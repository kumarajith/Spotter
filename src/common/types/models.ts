export interface Activity {
  /** Lowercased display name — the key used in logs and button ids. */
  name: string;
  displayName: string;
  emoji: string;
  isDefault: boolean;
}

export interface TrackedChannel {
  guildId: string;
  channelId: string;
  lastPanelMessageId?: string;
}

export interface UserStreak {
  userId: string;
  /** Length of the streak that reaches today or yesterday (UTC); 0 if there is none. */
  currentStreak: number;
  bestStreak: number;
}

export interface ActivityLog {
  /** YYYY-MM-DD (UTC) */
  date: string;
  activityName: string;
}
