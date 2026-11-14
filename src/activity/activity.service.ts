import { ActivityRepository } from './activity.repository';
import { Activity } from '../common/types/models';

export class ActivityService {
  constructor(private readonly activityRepo: ActivityRepository) {}

  private validateActivityName(displayName: string): boolean {
    const regex = /^[A-Za-z0-9 ]{1,32}$/;
    return regex.test(displayName);
  }

  async getActivities(guildId: string): Promise<Activity[]> {
    return this.activityRepo.getActivities(guildId);
  }

  async addActivity(
    guildId: string,
    displayName: string,
    emoji: string,
    userId: string,
  ): Promise<void> {
    if (!this.validateActivityName(displayName)) {
      throw new Error('Activity name must be alphanumeric (spaces allowed), max 32 characters.');
    }
    const created = await this.activityRepo.putActivity(guildId, displayName, emoji, false, userId);
    if (!created) {
      throw new Error(`An activity named "${displayName}" already exists.`);
    }
  }

  async removeActivity(guildId: string, name: string): Promise<void> {
    await this.activityRepo.deleteActivity(guildId, name);
  }

  async seedDefaults(guildId: string): Promise<void> {
    await this.activityRepo.seedDefaults(guildId);
  }
}
