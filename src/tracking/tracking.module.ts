import { Module } from '@nestjs/common';
import { TrackingRepository } from './tracking.repository';
import { TrackingService } from './tracking.service';
import { StreakRepository } from './streak.repository';
import { StreakService } from './streak.service';

@Module({
  providers: [TrackingRepository, TrackingService, StreakRepository, StreakService],
  exports: [TrackingRepository, TrackingService, StreakRepository, StreakService],
})
export class TrackingModule {}
