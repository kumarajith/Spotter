# Spotter v2 — Architecture & Design Document

## For Claude Code: Migration from Discord.js Bot to Serverless AWS

> **Purpose**: This document is the single source of truth for migrating the Spotter Discord fitness tracker bot from a long-running Node.js process with SQLite to a fully serverless AWS architecture using NestJS, DynamoDB, CDK, and GitHub Actions. Claude Code should use this document alongside the existing repo to implement the migration.

---

## 1. Project overview

### 1.1 What Spotter does today

Spotter is a Discord bot that tracks daily fitness activities for server members. Users tap buttons on a panel to log workouts, build consecutive-day streaks, and compete on a leaderboard.

Current features:
- Button-based tracker panel posted daily in configured channels
- Activity logging with one-click buttons (Legs, Push, Pull, Lower, Upper, Walk, Rest)
- Custom server-specific activities (`/addactivity`, `/removeactivity`)
- Streak tracking with milestone celebrations and encouragement messages
- Leaderboard showing current and all-time streaks
- Daily auto-repost at 8:00 AM UTC with streak summary
- 30-day heatmap via `/streak` command

### 1.2 Current tech stack

- **Runtime**: Node.js with discord.js (gateway bot, long-running process)
- **Database**: SQLite (better-sqlite3), file-based
- **Hosting**: Likely a VPS or local machine
- **Deployment**: Manual (`npm start`)
- **No CI/CD, no IaC, no observability**

### 1.3 Target tech stack

- **Runtime**: Node.js with NestJS, deployed as AWS Lambda
- **API layer**: AWS API Gateway (HTTP API)
- **Database**: DynamoDB (single-table design, on-demand capacity)
- **Async processing**: SQS with Dead Letter Queue
- **Scheduling**: EventBridge Scheduler
- **Notifications**: SNS (fan-out for milestone alerts)
- **Secrets**: SSM Parameter Store SecureString (Discord bot token, etc.)
- **Observability**: CloudWatch custom metrics, alarms, dashboard
- **IaC**: AWS CDK (TypeScript)
- **CI/CD**: GitHub Actions (lint → test → cdk diff on PR → cdk deploy on merge)
- **Environments**: Dev and Prod stacks via CDK context

### 1.4 Key architectural shift

The bot currently uses the Discord **Gateway** (a persistent WebSocket connection). The new architecture uses Discord **Interactions Endpoint** (webhook-based HTTP POST). Discord sends every slash command and button click as an HTTP request to our API Gateway URL. This is the serverless-native approach — no idle compute, no persistent connections.

**Important**: The daily auto-repost feature (posting panels and streak summaries at 8 AM UTC) cannot be triggered by Discord interactions. This is handled by a separate scheduled Lambda triggered by EventBridge Scheduler, which calls the Discord REST API directly to post messages.

---

## 2. Repository structure

```
spotter-v2/
├── .github/
│   └── workflows/
│       ├── ci.yml                    # Lint + test on PR
│       └── deploy.yml                # CDK deploy on merge to main
├── infra/                            # AWS CDK app
│   ├── bin/
│   │   └── app.ts                    # CDK app entrypoint
│   ├── lib/
│   │   ├── spotter-stack.ts          # Main stack (all resources)
│   │   └── constructs/
│   │       ├── api.ts                # API Gateway + Lambda integration
│   │       ├── database.ts           # DynamoDB table + GSIs
│   │       ├── queue.ts              # SQS + DLQ
│   │       ├── scheduler.ts          # EventBridge scheduled rules
│   │       ├── notifications.ts      # SNS topics
│   │       ├── secrets.ts            # Secrets Manager
│   │       └── monitoring.ts         # CloudWatch dashboard + alarms
│   ├── cdk.json
│   ├── tsconfig.json
│   └── package.json
├── src/                              # NestJS application
│   ├── main.ts                       # NestJS bootstrap (local dev)
│   ├── lambda.ts                     # Lambda handler (wraps NestJS with serverless-express)
│   ├── app.module.ts                 # Root module
│   ├── discord/                      # Discord interaction handling
│   │   ├── discord.module.ts
│   │   ├── discord.controller.ts     # POST /interactions endpoint
│   │   ├── discord.service.ts        # Interaction routing + response building
│   │   ├── discord-api.service.ts    # Discord REST API client (for posting messages)
│   │   └── guards/
│   │       └── discord-signature.guard.ts  # Ed25519 signature verification
│   ├── activity/                     # Activity management domain
│   │   ├── activity.module.ts
│   │   ├── activity.controller.ts    # REST endpoints (future use)
│   │   ├── activity.service.ts       # Business logic
│   │   └── activity.repository.ts    # DynamoDB operations
│   ├── tracking/                     # Activity logging + streaks
│   │   ├── tracking.module.ts
│   │   ├── tracking.service.ts       # Log activity, compute streaks
│   │   └── tracking.repository.ts    # DynamoDB operations
│   ├── leaderboard/                  # Leaderboard domain
│   │   ├── leaderboard.module.ts
│   │   ├── leaderboard.service.ts
│   │   └── leaderboard.repository.ts
│   ├── panel/                        # Panel management (tracked channels)
│   │   ├── panel.module.ts
│   │   ├── panel.service.ts          # Panel posting + updating
│   │   └── panel.repository.ts
│   ├── common/
│   │   ├── dynamodb/
│   │   │   └── dynamodb.service.ts   # DynamoDB DocumentClient wrapper
│   │   ├── sqs/
│   │   │   └── sqs.service.ts        # SQS send helper
│   │   ├── config/
│   │   │   └── env.config.ts         # Environment config (table name, queue URL, etc.)
│   │   └── types/
│   │       ├── discord.types.ts      # Discord interaction types
│   │       └── dynamo.types.ts       # DynamoDB entity types
│   └── handlers/                     # Non-HTTP Lambda handlers
│       ├── sqs-consumer.handler.ts   # SQS event processor
│       └── scheduler.handler.ts      # EventBridge scheduled tasks
├── test/
│   ├── unit/
│   │   ├── tracking.service.spec.ts
│   │   ├── activity.service.spec.ts
│   │   └── leaderboard.service.spec.ts
│   └── e2e/
│       └── discord.e2e-spec.ts
├── .env.example
├── .gitignore
├── nest-cli.json
├── tsconfig.json
├── tsconfig.build.json
├── package.json
├── ARCHITECTURE.md                   # This file
└── README.md
```

