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
  ttl: number; // unix epoch, loggedAt + 730 days
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
}

export interface TrackedChannelItem {
  PK: string; // GUILD#<guildId>
  SK: string; // CHANNEL#<channelId>
  lastPanelMessageId?: string;
  createdAt: string;
  entityType: 'CHANNEL';
}
