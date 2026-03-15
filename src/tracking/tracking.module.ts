import { Module } from '@nestjs/common';
import { TrackingRepository } from './tracking.repository';
import { TrackingService } from './tracking.service';

@Module({
  providers: [TrackingRepository, TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}
