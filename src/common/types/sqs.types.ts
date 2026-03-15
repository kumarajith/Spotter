export interface ActivityLoggedMessage {
  type: 'ACTIVITY_LOGGED';
  guildId: string;
  userId: string;
  activityName: string; // lowercased (e.g. "push", "rest")
  timestamp: string; // ISO string — used as loggedAt and to derive date
  channelId: string; // used to post the public log message directly via bot token
  interactionToken: string;
  applicationId: string;
}

export interface BackfillActivityMessage {
  type: 'BACKFILL_ACTIVITY';
  guildId: string;
  userId: string;
  activityName: string; // lowercased
  date: string; // YYYY-MM-DD — explicit past date, not derived from timestamp
  channelId: string;
  interactionToken: string;
  applicationId: string;
}

// Discriminated union — extend with | NewMessageType as new message types are added
export type SqsMessage = ActivityLoggedMessage | BackfillActivityMessage;
