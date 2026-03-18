import { Injectable } from '@nestjs/common';
import { TrackingRepository } from './tracking.repository';

@Injectable()
export class TrackingService {
  constructor(private readonly trackingRepository: TrackingRepository) {}

  async log(
    guildId: string,
    userId: string,
    activityName: string,
  ): Promise<{ alreadyLogged: boolean }> {
    const date = new Date().toISOString().slice(0, 10);
    return this.trackingRepository.logActivity(guildId, userId, activityName, date);
  }
}
