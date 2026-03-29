import { StreakService } from './streak.service';
import { StreakRepository } from './streak.repository';
import { StreakItem } from '../common/types/dynamo.types';

// -- Helpers ------------------------------------------------------------------

function makeStreak(overrides: Partial<StreakItem> = {}): StreakItem {
  const guildId = overrides.guildId ?? 'g1';
  const userId = overrides.userId ?? 'u1';
  const currentStreak = overrides.currentStreak ?? 5;
  const padded = currentStreak.toString().padStart(5, '0');

  return {
    PK: `GUILD#${guildId}`,
    SK: `STREAK#${userId}`,
    GSI1PK: `LEADERBOARD#${guildId}`,
    GSI1SK: `STREAK#${padded}`,
    guildId,
    userId,
    currentStreak,
    longestStreak: overrides.longestStreak ?? currentStreak,
    currentStreakPadded: padded,
    lastLoggedDate: overrides.lastLoggedDate ?? '2025-06-10',
    updatedAt: overrides.updatedAt ?? '2025-06-10T12:00:00.000Z',
    entityType: 'STREAK',
    consecutiveRestOnlyDays: overrides.consecutiveRestOnlyDays ?? 0,
    lastDayHasNonRest: overrides.lastDayHasNonRest ?? true,
    ...(overrides.pendingBreakState !== undefined && {
      pendingBreakState: overrides.pendingBreakState,
    }),
  };
}

// -- Test setup ---------------------------------------------------------------

