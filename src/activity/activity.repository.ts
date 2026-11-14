import { Activity } from '../common/types/models';
import { Db } from '../db/db';
import { DEFAULT_ACTIVITIES } from './activity.defaults';

export class ActivityRepository {
  constructor(protected readonly db: Db) {}

  /** Activities currently on the panel (removed ones are kept in the table but hidden). */
  async getActivities(guildId: string): Promise<Activity[]> {
    const rows = await this.db.query<{
      name: string;
      display_name: string;
      emoji: string;
      is_default: boolean;
    }>(
      `SELECT name, display_name, emoji, is_default
       FROM activities
       WHERE guild_id = $1 AND removed_at IS NULL
       ORDER BY name`,
      [guildId],
    );
    return rows.map((r) => ({
      name: r.name,
      displayName: r.display_name,
      emoji: r.emoji,
      isDefault: r.is_default,
    }));
  }

  /**
   * Adds an activity, or brings a removed one back with the new emoji and casing.
   * @returns false when an activity with that name is already on the panel
   */
  async putActivity(
    guildId: string,
    displayName: string,
    emoji: string,
    isDefault: boolean,
    createdBy: string,
  ): Promise<boolean> {
    const params = [guildId, displayName.toLowerCase(), displayName, emoji, isDefault, createdBy];

    const revived = await this.db.query(
      `UPDATE activities
       SET display_name = $3, emoji = $4, is_default = $5, created_by = $6,
           created_at = now(), removed_at = NULL
       WHERE guild_id = $1 AND name = $2 AND removed_at IS NOT NULL
       RETURNING name`,
      params,
    );
    if (revived.length > 0) return true;

    const inserted = await this.db.query(
      `INSERT INTO activities (guild_id, name, display_name, emoji, is_default, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING name`,
      params,
    );
    return inserted.length > 0;
  }

  /**
   * Soft delete: the button disappears, but logs of this activity keep their
   * display name and emoji for history views.
   */
  async deleteActivity(guildId: string, displayName: string): Promise<void> {
    await this.db.query(
      `UPDATE activities SET removed_at = now()
       WHERE guild_id = $1 AND name = $2 AND removed_at IS NULL`,
      [guildId, displayName.toLowerCase()],
    );
  }

  /**
   * Makes sure every default activity is on the panel. Runs on each /setup,
   * which has to answer Discord within 3 seconds, so the usual case is two
   * statements: one insert for whatever is missing, one look for removed defaults.
   */
  async seedDefaults(guildId: string): Promise<void> {
    const tuples = DEFAULT_ACTIVITIES.map(
      (_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4}, true, 'system')`,
    );
    await this.db.query(
      `INSERT INTO activities (guild_id, name, display_name, emoji, is_default, created_by)
       VALUES ${tuples.join(', ')}
       ON CONFLICT DO NOTHING`,
      [guildId, ...DEFAULT_ACTIVITIES.flatMap((a) => [a.name, a.displayName, a.emoji])],
    );

    const removed = await this.db.query<{ name: string }>(
      `SELECT name FROM activities
       WHERE guild_id = $1 AND removed_at IS NOT NULL
         AND name IN (${DEFAULT_ACTIVITIES.map((_, i) => `$${i + 2}`).join(', ')})`,
      [guildId, ...DEFAULT_ACTIVITIES.map((a) => a.name)],
    );
    for (const { name } of removed) {
      const activity = DEFAULT_ACTIVITIES.find((a) => a.name === name)!;
      await this.putActivity(guildId, activity.displayName, activity.emoji, true, 'system');
    }
  }
}