---

## 3. DynamoDB single-table design

### 3.1 Design philosophy

All entities live in one DynamoDB table. This is the DynamoDB-native pattern: you co-locate related items under the same partition key and use sort key prefixes to separate entity types. Access patterns drive the key design — every query the application needs must be answerable with a Query or GetItem, never a Scan.

The table uses **on-demand capacity mode** (PAY_PER_REQUEST) — $0 at our scale, no capacity planning needed, handles traffic spikes around daily log times.

Every item includes an `entityType` attribute (e.g., `"ACTIVITY"`, `"LOG"`, `"STREAK"`) for debugging, DynamoDB Streams consumers, and generic tooling.

### 3.2 Table definition

```
Table: spotter-{env}
  PK    (S)  — Partition key (overloaded, meaning depends on entity type)
  SK    (S)  — Sort key (overloaded)

GSI1:
  GSI1PK (S) — Overloaded GSI partition key
  GSI1SK (S) — Overloaded GSI sort key
  Projection: ALL
```

One table, one GSI. Every entity goes in here.

### 3.3 Entity key design

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ ACTIVITIES                                                                          │
│ PK                  SK                        GSI1PK    GSI1SK    Attributes         │
│ GUILD#123           ACTIVITY#push             —         —         displayName, emoji │
│ GUILD#123           ACTIVITY#pull             —         —         displayName, emoji │
│ GUILD#123           ACTIVITY#legs             —         —         displayName, emoji │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ ACTIVITY LOGS                                                                       │
│ PK                  SK                              GSI1PK      GSI1SK              │
│ GUILD#123           LOG#2026-03-14#user456#push     USER#456    LOG#123#2026-03-14  │
│ GUILD#123           LOG#2026-03-14#user456#pull     USER#456    LOG#123#2026-03-14  │
│ GUILD#123           LOG#2026-03-14#user789#legs     USER#789    LOG#123#2026-03-14  │
│ GUILD#123           LOG#2026-03-13#user456#push     USER#456    LOG#123#2026-03-13  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ STREAKS                                                                             │
│ PK                  SK                 GSI1PK              GSI1SK                   │
│ GUILD#123           STREAK#user456     LEADERBOARD#123     STREAK#00015             │
│ GUILD#123           STREAK#user789     LEADERBOARD#123     STREAK#00003             │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ TRACKED CHANNELS                                                                    │
│ PK                  SK                    GSI1PK    GSI1SK    Attributes             │
│ GUILD#123           CHANNEL#ch001         —         —         lastPanelMessageId     │
│ GUILD#123           CHANNEL#ch002         —         —         lastPanelMessageId     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

All items for a guild share the same PK (`GUILD#123`). The SK prefix (`ACTIVITY#`, `LOG#`, `STREAK#`, `CHANNEL#`) separates entity types within the partition.

### 3.4 Item schemas

**ACTIVITY items:**
```
PK:          GUILD#<guild_id>
SK:          ACTIVITY#<name>          (lowercased)
Attributes:  displayName, emoji, isDefault, createdBy, createdAt, entityType="ACTIVITY"
```

**ACTIVITY_LOG items:**
```
PK:          GUILD#<guild_id>
SK:          LOG#<date>#<userId>#<activityName>    (date first for daily queries)
GSI1PK:      USER#<userId>
GSI1SK:      LOG#<guildId>#<date>
Attributes:  guildId, userId, activityName, date, loggedAt, entityType="LOG",
             ttl (unix epoch, loggedAt + 730 days, for future TTL enablement)
```

**STREAK items:**
```
PK:          GUILD#<guild_id>
SK:          STREAK#<userId>
GSI1PK:      LEADERBOARD#<guild_id>
GSI1SK:      STREAK#<currentStreakPadded>    (5-digit zero-padded: "00015")
Attributes:  guildId, userId, currentStreak, longestStreak, currentStreakPadded,
             lastLoggedDate, updatedAt, entityType="STREAK"
```

**TRACKED_CHANNEL items:**
```
PK:          GUILD#<guild_id>
SK:          CHANNEL#<channel_id>
Attributes:  lastPanelMessageId, createdAt, entityType="CHANNEL"
```

Validation constraint: activity names must be alphanumeric + spaces only, max 32 chars, stored lowercased. This prevents sort-key edge cases.

### 3.5 Access patterns

