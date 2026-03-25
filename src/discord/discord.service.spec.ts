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
import { StreakService } from '../tracking/streak.service';
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

/** Narrow the union returned by handleCommand/handleComponent for ephemeral results. */
interface EphemeralData {
  content: string;
  flags: MessageFlags;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('DiscordService', () => {
  let service: DiscordService;
  let activityService: jest.Mocked<
    Pick<ActivityService, 'getActivities' | 'addActivity' | 'removeActivity'>
  >;
  let panelService: jest.Mocked<Pick<PanelService, 'setup'>>;
  let streakService: jest.Mocked<Pick<StreakService, 'processActivityLogged' | 'recomputeStreak'>>;
  let streakRepository: jest.Mocked<
    Pick<StreakRepository, 'getStreak' | 'getTopCurrentStreaks' | 'getAllGuildStreaks'>
  >;
  let trackingRepository: jest.Mocked<
    Pick<TrackingRepository, 'logActivity' | 'getUserLogsForRange' | 'getUserActivityCounts'>
  >;

  beforeEach(() => {
    activityService = {
      getActivities: jest.fn().mockResolvedValue([]),
      addActivity: jest.fn().mockResolvedValue(undefined),
      removeActivity: jest.fn().mockResolvedValue(undefined),
    };

    panelService = {
      setup: jest.fn().mockResolvedValue(undefined),
    };

    const discordConfig = { applicationId: 'app-123' } as DiscordConfigService;

    streakService = {
      processActivityLogged: jest.fn().mockResolvedValue({ currentStreak: 1 }),
      recomputeStreak: jest.fn().mockResolvedValue({ currentStreak: 1, longestStreak: 1 }),
    };

    streakRepository = {
      getStreak: jest.fn().mockResolvedValue(null),
      getTopCurrentStreaks: jest.fn().mockResolvedValue([]),
      getAllGuildStreaks: jest.fn().mockResolvedValue([]),
    };

    trackingRepository = {
      logActivity: jest.fn().mockResolvedValue({ alreadyLogged: false }),
      getUserLogsForRange: jest.fn().mockResolvedValue([]),
      getUserActivityCounts: jest.fn().mockResolvedValue(new Map()),
    };

    service = new DiscordService(
      activityService as unknown as ActivityService,
      panelService as unknown as PanelService,
      discordConfig,
      streakService as unknown as StreakService,
      streakRepository as unknown as StreakRepository,
      trackingRepository as unknown as TrackingRepository,
    );
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
      expect((result.data as EphemeralData).content).toContain('can only be used in a server');
      expect((result.data as EphemeralData).flags).toBe(MessageFlags.Ephemeral);
    });

    it('returns ephemeral "not implemented" for unknown command', async () => {
      const interaction = makeCommandInteraction('unknown_cmd');

      const result = await service.handleCommand(interaction as any);

      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect((result.data as EphemeralData).content).toContain('not implemented');
      expect((result.data as EphemeralData).flags).toBe(MessageFlags.Ephemeral);
    });
  });

  // -----------------------------------------------------------------------
  // handleAddActivity
  // -----------------------------------------------------------------------

  describe('handleAddActivity', () => {
    it('calls activityService.addActivity and returns success', async () => {
      const interaction = makeCommandInteraction(COMMANDS.ADD_ACTIVITY, [
        stringOption('name', 'Push'),
        stringOption('emoji', '\u{1F4AA}'),
      ]);

      const result = await service.handleCommand(interaction as any);

      expect(activityService.addActivity).toHaveBeenCalledWith(
        'guild-1',
        'Push',
        '\u{1F4AA}',
        'user-1',
      );
      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect((result.data as EphemeralData).content).toContain('Added activity');
      expect((result.data as EphemeralData).flags).toBe(MessageFlags.Ephemeral);
    });

    it('returns error when activity already exists', async () => {
      activityService.addActivity.mockRejectedValueOnce(new Error('Duplicate'));

      const interaction = makeCommandInteraction(COMMANDS.ADD_ACTIVITY, [
        stringOption('name', 'Push'),
      ]);

      const result = await service.handleCommand(interaction as any);

      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect((result.data as EphemeralData).content).toContain('already exists');
      expect((result.data as EphemeralData).flags).toBe(MessageFlags.Ephemeral);
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
      expect((result.data as EphemeralData).content).toContain('Removed');
      expect((result.data as EphemeralData).flags).toBe(MessageFlags.Ephemeral);
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
      expect((result.data as EphemeralData).content).toContain('Tracker panel posted');
      expect((result.data as EphemeralData).flags).toBe(MessageFlags.Ephemeral);
    });

    it('returns error when channel is missing', async () => {
      const interaction = makeCommandInteraction(COMMANDS.SETUP, [], {
        channel: undefined,
      });

      const result = await service.handleCommand(interaction as any);

      expect(panelService.setup).not.toHaveBeenCalled();
      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect((result.data as EphemeralData).content).toContain('Could not determine the channel');
      expect((result.data as EphemeralData).flags).toBe(MessageFlags.Ephemeral);
    });
  });

