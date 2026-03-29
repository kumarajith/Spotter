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

  // 1. DynamoDB table with on-demand billing + PITR + GSI1
  describe('DynamoDB', () => {
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

  // 3. Two Lambda functions (API + Scheduler) + log retention provider
  describe('Lambda', () => {
    test('two application Lambda functions are created (plus log retention provider)', () => {
      // 2 application Lambdas + 1 CDK-generated log retention custom resource provider
      template.resourceCountIs('AWS::Lambda::Function', 3);
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