| Access pattern | Operation | Key condition |
|----------------|-----------|---------------|
| List activities for guild | Query | PK=`GUILD#<id>`, SK begins_with `ACTIVITY#` |
| Get specific activity | GetItem | PK=`GUILD#<id>`, SK=`ACTIVITY#<name>` |
| Log an activity (write) | PutItem | PK=`GUILD#<id>`, SK=`LOG#<date>#<userId>#<activity>`. Condition: `attribute_not_exists(SK)` to prevent double-log. |
| All logs for guild on a date (daily summary) | Query | PK=`GUILD#<id>`, SK begins_with `LOG#<date>` |
| User's logs in guild for date range (heatmap) | Query | PK=`GUILD#<id>`, SK between `LOG#<startDate>#<userId>` and `LOG#<endDate>#<userId>#zzz` |
| User's logs across all guilds | Query (GSI1) | GSI1PK=`USER#<userId>`, GSI1SK begins_with `LOG#` |
| User's logs in specific guild via GSI | Query (GSI1) | GSI1PK=`USER#<userId>`, GSI1SK begins_with `LOG#<guildId>#` |
| Get user's streak in guild | GetItem | PK=`GUILD#<id>`, SK=`STREAK#<userId>` |
| All streaks in guild (nightly reset) | Query | PK=`GUILD#<id>`, SK begins_with `STREAK#` |
| Leaderboard: top active streaks | Query (GSI1) | GSI1PK=`LEADERBOARD#<id>`, ScanIndexForward=false, Limit=10 |
| Leaderboard: top all-time streaks | Query | PK=`GUILD#<id>`, SK begins_with `STREAK#`, sort by `longestStreak` in app code |
| List tracked channels for guild | Query | PK=`GUILD#<id>`, SK begins_with `CHANNEL#` |

**Note on the `#zzz` suffix**: Used as a lexicographic ceiling to capture all activity names within a date+user prefix. Since activity names are constrained to alphanumeric + spaces (validated at creation), `zzz` sorts after all valid names.

**Note on the leaderboard GSI1PK**: Uses `LEADERBOARD#<id>` instead of `GUILD#<id>` so the GSI query returns ONLY streak items, not a mix of logs and streaks.

### 3.6 Key design decisions

**Why date comes before userId in the log SK:**
```
SK = LOG#<date>#<userId>#<activity>
```
Putting date first means you can query "all logs for all users on a specific date" with `begins_with "LOG#2026-03-14"`. This powers the daily summary. You can still query per-user by extending the prefix: `begins_with "LOG#2026-03-14#user456"`. If userId came first, you'd need a separate GSI for date-based queries.

**Why GSI1SK for logs is `LOG#<guildId>#<date>`:**
The GSI inverts the relationship. Main table is partitioned by guild (find things in a server). GSI1 is partitioned by user (find things across servers). Including guildId in the GSI1SK lets you filter to a specific guild within the user's partition.

### 3.7 Streak logic

Streaks are **per-user, not per-activity**. A user's streak increments for each consecutive day they log *at least one* activity. Push on Monday + Pull on Tuesday + Rest on Wednesday = 3-day streak.

