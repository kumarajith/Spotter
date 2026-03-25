import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

export interface MonitoringConstructProps {
  apiLambda: lambda.IFunction;
  schedulerLambda: lambda.IFunction;
  alarmTopic: sns.ITopic;
}

export class MonitoringConstruct extends Construct {
  constructor(scope: Construct, id: string, props: MonitoringConstructProps) {
    super(scope, id);

    const snsAction = new cw_actions.SnsAction(props.alarmTopic);

    const apiAlarm = new cloudwatch.Alarm(this, 'ApiErrorAlarm', {
      metric: props.apiLambda.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'API Lambda errors detected',
    });
    apiAlarm.addAlarmAction(snsAction);

    const schedulerAlarm = new cloudwatch.Alarm(this, 'SchedulerErrorAlarm', {
      metric: props.schedulerLambda.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Scheduler Lambda errors detected',
    });
    schedulerAlarm.addAlarmAction(snsAction);
  }
}
