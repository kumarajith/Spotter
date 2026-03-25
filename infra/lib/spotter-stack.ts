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

    // Resolve Discord credentials from SSM SecureString at deploy time.
    // Values are injected into Lambda env vars via CloudFormation dynamic
    // references — they never appear in the CloudFormation template.
    //
    // Create these params once per environment:
    //   aws ssm put-parameter --name "/spotter/<env>/discord-bot-token" --type SecureString --value "..."
    //   aws ssm put-parameter --name "/spotter/<env>/discord-public-key" --type SecureString --value "..."
    //   aws ssm put-parameter --name "/spotter/<env>/discord-application-id" --type SecureString --value "..."
    const paramPrefix = `/spotter/${props.environment}`;
    const discordBotToken = cdk.SecretValue.ssmSecure(
      `${paramPrefix}/discord-bot-token`,
    ).unsafeUnwrap();
    const discordPublicKey = cdk.SecretValue.ssmSecure(
      `${paramPrefix}/discord-public-key`,
    ).unsafeUnwrap();
    const discordApplicationId = cdk.SecretValue.ssmSecure(
      `${paramPrefix}/discord-application-id`,
    ).unsafeUnwrap();

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
