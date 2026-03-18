import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, '..', 'spotter.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Schema ---

db.exec(`
  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    emoji TEXT DEFAULT NULL,
    is_default BOOLEAN DEFAULT 0,
    created_by TEXT,
    UNIQUE(guild_id, name)
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    activity_id INTEGER NOT NULL REFERENCES activities(id),
    logged_date TEXT NOT NULL,
    logged_at TEXT NOT NULL,
    UNIQUE(guild_id, user_id, activity_id, logged_date)
  );

  CREATE TABLE IF NOT EXISTS tracked_channels (
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    last_panel_message_id TEXT DEFAULT NULL,
    PRIMARY KEY(guild_id, channel_id)
  );
`);

import DEFAULT_ACTIVITIES from './defaults.js';

// --- Prepared statements ---

const stmts = {
  insertActivity: db.prepare(
    `INSERT OR IGNORE INTO activities (guild_id, name, emoji, is_default, created_by)
     VALUES (?, ?, ?, ?, ?)`
  ),
  getActivities: db.prepare(
    `SELECT * FROM activities WHERE guild_id = ? ORDER BY is_default DESC, id ASC`
  ),
  getActivityById: db.prepare(
    `SELECT * FROM activities WHERE id = ?`
  ),
  getActivityByName: db.prepare(
    `SELECT * FROM activities WHERE guild_id = ? AND name = ? COLLATE NOCASE`
  ),
  getCustomActivities: db.prepare(
    `SELECT * FROM activities WHERE guild_id = ? AND is_default = 0 ORDER BY id ASC`
  ),
  deleteActivity: db.prepare(
    `DELETE FROM activities WHERE guild_id = ? AND name = ? COLLATE NOCASE`
  ),
  deleteActivityLogs: db.prepare(
    `DELETE FROM activity_logs WHERE activity_id = ?`
  ),
  logActivity: db.prepare(
    `INSERT OR IGNORE INTO activity_logs (guild_id, user_id, activity_id, logged_date, logged_at)
     VALUES (?, ?, ?, ?, ?)`
  ),
  getLogForToday: db.prepare(
    `SELECT * FROM activity_logs WHERE guild_id = ? AND user_id = ? AND activity_id = ? AND logged_date = ?`
  ),
  getUserLogDates: db.prepare(
    `SELECT DISTINCT logged_date FROM activity_logs
     WHERE guild_id = ? AND user_id = ?
     ORDER BY logged_date DESC`
  ),
  getUserLogDatesWithActivities: db.prepare(
    `SELECT al.logged_date, a.name as activity_name
     FROM activity_logs al
     JOIN activities a ON a.id = al.activity_id
     WHERE al.guild_id = ? AND al.user_id = ?
     ORDER BY al.logged_date DESC`
  ),
  getUserActivityCounts: db.prepare(
    `SELECT a.name, a.emoji, COUNT(*) as count
     FROM activity_logs al
     JOIN activities a ON a.id = al.activity_id
     WHERE al.guild_id = ? AND al.user_id = ?
     GROUP BY al.activity_id
     ORDER BY count DESC`
  ),
  getUserTotalDays: db.prepare(
    `SELECT COUNT(DISTINCT logged_date) as total
     FROM activity_logs
     WHERE guild_id = ? AND user_id = ?`
  ),
  getRecentActivities: db.prepare(
    `SELECT a.name
     FROM activity_logs al
     JOIN activities a ON a.id = al.activity_id
     WHERE al.guild_id = ? AND al.user_id = ? AND al.logged_date = ?`
  ),
  getUserTotalLogs: db.prepare(
    `SELECT COUNT(*) as total FROM activity_logs WHERE guild_id = ? AND user_id = ?`
  ),
  getAllUsersWithLogs: db.prepare(
    `SELECT DISTINCT user_id FROM activity_logs WHERE guild_id = ?`
  ),
  upsertTrackedChannel: db.prepare(
    `INSERT INTO tracked_channels (guild_id, channel_id, last_panel_message_id)
     VALUES (?, ?, ?)
     ON CONFLICT(guild_id, channel_id) DO UPDATE SET last_panel_message_id = ?`
  ),
  getTrackedChannels: db.prepare(
    `SELECT * FROM tracked_channels`
  ),
  getTrackedChannel: db.prepare(
    `SELECT * FROM tracked_channels WHERE guild_id = ? AND channel_id = ?`
  ),
  updatePanelMessageId: db.prepare(
    `UPDATE tracked_channels SET last_panel_message_id = ? WHERE guild_id = ? AND channel_id = ?`
  ),
};

// --- Helpers ---

export function seedDefaults(guildId) {
  const insert = db.transaction(() => {
    for (const act of DEFAULT_ACTIVITIES) {
      stmts.insertActivity.run(guildId, act.name, act.emoji, 1, null);
    }
  });
  insert();
}

export function getActivities(guildId) {
  return stmts.getActivities.all(guildId);
}

export function getActivityById(id) {
  return stmts.getActivityById.get(id);
}

export function getActivityByName(guildId, name) {
  return stmts.getActivityByName.get(guildId, name);
}

export function getCustomActivities(guildId) {
  return stmts.getCustomActivities.all(guildId);
}

export function addActivity(guildId, name, emoji, createdBy) {
  return stmts.insertActivity.run(guildId, name, emoji, 0, createdBy);
}

export function removeActivity(guildId, name) {
  const activity = getActivityByName(guildId, name);
  if (activity) {
    stmts.deleteActivityLogs.run(activity.id);
  }
  return stmts.deleteActivity.run(guildId, name);
}

export function logActivity(guildId, userId, activityId, date, timestamp) {
  return stmts.logActivity.run(guildId, userId, activityId, date, timestamp);
}

export function getLogForToday(guildId, userId, activityId, date) {
  return stmts.getLogForToday.get(guildId, userId, activityId, date);
}

export function getUserLogDates(guildId, userId) {
  return stmts.getUserLogDates.all(guildId, userId).map(r => r.logged_date);
}

export function getUserLogDatesWithActivities(guildId, userId) {
  return stmts.getUserLogDatesWithActivities.all(guildId, userId);
}

export function getUserActivityCounts(guildId, userId) {
  return stmts.getUserActivityCounts.all(guildId, userId);
}

export function getUserTotalDays(guildId, userId) {
  return stmts.getUserTotalDays.get(guildId, userId).total;
}

export function getRecentActivities(guildId, userId, date) {
  return stmts.getRecentActivities.all(guildId, userId, date).map(r => r.name);
}

export function getUserTotalLogs(guildId, userId) {
  return stmts.getUserTotalLogs.get(guildId, userId).total;
}

export function getAllUsersWithLogs(guildId) {
  return stmts.getAllUsersWithLogs.all(guildId).map(r => r.user_id);
}

export function upsertTrackedChannel(guildId, channelId, messageId = null) {
  stmts.upsertTrackedChannel.run(guildId, channelId, messageId, messageId);
}

export function getTrackedChannels() {
  return stmts.getTrackedChannels.all();
}

export function getTrackedChannel(guildId, channelId) {
  return stmts.getTrackedChannel.get(guildId, channelId);
}

export function updatePanelMessageId(messageId, guildId, channelId) {
  stmts.updatePanelMessageId.run(messageId, guildId, channelId);
}

export default db;
