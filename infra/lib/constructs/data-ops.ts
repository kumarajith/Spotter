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
  /** Lambdas that must not get new code until the schema and data are in place. */
  appFunctions: lambda.Function[];
}

/**
 * Operational Lambdas (src/handlers/data-ops.ts) and the deploy-time ordering:
 *
 *   cluster -> migrate -> importLegacy -> [app Lambdas update] -> importLegacy again
 *
 * A failure before the app Lambdas update fails the deployment, so users never
 * see new code against a database that is not ready. The second import picks up
 * anything the old code wrote to DynamoDB while the deployment was running;
 * after that the app writes to Aurora DSQL only and the table is frozen.
 *
 * Everything except `migrate` is temporary and goes away with the DynamoDB table.
 */
export class DataOpsConstruct extends Construct {
  public readonly migrate: lambda.Function;
  public readonly importLegacy: lambda.Function;
  public readonly verify: lambda.Function;

  constructor(scope: Construct, id: string, props: DataOpsConstructProps) {
    super(scope, id);

    const { database, environment } = props;
    const code = lambda.Code.fromAsset(path.join(__dirname, '../../..', 'dist'));
    const timeout = cdk.Duration.minutes(10);

    const dataOpsFunction = (constructId: string, exportName: string, name: string) => {
      const fn = new lambda.Function(this, constructId, {
        functionName: `spotter-${environment}-${name}`,
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: `handlers/data-ops.${exportName}`,
        code,
        memorySize: 1024,
        timeout,
        logRetention: logs.RetentionDays.ONE_MONTH,
        environment: { NODE_ENV: environment },
      });
      database.grantConnect(fn);
      return fn;
    };

    /** The two functions that read the old table get its name and read-only access. */
    const readsLegacyTable = (fn: lambda.Function) => {
      fn.addEnvironment('TABLE_NAME', database.table.tableName);
      database.table.grantReadData(fn);
      return fn;
    };

    this.migrate = dataOpsFunction('Migrate', 'migrate', 'migrate');
    this.importLegacy = readsLegacyTable(
      dataOpsFunction('ImportLegacy', 'importLegacy', 'import-legacy'),
    );
    this.verify = readsLegacyTable(dataOpsFunction('Verify', 'verify', 'verify'));

    const migrateOnDeploy = new triggers.Trigger(this, 'MigrateOnDeploy', {
      handler: this.migrate,
      timeout,
      executeAfter: [database.cluster],
      executeBefore: props.appFunctions,
    });

    const importBeforeSwitch = new triggers.Trigger(this, 'ImportBeforeSwitch', {
      handler: this.importLegacy,
      timeout,
      executeAfter: [migrateOnDeploy],
      executeBefore: props.appFunctions,
    });

    new triggers.Trigger(this, 'ImportAfterSwitch', {
      handler: this.importLegacy,
      timeout,
      executeAfter: [importBeforeSwitch, ...props.appFunctions],
    });
  }
}