**On activity log (SQS consumer)**:
1. Write the activity log item (conditional PutItem — handle `ConditionalCheckFailedException` as "already logged today, not an error")
2. Read the user's streak item for this guild (GetItem: PK=`GUILD#<id>`, SK=`STREAK#<userId>`)
3. Determine if this is the user's **first log of the day** by checking `lastLoggedDate`:
   - If `lastLoggedDate` == today → streak already counted for today, no update needed. Stop here.
   - If `lastLoggedDate` == yesterday → increment `currentStreak` by 1, update `longestStreak` if `currentStreak` now exceeds it
   - If `lastLoggedDate` is older than yesterday (or streak item doesn't exist) → set `currentStreak` to 1, create/update streak item
4. Set `lastLoggedDate` to today
5. Write updated streak item using **TransactWriteItems** (delete old + put new, atomic — required because GSI1SK `currentStreakPadded` changes with the streak value)
6. If milestone hit (streak = 7, 14, 30, 60, 100, 365) → publish to SNS, post celebration message to Discord

```typescript
// Atomic streak update (pseudocode)
await dynamodb.transactWrite({
  TransactItems: [
    { Delete: { TableName: table, Key: { PK: 'GUILD#123', SK: 'STREAK#user456' } } },
    { Put: { TableName: table, Item: {
        PK: 'GUILD#123', SK: 'STREAK#user456',
        GSI1PK: 'LEADERBOARD#123', GSI1SK: 'STREAK#00015',
        currentStreak: 15, longestStreak: 15, currentStreakPadded: '00015',
        lastLoggedDate: '2026-03-14', entityType: 'STREAK',
    } } },
  ],
});
```

Without the transaction, a failure between delete and put leaves no streak item. A failure between put and delete creates a duplicate on the leaderboard.

**On nightly schedule (EventBridge → Scheduler Lambda)**:
1. For each guild with tracked channels:
   a. Query all streak items (PK=`GUILD#<id>`, SK begins_with `STREAK#`)
   b. For each streak where `lastLoggedDate` < yesterday → set `currentStreak` to 0 (via TransactWriteItems)
   c. Build streak summary: list users with active streaks, grouped by user, showing streak length
   d. Post summary embed to each tracked channel via Discord REST API
   e. Repost the activity panel with fresh buttons

**For the heatmap** (`/streak [user]` command):
1. Query activity logs: PK=`GUILD#<id>`, SK between `LOG#<30daysAgo>#<userId>` and `LOG#<today>#<userId>#zzz`
2. Group logs by date
3. Each day is green (has at least one activity) or red (no activity)
4. Show activity names for each day as detail (e.g., "Mon 3/10: Push, Walk")

Total cost at hobby scale: **$0/month** (well within DynamoDB always-free tier of 25GB storage + 25 WCU/RCU).

## 4. Lambda functions

### 4.1 API Lambda (NestJS monolambda)

**Trigger**: API Gateway HTTP API → single Lambda
**Handler**: `src/lambda.ts`
**Purpose**: All synchronous HTTP traffic — Discord interactions and REST API

```typescript
// src/lambda.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configure as serverlessExpress } from '@codegenie/serverless-express';
import { Callback, Context, Handler } from 'aws-lambda';

let server: Handler;

async function bootstrap(): Promise<Handler> {
  const app = await NestFactory.create(AppModule);
  await app.init();
  const expressApp = app.getHttpAdapter().getInstance();
  return serverlessExpress({ app: expressApp });
}

export const handler: Handler = async (
  event: any,
  context: Context,
  callback: Callback,
) => {
  server = server ?? (await bootstrap());
  return server(event, context, callback);
};
```

**Key implementation notes**:
- Use `@codegenie/serverless-express` to wrap the NestJS app
- For local development, `src/main.ts` starts NestJS normally with `app.listen(3000)`
- The NestJS app is initialized once and reused across Lambda invocations (warm starts)
- Keep the bundle lean — tree-shake, exclude dev dependencies

### 4.2 SQS Consumer Lambda

**Trigger**: SQS queue (batch size: 1 to start, tune later)
**Handler**: `src/handlers/sqs-consumer.handler.ts`
**Purpose**: Async processing of activity logs, streak updates, milestone checks

```typescript
// src/handlers/sqs-consumer.handler.ts
import { SQSHandler, SQSEvent } from 'aws-lambda';

export const handler: SQSHandler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const body = JSON.parse(record.body);

    switch (body.type) {
      case 'ACTIVITY_LOGGED':
        // 1. Write activity log to DynamoDB (conditional put)
        // 2. Read + update streak counter
        // 3. Check for milestones → publish to SNS if hit
        break;
      case 'PANEL_UPDATE':
        // Update the panel message in Discord with new button states
        break;
      default:
        console.warn(`Unknown message type: ${body.type}`);
    }
  }
};
```

**SQS message schema**:
```json
{
  "type": "ACTIVITY_LOGGED",
  "guildId": "123456789",
  "userId": "987654321",
  "activityName": "Push",
  "timestamp": "2026-03-13T10:30:00Z"
}
```

**Dead Letter Queue**: Messages that fail 3 times go to a DLQ. Set up a CloudWatch alarm on DLQ depth > 0.

### 4.3 Scheduler Lambda

**Trigger**: EventBridge Scheduler (cron: `0 8 * * ? *` — 8:00 AM UTC daily)
**Handler**: `src/handlers/scheduler.handler.ts`
**Purpose**: Daily streak resets, panel reposts, streak summaries

```typescript
// src/handlers/scheduler.handler.ts
import { ScheduledHandler } from 'aws-lambda';

export const handler: ScheduledHandler = async () => {
  // 1. Get all guilds with tracked channels
  // 2. For each guild:
  //    a. Query all STREAK items
  //    b. Reset streaks where lastLoggedDate < yesterday
  //    c. Build streak summary embed
  //    d. Post summary to each tracked channel via Discord REST API
  //    e. Repost the activity panel with fresh buttons
};
```

---

## 5. Discord interaction handling

### 5.1 Webhook-based interactions (replacing gateway)

Discord sends all interactions (slash commands, button clicks) as HTTP POST requests to a configured **Interactions Endpoint URL**. This URL must:

1. Respond to Discord's `PING` verification (type 1) with a `PONG` (type 1)
2. Verify the request signature using Ed25519 (Discord's public key)
3. Respond within 3 seconds

### 5.2 Signature verification guard

```typescript
// src/discord/guards/discord-signature.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { verify } from 'discord-interactions'; // or use tweetnacl

@Injectable()
export class DiscordSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];
    const body = JSON.stringify(req.body);
    const publicKey = process.env.DISCORD_PUBLIC_KEY;

    return verify(body, signature, timestamp, publicKey);
  }
}
```

**Critical**: API Gateway must be configured to pass the raw body for signature verification. Use a **Lambda proxy integration** (the default with HTTP API), which passes the raw body in `event.body`.

### 5.3 Interaction controller

```typescript
// src/discord/discord.controller.ts
@Controller('interactions')
export class DiscordController {
  @Post()
  @UseGuards(DiscordSignatureGuard)
  async handleInteraction(@Body() interaction: DiscordInteraction) {
    // Type 1: PING → return PONG
    if (interaction.type === InteractionType.PING) {
      return { type: InteractionResponseType.PONG };
    }

    // Type 2: APPLICATION_COMMAND (slash commands)
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      return this.discordService.handleCommand(interaction);
    }

    // Type 3: MESSAGE_COMPONENT (button clicks)
    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      return this.discordService.handleComponent(interaction);
    }
  }
}
```

### 5.4 Handling the 3-second deadline

Discord requires a response within 3 seconds. For activity logging (which involves SQS + DynamoDB), the flow is:

1. User clicks button → Discord POSTs to API Gateway
2. API Lambda receives interaction
3. **Immediately** sends SQS message with the activity log data
4. **Immediately** returns a Discord response: `DEFERRED_UPDATE_MESSAGE` (type 6) or an acknowledgment embed
5. SQS consumer processes the log asynchronously
6. If the consumer needs to update the panel (e.g., showing a checkmark), it calls the Discord REST API to edit the original message

For fast reads (streak, leaderboard), respond directly — DynamoDB GetItem/Query is fast enough to stay under 3 seconds.

### 5.5 Slash command registration

Slash commands must be registered with Discord separately (not on every request). Create a one-time setup script:

```
scripts/register-commands.ts
```

This script uses the Discord REST API to register the following commands:
- `/setup` — Post tracker panel in current channel
- `/addactivity name: emoji:` — Add custom activity
- `/removeactivity name:` — Remove custom activity (with autocomplete)
- `/streak [user]` — Show streak stats + 30-day heatmap
- `/leaderboard` — Show top streaks

Run this script once during initial setup and whenever commands change. It does NOT run on every deploy.

---

## 6. CDK infrastructure

### 6.1 Stack overview

One CDK stack (`SpotterStack`) deploys everything. Environment separation (dev/prod) is handled via CDK context.

```typescript
// infra/bin/app.ts
const app = new cdk.App();
const env = app.node.tryGetContext('env') || 'dev';

new SpotterStack(app, `Spotter-${env}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-south-1', // Mumbai — closest to you
  },
  environment: env,
});
```

### 6.2 Resource definitions

**DynamoDB Tables** (`infra/lib/constructs/database.ts`):
```typescript
const removalPolicy = props.environment === 'prod'
  ? cdk.RemovalPolicy.RETAIN
  : cdk.RemovalPolicy.DESTROY;

