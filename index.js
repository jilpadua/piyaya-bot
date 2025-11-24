import "./server.js";
import dotenv from "dotenv";
dotenv.config();
import davey from "@snazzah/davey";
const { install: installDavey } = davey;
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { generateDependencyReport } from "@discordjs/voice";
import { handleMusicCommand } from "./commands/music.js";
import path from "path";

// -------------------------------------------
// 1. Install Davey (fixes voice detection / IP discovery)
// -------------------------------------------
try {
  installDavey();
  console.log("Davey voice protocol enabled.");
} catch (err) {
  console.error("Failed to install Davey:", err);
}

// -------------------------------------------
// 2. Create Bot Client
// -------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// -------------------------------------------
// 3. Voice auto-reconnect handler
// -------------------------------------------
// Prevents “socket closed / cannot perform IP discovery”
import {
  VoiceConnectionStatus,
  entersState
} from "@discordjs/voice";

function attachVoiceReconnection(connection) {
  connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
    console.log("Voice disconnected — attempting reconnection...");

    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
      ]);

      console.log("Reconnected to voice channel.");
    } catch {
      console.log("Reconnection failed. Destroying connection.");
      connection.destroy();
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    console.log("Voice connection destroyed.");
  });
}

// Expose this to music.js
export { attachVoiceReconnection };

// -------------------------------------------
// 4. Bot Startup
// -------------------------------------------
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);

  console.log("Voice dependency report:");
  console.log(generateDependencyReport());
});

// -------------------------------------------
// 5. Command Handler
// -------------------------------------------
client.on("messageCreate", async (msg) => {
  if (!msg.guild || msg.author.bot) return;

  if (!msg.content.startsWith("!")) return; // change prefix if needed

  const args = msg.content.slice(1).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  const musicCommands = ["play", "stop", "queue"];

  if (musicCommands.includes(command)) {
    return handleMusicCommand(command, msg, args);
  }
});

// -------------------------------------------
// 6. Login
// -------------------------------------------
client.login(process.env.DISCORD_TOKEN);
