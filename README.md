# Spotter

A Discord fitness-tracking bot. Members log workouts via button clicks, build streaks, and compete on a leaderboard. Migrated from a monolithic Discord.js bot to a fully serverless AWS architecture.

## Architecture

```
Discord
  │
  ▼
API Gateway → API Lambda (NestJS + serverless-express)
                  │  synchronous commands (/streak, /leaderboard, /backfill validation)
                  │
                  └─► SQS Queue
                            │
                            ▼
                      Consumer Lambda (NestJS app context)
                            │  logs activity, updates streak
                            │
                            └─► Discord webhook followup (ephemeral)

Both Lambdas ──► DynamoDB (single table, on-demand)
API Lambda   ──► SSM Parameter Store (Discord credentials)
```

**Key design decisions:**
- Single DynamoDB table with GSI1 for user-scoped and leaderboard queries
- Activity logging is async (SQS) so Discord's 3-second interaction deadline is never at risk
- Streak state is incremental (updated per-log) with a full-recompute path for backfill
- Consumer Lambda bootstraps a lightweight NestJS app context (no HTTP, no SSM) — fast cold starts

## Prerequisites

- Node.js 20+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — provides `docker` CLI and `docker compose`

## Quick Start (Local Dev)

**1. Install dependencies**
```bash
npm install
```

**2. Configure environment**
```bash
cp .env.example .env
# Fill in your Discord credentials:
#   DISCORD_BOT_TOKEN
#   DISCORD_APPLICATION_ID
#   DISCORD_PUBLIC_KEY
```

**3. Start everything**
```bash
npm run local
```

This starts LocalStack (DynamoDB + SQS), provisions the table and queue, then runs the API and consumer in the same terminal with labeled output.

**Subsequent runs** (Docker containers already up):
```bash
npm run dev
```

**Shut down**
```bash
docker compose down
```

## Environment Variables

| Variable | Description | Local default |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Bot token from Discord Developer Portal | — |
| `DISCORD_APPLICATION_ID` | Application ID from Discord Developer Portal | — |
| `DISCORD_PUBLIC_KEY` | Public key for interaction signature verification | — |
| `TABLE_NAME` | DynamoDB table name | `spotter-dev` |
| `QUEUE_URL` | Full SQS queue URL | `http://localhost:4566/000000000000/spotter-local` |
| `DYNAMODB_ENDPOINT` | Override DynamoDB endpoint (local only) | `http://localhost:4566` |
| `AWS_ACCESS_KEY_ID` | AWS credentials (use `local` for LocalStack) | `local` |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials (use `local` for LocalStack) | `local` |
| `AWS_DEFAULT_REGION` | AWS region | `us-east-1` |

## Commands

### Local dev
| Command | Description |
|---|---|
| `npm run local` | First-time / fresh start — starts Docker, provisions, then runs app |
| `npm run dev` | Start API + consumer (assumes Docker is already up) |
| `npm run docker:up` | Start LocalStack + provision table and queue only |
| `npm run setup:local` | Provision DynamoDB table and SQS queue (idempotent) |
| `npm run consumer:local` | Run the SQS consumer poller only |

### Discord
| Command | Description |
|---|---|
| `npm run commands:register` | Register slash commands with Discord (set `DISCORD_GUILD_ID` for instant guild-scoped registration) |

### AWS / CDK
| Command | Description |
|---|---|
| `npm run infra:synth` | Synthesize CloudFormation templates |
| `npm run infra:diff:dev` | Diff CDK changes against deployed dev stack |
| `npm run infra:deploy:dev` | Deploy to dev environment |
| `npm run infra:deploy:prod` | Deploy to prod environment |

### Build & test
| Command | Description |
|---|---|
| `npm run build` | TypeScript compile |
| `npm run lint` | ESLint with auto-fix |
| `npm run test` | Unit tests |

## Discord Commands

| Command | Description |
|---|---|
| `/setup` | Post the activity tracker panel in the current channel |
| `/addactivity` | Add a custom activity for the server |
| `/removeactivity` | Remove a custom activity |
| `/streak [user]` | Show streak stats and 30-day activity heatmap |
| `/leaderboard` | Show top 10 current streaks and all-time bests |
| `/backfill <date> <activity>` | Log an activity for a past date and recalculate streak |

## Project Structure

```
src/
  discord/          # Interaction handler, command routing
  activity/         # Activity CRUD
  tracking/         # Activity log repository, streak computation
  consumer/         # SQS consumer service
  sqs/              # SQS producer service
  panel/            # Tracker panel builder and poster
  common/
    config/         # Discord credentials via SSM
    dynamodb/       # DynamoDB wrapper service
    types/          # dynamo.types.ts, sqs.types.ts
  handlers/
    sqs-consumer.handler.ts  # Lambda entry point for SQS consumer
  lambda.ts                  # Lambda entry point for API
infra/              # AWS CDK stack
scripts/            # Local dev and command registration scripts
legacy/             # Original Discord.js bot (reference only)
```
