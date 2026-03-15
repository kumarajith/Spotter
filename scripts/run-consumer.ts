/**
 * Local consumer poller — simulates the SQS-triggered Lambda for local development.
 *
 * Usage:
 *   npm run consumer:local
 *
 * Requires:
 *   QUEUE_URL=http://localhost:4566/000000000000/<queue-name>
 *   TABLE_NAME=spotter-dev
 *   DYNAMODB_ENDPOINT=http://localhost:8000   (or 4566 if using LocalStack for DynamoDB too)
 */
import 'dotenv/config';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { NestFactory } from '@nestjs/core';
import { ConsumerModule } from '../src/consumer/consumer.module';
import { ConsumerService } from '../src/consumer/consumer.service';
import { SqsMessage } from '../src/common/types/sqs.types';

async function bootstrap(): Promise<ConsumerService> {
  const app = await NestFactory.createApplicationContext(ConsumerModule, {
    logger: ['error', 'warn', 'log'],
  });
  return app.get(ConsumerService);
}

async function main() {
  const queueUrl = process.env.QUEUE_URL;
  if (!queueUrl) throw new Error('QUEUE_URL is required');

  const { hostname, origin } = new URL(queueUrl);
  const isLocal = !hostname.includes('amazonaws.com');

  const sqs = new SQSClient(
    isLocal
      ? {
          endpoint: origin,
          region: 'us-east-1',
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }
      : {},
  );

  console.log('🚀 Bootstrapping consumer...');
  const consumerService = await bootstrap();
  console.log(`✅ Polling ${queueUrl}`);
  console.log('   Press Ctrl+C to stop.\n');

  let running = true;
  process.on('SIGINT', () => {
    running = false;
    console.log('\n🛑 Shutting down...');
  });
  process.on('SIGTERM', () => {
    running = false;
  });

  while (running) {
    const { Messages: messages = [] } = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20, // long polling — avoids busy-wait
      }),
    );

    for (const msg of messages) {
      const body = msg.Body!;
      let parsed: SqsMessage;

      try {
        parsed = JSON.parse(body) as SqsMessage;
      } catch {
        console.error(`❌ Invalid JSON in message body, skipping:`, body);
        await sqs.send(
          new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle! }),
        );
        continue;
      }

      try {
        await consumerService.processMessage(parsed);
        await sqs.send(
          new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle! }),
        );
        console.log(`✅ [${parsed.type}] processed`);
      } catch (err) {
        // Leave the message in the queue — it becomes visible again after the visibility timeout.
        console.error(`❌ [${parsed.type}] failed — message will retry:`, err);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
