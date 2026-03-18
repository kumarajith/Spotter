import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DatabaseConstruct } from './constructs/database';
import { QueueConstruct } from './constructs/queue';
import { ApiConstruct } from './constructs/api';
import { SecretsConstruct } from './constructs/secrets';
import { SchedulerConstruct } from './constructs/scheduler';
import { MonitoringConstruct } from './constructs/monitoring';
import { NotificationsConstruct } from './constructs/notifications';

export interface SpotterStackProps extends cdk.StackProps {
  environment: string;
}

export class SpotterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SpotterStackProps) {
    super(scope, id, props);

    const db = new DatabaseConstruct(this, 'Database', {
      environment: props.environment,
    });

    const queue = new QueueConstruct(this, 'Queue', {
      environment: props.environment,
    });

    const secrets = new SecretsConstruct(this, 'Secrets', {
      environment: props.environment,
    });

    const api = new ApiConstruct(this, 'Api', {
      table: db.table,
      queue: queue.queue,
      discordParam: secrets.discordParam,
      environment: props.environment,
    });

    const scheduler = new SchedulerConstruct(this, 'Scheduler', {
      table: db.table,
      discordParam: secrets.discordParam,
      environment: props.environment,
    });

    const alarmEmail = String(this.node.tryGetContext('alarmEmail') ?? '');
    const notifications = new NotificationsConstruct(this, 'Notifications', {
      environment: props.environment,
      ...(alarmEmail && { alarmEmail }),
    });

    new MonitoringConstruct(this, 'Monitoring', {
      dlq: queue.dlq,
      consumerLambda: api.consumerLambda,
      schedulerLambda: scheduler.schedulerLambda,
      alarmTopic: notifications.topic,
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.httpApi.url ?? 'N/A',
      description: 'HTTP API endpoint URL',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: db.table.tableName,
      description: 'DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'QueueUrl', {
      value: queue.queue.queueUrl,
      description: 'SQS processing queue URL',
    });
  }
}
