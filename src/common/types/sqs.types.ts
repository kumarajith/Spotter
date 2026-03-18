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

const VALID_TYPES = new Set<SqsMessage['type']>(['ACTIVITY_LOGGED', 'BACKFILL_ACTIVITY']);

/** Type guard that validates shape + discriminator of an SQS message body. */
export function isValidSqsMessage(value: unknown): value is SqsMessage {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.type !== 'string' || !VALID_TYPES.has(obj.type as SqsMessage['type']))
    return false;
  // Validate common required fields
  return (
    typeof obj.guildId === 'string' &&
    typeof obj.userId === 'string' &&
    typeof obj.activityName === 'string' &&
    typeof obj.channelId === 'string' &&
    typeof obj.interactionToken === 'string' &&
    typeof obj.applicationId === 'string'
  );
}
