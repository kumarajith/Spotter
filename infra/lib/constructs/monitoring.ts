import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface MonitoringConstructProps {
  dlq: sqs.IQueue;
  consumerLambda: lambda.IFunction;
  schedulerLambda: lambda.IFunction;
  alarmTopic: sns.ITopic;
}

export class MonitoringConstruct extends Construct {
  constructor(scope: Construct, id: string, props: MonitoringConstructProps) {
    super(scope, id);

    const snsAction = new cw_actions.SnsAction(props.alarmTopic);

    const dlqAlarm = new cloudwatch.Alarm(this, 'DlqAlarm', {
      metric: props.dlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Messages in DLQ — activity log processing failures detected',
    });
    dlqAlarm.addAlarmAction(snsAction);

    const consumerAlarm = new cloudwatch.Alarm(this, 'ConsumerErrorAlarm', {
      metric: props.consumerLambda.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'SQS consumer Lambda errors detected',
    });
    consumerAlarm.addAlarmAction(snsAction);

    const schedulerAlarm = new cloudwatch.Alarm(this, 'SchedulerErrorAlarm', {
      metric: props.schedulerLambda.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Scheduler Lambda errors detected',
    });
    schedulerAlarm.addAlarmAction(snsAction);
  }
}