describe('StreakService', () => {
  let service: StreakService;
  let repo: {
    getStreak: jest.Mock;
    putStreak: jest.Mock;
    getUserLogs: jest.Mock;
  };

  beforeEach(() => {
    repo = {
      getStreak: jest.fn(),
      putStreak: jest.fn(),
      getUserLogs: jest.fn(),
    };

    service = new StreakService(repo as unknown as StreakRepository);
  });

  // -- processActivityLogged --------------------------------------------------

  describe('processActivityLogged', () => {
    // -- Case A: gap or new user ----------------------------------------------

    describe('Case A: gap or new user', () => {
      it('new user, non-rest -> streak 1', async () => {
        repo.getStreak.mockResolvedValue(null);

        const result = await service.processActivityLogged('g1', 'u1', 'push-ups', '2025-06-10');

        expect(result).toEqual({ currentStreak: 1 });
        const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
        expect(saved.currentStreak).toBe(1);
        expect(saved.consecutiveRestOnlyDays).toBe(0);
        expect(saved.lastDayHasNonRest).toBe(true);
        expect(saved.longestStreak).toBe(1);
      });

      it('new user, rest -> streak 1, consecutiveRestOnlyDays 1', async () => {
        repo.getStreak.mockResolvedValue(null);

        const result = await service.processActivityLogged('g1', 'u1', 'rest', '2025-06-10');

        expect(result).toEqual({ currentStreak: 1 });
        const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
        expect(saved.currentStreak).toBe(1);
        expect(saved.consecutiveRestOnlyDays).toBe(1);
        expect(saved.lastDayHasNonRest).toBe(false);
      });

      it('gap >1 day resets streak, preserves longestStreak', async () => {
        repo.getStreak.mockResolvedValue(
          makeStreak({ currentStreak: 10, longestStreak: 20, lastLoggedDate: '2025-06-01' }),
        );

        const result = await service.processActivityLogged('g1', 'u1', 'push-ups', '2025-06-10');

        expect(result).toEqual({ currentStreak: 1 });
        const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
        expect(saved.currentStreak).toBe(1);
        expect(saved.longestStreak).toBe(20);
        expect(saved.pendingBreakState).toBeUndefined();
      });
    });

    // -- Case B: consecutive day ----------------------------------------------

    describe('Case B: consecutive day', () => {
      it('post-break (currentStreak=0), non-rest -> streak 1', async () => {
        repo.getStreak.mockResolvedValue(
          makeStreak({ currentStreak: 0, lastLoggedDate: '2025-06-10', longestStreak: 8 }),
        );

        const result = await service.processActivityLogged('g1', 'u1', 'push-ups', '2025-06-11');

        expect(result).toEqual({ currentStreak: 1 });
        const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
        expect(saved.consecutiveRestOnlyDays).toBe(0);
        expect(saved.lastDayHasNonRest).toBe(true);
      });

      it('non-rest extends streak', async () => {
        repo.getStreak.mockResolvedValue(
          makeStreak({ currentStreak: 5, lastLoggedDate: '2025-06-10' }),
        );

        const result = await service.processActivityLogged('g1', 'u1', 'push-ups', '2025-06-11');

        expect(result).toEqual({ currentStreak: 6 });
        const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
        expect(saved.consecutiveRestOnlyDays).toBe(0);
        expect(saved.lastDayHasNonRest).toBe(true);
      });

      it('rest below limit increments streak and consecutiveRestOnlyDays', async () => {
        repo.getStreak.mockResolvedValue(
          makeStreak({
            currentStreak: 5,
            lastLoggedDate: '2025-06-10',
            consecutiveRestOnlyDays: 2,
          }),
        );

        const result = await service.processActivityLogged('g1', 'u1', 'rest', '2025-06-11');

        expect(result).toEqual({ currentStreak: 6 });
        const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
        expect(saved.consecutiveRestOnlyDays).toBe(3);
        expect(saved.lastDayHasNonRest).toBe(false);
      });

      it('rest hits REST_STREAK_LIMIT -> streak 0, pendingBreakState set', async () => {
        repo.getStreak.mockResolvedValue(
          makeStreak({
            currentStreak: 10,
            lastLoggedDate: '2025-06-10',
            consecutiveRestOnlyDays: 4, // next rest = 5 = limit
          }),
        );

        const result = await service.processActivityLogged('g1', 'u1', 'rest', '2025-06-11');

        expect(result).toEqual({ currentStreak: 0 });
        const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
        expect(saved.currentStreak).toBe(0);
        expect(saved.consecutiveRestOnlyDays).toBe(5);
        expect(saved.lastDayHasNonRest).toBe(false);
        expect(saved.pendingBreakState).toEqual({
          preBreakStreak: 10,
          preBreakConsecutiveRest: 4,
        });
      });

      it('longestStreak updates when currentStreak exceeds it', async () => {
        repo.getStreak.mockResolvedValue(
          makeStreak({ currentStreak: 7, longestStreak: 7, lastLoggedDate: '2025-06-10' }),
        );

        await service.processActivityLogged('g1', 'u1', 'push-ups', '2025-06-11');

        const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
        expect(saved.currentStreak).toBe(8);
        expect(saved.longestStreak).toBe(8);
      });

      it('clears pendingBreakState from previous day on new consecutive day', async () => {
        repo.getStreak.mockResolvedValue(
          makeStreak({
            currentStreak: 0,
            lastLoggedDate: '2025-06-10',
            pendingBreakState: { preBreakStreak: 8, preBreakConsecutiveRest: 4 },
          }),
        );

        await service.processActivityLogged('g1', 'u1', 'push-ups', '2025-06-11');

        const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
        expect(saved.pendingBreakState).toBeUndefined();
        // Post-break fresh start
        expect(saved.currentStreak).toBe(1);
      });
    });

    // -- Case C: same day -----------------------------------------------------

    describe('Case C: same day', () => {
      it('non-rest after rest WITH pendingBreakState -> restores streak', async () => {
        repo.getStreak.mockResolvedValue(
          makeStreak({
            currentStreak: 0,
            lastLoggedDate: '2025-06-10',
            consecutiveRestOnlyDays: 5,
            lastDayHasNonRest: false,
            longestStreak: 15,
            pendingBreakState: { preBreakStreak: 10, preBreakConsecutiveRest: 4 },
          }),
        );

        const result = await service.processActivityLogged('g1', 'u1', 'push-ups', '2025-06-10');

        expect(result).toEqual({ currentStreak: 11 });
        const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
        expect(saved.currentStreak).toBe(11);
        expect(saved.consecutiveRestOnlyDays).toBe(0);
        expect(saved.lastDayHasNonRest).toBe(true);
        expect(saved.pendingBreakState).toBeUndefined();
        expect(saved.longestStreak).toBe(15);
      });

      it('non-rest after rest WITHOUT pendingBreakState -> decrements consecutiveRestOnlyDays', async () => {
        repo.getStreak.mockResolvedValue(
          makeStreak({
            currentStreak: 6,
            lastLoggedDate: '2025-06-10',
            consecutiveRestOnlyDays: 2,
            lastDayHasNonRest: false,
          }),
        );

        const result = await service.processActivityLogged('g1', 'u1', 'push-ups', '2025-06-10');

        expect(result).toEqual({ currentStreak: 6 });
        const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
        expect(saved.consecutiveRestOnlyDays).toBe(1);
        expect(saved.lastDayHasNonRest).toBe(true);
      });

      it('rest after rest (no-op) -> fields unchanged', async () => {
        const existing = makeStreak({
          currentStreak: 6,
          lastLoggedDate: '2025-06-10',
          consecutiveRestOnlyDays: 2,
          lastDayHasNonRest: false,
          longestStreak: 10,
        });
        repo.getStreak.mockResolvedValue(existing);

        const result = await service.processActivityLogged('g1', 'u1', 'rest', '2025-06-10');

        expect(result).toEqual({ currentStreak: 6 });
        const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
        expect(saved.currentStreak).toBe(6);
        expect(saved.consecutiveRestOnlyDays).toBe(2);
        expect(saved.lastDayHasNonRest).toBe(false);
        expect(saved.longestStreak).toBe(10);
      });

      it('non-rest after non-rest (no-op)', async () => {
        const existing = makeStreak({
          currentStreak: 6,
          lastLoggedDate: '2025-06-10',
          consecutiveRestOnlyDays: 0,
          lastDayHasNonRest: true,
          longestStreak: 10,
        });
        repo.getStreak.mockResolvedValue(existing);

        const result = await service.processActivityLogged('g1', 'u1', 'push-ups', '2025-06-10');

        expect(result).toEqual({ currentStreak: 6 });
        const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
        expect(saved.currentStreak).toBe(6);
        expect(saved.consecutiveRestOnlyDays).toBe(0);
        expect(saved.lastDayHasNonRest).toBe(true);
      });
    });

    // -- putStreak verification -----------------------------------------------

    describe('putStreak shape', () => {
      it('builds correct StreakItem keys and padding', async () => {
        repo.getStreak.mockResolvedValue(null);

        await service.processActivityLogged('guild-abc', 'user-xyz', 'push-ups', '2025-06-10');

        const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
        expect(saved.PK).toBe('GUILD#guild-abc');
        expect(saved.SK).toBe('STREAK#user-xyz');
        expect(saved.GSI1PK).toBe('LEADERBOARD#guild-abc');
        expect(saved.GSI1SK).toBe('STREAK#00001');
        expect(saved.guildId).toBe('guild-abc');
        expect(saved.userId).toBe('user-xyz');
        expect(saved.currentStreakPadded).toBe('00001');
        expect(saved.lastLoggedDate).toBe('2025-06-10');
        expect(saved.entityType).toBe('STREAK');
        expect(saved.updatedAt).toBeDefined();
      });

      it('omits pendingBreakState when undefined', async () => {
        repo.getStreak.mockResolvedValue(null);

        await service.processActivityLogged('g1', 'u1', 'push-ups', '2025-06-10');

        const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
        expect(saved).not.toHaveProperty('pendingBreakState');
      });
    });
  });

  // -- recomputeStreak --------------------------------------------------------

  describe('recomputeStreak', () => {
    beforeEach(() => {
      // Freeze time so calculateStreaks sees a known "today"
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-06-15T12:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('empty logs -> currentStreak 0, preserves existing longestStreak', async () => {
      repo.getStreak.mockResolvedValue(makeStreak({ longestStreak: 20 }));
      repo.getUserLogs.mockResolvedValue([]);

      const result = await service.recomputeStreak('g1', 'u1');

      expect(result).toEqual({ currentStreak: 0, longestStreak: 20 });
    });

    it('straight non-rest run anchored to today -> correct currentStreak', async () => {
      // today is 2025-06-15; 5 consecutive days ending today
      const logs = [
        { date: '2025-06-15', activityName: 'push-ups' },
        { date: '2025-06-14', activityName: 'squats' },
        { date: '2025-06-13', activityName: 'push-ups' },
        { date: '2025-06-12', activityName: 'push-ups' },
        { date: '2025-06-11', activityName: 'push-ups' },
      ];
      repo.getStreak.mockResolvedValue(null);
      repo.getUserLogs.mockResolvedValue(logs);

      const result = await service.recomputeStreak('g1', 'u1');

      expect(result.currentStreak).toBe(5);
      expect(result.longestStreak).toBe(5);

      const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
      expect(saved.consecutiveRestOnlyDays).toBe(0);
      expect(saved.lastDayHasNonRest).toBe(true);
    });

    it('5 consecutive rest-only days breaks the streak via countRun', async () => {
      // today=2025-06-15. Days 11-15 are rest only (5 days), days 06-10 are non-rest.
      // The run is 10 consecutive dates. countRun should break at 5 rest days.
      const logs: Array<{ date: string; activityName: string }> = [];
      // DESC order: most recent first
      for (let d = 15; d >= 11; d--) {
        logs.push({ date: `2025-06-${d.toString().padStart(2, '0')}`, activityName: 'rest' });
      }
      for (let d = 10; d >= 6; d--) {
        logs.push({ date: `2025-06-${d.toString().padStart(2, '0')}`, activityName: 'push-ups' });
      }
      repo.getStreak.mockResolvedValue(null);
      repo.getUserLogs.mockResolvedValue(logs);

      const result = await service.recomputeStreak('g1', 'u1');

      // countRun: iterates DESC from day 15. After 4 rest days streak=4,
      // 5th rest hits limit: max(0, 4 - (5-1)) = 0
      expect(result.currentStreak).toBe(0);
    });

    it('deriveIncrementalState: trailing rest-only days counted correctly', async () => {
      // today=2025-06-15. Days 14-15 rest, days 11-13 non-rest => streak 5
      const logs = [
        { date: '2025-06-15', activityName: 'rest' },
        { date: '2025-06-14', activityName: 'rest' },
        { date: '2025-06-13', activityName: 'push-ups' },
        { date: '2025-06-12', activityName: 'push-ups' },
        { date: '2025-06-11', activityName: 'push-ups' },
      ];
      repo.getStreak.mockResolvedValue(null);
      repo.getUserLogs.mockResolvedValue(logs);

      await service.recomputeStreak('g1', 'u1');

      const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
      expect(saved.currentStreak).toBe(5);
      expect(saved.consecutiveRestOnlyDays).toBe(2);
      expect(saved.lastDayHasNonRest).toBe(false);
    });

    it('calls putStreak with correct computed StreakItem', async () => {
      const logs = [
        { date: '2025-06-15', activityName: 'push-ups' },
        { date: '2025-06-14', activityName: 'push-ups' },
      ];
      repo.getStreak.mockResolvedValue(makeStreak({ longestStreak: 50 }));
      repo.getUserLogs.mockResolvedValue(logs);

      await service.recomputeStreak('g1', 'u1');

      expect(repo.putStreak).toHaveBeenCalledTimes(1);
      const saved = repo.putStreak.mock.calls[0][0] as StreakItem;
      expect(saved.PK).toBe('GUILD#g1');
      expect(saved.SK).toBe('STREAK#u1');
      expect(saved.GSI1PK).toBe('LEADERBOARD#g1');
      expect(saved.currentStreak).toBe(2);
      expect(saved.longestStreak).toBe(50); // preserves existing
      expect(saved.lastLoggedDate).toBe('2025-06-15');
      expect(saved.entityType).toBe('STREAK');
      expect(saved).not.toHaveProperty('pendingBreakState');
    });
  });
});
