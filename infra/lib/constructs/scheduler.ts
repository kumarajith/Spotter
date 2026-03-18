import * as path from 'path';
import { execSync } from 'child_process';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
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

    const appRoot = path.join(__dirname, '../../..');
    const distPath = path.join(appRoot, 'dist');

    this.schedulerLambda = new lambda.Function(this, 'SchedulerHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handlers/scheduler.handler',
      code: lambda.Code.fromAsset(appRoot, {
        assetHashType: cdk.AssetHashType.OUTPUT,
        bundling: {
          image: lambda.Runtime.NODEJS_22_X.bundlingImage,
          local: {
            tryBundle(outputDir: string): boolean {
              try {
                execSync(
                  `cp -r "${distPath}/." "${outputDir}/" && ` +
                    `cp "${appRoot}/package.json" "${outputDir}/" && ` +
                    `cp "${appRoot}/package-lock.json" "${outputDir}/" && ` +
                    `npm ci --omit=dev --prefix "${outputDir}"`,
                  { stdio: 'inherit' },
                );
                return true;
              } catch {
                return false;
              }
            },
          },
          command: [
            'bash',
            '-c',
            [
              'cp -r /asset-input/dist/. /asset-output/',
              'cp /asset-input/package.json /asset-output/',
              'cp /asset-input/package-lock.json /asset-output/',
              'npm ci --omit=dev --prefix /asset-output',
            ].join(' && '),
          ],
        },
      }),
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      logRetention: logs.RetentionDays.TWO_WEEKS,
      environment: {
        TABLE_NAME: props.table.tableName,
        DISCORD_PARAM_NAME: props.discordParam.parameterName,
        NODE_ENV: props.environment,
      },
    });

    props.table.grantReadWriteData(this.schedulerLambda);
    props.discordParam.grantRead(this.schedulerLambda);

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
