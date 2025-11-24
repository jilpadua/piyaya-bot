import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  getVoiceConnection,
  StreamType
} from "@discordjs/voice";

import { execa } from "execa";
import path from "path";
import fs from "fs";

import { attachVoiceReconnection } from "../index.js";

const queueMap = new Map();

/** Locate yt-dlp binary inside node_modules or global path */
function findYtdlpBinary() {
  const candidatePaths = [
    path.join(process.cwd(), "node_modules", "yt-dlp-exec", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
    path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
    "yt-dlp"
  ];

  return candidatePaths.find((p) => {
    try {
      if (p === "yt-dlp") return true;
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

export async function handleMusicCommand(command, msg, args) {
  const guildId = msg.guild.id;

  if (!msg.member.voice.channel) {
    await msg.reply("❌ You must join a voice channel first.");
    return;
  }

  let queue = queueMap.get(guildId) || [];
  let connection = getVoiceConnection(guildId);

  if (command === "play") {
    const query = args.join(" ");
    await msg.reply(`🔍 Searching: **${query}**`);

    const ytdlpPath = findYtdlpBinary();
    if (!ytdlpPath) {
      await msg.reply("❌ yt-dlp executable not found (yt-dlp-exec missing?).");
      return;
    }

    const cookiesPath = process.env.YT_COOKIES_PATH;
    const searchArgs = [
      `ytsearch1:${query}`,
      "--dump-single-json",
      "--no-check-certificate",
      "--extractor-args",
      "youtube:player_client=default"
    ];

    if (cookiesPath && fs.existsSync(cookiesPath)) {
      searchArgs.push("--cookies", cookiesPath);
    }

    let info;
    try {
      const { stdout } = await execa(ytdlpPath, searchArgs);
      info = JSON.parse(stdout);
    } catch (err) {
      console.error("YTDLP SEARCH ERROR:", err?.stderr || err);
      await msg.reply("❌ yt-dlp search failed or returned no results.");
      return;
    }

    const entry = info?.entries?.[0] || info;
    const url = entry?.webpage_url || entry?.url;

    if (!entry || !url) {
      await msg.reply("❌ No results found.");
      return;
    }

    const song = {
      title: entry.title || "Unknown Title",
      url
    };

    queue.push(song);
    queueMap.set(guildId, queue);

    await msg.reply(`🎶 Added to queue: **${song.title}**`);

    if (!connection) {
      connection = joinVoiceChannel({
        guildId: guildId,
        channelId: msg.member.voice.channel.id,
        adapterCreator: msg.guild.voiceAdapterCreator
      });

      // *** ENABLE AUTO-RECONNECT ***
      attachVoiceReconnection(connection);
    }

    if (queue.length === 1) playNext(msg, connection, queue);
  }

  if (command === "stop") {
    if (connection) connection.destroy();
    queueMap.set(guildId, []);
    await msg.reply("⏹️ Stopped and cleared queue.");
  }

  if (command === "queue") {
    if (!queue.length) {
      await msg.reply("📭 Queue is empty.");
      return;
    }

    const list = queue.map((s, i) => `${i + 1}. ${s.title}`).join("\n");
    await msg.reply(`📜 **Current Queue:**\n${list}`);
  }
}

function playNext(msg, connection, queue) {
  if (!queue.length) return;

  const song = queue[0];
  msg.channel.send(`🎵 Now Playing: **${song.title}**`);

  const ytdlpPath = findYtdlpBinary();
  if (!ytdlpPath) {
    msg.channel.send("❌ yt-dlp missing — cannot stream.");
    connection.destroy();
    return;
  }

  const cookiesPath = process.env.YT_COOKIES_PATH;

  const args = [
    "-f",
    "bestaudio",
    "-o",
    "-",
    "--extractor-args",
    "youtube:player_client=default",
    song.url
  ];

  if (cookiesPath && fs.existsSync(cookiesPath)) {
    args.unshift("--cookies", cookiesPath);
  }

  let proc;
  try {
    proc = execa(ytdlpPath, args, { stdout: "pipe" });
  } catch (err) {
    console.error("yt-dlp launch failed:", err);
    queue.shift();
    queueMap.set(msg.guild.id, queue);
    if (queue.length) playNext(msg, connection, queue);
    else connection.destroy();
    return;
  }

  const resource = createAudioResource(proc.stdout, {
    inputType: StreamType.Arbitrary
  });

  const player = createAudioPlayer();

  player.play(resource);
  connection.subscribe(player);

  player.on(AudioPlayerStatus.Idle, () => {
    try {
      proc.kill();
    } catch {}

    queue.shift();
    queueMap.set(msg.guild.id, queue);

    if (queue.length) playNext(msg, connection, queue);
    else connection.destroy();
  });

  player.on("error", (err) => {
    console.error("Audio player error:", err);
    try {
      proc.kill();
    } catch {}

    queue.shift();
    queueMap.set(msg.guild.id, queue);
    if (queue.length) playNext(msg, connection, queue);
    else connection.destroy();
  });

  proc.catch?.((err) => {
    console.error("yt-dlp stream error:", err);
    msg.channel.send("⚠️ Error streaming audio. Skipping…");
    try {
      player.stop();
    } catch {}
  });
}
