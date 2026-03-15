import { Injectable } from '@nestjs/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SqsMessage } from '../common/types/dynamo.types';

@Injectable()
export class SqsService {
  private readonly client = new SQSClient({});
  private readonly queueUrl: string;

  constructor() {
    const queueUrl = process.env.QUEUE_URL;
    if (!queueUrl) {
      throw new Error('QUEUE_URL environment variable is required');
    }
    this.queueUrl = queueUrl;
  }

  async send(message: SqsMessage): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
      }),
    );
  }
}
