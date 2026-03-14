import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { DatabaseConstruct } from './constructs/database';
import { QueueConstruct } from './constructs/queue';
import { ApiConstruct } from './constructs/api';

export interface SpotterStackProps extends cdk.StackProps {
  environment: string;
}

export class SpotterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SpotterStackProps) {
    super(scope, id, props);

    const db = new DatabaseConstruct(this, 'Database', {
      environment: props.environment,
    });
    const queue = new QueueConstruct(this, 'Queue', {
      environment: props.environment,
    });

    const discordParam =
      ssm.StringParameter.fromSecureStringParameterAttributes(
        this,
        'DiscordSecret',
        {
          parameterName: `/spotter/${props.environment}/discord`,
        },
      );

    new ApiConstruct(this, 'Api', {
      table: db.table,
      queue: queue.queue,
      discordParam,
      environment: props.environment,
    });
  }
}