const table = new dynamodb.Table(this, 'SpotterTable', {
  tableName: `spotter-${props.environment}`,
  partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy,
});

table.addGlobalSecondaryIndex({
  indexName: 'GSI1',
  partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});
```

**API Lambda** (`infra/lib/constructs/api.ts`):
```typescript
const apiLambda = new lambda.Function(this, 'ApiHandler', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'dist/lambda.handler',
  code: lambda.Code.fromAsset('../dist'),  // Bundled NestJS app
  memorySize: 512,
  timeout: cdk.Duration.seconds(30),
  environment: {
    TABLE_NAME: table.tableName,
    QUEUE_URL: queue.queueUrl,
    DISCORD_PARAM_NAME: discordParam.parameterName,
    NODE_ENV: props.environment,
  },
});

const httpApi = new apigateway.HttpApi(this, 'HttpApi', {
  apiName: `spotter-api-${props.environment}`,
});

httpApi.addRoutes({
  path: '/interactions',
  methods: [apigateway.HttpMethod.POST],
  integration: new HttpLambdaIntegration('ApiIntegration', apiLambda),
});
```

**SQS Queue + DLQ** (`infra/lib/constructs/queue.ts`):
```typescript
const dlq = new sqs.Queue(this, 'DLQ', {
  queueName: `spotter-dlq-${props.environment}`,
  retentionPeriod: cdk.Duration.days(14),
});

const queue = new sqs.Queue(this, 'ProcessingQueue', {
  queueName: `spotter-queue-${props.environment}`,
  visibilityTimeout: cdk.Duration.seconds(60),
  deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
});
```

**SQS Consumer Lambda**:
```typescript
const sqsConsumer = new lambda.Function(this, 'SqsConsumer', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'dist/handlers/sqs-consumer.handler',
  code: lambda.Code.fromAsset('../dist'),
  memorySize: 256,
  timeout: cdk.Duration.seconds(60),
  environment: {
    TABLE_NAME: table.tableName,
    SNS_TOPIC_ARN: notificationTopic.topicArn,
    DISCORD_PARAM_NAME: discordParam.parameterName,
  },
});

sqsConsumer.addEventSource(new SqsEventSource(queue, {
  batchSize: 1,
}));
```

**EventBridge Scheduler**:
```typescript
const schedulerLambda = new lambda.Function(this, 'SchedulerHandler', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'dist/handlers/scheduler.handler',
  code: lambda.Code.fromAsset('../dist'),
  memorySize: 256,
  timeout: cdk.Duration.minutes(5), // Needs time to iterate guilds
  environment: {
    TABLE_NAME: table.tableName,
    DISCORD_PARAM_NAME: discordParam.parameterName,
  },
});

new events.Rule(this, 'DailySchedule', {
  schedule: events.Schedule.cron({ hour: '8', minute: '0' }),
  targets: [new targets.LambdaFunction(schedulerLambda)],
});
```

**SNS Topic** (`infra/lib/constructs/notifications.ts`):
```typescript
const topic = new sns.Topic(this, 'MilestoneNotifications', {
  topicName: `spotter-milestones-${props.environment}`,
});
// Initially: no subscriptions. Milestone handler in SQS consumer
// publishes to SNS, which can later fan out to email, SMS, etc.
// For now, the SQS consumer posts milestone messages directly to Discord.
```

**SSM Parameter Store** (`infra/lib/constructs/secrets.ts`):
```typescript
// Create the parameter manually via AWS Console or CLI first:
// aws ssm put-parameter --name "/spotter/dev/discord" --type SecureString \
//   --value '{"botToken":"...","publicKey":"...","applicationId":"..."}'
const discordParam = ssm.StringParameter.fromSecureStringParameterAttributes(
  this, 'DiscordSecret', {
    parameterName: `/spotter/${props.environment}/discord`,
  }
);
```

**CloudWatch** (`infra/lib/constructs/monitoring.ts`):
```typescript
// Alarm on DLQ messages — the only alert that matters
// Uses built-in SQS metric, costs $0
new cloudwatch.Alarm(this, 'DlqAlarm', {
  metric: dlq.metricApproximateNumberOfMessagesVisible(),
  threshold: 1,
  evaluationPeriods: 1,
  alarmDescription: 'Messages in DLQ — processing failures detected',
});

// No custom metrics or dashboards needed — use the built-in
// Lambda/SQS/DynamoDB metrics in CloudWatch console for free.
// Add a dashboard ($3/month) or custom metrics ($0.30/each) later if needed.
```

### 6.3 IAM permissions (CDK handles most of this)

CDK's `grant*` methods handle IAM automatically:
```typescript
// All Lambdas read/write the same table
table.grantReadWriteData(apiLambda);
table.grantReadWriteData(sqsConsumer);
table.grantReadWriteData(schedulerLambda);

queue.grantSendMessages(apiLambda);
discordParam.grantRead(apiLambda);
discordParam.grantRead(sqsConsumer);
discordParam.grantRead(schedulerLambda);
notificationTopic.grantPublish(sqsConsumer);
```

---

## 7. CI/CD pipeline (GitHub Actions)

### 7.1 CI — runs on every PR

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npm run build

      # CDK diff — shows what would change
      - run: cd infra && npm ci
      - run: cd infra && npx cdk diff -c env=dev
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: ap-south-1
```

