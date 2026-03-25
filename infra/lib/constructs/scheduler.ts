import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import { Construct } from 'constructs';

export interface SchedulerConstructProps {
  environment: string;
  table: dynamodb.ITable;
  discordBotToken: string;
  discordPublicKey: string;
  discordApplicationId: string;
}

export class SchedulerConstruct extends Construct {
  public readonly schedulerLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: SchedulerConstructProps) {
    super(scope, id);

    const appRoot = path.join(__dirname, '../../..');

    this.schedulerLambda = new lambda.Function(this, 'SchedulerHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handlers/scheduler.handler',
      code: lambda.Code.fromAsset(path.join(appRoot, 'dist')),
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      logRetention: logs.RetentionDays.TWO_WEEKS,
      environment: {
        TABLE_NAME: props.table.tableName,
        DISCORD_BOT_TOKEN: props.discordBotToken,
        DISCORD_PUBLIC_KEY: props.discordPublicKey,
        DISCORD_APPLICATION_ID: props.discordApplicationId,
        NODE_ENV: props.environment,
      },
    });

    props.table.grantReadWriteData(this.schedulerLambda);

    new scheduler.Schedule(this, 'DailySchedule', {
      // cron(0 0 * * ? *) — midnight UTC daily
      schedule: scheduler.ScheduleExpression.cron({
        hour: '0',
        minute: '0',
      }),
      target: new schedulerTargets.LambdaInvoke(this.schedulerLambda, {
        retryAttempts: 2,
      }),
    });
  }
}
