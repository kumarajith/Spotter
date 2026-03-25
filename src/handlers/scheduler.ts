import { ScheduledHandler } from 'aws-lambda';
import { DiscordConfigService } from '../common/config/discord-config-service';
import { DynamoService } from '../common/dynamodb/dynamodb.service';
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
  const dynamo = new DynamoService();

  const activityRepository = new ActivityRepository(dynamo);
  const activityService = new ActivityService(activityRepository);

  const panelRepository = new PanelRepository(dynamo);
  const panelService = new PanelService(activityService, panelRepository, discordConfig);

  const streakRepository = new StreakRepository(dynamo);

  schedulerService = new SchedulerService(
    panelRepository,
    panelService,
    streakRepository,
    discordConfig,
  );

  return schedulerService;
}

export const handler: ScheduledHandler = async () => {
  const service = init();
  await service.runDailyTasks();
};