### 7.2 Deploy — runs on merge to main

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy-dev:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci
      - run: npm run build

      - run: cd infra && npm ci
      - run: cd infra && npx cdk deploy -c env=dev --require-approval never
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: ap-south-1

  deploy-prod:
    needs: deploy-dev
    runs-on: ubuntu-latest
    environment: production  # Requires manual approval in GitHub
    steps:
      # Same steps with -c env=prod
```

---

## 8. Migration mapping (old → new)

This section maps every piece of the existing codebase to its new location and approach.

### 8.1 Database migration

| SQLite (old) | DynamoDB (new) | Notes |
|-------------|----------------|-------|
| `activities` table | `ACTIVITY#` items in `spotter-{env}` | `is_default` activities seeded on first `/setup` |
| `activity_logs` table | `LOG#` items in `spotter-{env}` | Unique constraint replaced by conditional PutItem |
| `tracked_channels` table | `CHANNEL#` items in `spotter-{env}` | Direct mapping |
| Streak computation (on read) | `STREAK#` items in `spotter-{env}` (pre-computed) | New entity. Per-user streaks (any activity counts). |

### 8.2 Feature mapping

| Feature | Old implementation | New implementation |
|---------|-------------------|-------------------|
| Button panel | discord.js message components via gateway | Discord Interactions Endpoint -> API Lambda -> return embed + components |
| Activity logging | Direct SQLite insert on button click | Button click -> API Lambda -> SQS -> Consumer Lambda -> DynamoDB |
| Streak display | SQL query computing consecutive days | GetItem: PK=`GUILD#<id>`, SK=`STREAK#<userId>` |
| Leaderboard (active) | SQL query with GROUP BY + ORDER BY | Query GSI1: GSI1PK=`LEADERBOARD#<id>`, ScanIndexForward=false |
| Leaderboard (all-time) | SQL query | Query all streaks for guild, sort by longestStreak in app code |
| 30-day heatmap | SQL query on activity_logs for date range | Query: PK=`GUILD#<id>`, SK between `LOG#{30daysAgo}#<userId>` and `LOG#{today}#<userId>#zzz` |
| Daily repost | node-cron or setTimeout in process | EventBridge Scheduler -> Scheduler Lambda |
| Daily streak summary | Posted with repost | Scheduler queries streaks, groups by user, posts embed |
| Encouragement messages | In-memory check after log | SQS Consumer checks milestone -> posts via Discord REST API |
| Slash command registration | discord.js client.once('ready') | One-time script (`scripts/register-commands.ts`) |

### 8.3 Environment variables

| Variable | Source | Description |
|----------|--------|-------------|
| `TABLE_NAME` | CDK output | DynamoDB table name (`spotter-{env}`) |
| `QUEUE_URL` | CDK output | SQS queue URL |
| `SNS_TOPIC_ARN` | CDK output | SNS topic ARN |
| `DISCORD_PARAM_NAME` | CDK output | SSM Parameter Store path (JSON SecureString: botToken, publicKey, applicationId) |
| `NODE_ENV` | CDK context | `dev` or `prod` |
| `DAILY_HOUR_UTC` | Lambda env | Configurable via CDK (default: 8) |

---

## 9. Local development

### 9.1 Running NestJS locally

```bash
# Start NestJS on port 3000
npm run start:dev

# In another terminal, expose via ngrok for Discord webhooks
ngrok http 3000
```

Set the ngrok URL as your Discord application's Interactions Endpoint URL for testing.

### 9.2 Local DynamoDB

```bash
# Run DynamoDB Local via Docker
docker run -p 8000:8000 amazon/dynamodb-local

# Set env var to use local endpoint
DYNAMODB_ENDPOINT=http://localhost:8000
```

The `dynamodb.service.ts` should check for `DYNAMODB_ENDPOINT` and use it if set, otherwise use the default AWS SDK behavior.

### 9.3 Testing SQS locally

For local development, bypass SQS and call the consumer logic directly. Add a flag:

```typescript
if (process.env.NODE_ENV === 'local') {
  // Call consumer logic directly instead of sending to SQS
  await this.processActivityLog(payload);
} else {
  await this.sqsService.send(payload);
}
```

---

## 10. Implementation order

This is the recommended build sequence. Each phase produces a working, deployable state.

### Phase 1: Foundation (Saturday morning)
1. Initialize NestJS project with TypeScript
2. Set up CDK app with DynamoDB table + API Gateway + API Lambda
3. Implement Discord signature verification guard
4. Implement PING/PONG handler
5. Deploy, configure Discord Interactions Endpoint URL
6. Verify Discord can reach your endpoint

### Phase 2: Core commands (Saturday afternoon)
1. Port activity definitions (seed defaults, `/addactivity`, `/removeactivity`)
2. Implement DynamoDB repository layer
3. Implement button-based panel (`/setup` command)
4. Implement activity logging flow (sync first — no SQS yet)
5. Deploy and test button clicks

### Phase 3: Async + streaks (Sunday morning)
1. Add SQS queue + DLQ to CDK stack
2. Create SQS consumer Lambda
3. Move activity logging to async (API → SQS → Consumer)
4. Implement streak computation in consumer
5. Implement `/streak` command with heatmap
6. Implement `/leaderboard` command

### Phase 4: Scheduling + polish (Sunday afternoon)
1. Add EventBridge Scheduler to CDK stack
2. Create Scheduler Lambda for daily repost + streak reset
3. Add Secrets Manager for Discord credentials
4. Add CloudWatch dashboard + DLQ alarm
5. Set up GitHub Actions CI/CD pipeline
6. Write README

