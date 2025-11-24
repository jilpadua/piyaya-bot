import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  getVoiceConnection,
  StreamType
} from '@discordjs/voice';

import { execa } from 'execa';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';

const queueMap = new Map();

/**
 * Search YouTube for a query using the YouTube Data API (v3).
 * Returns { title, url } or null if nothing found.
 */
async function youtubeSearch(query) {
  const apiKey = process.env.YT_API_KEY;
  if (!apiKey) throw new Error('Missing YT_API_KEY environment variable.');

  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${encodeURIComponent(
    query
  )}&key=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`YouTube API error ${res.status}: ${txt}`);
  }

  const data = await res.json();
  if (!data.items || data.items.length === 0) return null;

  const vid = data.items[0].id.videoId;
  const title = data.items[0].snippet.title;
  return { title, url: `https://www.youtube.com/watch?v=${vid}` };
}

/**
 * Main exported handler. Call from your message handler:
 * await handleMusicCommand(command, msg, args)
 */
export async function handleMusicCommand(command, msg, args) {
  if (!msg.guild) return; // only guilds
  const guildId = msg.guild.id;

  // require the user to be in a voice channel for play/stop
  if (['play', 'stop', 'queue'].includes(command) && !msg.member?.voice?.channel) {
    await msg.reply('You must be in a voice channel!');
    return;
  }

  let queue = queueMap.get(guildId) || [];
  let connection = getVoiceConnection(guildId);

  // PLAY
  if (command === 'play') {
    const query = args.join(' ').trim();
    if (!query) {
      await msg.reply('❌ Please provide a search term or URL.');
      return;
    }

    await msg.reply(`🔍 Searching YouTube: ${query}`);

    let song;
    try {
      // If the user provided a direct YouTube URL, prefer it (basic check)
      const isUrl = /^https?:\/\//i.test(query);
      if (isUrl) {
        // We don't fetch metadata for a direct url here — yt-dlp later will stream it.
        // But try to get a title via YouTube Data API if it's a youtube watch link.
        const urlObj = new URL(query);
        const v = urlObj.searchParams.get('v');
        if (v) {
          song = { title: `YouTube: ${v}`, url: `https://www.youtube.com/watch?v=${v}` };
          // Optionally: call YouTube API to get real title; omitted for speed.
        } else {
          song = { title: query, url: query };
        }
      } else {
        song = await youtubeSearch(query);
      }
    } catch (err) {
      console.error('YouTube search failed:', err);
      await msg.reply('❌ Error searching YouTube. Try again later.');
      return;
    }

    if (!song) {
      await msg.reply('❌ No results found.');
      return;
    }

    queue.push(song);
    queueMap.set(guildId, queue);
    await msg.reply(`✅ Added to queue: **${song.title}**`);

    if (!connection) {
      connection = joinVoiceChannel({
        channelId: msg.member.voice.channel.id,
        guildId,
        adapterCreator: msg.guild.voiceAdapterCreator
      });
    }

    // If this is the only song, start playing
    if (queue.length === 1) {
      playNext(msg, connection, queue);
    }
    return;
  }

  // STOP
  if (command === 'stop') {
    if (connection) connection.destroy();
    queueMap.set(guildId, []);
    await msg.reply('⏹️ Music stopped and queue cleared.');
    return;
  }

  // QUEUE
  if (command === 'queue') {
    queue = queueMap.get(guildId) || [];
    if (!queue.length) {
      await msg.reply('Queue is empty!');
      return;
    }
    const list = queue.map((s, i) => `${i + 1}. ${s.title}`).join('\n');
    await msg.reply(`**Queue:**\n${list}`);
    return;
  }
}

/**
 * Play the next song in the queue for the guild.
 * This function subscribes an AudioPlayer to the existing connection.
 */
function playNext(msg, connection, queue) {
  if (!queue.length) return;
  const song = queue[0];
  if (!song || !song.url) {
    msg.channel.send('❌ Error: no valid URL for the next song.');
    queue.shift();
    queueMap.set(msg.guild.id, queue);
    if (queue.length) playNext(msg, connection, queue);
    else connection.destroy();
    return;
  }

  msg.channel.send(`🎵 Now playing: **${song.title}**`);

  // candidate paths for yt-dlp binary (prefer package-provided binary)
  const candidatePaths = [
    path.join(process.cwd(), 'node_modules', 'yt-dlp-exec', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
    path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
    'yt-dlp'
  ];

  const ytDlpPath = candidatePaths.find(p => {
    try {
      if (p === 'yt-dlp') return true; // assume global installed if in PATH
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });

  if (!ytDlpPath) {
    msg.channel.send('❌ yt-dlp not found. Please install yt-dlp or include yt-dlp-exec in node_modules.');
    connection.destroy();
    return;
  }

  // spawn yt-dlp to stream best audio to stdout
  let proc;
  try {
    proc = execa(
      ytDlpPath,
      [
        '-f',
        'bestaudio',
        '-o',
        '-',
        '--no-warnings',
        '--no-call-home',
        // suggest a player_client to reduce JS runtime extraction issues
        '--extractor-args',
        'youtube:player_client=default',
        song.url
      ],
      { stdout: 'pipe' }
    );
  } catch (err) {
    console.error('yt-dlp spawn error:', err);
    // skip this song and continue
    queue.shift();
    queueMap.set(msg.guild.id, queue);
    if (queue.length) playNext(msg, connection, queue);
    else connection.destroy();
    return;
  }

  // create audio resource and player
  const resource = createAudioResource(proc.stdout, { inputType: StreamType.Arbitrary });
  const player = createAudioPlayer();

  // propagate errors & ensure process cleanup
  player.on('error', (err) => {
    console.error('Audio player error:', err);
    try {
      proc.kill();
    } catch {}
  });

  proc.on && proc.on('error', (err) => {
    console.error('yt-dlp process error:', err);
  });

  // If the yt-dlp process rejects (execa), handle that case
  proc.catch?.((err) => {
    console.error('yt-dlp failed:', err);
    try { player.stop(); } catch {}
    msg.channel.send('❌ Error while streaming audio, skipping song.');
  });

  player.play(resource);
  connection.subscribe(player);

  player.on(AudioPlayerStatus.Idle, () => {
    try { proc.kill(); } catch {}
    queue.shift();
    queueMap.set(msg.guild.id, queue);
    if (queue.length) {
      playNext(msg, connection, queue);
    } else {
      try { connection.destroy(); } catch {}
    }
  });
}
