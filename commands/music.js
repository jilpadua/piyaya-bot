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
import fetch from "node-fetch";

const queueMap = new Map();

/* ---------------------------------------------------------
   YOUTUBE SEARCH (YouTube Data API)
--------------------------------------------------------- */
async function youtubeSearch(query) {
  const apiKey = process.env.YT_API_KEY;
  if (!apiKey) throw new Error("Missing YT_API_KEY env variable.");

  const url =
    "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=" +
    encodeURIComponent(query) +
    "&key=" +
    apiKey;

  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error("YouTube API error: " + txt);
  }

  const data = await res.json();
  if (!data.items || !data.items.length) return null;

  const vid = data.items[0].id.videoId;
  const title = data.items[0].snippet.title;

  return { title, url: `https://www.youtube.com/watch?v=${vid}` };
}

/* ---------------------------------------------------------
   MAIN HANDLER
--------------------------------------------------------- */
export async function handleMusicCommand(command, msg, args) {
  if (!msg.guild) return;

  const guildId = msg.guild.id;

  if (["play", "stop", "queue"].includes(command) && !msg.member.voice?.channel) {
    await msg.reply("You must be in a voice channel!");
    return;
  }

  let queue = queueMap.get(guildId) || [];
  let connection = getVoiceConnection(guildId);

  /* PLAY */
  if (command === "play") {
    const query = args.join(" ").trim();
    if (!query) return msg.reply("❌ Provide a search term or URL.");

    await msg.reply(`🔍 Searching: ${query}`);

    let song;

    try {
      const isUrl = /^https?:\/\//i.test(query);
      if (isUrl) {
        const urlObj = new URL(query);
        const v = urlObj.searchParams.get("v");
        song = v
          ? { title: "YouTube Video", url: `https://www.youtube.com/watch?v=${v}` }
          : { title: query, url: query };
      } else {
        song = await youtubeSearch(query);
      }
    } catch (err) {
      console.error(err);
      return msg.reply("❌ Error searching YouTube.");
    }

    if (!song) return msg.reply("❌ No results found.");

    queue.push(song);
    queueMap.set(guildId, queue);

    await msg.reply(`✅ Added to queue: **${song.title}**`);

    if (!connection) {
      connection = joinVoiceChannel({
        channelId: msg.member.voice.channel.id,
        guildId,
        adapterCreator: msg.guild.voiceAdapterCreator,
      });
    }

    if (queue.length === 1) playNext(msg, connection, queue);
    return;
  }

  /* STOP */
  if (command === "stop") {
    connection?.destroy();
    queueMap.set(guildId, []);
    return msg.reply("⏹️ Stopped.");
  }

  /* QUEUE */
  if (command === "queue") {
    if (!queue.length) return msg.reply("Queue is empty!");
    const list = queue.map((s, i) => `${i + 1}. ${s.title}`).join("\n");
    return msg.reply("**Queue:**\n" + list);
  }
}

/* ---------------------------------------------------------
   PLAY NEXT SONG
--------------------------------------------------------- */
function playNext(msg, connection, queue) {
  if (!queue.length) return;
  const song = queue[0];

  msg.channel.send(`🎵 Now playing: **${song.title}**`);

  /* ---- Load Cookies ---- */
  const cookieEnv = process.env.YT_COOKIES_PATH || "/app/cookies.txt";
  const hasCookies = fs.existsSync(cookieEnv);

  const cookieArgs = hasCookies ? ["--cookies", cookieEnv] : [];

  if (hasCookies) {
    console.log("Using cookies.txt:", cookieEnv);
  } else {
    console.log("No cookies file detected.");
  }

  /* ---- Find yt-dlp ---- */
  const possible = [
    path.join(process.cwd(), "node_modules", "yt-dlp-exec", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
    path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
    "yt-dlp",
  ];

  const ytDlpPath = possible.find((p) => p === "yt-dlp" || fs.existsSync(p));
  if (!ytDlpPath) {
    msg.channel.send("❌ yt-dlp not found.");
    connection.destroy();
    return;
  }

  /* ---- Spawn yt-dlp ---- */
  let proc;
  try {
    proc = execa(
      ytDlpPath,
      [
        "-f",
        "bestaudio",
        "-o",
        "-",
        "--no-warnings",
        "--extractor-args",
        "youtube:player_client=default",
        ...cookieArgs,
        song.url,
      ],
      { stdout: "pipe" }
    );
  } catch (err) {
    console.error("yt-dlp spawn error:", err);
    queue.shift();
    queueMap.set(msg.guild.id, queue);
    if (queue.length) playNext(msg, connection, queue);
    else connection.destroy();
    return;
  }

  /* ---- Create audio resource ---- */
  const resource = createAudioResource(proc.stdout, { inputType: StreamType.Arbitrary });
  const player = createAudioPlayer();

  player.play(resource);
  connection.subscribe(player);

  player.on(AudioPlayerStatus.Idle, () => {
    try {
      proc.kill();
    } catch {}
    queue.shift();
    queueMap.set(msg.guild.id, queue);
    queue.length ? playNext(msg, connection, queue) : connection.destroy();
  });

  player.on("error", (err) => {
    console.error("Audio error:", err);
    try {
      proc.kill();
    } catch {}
  });

  proc.catch?.((err) => {
    console.error("yt-dlp failed:", err);
    msg.channel.send("❌ yt-dlp failed. Skipping.");
    try {
      player.stop();
    } catch {}
  });
}
