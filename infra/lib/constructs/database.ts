import * as cdk from 'aws-cdk-lib';
import * as dsql from 'aws-cdk-lib/aws-dsql';
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

  constructor(scope: Construct, id: string, props: DatabaseConstructProps) {
    super(scope, id);

    const isProd = props.environment === 'prod';

    this.cluster = new dsql.CfnCluster(this, 'Cluster', {
      deletionProtectionEnabled: isProd,
      tags: [{ key: 'Name', value: `spotter-${props.environment}` }],
    });
    this.cluster.applyRemovalPolicy(isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY);
    this.endpoint = `${this.cluster.attrIdentifier}.dsql.${cdk.Stack.of(this).region}.on.aws`;
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
