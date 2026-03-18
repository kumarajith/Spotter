import 'dotenv/config';
import { REST } from '@discordjs/rest';
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  RESTPutAPIApplicationCommandsJSONBody,
  Routes,
} from 'discord-api-types/v10';
import { COMMANDS } from '../src/discord/commands';

const commands: RESTPutAPIApplicationCommandsJSONBody = [
  {
    type: ApplicationCommandType.ChatInput,
    name: COMMANDS.SETUP,
    description: 'Post the activity tracker panel in this channel',
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: COMMANDS.ADD_ACTIVITY,
    description: 'Add a custom activity for this server',
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: 'name',
        description: 'Activity name (alphanumeric, max 32 characters)',
        required: true,
      },
      {
        type: ApplicationCommandOptionType.String,
        name: 'emoji',
        description: 'Emoji for the activity button',
        required: false,
      },
    ],
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: COMMANDS.REMOVE_ACTIVITY,
    description: 'Remove a custom activity from this server',
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: 'name',
        description: 'Activity to remove',
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: COMMANDS.STREAK,
    description: 'Show streak stats and 30-day heatmap for a user',
    options: [
      {
        type: ApplicationCommandOptionType.User,
        name: 'user',
        description: 'User to check (defaults to you)',
        required: false,
      },
    ],
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: COMMANDS.LEADERBOARD,
    description: 'Show top streaks for this server',
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: COMMANDS.BACKFILL,
    description: 'Log an activity for a past date and recalculate your streak',
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: 'date',
        description: 'Date to backfill (YYYY-MM-DD, e.g. 2026-03-10)',
        required: true,
      },
      {
        type: ApplicationCommandOptionType.String,
        name: 'activity',
        description: 'Activity to log',
        required: true,
        autocomplete: true,
      },
    ],
  },
];

async function main() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const applicationId = process.env.DISCORD_APPLICATION_ID;
  const guildId = process.env.DISCORD_GUILD_ID; // Optional: set for instant guild-scoped registration in dev

  if (!token || !applicationId) {
    console.error('DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID are required.');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(token);

  if (guildId) {
    // Clear global commands so guild + global don't both show up as duplicates
    await rest.put(Routes.applicationCommands(applicationId), { body: [] });
    console.log('Cleared global commands.');
  }

  const route = guildId
    ? Routes.applicationGuildCommands(applicationId, guildId)
    : Routes.applicationCommands(applicationId);

  const registered = (await rest.put(route, { body: commands })) as { name: string }[];

  const scope = guildId ? `guild ${guildId}` : 'global';
  console.log(`Registered ${registered.length} commands (${scope}):`);
  registered.forEach((cmd) => console.log(`  /${cmd.name}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
