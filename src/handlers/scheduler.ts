import { ScheduledHandler } from 'aws-lambda';
import { DiscordConfigService } from '../common/config/discord-config-service';
import { createDb } from '../db/db';
import { createRepositories } from '../legacy/mirror';
import { ActivityService } from '../activity/activity.service';
import { PanelService } from '../panel/panel.service';
import { StreakRepository } from '../tracking/streak.repository';
import { SchedulerService } from '../scheduler/scheduler.service';

let schedulerService: SchedulerService | undefined;

function init(): SchedulerService {
  if (schedulerService) return schedulerService;

  const discordConfig = new DiscordConfigService();
  const db = createDb();
  const repositories = createRepositories(db);

  const activityService = new ActivityService(repositories.activities);
  const panelService = new PanelService(activityService, repositories.panels, discordConfig);

  schedulerService = new SchedulerService(
    repositories.panels,
    panelService,
    new StreakRepository(db),
    discordConfig,
  );

  return schedulerService;
}

export const handler: ScheduledHandler = async () => {
  const service = init();
  await service.runDailyTasks();
};