### Phase 5: Future enhancements (later)
- SNS fan-out for milestone notifications (email, SMS)
- REST API endpoints for non-Discord access
- Multi-guild optimization (batch operations)
- CloudWatch custom metrics (activities per day, unique users)
- Lambda bundle optimization (esbuild, layers)

---

## 11. Key decisions and rationale

| Decision | Rationale |
|----------|-----------|
| DynamoDB over RDS | $0/month on free tier permanently. Access patterns are well-defined and key-based. |
| Single-table over multi-table | Learn the DynamoDB-native pattern. One table in CDK, one env var, simpler IAM. Multi-table alternative documented in Appendix A. |
| NestJS over plain Express | Module system maps naturally to domains (activity, tracking, leaderboard). Dependency injection makes testing clean. Same framework can grow with the project. |
| Monolambda over lambda-per-route | Weekend scope. One Lambda serving all HTTP routes via NestJS routing. Split later if cold starts become an issue. |
| Webhook interactions over gateway | Serverless-native. No idle compute. Scales to zero. Gateway requires a persistent process. |
| SQS for async processing | Decouples the 3-second Discord response deadline from streak computation. DLQ provides failure visibility. |
| Pre-computed streaks over on-read calculation | DynamoDB has no aggregation. Computing streaks on every read would require scanning all logs. Write-time computation is O(1) on read. |
| Per-user streaks (not per-activity) | A streak = consecutive days logging any activity. Push Monday + Pull Tuesday = 2-day streak. This matches how the current bot works. |
| CDK over SAM/Serverless Framework | TypeScript throughout. Fine-grained control. Better construct composition. Matches your professional experience. |
| Single stack over multi-stack | Simple enough to stay in one stack. Environment separation via CDK context (`-c env=dev`). |

---

## 12. Testing and cutover plan

### 12.1 Test Discord application

Create a separate Discord application ("Spotter Dev") for development and testing. This runs in parallel with the existing bot — zero disruption to your friends.

Setup:
1. Discord Developer Portal → New Application → "Spotter Dev"
2. Create bot → copy token
3. Copy Application ID and Public Key from General Information
4. Store in SSM Parameter Store: `/spotter/dev/discord` → `{ "botToken": "...", "publicKey": "...", "applicationId": "..." }`
5. Invite to your server (two bots can coexist — they have different commands)
6. After first CDK deploy, set Interactions Endpoint URL to your dev API Gateway URL

### 12.2 Local development workflow

```
Code change → NestJS hot-reloads → ngrok forwards Discord webhook → test in Discord
```

No deploy needed for most iteration. Only deploy to AWS when testing CDK infrastructure, SQS processing, or EventBridge scheduling.

### 12.3 Cutover to production

When v2 is fully tested against Spotter Dev:

1. Deploy prod CDK stack: `cd infra && npx cdk deploy -c env=prod`
2. Store the **original** Spotter bot's credentials in SSM Parameter Store: `/spotter/prod/discord`
3. In Discord Developer Portal, open the **original** Spotter application
4. Set its Interactions Endpoint URL → your prod API Gateway URL (`/interactions`)
5. Register slash commands against the original Application ID (run `scripts/register-commands.ts` with prod app ID)
6. Shut down the old Node.js process
7. The original bot now runs serverless — same bot token, same identity, new backend

### 12.4 Data migration (optional)

Option A — **Clean start** (recommended): Tell friends "new version, streaks reset." It's a side project.

Option B — **Migrate data**: Write a one-time script that reads SQLite → transforms → batch writes to DynamoDB. The schema mapping is straightforward. ~30-60 minutes of work.

```typescript
// scripts/migrate-from-sqlite.ts (sketch)
// 1. Read activities from SQLite → PutItem to spotter-activities-prod
// 2. Read activity_logs from SQLite → PutItem to spotter-logs-prod
// 3. Read tracked_channels from SQLite → PutItem to spotter-channels-prod
// 4. Compute streaks from activity_logs → PutItem to spotter-streaks-prod
```

---

## 13. Notes for Claude Code

### Working with the existing codebase
- The existing code lives in `v1-reference/` on the v2-serverless branch. Port the business logic (streak calculation, encouragement messages, heatmap generation, embed builders) but rewrite the infrastructure layer entirely.
- The existing `spotter.db-shm` and `spotter.db-wal` files are SQLite artifacts — these should be gitignored and are not needed in the new architecture.
- The existing `.claude/` directory may contain Claude Code settings — preserve it.

### DynamoDB gotchas
- Single-table design: all entities share one table. PK is always `GUILD#<id>`. SK prefix determines entity type (`ACTIVITY#`, `LOG#`, `STREAK#`, `CHANNEL#`).
- Use `attribute_not_exists(SK)` condition on PutItem for activity logs to prevent double-logging. Handle `ConditionalCheckFailedException` gracefully (it means "already logged today" — not an error).
- When updating streak counters, use TransactWriteItems to atomically delete the old item and put the new one (because the GSI1SK `STREAK#<padded>` changes with the streak value).
- DynamoDB Query with `begins_with` on SK is your primary query pattern. `begins_with "LOG#2026-03-14"` gets all logs for a date; `begins_with "STREAK#"` gets all streaks.
- Activity names are validated at creation: alphanumeric + spaces only, max 32 chars, stored lowercased. This makes sort key range queries safe.
- The `#zzz` suffix on range query end keys is a lexicographic ceiling — documented in Section 3.5.
- The leaderboard GSI uses `LEADERBOARD#<guildId>` as GSI1PK (not `GUILD#<id>`) so queries return only streak items, not a mix of entity types.