  // -----------------------------------------------------------------------
  // handleLogActivity (via handleComponent)
  // -----------------------------------------------------------------------

  describe('handleLogActivity', () => {
    it('logs activity, processes streak, and returns public message', async () => {
      const interaction = makeComponentInteraction('log_activity:push');

      const result = await service.handleComponent(interaction as any);

      expect(trackingRepository.logActivity).toHaveBeenCalledWith(
        'guild-1',
        'user-1',
        'push',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
      expect(streakService.processActivityLogged).toHaveBeenCalledWith(
        'guild-1',
        'user-1',
        'push',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
      expect(result).toEqual({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: expect.stringContaining('logged **Push**') },
      });
    });

    it('returns ephemeral already-logged message when duplicate', async () => {
      trackingRepository.logActivity.mockResolvedValueOnce({ alreadyLogged: true });

      const interaction = makeComponentInteraction('log_activity:push');

      const result = await service.handleComponent(interaction as any);

      expect(streakService.processActivityLogged).not.toHaveBeenCalled();
      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect((result.data as EphemeralData).content).toContain('Already logged');
      expect((result.data as EphemeralData).flags).toBe(MessageFlags.Ephemeral);
    });

    it('returns ephemeral error when guild_id is missing', async () => {
      const interaction = makeComponentInteraction('log_activity:push', {
        guild_id: undefined,
      });

      const result = await service.handleComponent(interaction as any);

      expect(trackingRepository.logActivity).not.toHaveBeenCalled();
      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(result.data).toHaveProperty('flags', MessageFlags.Ephemeral);
    });

    it('returns ephemeral error when activity name is empty', async () => {
      const interaction = makeComponentInteraction('log_activity:');

      const result = await service.handleComponent(interaction as any);

      expect(trackingRepository.logActivity).not.toHaveBeenCalled();
      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect((result.data as EphemeralData).content).toContain('Invalid activity');
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

      expect(trackingRepository.logActivity).not.toHaveBeenCalled();
      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect((result.data as EphemeralData).content).toContain('Invalid date');
      expect((result.data as EphemeralData).flags).toBe(MessageFlags.Ephemeral);
    });

    it('returns error for future date', async () => {
      const interaction = makeCommandInteraction(COMMANDS.BACKFILL, [
        stringOption('date', '2099-01-01'),
        stringOption('activity', 'push'),
      ]);

      const result = await service.handleCommand(interaction as any);

      expect(trackingRepository.logActivity).not.toHaveBeenCalled();
      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect((result.data as EphemeralData).content).toContain('Invalid date');
      expect((result.data as EphemeralData).flags).toBe(MessageFlags.Ephemeral);
    });

    it('logs activity, recomputes streak, and returns public message', async () => {
      const interaction = makeCommandInteraction(COMMANDS.BACKFILL, [
        stringOption('date', '2025-01-15'),
        stringOption('activity', 'Push'),
      ]);

      const result = await service.handleCommand(interaction as any);

      expect(trackingRepository.logActivity).toHaveBeenCalledWith(
        'guild-1',
        'user-1',
        'push',
        '2025-01-15',
      );
      expect(streakService.recomputeStreak).toHaveBeenCalledWith('guild-1', 'user-1');
      expect(result).toEqual({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: expect.stringContaining('backfilled **Push**') },
      });
    });

    it('returns ephemeral already-logged message when duplicate backfill', async () => {
      trackingRepository.logActivity.mockResolvedValueOnce({ alreadyLogged: true });

      const interaction = makeCommandInteraction(COMMANDS.BACKFILL, [
        stringOption('date', '2025-01-15'),
        stringOption('activity', 'Push'),
      ]);

      const result = await service.handleCommand(interaction as any);

      expect(streakService.recomputeStreak).not.toHaveBeenCalled();
      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect((result.data as EphemeralData).content).toContain('Already logged');
      expect((result.data as EphemeralData).flags).toBe(MessageFlags.Ephemeral);
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
      expect((result.data as EphemeralData).content).toContain('No streaks recorded');
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
      const embeds = (result.data as { embeds: { title: string }[] }).embeds;
      expect(embeds[0].title).toContain('Leaderboard');
    });
  });
});
