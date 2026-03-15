import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SQSHandler } from 'aws-lambda';
import { ConsumerModule } from '../consumer/consumer.module';
import { ConsumerService } from '../consumer/consumer.service';
import { isValidSqsMessage } from '../common/types/sqs.types';

const logger = new Logger('SqsConsumerHandler');

let consumerService: ConsumerService;

async function bootstrap(): Promise<ConsumerService> {
  const app = await NestFactory.createApplicationContext(ConsumerModule, {
    logger: ['error', 'warn'],
  });
  return app.get(ConsumerService);
}

export const handler: SQSHandler = async (event) => {
  consumerService ??= await bootstrap();

  for (const record of event.Records) {
    const parsed: unknown = JSON.parse(record.body);
    if (!isValidSqsMessage(parsed)) {
      logger.error(`Invalid SQS message, skipping: ${record.body}`);
      continue;
    }
    await consumerService.processMessage(parsed);
  }
};
