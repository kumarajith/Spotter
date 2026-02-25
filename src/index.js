import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, Collection } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { handleActivityButton } from './components/activityButtons.js';
import { startScheduler } from './scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { DISCORD_TOKEN, GUILD_ID } = process.env;

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

// --- Load commands ---

const commands = new Collection();
const commandData = [];

const commandFiles = readdirSync(join(__dirname, 'commands')).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const mod = await import(`./commands/${file}`);
  commands.set(mod.data.name, mod);
  commandData.push(mod.data.toJSON());
}

// --- Register slash commands ---

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

try {
  if (GUILD_ID) {
    const app = await rest.get(Routes.oauth2CurrentApplication());
    await rest.put(Routes.applicationGuildCommands(app.id, GUILD_ID), { body: commandData });
    console.log(`Registered ${commandData.length} commands for guild ${GUILD_ID}.`);
  } else {
    const app = await rest.get(Routes.oauth2CurrentApplication());
    await rest.put(Routes.applicationCommands(app.id), { body: commandData });
    console.log(`Registered ${commandData.length} commands globally.`);
  }
} catch (err) {
  console.error('Failed to register commands:', err);
}

// --- Client setup ---

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  startScheduler(client);
});

client.on('interactionCreate', async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }

    // Autocomplete
    if (interaction.isAutocomplete()) {
      const command = commands.get(interaction.commandName);
      if (command?.autocomplete) {
        await command.autocomplete(interaction);
      }
      return;
    }

    // Button interactions
    if (interaction.isButton() && interaction.customId.startsWith('log_activity:')) {
      await handleActivityButton(interaction);
      return;
    }
  } catch (err) {
    console.error('Interaction error:', err);
    const reply = { content: '❌ Something went wrong. Please try again.', flags: 64 };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    } catch {
      // Cannot respond
    }
  }
});

client.login(DISCORD_TOKEN);
