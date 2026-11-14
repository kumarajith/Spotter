import * as cdk from 'aws-cdk-lib';
import * as dsql from 'aws-cdk-lib/aws-dsql';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface DatabaseConstructProps {
  environment: string;
}

export class DatabaseConstruct extends Construct {
  /** Aurora DSQL — the database the app reads from and writes to. */
  public readonly cluster: dsql.CfnCluster;
  /** Hostname the Lambdas connect to. */
  public readonly endpoint: string;

  /**
   * The pre-v4 DynamoDB table. During the v4 cutover every write is mirrored
   * into it so it stays a complete copy; it is removed once v4 is confirmed.
   */
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatabaseConstructProps) {
    super(scope, id);

    const isProd = props.environment === 'prod';
    const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    this.cluster = new dsql.CfnCluster(this, 'Cluster', {
      deletionProtectionEnabled: isProd,
      tags: [{ key: 'Name', value: `spotter-${props.environment}` }],
    });
    this.cluster.applyRemovalPolicy(removalPolicy);
    this.endpoint = `${this.cluster.attrIdentifier}.dsql.${cdk.Stack.of(this).region}.on.aws`;

    this.table = new dynamodb.Table(this, 'SpotterTable', {
      tableName: `spotter-${props.environment}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }

  /**
   * Lets a Lambda connect to the cluster: the endpoint as DSQL_ENDPOINT plus
   * permission to sign IAM auth tokens for the built-in `admin` database role.
   */
  grantConnect(fn: lambda.Function): void {
    fn.addEnvironment('DSQL_ENDPOINT', this.endpoint);
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dsql:DbConnectAdmin'],
        resources: [this.cluster.attrResourceArn],
      }),
    );
  }
}
