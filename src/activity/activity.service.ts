import { BadRequestException, Injectable } from '@nestjs/common';
import { ActivityRepository } from './activity.repository';
import { ActivityItem } from '../common/types/dynamo.types';

@Injectable()
export class ActivityService {
  constructor(private readonly activityRepo: ActivityRepository) {}

  private validateActivityName(displayName: string): boolean {
    const regex = /^[A-Za-z0-9 ]{1,32}$/;
    return regex.test(displayName);
  }

  async getActivities(guildId: string): Promise<ActivityItem[]> {
    return this.activityRepo.getActivities(guildId);
  }

  async addActivity(
    guildId: string,
    displayName: string,
    emoji: string,
    userId: string,
  ): Promise<void> {
    if (!this.validateActivityName(displayName)) {
      throw new BadRequestException(
        'Activity name must be alphanumeric (spaces allowed), max 32 characters.',
      );
    }
    await this.activityRepo.putActivity(guildId, displayName, emoji, false, userId);
  }

  async removeActivity(guildId: string, name: string): Promise<void> {
    await this.activityRepo.deleteActivity(guildId, name);
  }

  async seedDefaults(guildId: string): Promise<void> {
    await this.activityRepo.seedDefaults(guildId);
  }
}
