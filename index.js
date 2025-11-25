import { Client, GatewayIntentBits, Partials } from 'discord.js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';


dotenv.config();


const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildVoiceStates,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent
],
partials: [Partials.Channel]
});


import { handleMusicCommand } from './commands/music.js';


client.once('clientReady', () => {
console.log('Logged in as', client.user.tag);
});


client.on('messageCreate', async (msg) => {
if (msg.author.bot) return;
if (!msg.guild) return;


const prefix = '!';
if (!msg.content.startsWith(prefix)) return;


const [cmd, ...args] = msg.content.slice(prefix.length).trim().split(/\s+/);
const command = cmd.toLowerCase();


if (['play','stop','queue'].includes(command)) {
try {
await handleMusicCommand(command, msg, args);
} catch (err) {
console.error('Music command error:', err);
msg.reply('⚠️ Internal error while handling music command.');
}
}
});


client.login(process.env.DISCORD_TOKEN).catch(err => {
console.error('Failed to login:', err);
});