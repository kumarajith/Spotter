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

  // 1b. DynamoDB is gone: no table, and nothing is allowed to touch one
  describe('DynamoDB', () => {
    test('no table is created', () => {
      template.resourceCountIs('AWS::DynamoDB::Table', 0);
    });

    test('no function has a table name or any DynamoDB permission', () => {
      const functions = template.findResources('AWS::Lambda::Function');
      for (const fn of Object.values(functions)) {
        expect(fn.Properties.Environment?.Variables ?? {}).not.toHaveProperty('TABLE_NAME');
      }
      expect(JSON.stringify(template.findResources('AWS::IAM::Policy'))).not.toContain('dynamodb:');
    });
  });

  // 2. No SQS (removed in v2 optimization)
  describe('SQS', () => {
    test('no SQS queues are created', () => {
      template.resourceCountIs('AWS::SQS::Queue', 0);
    });
  });

  // 3. Lambda functions: API + Scheduler, the migrate function, and CDK's own providers
  describe('Lambda', () => {
    test('application, migrate and CDK provider functions are created', () => {
      // 2 application + migrate + log retention provider + deploy trigger provider
      template.resourceCountIs('AWS::Lambda::Function', 5);
    });

    test('migrate function exists and can reach the DSQL cluster', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'spotter-test-migrate',
        Handler: 'handlers/data-ops.migrate',
        Environment: { Variables: Match.objectLike({ DSQL_ENDPOINT: Match.anyValue() }) },
      });
    });

    test('every function that talks to the database may only connect to DSQL', () => {
      const functions = template.findResources('AWS::Lambda::Function');
      const policies = template.findResources('AWS::IAM::Policy');

      for (const handler of [
        'lambda.handler',
        'handlers/scheduler.handler',
        'handlers/data-ops.migrate',
      ]) {
        const fn = Object.values(functions).find((f) => f.Properties.Handler === handler)!;
        const roleId = fn.Properties.Role['Fn::GetAtt'][0];
        const attached = Object.values(policies).filter((p) =>
          JSON.stringify(p.Properties.Roles).includes(roleId),
        );
        const actions = attached.flatMap((p) =>
          p.Properties.PolicyDocument.Statement.flatMap(
            (st: { Action: string | string[] }) => st.Action,
          ),
        );
        expect(actions).toEqual(['dsql:DbConnectAdmin']);
      }
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
            DSQL_ENDPOINT: Match.anyValue(),
          }),
        },
      });
    });
  });

  // 3b. Deploy ordering: migrate -> app Lambdas update
  describe('Deploy trigger', () => {
    test('one trigger runs on deploy', () => {
      template.resourceCountIs('Custom::Trigger', 1);
    });

    test('app Lambdas wait for the migration', () => {
      const [migrate] = Object.keys(template.findResources('Custom::Trigger'));
      expect(migrate).toMatch(/MigrateOnDeploy/);

      const functions = template.findResources('AWS::Lambda::Function');
      for (const handler of ['lambda.handler', 'handlers/scheduler.handler']) {
        const fn = Object.values(functions).find((f) => f.Properties.Handler === handler);
        expect(fn?.DependsOn).toEqual(expect.arrayContaining([migrate]));
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
