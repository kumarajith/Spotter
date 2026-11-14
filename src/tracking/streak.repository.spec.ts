import { addDays } from '../common/dates';
import { Db } from '../db/db';
import { createTestDb, uniqueGuildId } from '../db/test-db';
import { StreakRepository } from './streak.repository';
import { TrackingRepository } from './tracking.repository';

const TODAY = '2025-06-15';

/**
 * Writes logs from a pattern, one character per consecutive day, the last
 * character being `endsOn`:
 *   P = an activity   R = rest only   B = rest and an activity   . = nothing logged
 */
async function seed(
  tracking: TrackingRepository,
  guildId: string,
  pattern: string,
  { userId = 'u1', endsOn = TODAY } = {},
): Promise<void> {
  const days = [...pattern];
  for (let i = 0; i < days.length; i++) {
    const date = addDays(endsOn, i - (days.length - 1));
    const kind = days[i];
    if (kind === 'P' || kind === 'B') await tracking.logActivity(guildId, userId, 'push', date);
    if (kind === 'R' || kind === 'B') await tracking.logActivity(guildId, userId, 'rest', date);
  }
}

describe('StreakRepository (streak_runs view)', () => {
  let db: Db;
  let tracking: TrackingRepository;
  let streaks: StreakRepository;
  let guildId: string;

  beforeAll(async () => {
    db = await createTestDb();
    tracking = new TrackingRepository(db);
    streaks = new StreakRepository(db);
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(() => {
    guildId = uniqueGuildId();
  });

  async function streakFor(pattern: string, endsOn = TODAY) {
    await seed(tracking, guildId, pattern, { endsOn });
    const { currentStreak, bestStreak } = await streaks.getUserStreak(guildId, 'u1', TODAY);
    return { current: currentStreak, best: bestStreak };
  }

  describe('consecutive days', () => {
    it('no logs -> no streak', async () => {
      expect(await streakFor('')).toEqual({ current: 0, best: 0 });
    });

    it('first activity today -> 1', async () => {
      expect(await streakFor('P')).toEqual({ current: 1, best: 1 });
    });

    it('a rest day counts as a streak day', async () => {
      expect(await streakFor('R')).toEqual({ current: 1, best: 1 });
    });

    it('five days in a row -> 5', async () => {
      expect(await streakFor('PPPPP')).toEqual({ current: 5, best: 5 });
    });

    it('several activities on one day count once', async () => {
      await tracking.logActivity(guildId, 'u1', 'walk', TODAY);
      expect(await streakFor('PPB')).toEqual({ current: 3, best: 3 });
    });
  });

  describe('missed days', () => {
    it('nothing logged today yet: the streak ending yesterday is still current', async () => {
      expect(await streakFor('PPP.')).toEqual({ current: 3, best: 3 });
    });

    it('a full missed day ends the streak without anything being written', async () => {
      expect(await streakFor('PPP..')).toEqual({ current: 0, best: 3 });
    });

    it('a gap starts a new streak and keeps the best', async () => {
      expect(await streakFor('PPP.PP')).toEqual({ current: 2, best: 3 });
    });

    it('backfilling the missed day joins the two streaks immediately', async () => {
      expect(await streakFor('PP.PP')).toEqual({ current: 2, best: 2 });

      await tracking.logActivity(guildId, 'u1', 'push', addDays(TODAY, -2));

      expect(await streaks.getUserStreak(guildId, 'u1', TODAY)).toMatchObject({
        currentStreak: 5,
        bestStreak: 5,
      });
    });
  });

  describe('rest days', () => {
    it('up to four rest-only days in a row keep the streak going', async () => {
      expect(await streakFor('PRRRRP')).toEqual({ current: 6, best: 6 });
    });

    it('four trailing rest days still count', async () => {
      expect(await streakFor('PPRRRR')).toEqual({ current: 6, best: 6 });
    });

    it('the fifth rest-only day in a row breaks the streak', async () => {
      expect(await streakFor('PPRRRRR')).toEqual({ current: 0, best: 2 });
    });

    it('an activity on that fifth day un-breaks it', async () => {
      expect(await streakFor('PPRRRRB')).toEqual({ current: 7, best: 7 });
    });

    it('a rest day that also has an activity is not a rest-only day', async () => {
      expect(await streakFor('RRBRRRR')).toEqual({ current: 7, best: 7 });
    });

    it('after a rest break, the next activity starts from 1', async () => {
      expect(await streakFor('PPPRRRRRPP')).toEqual({ current: 2, best: 3 });
    });

    it('more rest after a break does not start a streak', async () => {
      expect(await streakFor('PRRRRRR')).toEqual({ current: 0, best: 1 });
    });

    it('best streak counts the days before a rest break in full', async () => {
      expect(await streakFor('PPPPRRRRRP')).toEqual({ current: 1, best: 4 });
    });

    it('treats "rest" case-insensitively', async () => {
      for (let i = 0; i < 5; i++) {
        await tracking.logActivity(guildId, 'u1', 'Rest', addDays(TODAY, -i));
      }
      expect(await streaks.getUserStreak(guildId, 'u1', TODAY)).toMatchObject({
        currentStreak: 0,
        bestStreak: 0,
      });
    });
  });

  describe('scoping', () => {
    it('keeps users and guilds apart', async () => {
      const otherGuild = uniqueGuildId();
      await seed(tracking, guildId, 'PPP', { userId: 'u1' });
      await seed(tracking, guildId, 'P', { userId: 'u2' });
      await seed(tracking, otherGuild, 'PPPPPPP', { userId: 'u1' });

      expect(await streaks.getUserStreak(guildId, 'u1', TODAY)).toMatchObject({ currentStreak: 3 });
      expect(await streaks.getUserStreak(guildId, 'u2', TODAY)).toMatchObject({ currentStreak: 1 });
      expect(await streaks.getUserStreak(otherGuild, 'u1', TODAY)).toMatchObject({
        currentStreak: 7,
      });
    });

    it('getGuildStreaks returns one row per user with the same numbers', async () => {
      await seed(tracking, guildId, 'PPP.PP', { userId: 'u1' });
      await seed(tracking, guildId, 'PPPP..', { userId: 'u2' });

      const rows = await streaks.getGuildStreaks(guildId, TODAY);

      expect(rows.sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
        { userId: 'u1', currentStreak: 2, bestStreak: 3 },
        { userId: 'u2', currentStreak: 0, bestStreak: 4 },
      ]);
    });
  });

  describe('pre-v4 best streak floor', () => {
    beforeEach(async () => {
      await db.query(
        `INSERT INTO legacy_best_streaks (guild_id, user_id, best_streak)
         VALUES ($1, 'u1', 40), ($1, 'gone', 12)`,
        [guildId],
      );
    });

    it('never lets the best streak drop below the stored value', async () => {
      expect(await streakFor('PPP')).toEqual({ current: 3, best: 40 });
    });

    it('keeps a user who has a stored best but no logs on the guild list', async () => {
      await seed(tracking, guildId, 'PPP');

      const rows = await streaks.getGuildStreaks(guildId, TODAY);

      expect(rows.sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
        { userId: 'gone', currentStreak: 0, bestStreak: 12 },
        { userId: 'u1', currentStreak: 3, bestStreak: 40 },
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // The view against an independent, deliberately naive implementation of the rule.
  // ---------------------------------------------------------------------------

  describe('randomized histories', () => {
    type Kind = 'active' | 'rest' | 'none';

    /** Walks the calendar day by day; shares no technique with the SQL. */
    function referenceStreak(kinds: Kind[], lastDay: string): { current: number; best: number } {
      const breaker = new Set<number>();
      for (let i = 0; i < kinds.length; ) {
        if (kinds[i] !== 'rest') {
          i++;
          continue;
        }
        let j = i;
        while (j < kinds.length && kinds[j] === 'rest') j++;
        if (j - i >= 5) for (let k = i; k < j; k++) breaker.add(k);
        i = j;
      }

      let best = 0;
      let current = 0;
      let run = 0;
      for (let i = 0; i < kinds.length; i++) {
        run = kinds[i] !== 'none' && !breaker.has(i) ? run + 1 : 0;
        best = Math.max(best, run);
        const date = addDays(lastDay, i - (kinds.length - 1));
        const runEndsHere =
          run > 0 && (i === kinds.length - 1 || kinds[i + 1] === 'none' || breaker.has(i + 1));
        if (runEndsHere && date >= addDays(TODAY, -1)) current = run;
      }
      return { current, best };
    }

    /** Small seeded PRNG so a failure is reproducible. */
    function mulberry32(seed: number): () => number {
      let a = seed;
      return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    it('matches the reference for 200 random 45-day histories', async () => {
      const random = mulberry32(20251114);
      const histories = Array.from({ length: 200 }, (_, n) => {
        // Rest-heavy on purpose, so runs of 5+ rest days are common.
        const kinds: Kind[] = Array.from({ length: 45 }, () => {
          const r = random();
          return r < 0.15 ? 'none' : r < 0.6 ? 'rest' : 'active';
        });
        return { userId: `user-${n}`, kinds, lastDay: addDays(TODAY, -Math.floor(random() * 3)) };
      });

      const rows: string[][] = [];
      for (const { userId, kinds, lastDay } of histories) {
        kinds.forEach((kind, i) => {
          const date = addDays(lastDay, i - (kinds.length - 1));
          if (kind !== 'none') rows.push([userId, date, kind === 'rest' ? 'rest' : 'push']);
          // Some active days also carry a rest log — they must still count as active.
          if (kind === 'active' && random() < 0.3) rows.push([userId, date, 'rest']);
        });
      }
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const values = batch
          .map((_, n) => `($1, $${n * 3 + 2}, $${n * 3 + 3}::date, $${n * 3 + 4})`)
          .join(', ');
        await db.query(
          `INSERT INTO activity_logs (guild_id, user_id, log_date, activity_name) VALUES ${values}`,
          [guildId, ...batch.flat()],
        );
      }

      const actual = new Map(
        (await streaks.getGuildStreaks(guildId, TODAY)).map((s) => [s.userId, s]),
      );

      for (const { userId, kinds, lastDay } of histories) {
        const expected = referenceStreak(kinds, lastDay);
        const got = actual.get(userId);
        expect({
          userId,
          history: kinds.map((k) => (k === 'active' ? 'P' : k === 'rest' ? 'R' : '.')).join(''),
          current: got?.currentStreak ?? 0,
          best: got?.bestStreak ?? 0,
        }).toEqual({
          userId,
          history: expect.any(String),
          current: expected.current,
          best: expected.best,
        });
      }

      // The single-user query must agree with the guild query.
      for (const { userId } of histories.slice(0, 10)) {
        expect(await streaks.getUserStreak(guildId, userId, TODAY)).toEqual(actual.get(userId));
      }
    });
  });
});
