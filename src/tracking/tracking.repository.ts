import { ActivityLog } from '../common/types/models';
import { Db } from '../db/db';

export class TrackingRepository {
  constructor(protected readonly db: Db) {}

  /** Idempotent: logging the same activity twice on one day reports `alreadyLogged`. */
  async logActivity(
    guildId: string,
    userId: string,
    activityName: string,
    date: string,
  ): Promise<{ alreadyLogged: boolean }> {
    const inserted = await this.db.query(
      `INSERT INTO activity_logs (guild_id, user_id, log_date, activity_name)
       VALUES ($1, $2, $3::date, $4)
       ON CONFLICT DO NOTHING
       RETURNING activity_name`,
      [guildId, userId, date, activityName],
    );
    return { alreadyLogged: inserted.length === 0 };
  }

  /** Logs between two dates (inclusive), newest first. */
  async getUserLogsForRange(
    guildId: string,
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<ActivityLog[]> {
    const rows = await this.db.query<{ date: string; activity_name: string }>(
      `SELECT CAST(log_date AS text) AS date, activity_name
       FROM activity_logs
       WHERE guild_id = $1 AND user_id = $2 AND log_date BETWEEN $3::date AND $4::date
       ORDER BY log_date DESC, activity_name`,
      [guildId, userId, startDate, endDate],
    );
    return rows.map((r) => ({ date: r.date, activityName: r.activity_name }));
  }

  async getUserActivityCounts(guildId: string, userId: string): Promise<Map<string, number>> {
    const rows = await this.db.query<{ activity_name: string; count: number }>(
      `SELECT activity_name, CAST(COUNT(*) AS integer) AS count
       FROM activity_logs
       WHERE guild_id = $1 AND user_id = $2
       GROUP BY activity_name`,
      [guildId, userId],
    );
    return new Map(rows.map((r) => [r.activity_name, r.count]));
  }
}