### Discord interaction specifics
- The `discord-interactions` npm package provides Ed25519 verification utilities.
- Button `custom_id` format should encode the action: `log:<activity_name>` (e.g., `log:push`, `log:legs`).
- For deferred responses, return `{ type: 5 }` (DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE) or `{ type: 6 }` (DEFERRED_UPDATE_MESSAGE). Then follow up via the Discord REST API's webhook endpoint.
- Autocomplete interactions (for `/removeactivity`) are type 4 — return suggestions from DynamoDB.

### Bundle and deployment
- Use `esbuild` or `ncc` to bundle the NestJS app into a single file for Lambda deployment. The `dist/` folder should contain the bundled output.
- Lambda code is deployed via `lambda.Code.fromAsset('../dist')` in CDK — the CDK stack references the built output.
- Keep the NestJS app and CDK infra in the same repo but with separate `package.json` files (root for app, `infra/` for CDK).

### Testing approach
- Unit test the services (streak logic, leaderboard ranking, encouragement message selection).
- Integration test the DynamoDB repository layer against DynamoDB Local.
- E2E test the Discord controller with mocked interactions.
- Don't over-test CDK constructs — focus on application logic.

---

## Appendix A: Multi-table DynamoDB design (alternative)

> This appendix shows how the same data model would look using separate tables per entity type. **The main architecture uses single-table (Section 3).** Multi-table is a valid alternative that's more intuitive for developers coming from relational databases.

### A.1 When to consider multi-table instead

Multi-table is better when:
- Your access patterns mostly target one entity type at a time
- You want independent TTL policies per entity type (e.g., TTL on logs but not activities)
- You want independent scaling and backup policies per table
- Your team is less experienced with DynamoDB single-table patterns
- You might need to evolve access patterns over time without affecting other entities

Single-table is better when:
- You have many entity types frequently queried together (e.g., "get order + line items + shipping")
- You're at scale where minimizing round-trips matters
- Your access patterns are fully known and stable

For Spotter, either approach works. The access patterns are entity-scoped (streak commands read streaks, log commands write logs), so you rarely benefit from co-locating entities. We chose single-table to learn the pattern.

### A.2 Table definitions

**Activities Table** (`spotter-activities-{env}`):
```
PK:  guildId    (S)
SK:  name       (S)   — lowercased activity name
Attributes: displayName, emoji, isDefault, createdBy, createdAt, entityType
No GSIs needed.
```

**Activity Logs Table** (`spotter-logs-{env}`):
```
PK:  guildId    (S)
SK:  date#userId#activityName  (S)   — e.g., "2026-03-14#987654321#push"

GSI: DateIndex
  GSI-PK:  guildId    (S)
  GSI-SK:  date       (S)
  Projection: ALL

GSI: UserIndex
  GSI-PK:  userId     (S)
  GSI-SK:  guildDate  (S)   — "{guildId}#{date}"
  Projection: ALL

Attributes: guildId, userId, activityName, date, loggedAt, guildDate, entityType,
            ttl (unix epoch for future TTL enablement)
```

**Streaks Table** (`spotter-streaks-{env}`):
```
PK:  guildId    (S)
SK:  userId     (S)

GSI: LeaderboardIndex
  GSI-PK:  guildId              (S)
  GSI-SK:  currentStreakPadded   (S)   — zero-padded: "00015"
  Projection: ALL

Attributes: guildId, userId, currentStreak, longestStreak, currentStreakPadded,
            lastLoggedDate, updatedAt, entityType
```

**Tracked Channels Table** (`spotter-channels-{env}`):
```
PK:  guildId    (S)
SK:  channelId  (S)
Attributes: lastPanelMessageId, createdAt, entityType
No GSIs needed.
```

### A.3 Key differences from single-table

| Aspect | Single-table | Multi-table |
|--------|-------------|-------------|
| Tables to create in CDK | 1 table + 1 GSI | 4 tables + 3 GSIs |
| Env vars for table names | 1 (`TABLE_NAME`) | 4 (`ACTIVITIES_TABLE`, `LOGS_TABLE`, etc.) |
| IAM permissions | Grant on 1 table | Grant on 4 tables separately |
| TTL policy | One policy for all entities | Independent per table |
| Key design | Overloaded PK/SK with prefixes | Natural, intuitive keys |
| "Get everything for guild" | One Query | 4 separate Queries |
| Repository code | Parse SK prefixes to determine entity type | Each repo knows its own table |
| Debugging in AWS Console | Filter by SK prefix | Just open the right table |

### A.4 CDK for multi-table (if you switch)

```typescript
const activitiesTable = new dynamodb.Table(this, 'ActivitiesTable', {
  tableName: `spotter-activities-${props.environment}`,
  partitionKey: { name: 'guildId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'name', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy,
});

const logsTable = new dynamodb.Table(this, 'LogsTable', {
  tableName: `spotter-logs-${props.environment}`,
  partitionKey: { name: 'guildId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy,
});
logsTable.addGlobalSecondaryIndex({
  indexName: 'DateIndex',
  partitionKey: { name: 'guildId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});
logsTable.addGlobalSecondaryIndex({
  indexName: 'UserIndex',
  partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'guildDate', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});

const streaksTable = new dynamodb.Table(this, 'StreaksTable', {
  tableName: `spotter-streaks-${props.environment}`,
  partitionKey: { name: 'guildId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy,
});
streaksTable.addGlobalSecondaryIndex({
  indexName: 'LeaderboardIndex',
  partitionKey: { name: 'guildId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'currentStreakPadded', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});

const channelsTable = new dynamodb.Table(this, 'ChannelsTable', {
  tableName: `spotter-channels-${props.environment}`,
  partitionKey: { name: 'guildId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'channelId', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy,
});
```

The access patterns, streak logic, and everything else remain identical — only the table/key structure and CDK definitions change.
