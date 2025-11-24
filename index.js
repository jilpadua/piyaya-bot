import { Client, GatewayIntentBits } from 'discord.js';
import { handleMusicCommand } from './music.js';
import dotenv from 'dotenv';

dotenv.config();

const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('Discord bot token is missing! Please set DISCORD_TOKEN in your .env file.');
    process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (msg) => {
  if (!msg.content.startsWith('!')) return;
  const args = msg.content.slice(1).split(' ');
  const command = args.shift().toLowerCase();

  if (['play', 'stop', 'queue'].includes(command)) {
    await handleMusicCommand(command, msg, args);
  }
});

client.login(process.env.DISCORD_TOKEN);
