import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { verifyKey } from 'discord-interactions';
import { APIInteraction, InteractionType, InteractionResponseType } from 'discord-api-types/v10';
import { DiscordConfigService } from './common/config/discord-config-service';
import { DynamoService } from './common/dynamodb/dynamodb.service';
import { ActivityRepository } from './activity/activity.repository';
import { ActivityService } from './activity/activity.service';
import { TrackingRepository } from './tracking/tracking.repository';
import { StreakRepository } from './tracking/streak.repository';
import { StreakService } from './tracking/streak.service';
import { PanelRepository } from './panel/panel.repository';
import { PanelService } from './panel/panel.service';
import { DiscordService } from './discord/discord.service';

const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY ?? '';

let discordService: DiscordService | undefined;

function init(): DiscordService {
  if (discordService) return discordService;

  const discordConfig = new DiscordConfigService();
  const dynamo = new DynamoService();

  const activityRepository = new ActivityRepository(dynamo);
  const activityService = new ActivityService(activityRepository);

  const trackingRepository = new TrackingRepository(dynamo);
  const streakRepository = new StreakRepository(dynamo);
  const streakService = new StreakService(streakRepository);

  const panelRepository = new PanelRepository(dynamo);
  const panelService = new PanelService(activityService, panelRepository, discordConfig);

  discordService = new DiscordService(
    activityService,
    panelService,
    discordConfig,
    streakService,
    streakRepository,
    trackingRepository,
  );

  return discordService;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const signature = event.headers['x-signature-ed25519'] ?? '';
  const timestamp = event.headers['x-signature-timestamp'] ?? '';

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf-8')
    : (event.body ?? '');

  const isValid = await verifyKey(rawBody, signature, timestamp, DISCORD_PUBLIC_KEY);
  if (!isValid) {
    return { statusCode: 401, body: 'Invalid request signature' };
  }

  const interaction: APIInteraction = JSON.parse(rawBody) as APIInteraction;

  // PING — respond immediately without initializing services
  if (interaction.type === InteractionType.Ping) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: InteractionResponseType.Pong }),
    };
  }

  const service = init();
  let response: unknown;

  try {
    switch (interaction.type) {
      case InteractionType.ApplicationCommand:
        response = await service.handleCommand(interaction);
        break;
      case InteractionType.MessageComponent:
        response = await service.handleComponent(interaction);
        break;
      case InteractionType.ApplicationCommandAutocomplete:
        response = await service.handleAutocomplete(interaction);
        break;
      default:
        response = {
          type: InteractionResponseType.ChannelMessageWithSource,
          data: { content: 'Unknown interaction type.' },
        };
    }
  } catch (err) {
    console.error('Unhandled interaction error', err);
    response = {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content: 'Something went wrong. Please try again.', flags: 64 },
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(response),
  };
};
