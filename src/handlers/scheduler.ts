import { ScheduledHandler } from 'aws-lambda';
import { DiscordConfigService } from '../common/config/discord-config-service';
import { createDb } from '../db/db';
import { ActivityRepository } from '../activity/activity.repository';
import { ActivityService } from '../activity/activity.service';
import { PanelRepository } from '../panel/panel.repository';
import { PanelService } from '../panel/panel.service';
import { StreakRepository } from '../tracking/streak.repository';
import { SchedulerService } from '../scheduler/scheduler.service';

let schedulerService: SchedulerService | undefined;

function init(): SchedulerService {
  if (schedulerService) return schedulerService;

  const discordConfig = new DiscordConfigService();
  const db = createDb();

  const activityService = new ActivityService(new ActivityRepository(db));
  const panelRepository = new PanelRepository(db);
  const panelService = new PanelService(activityService, panelRepository, discordConfig);

  schedulerService = new SchedulerService(
    panelRepository,
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
