# Spotter — Discord Fitness Tracker Bot

A Discord bot that tracks daily fitness activities with a button-based UX. Log workouts, build streaks, and compete on the leaderboard.

## Features

- **Button-based tracker panel** — one tap to log your daily activity
- **Streak tracking** — consecutive day streaks with milestone celebrations
- **Leaderboard** — see who's got the longest current and all-time streaks
- **Custom activities** — add server-specific activities beyond the defaults
- **Daily auto-repost** — fresh panel every morning + streak summary
- **Encouragement system** — motivational messages on milestones, comebacks, and more

## Setup

### 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and give it a name
3. Go to **Bot** → click **Reset Token** → copy the token
4. Under **Privileged Gateway Intents**, you do NOT need Message Content Intent

### 2. Invite the Bot

Go to **OAuth2 → URL Generator**:
- Scopes: `bot`, `applications.commands`
- Permissions: `Send Messages`, `Embed Links`, `Use External Emojis`, `Read Message History`

Copy the generated URL and open it to invite the bot to your server.

### 3. Configure Environment

```bash
cp .env.example .env
```

Fill in your `.env`:
```
DISCORD_TOKEN=your-bot-token
GUILD_ID=your-server-id
CHANNEL_ID=your-channel-id
```

- `GUILD_ID` — registers slash commands instantly for this server (omit for global registration, which takes up to an hour)
- `CHANNEL_ID` — optional, not used directly by the bot (channels are set via `/setup`)

### 4. Install & Run

```bash
npm install
npm start
```

For development with auto-restart:
```bash
npm run dev
```

### 5. Use the Bot

1. Run `/setup` in the channel where you want the tracker panel
2. Tap buttons to log daily activities
3. Use `/streak` to see your stats
4. Use `/leaderboard` to see server rankings
5. Use `/addactivity` and `/removeactivity` to customize activities

## Commands

| Command | Description |
|---------|-------------|
| `/setup` | Post the tracker panel in the current channel |
| `/addactivity name: emoji:` | Add a custom activity |
| `/removeactivity name:` | Remove a custom activity (with autocomplete) |
| `/streak [user]` | Show streak stats and 30-day heatmap |
| `/leaderboard` | Show top current and all-time streaks |

## Default Activities

🦵 Legs · 🫸 Push · 🫷 Pull · ⬇️ Lower · ⬆️ Upper · 🚶 Walk · 😴 Rest

## Daily Schedule

The bot automatically runs at 8:00 AM UTC (configurable via `DAILY_HOUR_UTC` env var):
- Reposts the tracker panel in all tracked channels
- Posts a streak summary showing users with 2+ day streaks


## Permissions
https://discord.com/oauth2/authorize?client_id=<Client_ID>&permissions=354304&integration_type=0&scope=bot+applications.commands