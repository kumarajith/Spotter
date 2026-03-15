import { NestFactory } from '@nestjs/core';
import { SQSHandler } from 'aws-lambda';
import { ConsumerModule } from '../consumer/consumer.module';
import { ConsumerService } from '../consumer/consumer.service';
import { SqsMessage } from '../common/types/dynamo.types';

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
    const msg = JSON.parse(record.body) as SqsMessage;
    await consumerService.processMessage(msg);
  }
};
