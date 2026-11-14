import { TrackedChannel } from '../common/types/models';
import { Db } from '../db/db';

interface ChannelRow {
  guild_id: string;
  channel_id: string;
  last_panel_message_id: string | null;
  [column: string]: unknown;
}

function toChannel(row: ChannelRow): TrackedChannel {
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    ...(row.last_panel_message_id && { lastPanelMessageId: row.last_panel_message_id }),
  };
}

export class PanelRepository {
  constructor(protected readonly db: Db) {}

  async getChannel(guildId: string, channelId: string): Promise<TrackedChannel | null> {
    const [row] = await this.db.query<ChannelRow>(
      `SELECT guild_id, channel_id, last_panel_message_id
       FROM tracked_channels
       WHERE guild_id = $1 AND channel_id = $2`,
      [guildId, channelId],
    );
    return row ? toChannel(row) : null;
  }

  async upsertChannel(guildId: string, channelId: string, messageId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO tracked_channels (guild_id, channel_id, last_panel_message_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (guild_id, channel_id)
       DO UPDATE SET last_panel_message_id = EXCLUDED.last_panel_message_id`,
      [guildId, channelId, messageId],
    );
  }

  /** Every tracked channel across all guilds, for the daily repost. */
  async getAllTrackedChannels(): Promise<TrackedChannel[]> {
    const rows = await this.db.query<ChannelRow>(
      `SELECT guild_id, channel_id, last_panel_message_id
       FROM tracked_channels
       ORDER BY guild_id, channel_id`,
    );
    return rows.map(toChannel);
  }
}
