import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as triggers from 'aws-cdk-lib/triggers';
import { Construct } from 'constructs';
import { DatabaseConstruct } from './database';

export interface DataOpsConstructProps {
  environment: string;
  database: DatabaseConstruct;
  /** Lambdas that must not get new code until the schema is in place. */
  appFunctions: lambda.Function[];
}

/**
 * The `migrate` Lambda (src/handlers/data-ops.ts) and the deploy-time ordering:
 *
 *   cluster -> migrate -> [app Lambdas update]
 *
 * A failed migration fails the deployment, so users never see new code against
 * a schema that is not ready.
 */
export class DataOpsConstruct extends Construct {
  public readonly migrate: lambda.Function;

  constructor(scope: Construct, id: string, props: DataOpsConstructProps) {
    super(scope, id);

    const { database, environment } = props;
    const timeout = cdk.Duration.minutes(10);

    this.migrate = new lambda.Function(this, 'Migrate', {
      functionName: `spotter-${environment}-migrate`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handlers/data-ops.migrate',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../..', 'dist')),
      memorySize: 1024,
      timeout,
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: { NODE_ENV: environment },
    });
    database.grantConnect(this.migrate);

    new triggers.Trigger(this, 'MigrateOnDeploy', {
      handler: this.migrate,
      timeout,
      executeAfter: [database.cluster],
      executeBefore: props.appFunctions,
    });
  }
}
