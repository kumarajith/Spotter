import { Test, TestingModule } from '@nestjs/testing';
import {
  InteractionResponseType,
  InteractionType,
  MessageFlags,
  ComponentType,
  ApplicationCommandType,
  ApplicationCommandOptionType,
} from 'discord-api-types/v10';
import { DiscordService } from './discord.service';
import { ActivityService } from '../activity/activity.service';
import { PanelService } from '../panel/panel.service';
import { DiscordConfigService } from '../common/config/discord-config-service';
import { SqsService } from '../sqs/sqs.service';
import { StreakRepository } from '../tracking/streak.repository';
import { TrackingRepository } from '../tracking/tracking.repository';
import { COMMANDS } from './commands';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCommandInteraction(name: string, options?: any[], overrides?: Record<string, any>) {
  return {
    type: InteractionType.ApplicationCommand,
    guild_id: 'guild-1',
    channel: { id: 'channel-1' },
    member: { user: { id: 'user-1' } },
    token: 'interaction-token',
    data: {
      type: ApplicationCommandType.ChatInput,
      name,
      options: options ?? [],
      ...overrides?.data,
    },
    ...overrides,
  };
}

function makeComponentInteraction(customId: string, overrides?: Record<string, any>) {
  return {
    type: InteractionType.MessageComponent,
    guild_id: 'guild-1',
    channel: { id: 'channel-1' },
    member: { user: { id: 'user-1' } },
    token: 'interaction-token',
    data: {
      component_type: ComponentType.Button,
      custom_id: customId,
    },
    ...overrides,
  };
}

