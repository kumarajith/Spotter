# Spotter

> A serverless Discord bot for tracking daily fitness activity, streaks, and server leaderboards.

[![CI](https://github.com/kumarajith/Spotter/actions/workflows/ci.yml/badge.svg)](https://github.com/kumarajith/Spotter/actions/workflows/ci.yml)
[![Deploy](https://github.com/kumarajith/Spotter/actions/workflows/deploy.yml/badge.svg)](https://github.com/kumarajith/Spotter/actions/workflows/deploy.yml)
![Node.js](https://img.shields.io/badge/node-24-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

Members log workouts by clicking buttons on a daily panel. Spotter tracks consecutive-day streaks, resets when activity lapses, and posts a leaderboard. The entire backend runs on AWS Lambda — zero idle compute, scales to zero when unused.

---

## Features

- **One-click activity logging** — button panel posted daily with configurable activity types
- **Streak tracking** — per-user consecutive-day streaks; up to 5 rest-only days before a break
- **Milestone celebrations** — in-channel messages at 7, 14, 30, 50, and 100-day milestones
- **30-day heatmap** — visual grid of active vs rest days per user via `/streak`
- **Leaderboard** — current and all-time best streaks via `/leaderboard`
- **Custom activities** — server admins can add and remove activity types
- **Backfill** — log a missed past date and have the streak recomputed correctly
- **Daily automation** — panel reposts at 8 AM UTC with an active-streak summary

---

## Architecture

![Architecture](spotter-architecture.svg)

### Key design decisions

| Decision                                 | Rationale                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Webhook interactions over Gateway        | Serverless-native — no idle process, scales to zero                                                            |
| Single DynamoDB table                    | All entities in one table with SK prefix routing; one env var, one IAM grant                                   |
| Pre-computed streaks                     | DynamoDB has no aggregation — write-time O(1) vs read-time scan of all logs                                    |
| EventBridge Scheduler (not Rules)        | Native timezone support, per-schedule DLQ, flexible invocation windows                                         |
| Deploy-time secrets via SSM SecureString | CloudFormation dynamic references resolve at deploy — zero runtime latency, no IAM grants for SSM:GetParameter |
| esbuild single-file bundles              | Tree-shaken ~760KB vs ~40MB node_modules — eliminates cold start from module resolution                        |

---

## Tech Stack

| Layer     | Technology                                                                              |
| --------- | --------------------------------------------------------------------------------------- |
| Runtime   | Node.js 24, TypeScript                                                                  |
| Bundler   | esbuild                                                                                 |
| Cloud     | AWS Lambda, API Gateway (HTTP API v2), DynamoDB, EventBridge Scheduler, SSM, CloudWatch |
| IaC       | AWS CDK v2 (TypeScript)                                                                 |
| CI/CD     | GitHub Actions + OIDC (no stored AWS credentials)                                       |
| Local dev | LocalStack via Docker                                                                   |

---

## Getting Started

### Prerequisites

- Node.js 24+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- A Discord application ([Developer Portal](https://discord.com/developers/applications))

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your Discord credentials from the Developer Portal:

```env
DISCORD_BOT_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_PUBLIC_KEY=
```

### 3. Start local environment

```bash
npm run local
```

This starts LocalStack (DynamoDB only), provisions the table, then runs the API dev server.

```
API server listening on port 3000
```

**Subsequent runs** (Docker already running):

```bash
npm run dev
```

### 4. Register slash commands

```bash
npm run commands:register
```

Set `DISCORD_GUILD_ID` in `.env` for instant guild-scoped registration during development. Leave it unset for global registration (takes up to 1 hour to propagate).

### 5. Expose local server to Discord

Discord must be able to reach your local endpoint to send interactions:

```bash
ngrok http 3000
```

Set the resulting HTTPS URL + `/interactions` as the **Interactions Endpoint URL** in your Discord application settings.

---

## Discord Commands

| Command                       | Description                                            |
| ----------------------------- | ------------------------------------------------------ |
| `/setup`                      | Post the activity tracker panel in the current channel |
| `/addactivity <name> <emoji>` | Add a custom activity for this server                  |
| `/removeactivity <name>`      | Remove a custom activity (with autocomplete)           |
| `/streak [user]`              | Streak stats and 30-day activity heatmap               |
| `/leaderboard`                | Top 10 current streaks and all-time bests              |
| `/backfill <date> <activity>` | Log a past date and recompute the streak               |

---

## Deployment

### One-time setup

**1. Bootstrap CDK** in your AWS account:

```bash
cd infra && npx cdk bootstrap aws://<account-id>/ap-south-1
```

**2. Create the Discord SSM parameters:**

```bash
aws ssm put-parameter --name "/spotter/dev/discord-bot-token" --type SecureString --value "..."
aws ssm put-parameter --name "/spotter/dev/discord-public-key" --type SecureString --value "..."
aws ssm put-parameter --name "/spotter/dev/discord-application-id" --type SecureString --value "..."
```

**3. Set up GitHub Actions OIDC** (one-time, no stored credentials):

Create an IAM OIDC identity provider for `token.actions.githubusercontent.com`, then create an IAM role `GitHubActionsRole` with CDK deploy permissions and a trust policy scoped to this repository. Add the role ARN as a GitHub secret: `AWS_ROLE_ARN`.

### Deploy

```bash
# Dev
npm run infra:deploy:dev

# Prod (via GitHub Actions — requires manual approval in GitHub environment "prod")
git push origin main
```

### CI/CD pipeline

| Trigger                | Action                                                 |
| ---------------------- | ------------------------------------------------------ |
| Pull request to `main` | Lint → Test → Build → CDK synth                        |
| Merge to `main`        | Deploy dev (automatic) → Deploy prod (manual approval) |

---

## Project Structure

```
├── src/
│   ├── lambda.ts                       # API Lambda entry point (plain handler)
│   ├── discord/                        # Interaction handler, command routing
│   ├── activity/                       # Activity CRUD (/addactivity, /removeactivity)
│   ├── tracking/                       # Log repository, streak service, streak repository
│   ├── leaderboard/                    # Leaderboard service
│   ├── panel/                          # Panel builder, poster, channel repository
│   ├── scheduler/                      # Daily task service (streak reset, panel repost)
│   ├── handlers/
│   │   └── scheduler.ts                # Scheduler Lambda entry point
│   └── common/
│       ├── config/                     # Discord credentials from env vars
│       ├── dynamodb/                   # DynamoDB DocumentClient wrapper
│       ├── retry.ts                    # Retry utility with exponential backoff
│       └── types/                      # dynamo.types.ts
├── infra/
│   ├── bin/infra.ts
│   └── lib/
│       ├── spotter-stack.ts
│       └── constructs/
│           ├── api.ts                  # API Lambda + API Gateway
│           ├── database.ts             # DynamoDB table + GSI
│           ├── scheduler.ts            # Scheduler Lambda + EventBridge Schedule
│           ├── secrets.ts              # SSM parameter reference
│           ├── monitoring.ts           # CloudWatch alarms
│           └── notifications.ts       # SNS alarm topic + email
├── scripts/
│   ├── register-commands.ts            # Slash command registration
│   ├── setup-local.ts                  # LocalStack provisioning
│   ├── dev-server.ts                   # Local API dev server
│   └── migrate.ts                     # SQLite → DynamoDB migration
├── esbuild.config.mjs
└── .github/workflows/
    ├── ci.yml
    └── deploy.yml
```

---

## Development

### Commands

| Command                     | Description                                   |
| --------------------------- | --------------------------------------------- |
| `npm run local`             | First run — start Docker, provision, run app  |
| `npm run dev`               | Start API dev server (Docker already running) |
| `npm run build`             | esbuild bundle to dist/                       |
| `npm run lint`              | ESLint with auto-fix                          |
| `npm run test`              | Unit tests                                    |
| `npm run commands:register` | Register slash commands with Discord          |
| `npm run infra:synth`       | Synthesize CloudFormation template            |
| `npm run infra:diff:dev`    | Diff against deployed dev stack               |

### Testing

```bash
npm test                  # Unit tests (app)
cd infra && npm test      # CDK template assertions
```

53 test cases covering:

| Area                 | What's tested                                                                 |
| -------------------- | ----------------------------------------------------------------------------- |
| Streak engine        | Incremental updates, rest-day limits, same-day correction, backfill recompute |
| Discord interactions | Command routing, button clicks, autocomplete, validation, error paths         |
| Lambda handlers      | Singleton bootstrap, error handling, malformed input                          |
| CDK infrastructure   | DynamoDB config, Lambda runtimes, CloudWatch alarms, API Gateway              |

### DynamoDB single-table key design

```
Entity          PK                SK                          GSI1PK              GSI1SK
──────────────────────────────────────────────────────────────────────────────────────────
Activity        GUILD#<id>        ACTIVITY#<name>             —                   —
Activity log    GUILD#<id>        LOG#<date>#<userId>#<act>   USER#<userId>       LOG#<guildId>#<date>
Streak          GUILD#<id>        STREAK#<userId>             LEADERBOARD#<id>    STREAK#<00015>
Channel         GUILD#<id>        CHANNEL#<channelId>         —                   —
```

---

## Migration (SQLite → DynamoDB)

If migrating from the legacy Discord.js bot (v1):

```bash
# Dry run — validate without writing
npm run migrate -- --db legacy/spotter.db --dry-run

# Run for real against local DynamoDB
npm run migrate -- --db legacy/spotter.db --endpoint http://localhost:4566

# Run against AWS (uses default credentials)
npm run migrate -- --db legacy/spotter.db --table-name spotter-prod

# Migrate a single guild for testing
npm run migrate -- --db legacy/spotter.db --guild 123456789 --dry-run
```

**Cutover steps**: dry-run → stop legacy bot → run migration → deploy v2 → register slash commands → verify → keep SQLite backup.

---

## Roadmap

- [x] Core bot functionality (slash commands, activity logging, streaks)
- [x] Daily automation (streak resets, panel reposts via EventBridge Scheduler)
- [x] CI/CD with GitHub Actions + OIDC
- [x] Unit tests (53 tests across app and infrastructure)
- [x] CloudWatch alarm alerting via SNS email
- [x] SQLite → DynamoDB migration script
- [ ] **Observability** — structured JSON logging, correlation IDs across Lambda invocations, CloudWatch Logs Insights or Sentry integration
- [ ] **Dashboard** — CloudWatch dashboard or Grafana for key metrics (latency, error rates, streak activity)

---

## License

MIT
