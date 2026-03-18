import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export interface NotificationsConstructProps {
  environment: string;
  alarmEmail?: string;
}

export class NotificationsConstruct extends Construct {
  public readonly topic: sns.Topic;

  constructor(scope: Construct, id: string, props: NotificationsConstructProps) {
    super(scope, id);

    this.topic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `spotter-alarms-${props.environment}`,
      displayName: `Spotter Alarms (${props.environment})`,
    });

    if (props.alarmEmail) {
      this.topic.addSubscription(new subscriptions.EmailSubscription(props.alarmEmail));
    }
  }
}