function stringOption(name: string, value: string) {
  return { name, type: ApplicationCommandOptionType.String, value };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('DiscordService', () => {
  let service: DiscordService;
  let activityService: jest.Mocked<ActivityService>;
  let panelService: jest.Mocked<PanelService>;
  let discordConfig: jest.Mocked<DiscordConfigService>;
  let sqsService: jest.Mocked<SqsService>;
  let streakRepository: jest.Mocked<StreakRepository>;
  let trackingRepository: jest.Mocked<TrackingRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordService,
        {
          provide: ActivityService,
          useValue: {
            getActivities: jest.fn().mockResolvedValue([]),
            addActivity: jest.fn().mockResolvedValue(undefined),
            removeActivity: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: PanelService,
          useValue: {
            setup: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: DiscordConfigService,
          useValue: {
            applicationId: 'app-123',
          },
        },
        {
          provide: SqsService,
          useValue: {
            send: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: StreakRepository,
          useValue: {
            getStreak: jest.fn().mockResolvedValue(null),
            getTopCurrentStreaks: jest.fn().mockResolvedValue([]),
            getAllGuildStreaks: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: TrackingRepository,
          useValue: {
            getUserLogsForRange: jest.fn().mockResolvedValue([]),
            getUserActivityCounts: jest.fn().mockResolvedValue(new Map()),
          },
        },
      ],
    }).compile();

    service = module.get(DiscordService);
    activityService = module.get(ActivityService);
    panelService = module.get(PanelService);
    discordConfig = module.get(DiscordConfigService);
    sqsService = module.get(SqsService);
    streakRepository = module.get(StreakRepository);
    trackingRepository = module.get(TrackingRepository);
  });

  // -----------------------------------------------------------------------
  // handleCommand — routing
  // -----------------------------------------------------------------------

  describe('handleCommand', () => {
    it('returns ephemeral error when guild_id is missing', async () => {
      const interaction = makeCommandInteraction(COMMANDS.ADD_ACTIVITY, [], {
        guild_id: undefined,
      });

      const result = await service.handleCommand(interaction as any);

      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(result.data.content).toContain('can only be used in a server');
      expect(result.data.flags).toBe(MessageFlags.Ephemeral);
    });

    it('returns ephemeral "not implemented" for unknown command', async () => {
      const interaction = makeCommandInteraction('unknown_cmd');

      const result = await service.handleCommand(interaction as any);

      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(result.data.content).toContain('not implemented');
      expect(result.data.flags).toBe(MessageFlags.Ephemeral);
    });
  });

  // -----------------------------------------------------------------------
  // handleAddActivity
  // -----------------------------------------------------------------------

  describe('handleAddActivity', () => {
    it('calls activityService.addActivity and returns success', async () => {
      const interaction = makeCommandInteraction(COMMANDS.ADD_ACTIVITY, [
        stringOption('name', 'Push'),
        stringOption('emoji', '💪'),
      ]);

      const result = await service.handleCommand(interaction as any);

      expect(activityService.addActivity).toHaveBeenCalledWith('guild-1', 'Push', '💪', 'user-1');
      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(result.data.content).toContain('Added activity');
      expect(result.data.flags).toBe(MessageFlags.Ephemeral);
    });

    it('returns error when activity already exists', async () => {
      activityService.addActivity.mockRejectedValueOnce(new Error('Duplicate'));

      const interaction = makeCommandInteraction(COMMANDS.ADD_ACTIVITY, [
        stringOption('name', 'Push'),
      ]);

      const result = await service.handleCommand(interaction as any);

      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(result.data.content).toContain('already exists');
      expect(result.data.flags).toBe(MessageFlags.Ephemeral);
    });
  });

  // -----------------------------------------------------------------------
  // handleRemoveActivity
  // -----------------------------------------------------------------------

  describe('handleRemoveActivity', () => {
    it('calls removeActivity and returns success', async () => {
      const interaction = makeCommandInteraction(COMMANDS.REMOVE_ACTIVITY, [
        stringOption('name', 'Push'),
      ]);

      const result = await service.handleCommand(interaction as any);

      expect(activityService.removeActivity).toHaveBeenCalledWith('guild-1', 'Push');
      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(result.data.content).toContain('Removed');
      expect(result.data.flags).toBe(MessageFlags.Ephemeral);
    });
  });

  // -----------------------------------------------------------------------
  // handleSetup
  // -----------------------------------------------------------------------

  describe('handleSetup', () => {
    it('calls panelService.setup and returns success', async () => {
      const interaction = makeCommandInteraction(COMMANDS.SETUP);

      const result = await service.handleCommand(interaction as any);

      expect(panelService.setup).toHaveBeenCalledWith('guild-1', 'channel-1');
      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(result.data.content).toContain('Tracker panel posted');
      expect(result.data.flags).toBe(MessageFlags.Ephemeral);
    });

    it('returns error when channel is missing', async () => {
      const interaction = makeCommandInteraction(COMMANDS.SETUP, [], {
        channel: undefined,
      });

      const result = await service.handleCommand(interaction as any);

      expect(panelService.setup).not.toHaveBeenCalled();
      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(result.data.content).toContain('Could not determine the channel');
      expect(result.data.flags).toBe(MessageFlags.Ephemeral);
    });
  });

  // -----------------------------------------------------------------------
  // handleLogActivity (via handleComponent)
  // -----------------------------------------------------------------------

  describe('handleLogActivity', () => {
    it('sends SQS message and returns deferred ephemeral for valid button click', async () => {
      const interaction = makeComponentInteraction('log_activity:push');

      const result = await service.handleComponent(interaction as any);

      expect(sqsService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ACTIVITY_LOGGED',
          guildId: 'guild-1',
          userId: 'user-1',
          activityName: 'push',
          channelId: 'channel-1',
          interactionToken: 'interaction-token',
          applicationId: 'app-123',
        }),
      );
      expect(result).toEqual({
        type: InteractionResponseType.DeferredChannelMessageWithSource,
        data: { flags: MessageFlags.Ephemeral },
      });
    });

    it('returns ephemeral error when guild_id is missing', async () => {
      const interaction = makeComponentInteraction('log_activity:push', {
        guild_id: undefined,
      });

      const result = await service.handleComponent(interaction as any);

      expect(sqsService.send).not.toHaveBeenCalled();
      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(result.data).toHaveProperty('flags', MessageFlags.Ephemeral);
    });

    it('returns ephemeral error when activity name is empty', async () => {
      const interaction = makeComponentInteraction('log_activity:');

      const result = await service.handleComponent(interaction as any);

      expect(sqsService.send).not.toHaveBeenCalled();
      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect((result.data as any).content).toContain('Invalid activity');
    });
  });

  // -----------------------------------------------------------------------
  // handleBackfill
  // -----------------------------------------------------------------------

  describe('handleBackfill', () => {
    it('returns error for invalid date format', async () => {
      const interaction = makeCommandInteraction(COMMANDS.BACKFILL, [
        stringOption('date', 'not-a-date'),
        stringOption('activity', 'push'),
      ]);

      const result = await service.handleCommand(interaction as any);

      expect(sqsService.send).not.toHaveBeenCalled();
      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(result.data.content).toContain('Invalid date');
      expect(result.data.flags).toBe(MessageFlags.Ephemeral);
    });

    it('returns error for future date', async () => {
      const interaction = makeCommandInteraction(COMMANDS.BACKFILL, [
        stringOption('date', '2099-01-01'),
        stringOption('activity', 'push'),
      ]);

      const result = await service.handleCommand(interaction as any);

      expect(sqsService.send).not.toHaveBeenCalled();
      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(result.data.content).toContain('Invalid date');
      expect(result.data.flags).toBe(MessageFlags.Ephemeral);
    });

    it('sends SQS message and returns deferred ephemeral for valid backfill', async () => {
      const interaction = makeCommandInteraction(COMMANDS.BACKFILL, [
        stringOption('date', '2025-01-15'),
        stringOption('activity', 'Push'),
      ]);

      const result = await service.handleCommand(interaction as any);

      expect(sqsService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BACKFILL_ACTIVITY',
          guildId: 'guild-1',
          userId: 'user-1',
          activityName: 'push',
          date: '2025-01-15',
          applicationId: 'app-123',
        }),
      );
      expect(result).toEqual({
        type: InteractionResponseType.DeferredChannelMessageWithSource,
        data: { flags: MessageFlags.Ephemeral },
      });
    });
  });

  // -----------------------------------------------------------------------
  // handleLeaderboard
  // -----------------------------------------------------------------------

  describe('handleLeaderboard', () => {
    it('returns ephemeral message when no streaks exist', async () => {
      const interaction = makeCommandInteraction(COMMANDS.LEADERBOARD);

      const result = await service.handleCommand(interaction as any);

      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(result.data.content).toContain('No streaks recorded');
    });

    it('returns embed with leaderboard data when streaks exist', async () => {
      streakRepository.getTopCurrentStreaks.mockResolvedValueOnce([
        { userId: 'user-1', currentStreak: 5 } as any,
      ]);
      streakRepository.getAllGuildStreaks.mockResolvedValueOnce([
        { userId: 'user-1', longestStreak: 10 } as any,
      ]);

      const interaction = makeCommandInteraction(COMMANDS.LEADERBOARD);

      const result = await service.handleCommand(interaction as any);

      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(result.data).toHaveProperty('embeds');
      expect((result.data as any).embeds[0].title).toContain('Leaderboard');
    });
  });
});
