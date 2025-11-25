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
      if (p === "yt-dlp") return true; // rely on PATH if installed globally
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
      "--no-warnings",
      "--extractor-args",
      "youtube:player_client=android"
    ];

    // Only add cookies if file exists
    if (cookiesPath && fs.existsSync(cookiesPath)) {
      searchArgs.push("--cookies", cookiesPath);
    }

    let info;
    try {
      // execa will return a child-process-like object; stdout is a string here
      const { stdout } = await execa(ytdlpPath, searchArgs, { stderr: "inherit" });
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

      // Enable auto-reconnect
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

  // Build robust yt-dlp args for streaming to stdout
  const args = [
    // prefer m4a (good container for piping); fallback to bestaudio
    "-f", "bestaudio[ext=m4a]/bestaudio",
    "--no-check-certificate",
    "--no-warnings",
    "--prefer-free-formats",
    "--no-playlist",
    "--extract-audio", // ensure audio extraction
    "-o", "-",         // stream to stdout
    song.url
  ];

  // If cookies are present, place them before other args (safe)
  if (cookiesPath && fs.existsSync(cookiesPath)) {
    // Put cookies at the front so they are respected by extractors
    args.unshift("--cookies", cookiesPath);
  }

  let proc;
  try {
    // stdout: "pipe" gives us a stream we can pass to createAudioResource
    // stderr: "inherit" makes yt-dlp errors visible in the host logs (useful on Railway)
    proc = execa(ytdlpPath, args, { stdout: "pipe", stderr: "inherit" });
  } catch (err) {
    console.error("yt-dlp launch failed:", err);
    queue.shift();
    queueMap.set(msg.guild.id, queue);
    if (queue.length) playNext(msg, connection, queue);
    else connection.destroy();
    return;
  }

  // if proc.stdout is not present (unexpected), fail gracefully
  if (!proc.stdout) {
    console.error("yt-dlp did not provide stdout stream.");
    msg.channel.send("⚠️ Error streaming audio. Skipping…");
    try { proc.kill(); } catch {}
    queue.shift();
    queueMap.set(msg.guild.id, queue);
    if (queue.length) playNext(msg, connection, queue);
    else connection.destroy();
    return;
  }

  // Create resource from stdout stream
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

  // catch promise rejection from execa (if it resolves as a promise with non-zero code)
  proc.catch?.((err) => {
    console.error("yt-dlp stream error:", err);
    msg.channel.send("⚠️ Error streaming audio. Skipping…");
    try {
      player.stop();
    } catch {}
  });
}
