import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';

export interface ApiConstructProps {
  environment: string;
  table: dynamodb.ITable;
  discordBotToken: string;
  discordPublicKey: string;
  discordApplicationId: string;
}

export class ApiConstruct extends Construct {
  public readonly apiLambda: lambda.Function;
  public readonly httpApi: apigateway.HttpApi;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    const appRoot = path.join(__dirname, '../../..');

    this.apiLambda = new lambda.Function(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'lambda.handler',
      code: lambda.Code.fromAsset(path.join(appRoot, 'dist')),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      logRetention: logs.RetentionDays.TWO_WEEKS,
      environment: {
        TABLE_NAME: props.table.tableName,
        DISCORD_BOT_TOKEN: props.discordBotToken,
        DISCORD_PUBLIC_KEY: props.discordPublicKey,
        DISCORD_APPLICATION_ID: props.discordApplicationId,
        NODE_ENV: props.environment,
      },
    });

    props.table.grantReadWriteData(this.apiLambda);

    this.httpApi = new apigateway.HttpApi(this, 'HttpApi', {
      apiName: `spotter-api-${props.environment}`,
    });

    this.httpApi.addRoutes({
      path: '/interactions',
      methods: [apigateway.HttpMethod.POST],
      integration: new HttpLambdaIntegration('ApiIntegration', this.apiLambda),
    });
  }
}
