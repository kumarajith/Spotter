import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SpotterStack } from '../lib/spotter-stack';

function createTemplate(): Template {
  const app = new cdk.App();
  const stack = new SpotterStack(app, 'TestStack', {
    environment: 'test',
    env: { region: 'ap-south-1', account: '123456789012' },
  });
  return Template.fromStack(stack);
}

describe('SpotterStack', () => {
  let template: Template;

  beforeAll(() => {
    template = createTemplate();
  });

  // 1. Aurora DSQL cluster — the primary database
  describe('Aurora DSQL', () => {
    test('one cluster is created', () => {
      template.resourceCountIs('AWS::DSQL::Cluster', 1);
    });

    test('app Lambdas get the cluster endpoint and may connect as admin', () => {
      for (const handler of ['lambda.handler', 'handlers/scheduler.handler']) {
        template.hasResourceProperties('AWS::Lambda::Function', {
          Handler: handler,
          Environment: { Variables: Match.objectLike({ DSQL_ENDPOINT: Match.anyValue() }) },
        });
      }
      const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
      expect(policies.match(/dsql:DbConnectAdmin/g)?.length).toBeGreaterThanOrEqual(2);
    });

    test('prod cluster is deletion-protected and retained', () => {
      const prod = Template.fromStack(
        new SpotterStack(new cdk.App(), 'ProdStack', {
          environment: 'prod',
          env: { region: 'ap-south-1', account: '123456789012' },
        }),
      );
      prod.hasResource('AWS::DSQL::Cluster', {
        Properties: { DeletionProtectionEnabled: true },
        DeletionPolicy: 'Retain',
      });
    });
  });

  // 1b. DynamoDB table (pre-v4 store, mirrored during the cutover)
  describe('DynamoDB', () => {
    test('table has point-in-time recovery enabled', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      });
    });

    test('table has on-demand billing mode', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
      });
    });

    test('table has GSI1 with ALL projection', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'GSI1',
            Projection: { ProjectionType: 'ALL' },
            KeySchema: Match.arrayWith([
              Match.objectLike({ AttributeName: 'GSI1PK', KeyType: 'HASH' }),
              Match.objectLike({ AttributeName: 'GSI1SK', KeyType: 'RANGE' }),
            ]),
          }),
        ]),
      });
    });

    test('table has correct key schema (PK + SK)', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        KeySchema: Match.arrayWith([
          Match.objectLike({ AttributeName: 'PK', KeyType: 'HASH' }),
          Match.objectLike({ AttributeName: 'SK', KeyType: 'RANGE' }),
        ]),
      });
    });
  });

  // 2. No SQS (removed in v2 optimization)
  describe('SQS', () => {
    test('no SQS queues are created', () => {
      template.resourceCountIs('AWS::SQS::Queue', 0);
    });
  });

  // 3. Lambda functions: API + Scheduler, the data-ops functions, and CDK's own providers
  describe('Lambda', () => {
    test('application, data-ops and CDK provider functions are created', () => {
      // 2 application + 4 data-ops + log retention provider + deploy trigger provider
      template.resourceCountIs('AWS::Lambda::Function', 8);
    });

    test.each([
      ['spotter-test-migrate', 'handlers/data-ops.migrate'],
      ['spotter-test-import-legacy', 'handlers/data-ops.importLegacy'],
      ['spotter-test-verify', 'handlers/data-ops.verify'],
      ['spotter-test-recompute-legacy-streaks', 'handlers/data-ops.recomputeLegacyStreaks'],
    ])('data-ops function %s exists', (FunctionName, Handler) => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName,
        Handler,
        Environment: {
          Variables: Match.objectLike({
            DSQL_ENDPOINT: Match.anyValue(),
            TABLE_NAME: Match.anyValue(),
          }),
        },
      });
    });

    test('API Lambda exists with correct handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'lambda.handler',
        Runtime: 'nodejs22.x',
        MemorySize: 512,
      });
    });

    test('Scheduler Lambda exists with correct handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'handlers/scheduler.handler',
        Runtime: 'nodejs22.x',
        MemorySize: 512,
        Timeout: 300, // 5 minutes
      });
    });

    test('API Lambda has Discord credential env vars', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'lambda.handler',
        Environment: {
          Variables: Match.objectLike({
            DISCORD_BOT_TOKEN: Match.anyValue(),
            DISCORD_PUBLIC_KEY: Match.anyValue(),
            DISCORD_APPLICATION_ID: Match.anyValue(),
            TABLE_NAME: Match.anyValue(),
          }),
        },
      });
    });
  });

  // 3b. Deploy ordering: migrate -> import -> app Lambdas update -> import again
  describe('Deploy triggers', () => {
    const logicalId = (resources: Record<string, unknown>, match: RegExp) => {
      const ids = Object.keys(resources).filter((id) => match.test(id));
      expect(ids).toHaveLength(1);
      return ids[0];
    };

    test('three triggers run on deploy', () => {
      template.resourceCountIs('Custom::Trigger', 3);
    });

    test('app Lambdas wait for the migration and the first import', () => {
      const triggers = template.findResources('Custom::Trigger');
      const migrate = logicalId(triggers, /MigrateOnDeploy/);
      const importBefore = logicalId(triggers, /ImportBeforeSwitch/);

      const functions = template.findResources('AWS::Lambda::Function');
      for (const handler of ['lambda.handler', 'handlers/scheduler.handler']) {
        const fn = Object.values(functions).find((f) => f.Properties.Handler === handler);
        expect(fn?.DependsOn).toEqual(expect.arrayContaining([migrate, importBefore]));
      }
      expect(triggers[importBefore].DependsOn).toEqual(expect.arrayContaining([migrate]));
    });

    test('the second import waits for both app Lambdas', () => {
      const triggers = template.findResources('Custom::Trigger');
      const importAfter = triggers[logicalId(triggers, /ImportAfterSwitch/)];

      const functions = template.findResources('AWS::Lambda::Function');
      for (const handler of ['lambda.handler', 'handlers/scheduler.handler']) {
        const [id] = Object.entries(functions).find(([, f]) => f.Properties.Handler === handler)!;
        expect(importAfter.DependsOn).toEqual(expect.arrayContaining([id]));
      }
    });
  });

  // 4. Two CloudWatch alarms (API + Scheduler errors)
  describe('CloudWatch Alarms', () => {
    test('two alarms are created', () => {
      template.resourceCountIs('AWS::CloudWatch::Alarm', 2);
    });

    test('API error alarm exists', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'Errors',
        Threshold: 1,
        AlarmDescription: 'API Lambda errors detected',
      });
    });

    test('scheduler error alarm exists', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'Errors',
        Threshold: 1,
        AlarmDescription: 'Scheduler Lambda errors detected',
      });
    });
  });

  // 5. HTTP API created
  describe('HTTP API', () => {
    test('API Gateway HTTP API is created', () => {
      template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    });

    test('HTTP API has correct name', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
        Name: 'spotter-api-test',
        ProtocolType: 'HTTP',
      });
    });
  });

  // 6. SNS topic created
  describe('SNS', () => {
    test('alarm topic is created', () => {
      template.resourceCountIs('AWS::SNS::Topic', 1);
    });

    test('topic has correct name', () => {
      template.hasResourceProperties('AWS::SNS::Topic', {
        TopicName: 'spotter-alarms-test',
      });
    });

    const templateWithContext = (context: Record<string, string>) =>
      Template.fromStack(
        new SpotterStack(new cdk.App({ context }), 'EmailStack', {
          environment: 'test',
          env: { region: 'ap-south-1', account: '123456789012' },
        }),
      );

    test('alarmEmail context subscribes that address to the topic', () => {
      templateWithContext({ alarmEmail: 'ops@example.com' }).hasResourceProperties(
        'AWS::SNS::Subscription',
        { Protocol: 'email', Endpoint: 'ops@example.com' },
      );
    });

    test('no subscription without alarmEmail, or when it is empty', () => {
      template.resourceCountIs('AWS::SNS::Subscription', 0);
      templateWithContext({ alarmEmail: '' }).resourceCountIs('AWS::SNS::Subscription', 0);
    });
  });

  // 7. Alarms have SNS actions
  describe('Alarm SNS Actions', () => {
    test('all alarms have alarm actions configured', () => {
      const alarms = template.findResources('AWS::CloudWatch::Alarm');
      const alarmKeys = Object.keys(alarms);

      expect(alarmKeys).toHaveLength(2);

      for (const key of alarmKeys) {
        const alarm = alarms[key];
        expect(alarm.Properties.AlarmActions).toBeDefined();
        expect(alarm.Properties.AlarmActions).toHaveLength(1);
      }
    });
  });
});
