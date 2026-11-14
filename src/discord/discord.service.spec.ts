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
  let streakRepository: jest.Mocked<Pick<StreakRepository, 'getUserStreak' | 'getGuildStreaks'>>;
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

    streakRepository = {
      getUserStreak: jest
        .fn()
        .mockResolvedValue({ userId: 'user-1', currentStreak: 0, bestStreak: 0 }),
      getGuildStreaks: jest.fn().mockResolvedValue([]),
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

    describe('when posting the panel fails', () => {
      let logged: jest.SpyInstance;

      beforeEach(() => {
        logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      });

      afterEach(() => {
        logged.mockRestore();
      });

      it('explains a permissions problem and logs the Discord error', async () => {
        const missingAccess = Object.assign(new Error('Missing Access'), {
          status: 403,
          code: 50001,
        });
        panelService.setup.mockRejectedValueOnce(missingAccess);

        const result = await service.handleCommand(makeCommandInteraction(COMMANDS.SETUP) as any);

        expect((result.data as EphemeralData).content).toContain("I can't post in this channel");
        expect((result.data as EphemeralData).flags).toBe(MessageFlags.Ephemeral);
        expect(logged).toHaveBeenCalledWith(
          expect.stringContaining('guild guild-1, channel channel-1'),
          missingAccess,
        );
      });

      it('keeps the generic message for anything else, and still logs it', async () => {
        panelService.setup.mockRejectedValueOnce(new Error('socket hang up'));

        const result = await service.handleCommand(makeCommandInteraction(COMMANDS.SETUP) as any);

        expect((result.data as EphemeralData).content).toContain(
          'Failed to post the tracker panel',
        );
        expect(logged).toHaveBeenCalledTimes(1);
      });
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
    it('logs activity, reads the streak, and returns public message', async () => {
      streakRepository.getUserStreak.mockResolvedValueOnce({
        userId: 'user-1',
        currentStreak: 12,
        bestStreak: 30,
      });
      const interaction = makeComponentInteraction('log_activity:push');

      const result = await service.handleComponent(interaction as any);

      expect(trackingRepository.logActivity).toHaveBeenCalledWith(
        'guild-1',
        'user-1',
        'push',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
      expect(streakRepository.getUserStreak).toHaveBeenCalledWith(
        'guild-1',
        'user-1',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
      expect(result).toEqual({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: '<@user-1> logged **Push** — **12-day** streak 🔥' },
      });
    });

    it('returns ephemeral already-logged message when duplicate', async () => {
      trackingRepository.logActivity.mockResolvedValueOnce({ alreadyLogged: true });

      const interaction = makeComponentInteraction('log_activity:push');

      const result = await service.handleComponent(interaction as any);

      expect(streakRepository.getUserStreak).not.toHaveBeenCalled();
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

    it('returns error for a date that does not exist', async () => {
      const interaction = makeCommandInteraction(COMMANDS.BACKFILL, [
        stringOption('date', '2025-02-31'),
        stringOption('activity', 'push'),
      ]);

      const result = await service.handleCommand(interaction as any);

      expect(trackingRepository.logActivity).not.toHaveBeenCalled();
      expect((result.data as EphemeralData).content).toContain('Invalid date');
    });

    it('logs the past date, reads the streak as of today, and returns public message', async () => {
      streakRepository.getUserStreak.mockResolvedValueOnce({
        userId: 'user-1',
        currentStreak: 5,
        bestStreak: 5,
      });
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
      const today = new Date().toISOString().slice(0, 10);
      expect(streakRepository.getUserStreak).toHaveBeenCalledWith('guild-1', 'user-1', today);
      expect(result).toEqual({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: {
          content: '<@user-1> backfilled **Push** for 2025-01-15 — **5-day** streak 🔥',
        },
      });
    });

    it('returns ephemeral already-logged message when duplicate backfill', async () => {
      trackingRepository.logActivity.mockResolvedValueOnce({ alreadyLogged: true });

      const interaction = makeCommandInteraction(COMMANDS.BACKFILL, [
        stringOption('date', '2025-01-15'),
        stringOption('activity', 'Push'),
      ]);

      const result = await service.handleCommand(interaction as any);

      expect(streakRepository.getUserStreak).not.toHaveBeenCalled();
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
      streakRepository.getGuildStreaks.mockResolvedValueOnce([
        { userId: 'user-1', currentStreak: 5, bestStreak: 10 },
      ]);

      const interaction = makeCommandInteraction(COMMANDS.LEADERBOARD);

      const result = await service.handleCommand(interaction as any);

      expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(result.data).toHaveProperty('embeds');
      const embeds = (result.data as { embeds: { title: string }[] }).embeds;
      expect(embeds[0].title).toContain('Leaderboard');
    });

    it('ranks current and all-time separately and leaves out zeros', async () => {
      streakRepository.getGuildStreaks.mockResolvedValueOnce([
        { userId: 'lapsed', currentStreak: 0, bestStreak: 40 },
        { userId: 'steady', currentStreak: 9, bestStreak: 9 },
        { userId: 'new', currentStreak: 2, bestStreak: 2 },
      ]);

      const result = await service.handleCommand(
        makeCommandInteraction(COMMANDS.LEADERBOARD) as any,
      );

      const [current, allTime] = (
        result.data as { embeds: { fields: { value: string }[] }[] }
      ).embeds[0].fields.map((f) => f.value);
      expect(current).toBe('1. <@steady> — 9 days 🔥\n2. <@new> — 2 days 🔥');
      expect(allTime).toBe('1. <@lapsed> — 40 days\n2. <@steady> — 9 days\n3. <@new> — 2 days');
    });

    it('shows at most ten per list', async () => {
      streakRepository.getGuildStreaks.mockResolvedValueOnce(
        Array.from({ length: 15 }, (_, i) => ({
          userId: `u${i}`,
          currentStreak: i + 1,
          bestStreak: i + 1,
        })),
      );

      const result = await service.handleCommand(
        makeCommandInteraction(COMMANDS.LEADERBOARD) as any,
      );

      const [current] = (
        result.data as { embeds: { fields: { value: string }[] }[] }
      ).embeds[0].fields.map((f) => f.value);
      expect(current.split('\n')).toHaveLength(10);
      expect(current.split('\n')[0]).toContain('<@u14> — 15 days');
    });
  });

  // -----------------------------------------------------------------------
  // handleStreak
  // -----------------------------------------------------------------------

  describe('handleStreak', () => {
    it('returns ephemeral message when the user has never logged', async () => {
      const result = await service.handleCommand(makeCommandInteraction(COMMANDS.STREAK) as any);

      expect((result.data as EphemeralData).content).toContain('No activity logged yet');
      expect((result.data as EphemeralData).flags).toBe(MessageFlags.Ephemeral);
    });

    it('shows current streak, best streak, breakdown and a 30-day grid', async () => {
      const today = new Date().toISOString().slice(0, 10);
      streakRepository.getUserStreak.mockResolvedValueOnce({
        userId: 'user-1',
        currentStreak: 3,
        bestStreak: 21,
      });
      trackingRepository.getUserLogsForRange.mockResolvedValueOnce([
        { date: today, activityName: 'push' },
      ]);
      trackingRepository.getUserActivityCounts.mockResolvedValueOnce(
        new Map([
          ['push', 14],
          ['rest', 4],
        ]),
      );

      const result = await service.handleCommand(makeCommandInteraction(COMMANDS.STREAK) as any);

      expect(streakRepository.getUserStreak).toHaveBeenCalledWith('guild-1', 'user-1', today);
      const fields = (result.data as { embeds: { fields: { name: string; value: string }[] }[] })
        .embeds[0].fields;
      expect(fields.map((f) => f.value).slice(0, 3)).toEqual([
        '3 days',
        '21 days',
        'Push ×14\nRest ×4',
      ]);
      const grid = fields[3].value.replace(/\n/g, '');
      expect([...grid]).toHaveLength(30);
      expect(grid.endsWith('🟩')).toBe(true);
    });
  });
});
