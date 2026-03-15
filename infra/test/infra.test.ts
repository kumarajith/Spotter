import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SpotterStack } from '../lib/spotter-stack';

// Mock Code.fromAsset so we don't need an actual dist/ directory
jest.mock('aws-cdk-lib/aws-lambda', () => {
  const actual = jest.requireActual('aws-cdk-lib/aws-lambda');
  const originalFromAsset = actual.Code.fromAsset;
  actual.Code.fromAsset = function (path: string, ...args: unknown[]) {
    // Create a temporary directory for the mock asset
    const fs = require('fs');
    const os = require('os');
    const p = require('path');
    const tmpDir = p.join(os.tmpdir(), 'cdk-mock-asset');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    return originalFromAsset(tmpDir, ...args);
  };
  return actual;
});

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

    test('table has point-in-time recovery enabled', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
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

  // 2. SQS queue + DLQ with redrive policy (maxReceiveCount: 3)
  describe('SQS', () => {
    test('processing queue and DLQ are created', () => {
      template.resourceCountIs('AWS::SQS::Queue', 2);
    });

    test('processing queue has redrive policy with maxReceiveCount 3', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        RedrivePolicy: Match.objectLike({
          maxReceiveCount: 3,
        }),
      });
    });

    test('DLQ has 14-day retention period', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        MessageRetentionPeriod: 1209600, // 14 days in seconds
      });
    });
  });

  // 3. Three Lambda functions (API, Consumer, Scheduler)
  describe('Lambda', () => {
    test('three application Lambda functions are created (plus log retention provider)', () => {
      // 3 application Lambdas + 1 CDK-generated log retention custom resource provider
      template.resourceCountIs('AWS::Lambda::Function', 4);
    });

    test('API Lambda exists with correct handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'lambda.handler',
        Runtime: 'nodejs24.x',
        MemorySize: 512,
      });
    });

    test('Consumer Lambda exists with correct handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'handlers/sqs-consumer.handler',
        Runtime: 'nodejs24.x',
        MemorySize: 256,
      });
    });

    test('Scheduler Lambda exists with correct handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'handlers/scheduler.handler',
        Runtime: 'nodejs24.x',
        MemorySize: 512,
        Timeout: 300, // 5 minutes
      });
    });
  });

  // 4. Three CloudWatch alarms exist
  describe('CloudWatch Alarms', () => {
    test('three alarms are created', () => {
      template.resourceCountIs('AWS::CloudWatch::Alarm', 3);
    });

    test('DLQ alarm exists', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'ApproximateNumberOfMessagesVisible',
        Threshold: 1,
        EvaluationPeriods: 1,
      });
    });

    test('consumer error alarm exists', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'Errors',
        Threshold: 1,
        AlarmDescription: 'SQS consumer Lambda errors detected',
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

      expect(alarmKeys).toHaveLength(3);

      for (const key of alarmKeys) {
        const alarm = alarms[key];
        expect(alarm.Properties.AlarmActions).toBeDefined();
        expect(alarm.Properties.AlarmActions).toHaveLength(1);
      }
    });
  });
});
