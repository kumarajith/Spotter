import { NestFactory } from '@nestjs/core';
import { ScheduledHandler } from 'aws-lambda';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { SchedulerService } from '../scheduler/scheduler.service';

let schedulerService: SchedulerService;

async function bootstrap(): Promise<SchedulerService> {
  const app = await NestFactory.createApplicationContext(SchedulerModule, {
    logger: ['error', 'warn', 'log'],
  });
  return app.get(SchedulerService);
}

export const handler: ScheduledHandler = async () => {
  schedulerService ??= await bootstrap();
  await schedulerService.runDailyTasks();
};
