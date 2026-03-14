import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';

export interface ApiConstructProps {
  environment: string;
  table: dynamodb.ITable;
  queue: sqs.IQueue;
  discordParam: ssm.IStringParameter;
}

export class ApiConstruct extends Construct {
  public readonly apiLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    this.apiLambda = new lambda.Function(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambda.handler',
      code: lambda.Code.fromAsset('../dist'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: props.table.tableName,
        QUEUE_URL: props.queue.queueUrl,
        DISCORD_PARAM_NAME: props.discordParam.parameterName,
        NODE_ENV: props.environment,
      },
    });

    props.table.grantReadWriteData(this.apiLambda);
    props.queue.grantSendMessages(this.apiLambda);
    props.discordParam.grantRead(this.apiLambda);

    const httpApi = new apigateway.HttpApi(this, 'HttpApi', {
      apiName: `spotter-api-${props.environment}`,
    });

    httpApi.addRoutes({
      path: '/interactions',
      methods: [apigateway.HttpMethod.POST],
      integration: new HttpLambdaIntegration('ApiIntegration', this.apiLambda),
    });
  }
}
