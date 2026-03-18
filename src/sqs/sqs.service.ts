import { Injectable } from '@nestjs/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SqsMessage } from '../common/types/sqs.types';

@Injectable()
export class SqsService {
  private readonly client: SQSClient;
  private readonly queueUrl: string;

  constructor() {
    const queueUrl = process.env.QUEUE_URL;
    if (!queueUrl) {
      throw new Error('QUEUE_URL environment variable is required');
    }
    this.queueUrl = queueUrl;

    // If the queue URL points somewhere other than AWS (e.g. LocalStack),
    // extract the origin and use it as the endpoint. No extra env var needed.
    const { hostname, origin } = new URL(queueUrl);
    const isLocal = !hostname.includes('amazonaws.com');
    this.client = new SQSClient(
      isLocal
        ? {
            endpoint: origin,
            region: 'us-east-1',
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
          }
        : {},
    );
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
