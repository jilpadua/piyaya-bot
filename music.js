import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection, StreamType } from '@discordjs/voice';
import { execa } from 'execa';
import ytdlp from 'yt-dlp-exec';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const queueMap = new Map();

/* -----------------------------------------
   🔎 YOUTUBE SEARCH (using YouTube API)
----------------------------------------- */
async function searchYouTube(query) {
    const apiKey = process.env.YT_API_KEY;
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${encodeURIComponent(query)}&key=${apiKey}`;

    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    if (!data.items?.length) return null;

    const video = data.items[0];
    return {
        title: video.snippet.title,
        url: `https://www.youtube.com/watch?v=${video.id.videoId}`
    };
}

/* -----------------------------------------
   🔧 MAIN HANDLER
----------------------------------------- */
export async function handleMusicCommand(command, msg, args) {
    if (!msg.member.voice.channel) {
        msg.reply("You must be in a voice channel!");
        return;
    }

    const guildId = msg.guild.id;
    let queue = queueMap.get(guildId) || [];
    let connection = getVoiceConnection(guildId);

    /* ---------- PLAY ---------- */
    if (command === "play") {
        const query = args.join(" ");
        msg.reply(`🔍 Searching YouTube: **${query}**`);

        const result = await searchYouTube(query);
        if (!result) {
            msg.reply("❌ No results found!");
            return;
        }

        queue.push(result);
        queueMap.set(guildId, queue);

        msg.reply(`✅ Added to queue: **${result.title}**`);

        if (!connection) {
            connection = joinVoiceChannel({
                channelId: msg.member.voice.channel.id,
                guildId,
                adapterCreator: msg.guild.voiceAdapterCreator
            });
        }

        if (queue.length === 1) playNext(msg, connection, queue);
    }

    /* ---------- STOP ---------- */
    if (command === "stop") {
        if (connection) connection.destroy();
        queueMap.set(guildId, []);
        msg.reply("⏹️ Music stopped!");
    }

    /* ---------- QUEUE ---------- */
    if (command === "queue") {
        if (!queue.length) return msg.reply("Queue is empty!");

        const out = queue.map((s, i) => `${i + 1}. ${s.title}`).join("\n");
        msg.reply(`🎶 **Queue:**\n${out}`);
    }
}

/* -----------------------------------------
   ▶️ PLAY NEXT SONG
----------------------------------------- */
function playNext(msg, connection, queue) {
    if (!queue.length) return;

    const song = queue[0];
    msg.channel.send(`🎵 Now playing: **${song.title}**`);

    const candidatePaths = [
        path.join(process.cwd(), "node_modules", "yt-dlp-exec", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
        path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
        "yt-dlp"
    ];

    let ytDlpPath = candidatePaths.find(p => p === "yt-dlp" || fs.existsSync(p));

    const ytProcess = execa(ytDlpPath, [
        "-f", "bestaudio",
        "-o", "-",
        song.url
    ], { stdout: "pipe" });

    const resource = createAudioResource(ytProcess.stdout, { inputType: StreamType.Arbitrary });
    const player = createAudioPlayer();

    player.play(resource);
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
        try { ytProcess.kill(); } catch {}
        queue.shift();
        queueMap.set(msg.guild.id, queue);

        if (queue.length) playNext(msg, connection, queue);
        else connection.destroy();
    });

    player.on("error", err => {
        console.error("Audio error:", err);
        try { ytProcess.kill(); } catch {}
    });
}
