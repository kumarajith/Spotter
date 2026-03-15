export interface ActivityItem {
  PK: string; // GUILD#<guildId>
  SK: string; // ACTIVITY#<name> (lowercased)
  displayName: string;
  emoji: string;
  isDefault: boolean;
  createdBy: string;
  createdAt: string;
  entityType: 'ACTIVITY';
}

export interface ActivityLogItem {
  PK: string; // GUILD#<guildId>
  SK: string; // LOG#<date>#<userId>#<activityName>
  GSI1PK: string; // USER#<userId>
  GSI1SK: string; // LOG#<guildId>#<date>
  guildId: string;
  userId: string;
  activityName: string;
  date: string;
  loggedAt: string;
  entityType: 'LOG';
  ttl?: number; // optional — not enforced; streaks are permanent
}

export interface PendingBreakState {
  preBreakStreak: number;
  preBreakConsecutiveRest: number;
}

export interface StreakItem {
  PK: string; // GUILD#<guildId>
  SK: string; // STREAK#<userId>
  GSI1PK: string; // LEADERBOARD#<guildId>
  GSI1SK: string; // STREAK#<currentStreakPadded> (5-digit zero-padded)
  guildId: string;
  userId: string;
  currentStreak: number;
  longestStreak: number;
  currentStreakPadded: string;
  lastLoggedDate: string;
  updatedAt: string;
  entityType: 'STREAK';
  consecutiveRestOnlyDays: number;
  lastDayHasNonRest: boolean;
  pendingBreakState?: PendingBreakState;
}

export interface ActivityLoggedMessage {
  type: 'ACTIVITY_LOGGED';
  guildId: string;
  userId: string;
  activityName: string; // lowercased (e.g. "push", "rest")
  timestamp: string; // ISO string — used as loggedAt and to derive date
  interactionToken: string;
  applicationId: string;
}

export interface BackfillActivityMessage {
  type: 'BACKFILL_ACTIVITY';
  guildId: string;
  userId: string;
  activityName: string; // lowercased
  date: string; // YYYY-MM-DD — explicit past date, not derived from timestamp
  interactionToken: string;
  applicationId: string;
}

// Discriminated union — extend with | NewMessageType as new message types are added
export type SqsMessage = ActivityLoggedMessage | BackfillActivityMessage;

export interface TrackedChannelItem {
  PK: string; // GUILD#<guildId>
  SK: string; // CHANNEL#<channelId>
  lastPanelMessageId?: string;
  createdAt: string;
  entityType: 'CHANNEL';
}
