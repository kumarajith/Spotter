import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface QueueConstructProps {
  environment: string;
}

export class QueueConstruct extends Construct {
  public readonly queue: sqs.Queue;
  public readonly dlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: QueueConstructProps) {
    super(scope, id);
    this.dlq = new sqs.Queue(this, 'DLQ', {
      queueName: `spotter-dlq-${props.environment}`,
      retentionPeriod: cdk.Duration.days(14),
    });

    this.queue = new sqs.Queue(this, 'ProcessingQueue', {
      queueName: `spotter-queue-${props.environment}`,
      visibilityTimeout: cdk.Duration.seconds(120), // 2x consumer Lambda timeout (60s)
      deadLetterQueue: { queue: this.dlq, maxReceiveCount: 3 },
    });
  }
}
