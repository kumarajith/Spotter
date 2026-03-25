import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DatabaseConstruct } from './constructs/database';
import { ApiConstruct } from './constructs/api';
import { SchedulerConstruct } from './constructs/scheduler';
import { MonitoringConstruct } from './constructs/monitoring';
import { NotificationsConstruct } from './constructs/notifications';

export interface SpotterStackProps extends cdk.StackProps {
  environment: string;
}

export class SpotterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SpotterStackProps) {
    super(scope, id, props);

    const discordBotToken = process.env.DISCORD_BOT_TOKEN ?? '';
    const discordPublicKey = process.env.DISCORD_PUBLIC_KEY ?? '';
    const discordApplicationId = process.env.DISCORD_APPLICATION_ID ?? '';

    const db = new DatabaseConstruct(this, 'Database', {
      environment: props.environment,
    });

    const api = new ApiConstruct(this, 'Api', {
      table: db.table,
      discordBotToken,
      discordPublicKey,
      discordApplicationId,
      environment: props.environment,
    });

    const scheduler = new SchedulerConstruct(this, 'Scheduler', {
      table: db.table,
      discordBotToken,
      discordPublicKey,
      discordApplicationId,
      environment: props.environment,
    });

    const alarmEmail = String(this.node.tryGetContext('alarmEmail') ?? '');
    const notifications = new NotificationsConstruct(this, 'Notifications', {
      environment: props.environment,
      ...(alarmEmail && { alarmEmail }),
    });

    new MonitoringConstruct(this, 'Monitoring', {
      apiLambda: api.apiLambda,
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
  }
}
