import { Module } from '@nestjs/common';
import { DynamoModule } from '../common/dynamodb/dynamodb.module';
import { TrackingModule } from '../tracking/tracking.module';
import { ConsumerService } from './consumer.service';

@Module({
  imports: [DynamoModule, TrackingModule],
  providers: [ConsumerService],
})
export class ConsumerModule {}
