import fs from "fs";
import path from "path";
import { Client, GatewayIntentBits, Collection } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent]
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", (message) => {
  if (message.author.bot) return;

  if (message.content === "leon") {
    message.reply("posang bading 😾");
  } 
});

client.login(process.env.DISCORD_TOKEN);
