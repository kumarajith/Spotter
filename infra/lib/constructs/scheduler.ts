import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import { Construct } from 'constructs';

export interface SchedulerConstructProps {
  environment: string;
  table: dynamodb.ITable;
  discordParam: ssm.IStringParameter;
}

export class SchedulerConstruct extends Construct {
  public readonly schedulerLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: SchedulerConstructProps) {
    super(scope, id);

    this.schedulerLambda = new lambda.Function(this, 'SchedulerHandler', {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'handlers/scheduler.handler',
      code: lambda.Code.fromAsset('../dist'),
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      environment: {
        TABLE_NAME: props.table.tableName,
        DISCORD_PARAM_NAME: props.discordParam.parameterName,
        NODE_ENV: props.environment,
      },
    });

    props.table.grantReadWriteData(this.schedulerLambda);
    props.discordParam.grantRead(this.schedulerLambda);

    new scheduler.Schedule(this, 'DailySchedule', {
      // cron(0 8 * * ? *) — 8:00 AM UTC daily
      // UTC is the default timezone for EventBridge Scheduler
      schedule: scheduler.ScheduleExpression.cron({
        hour: '8',
        minute: '0',
      }),
      target: new schedulerTargets.LambdaInvoke(this.schedulerLambda, {
        retryAttempts: 2,
      }),
    });
  }
}
