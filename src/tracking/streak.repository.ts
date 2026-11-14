import { UserStreak } from '../common/types/models';
import { Db } from '../db/db';

/**
 * Streaks are never stored. They are read from the `streak_runs` view, which
 * derives them from activity_logs (see src/db/migrations/0001_init.ts for the rule).
 *
 * `today` is always passed in (UTC, YYYY-MM-DD): a streak is "current" when it
 * reaches today or yesterday, so a missed day ends it without anything being written.
 */
export class StreakRepository {
  constructor(private readonly db: Db) {}

  async getUserStreak(guildId: string, userId: string, today: string): Promise<UserStreak> {
    const [row] = await this.db.query<{ current_streak: number; best_streak: number }>(
      `SELECT
         CAST(COALESCE(MAX(CASE WHEN r.end_date >= $3::date - 1 THEN r.length ELSE 0 END), 0)
              AS integer) AS current_streak,
         CAST(GREATEST(
                COALESCE(MAX(r.length), 0),
                COALESCE((SELECT f.best_streak FROM legacy_best_streaks f
                          WHERE f.guild_id = $1 AND f.user_id = $2), 0))
              AS integer) AS best_streak
       FROM streak_runs r
       WHERE r.guild_id = $1 AND r.user_id = $2`,
      [guildId, userId, today],
    );
    return { userId, currentStreak: row.current_streak, bestStreak: row.best_streak };
  }

  /** Every user in the guild who has ever logged (or has a pre-v4 best streak on record). */
  async getGuildStreaks(guildId: string, today: string): Promise<UserStreak[]> {
    const derived = await this.db.query<{
      user_id: string;
      current_streak: number;
      best_streak: number;
    }>(
      `SELECT user_id,
              CAST(MAX(CASE WHEN end_date >= $2::date - 1 THEN length ELSE 0 END) AS integer)
                AS current_streak,
              CAST(MAX(length) AS integer) AS best_streak
       FROM streak_runs
       WHERE guild_id = $1
       GROUP BY user_id`,
      [guildId, today],
    );
    const floors = await this.db.query<{ user_id: string; best_streak: number }>(
      'SELECT user_id, best_streak FROM legacy_best_streaks WHERE guild_id = $1',
      [guildId],
    );

    const byUser = new Map<string, UserStreak>(
      derived.map((r) => [
        r.user_id,
        { userId: r.user_id, currentStreak: r.current_streak, bestStreak: r.best_streak },
      ]),
    );
    for (const floor of floors) {
      const streak = byUser.get(floor.user_id);
      if (streak) {
        streak.bestStreak = Math.max(streak.bestStreak, floor.best_streak);
      } else {
        byUser.set(floor.user_id, {
          userId: floor.user_id,
          currentStreak: 0,
          bestStreak: floor.best_streak,
        });
      }
    }
    return [...byUser.values()];
  }
}
