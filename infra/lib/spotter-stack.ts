import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
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

    // Resolve Discord credentials from SSM String parameters at deploy time.
    // Values are injected into Lambda env vars via CloudFormation dynamic
    // references ({{resolve:ssm:...}}) — zero runtime latency, no IAM grants.
    //
    // Create these params once per environment:
    //   aws ssm put-parameter --name "/spotter/<env>/discord-bot-token" --type String --value "..."
    //   aws ssm put-parameter --name "/spotter/<env>/discord-public-key" --type String --value "..."
    //   aws ssm put-parameter --name "/spotter/<env>/discord-application-id" --type String --value "..."
    const paramPrefix = `/spotter/${props.environment}`;
    const discordBotToken = ssm.StringParameter.valueForStringParameter(
      this,
      `${paramPrefix}/discord-bot-token`,
    );
    const discordPublicKey = ssm.StringParameter.valueForStringParameter(
      this,
      `${paramPrefix}/discord-public-key`,
    );
    const discordApplicationId = ssm.StringParameter.valueForStringParameter(
      this,
      `${paramPrefix}/discord-application-id`,
    );

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
