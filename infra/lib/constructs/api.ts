import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';

export interface ApiConstructProps {
  environment: string;
  table: dynamodb.ITable;
  queue: sqs.IQueue;
  discordParam: ssm.IStringParameter;
}

export class ApiConstruct extends Construct {
  public readonly apiLambda: lambda.Function;
  public readonly consumerLambda: lambda.Function;
  public readonly httpApi: apigateway.HttpApi;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    const codePath = path.join(__dirname, '../../dist');
    const consumerTimeout = cdk.Duration.seconds(60);

    this.apiLambda = new lambda.Function(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'lambda.handler',
      code: lambda.Code.fromAsset(codePath),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      logRetention: logs.RetentionDays.TWO_WEEKS,
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

    this.consumerLambda = new lambda.Function(this, 'SqsConsumer', {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'handlers/sqs-consumer.handler',
      code: lambda.Code.fromAsset(codePath),
      memorySize: 256,
      timeout: consumerTimeout,
      logRetention: logs.RetentionDays.TWO_WEEKS,
      environment: {
        TABLE_NAME: props.table.tableName,
        DISCORD_PARAM_NAME: props.discordParam.parameterName,
        NODE_ENV: props.environment,
      },
    });

    props.table.grantReadWriteData(this.consumerLambda);
    props.discordParam.grantRead(this.consumerLambda);

    this.consumerLambda.addEventSource(new SqsEventSource(props.queue, { batchSize: 1 }));

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
