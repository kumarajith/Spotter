import { Global, Module } from '@nestjs/common';
import { DynamoService } from './dynamodb.service';

@Global()
@Module({
  providers: [DynamoService],
  exports: [DynamoService],
})
export class DynamoModule {}
