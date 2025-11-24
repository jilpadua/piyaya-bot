import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection, StreamType } from '@discordjs/voice';
import ytdlp from 'yt-dlp-exec';
import { execa } from 'execa';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';

const queueMap = new Map();

async function youtubeSearch(query) {
    const apiKey = process.env.YT_API_KEY;
    const url =
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${encodeURIComponent(query)}&key=${apiKey}`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        if (!data.items || data.items.length === 0) {
            return null;
        }

        const vid = data.items[0].id.videoId;
        const title = data.items[0].snippet.title;

        return { title, url: `https://www.youtube.com/watch?v=${vid}` };
    } catch (err) {
        console.error("YouTube API error:", err);
        return null;
    }
}

export async function handleMusicCommand(command, msg, args) {
    const guildId = msg.guild.id;

    if (!msg.member.voice.channel) {
        msg.reply("You must be in a voice channel!");
        return;
    }

    let queue = queueMap.get(guildId) || [];
    let connection = getVoiceConnection(guildId);

    if (command === "play") {
        const query = args.join(" ");
        msg.reply(`🔍 Searching for: ${query}`);

        const song = await youtubeSearch(query);
        if (!song) {
            msg.reply("❌ No results found.");
            return;
        }

        queue.push(song);
        queueMap.set(guildId, queue);

        msg.reply(`✅ Added to queue: **${song.title}**`);

        if (!connection) {
            connection = joinVoiceChannel({
                channelId: msg.member.voice.channel.id,
                guildId: guildId,
                adapterCreator: msg.guild.voiceAdapterCreator
            });
        }

        if (queue.length === 1) {
            playNext(msg, connection, queue);
        }
    }

    if (command === "stop") {
        if (connection) connection.destroy();
        queueMap.set(guildId, []);
        msg.reply("⏹️ Music stopped.");
    }

    if (command === "queue") {
        if (!queue.length) {
            msg.reply("Queue is empty.");
            return;
        }

        const list = queue.map((s, i) => `${i + 1}. ${s.title}`).join("\n");
        msg.reply(`**Queue:**\n${list}`);
    }
}

function playNext(msg, connection, queue) {
    if (!queue.length) return;

    const song = queue[0];
    msg.channel.send(`🎵 Now playing: **${song.title}**`);

    const candidatePaths = [
        path.join(process.cwd(), "node_modules", "yt-dlp-exec", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
        path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
        "yt-dlp"
    ];

    let ytDlpPath = candidatePaths.find(p => {
        try {
            if (p === "yt-dlp") return true;
            return fs.existsSync(p);
        } catch {
            return false;
        }
    });

    if (!ytDlpPath) {
        msg.channel.send("❌ yt-dlp not found.");
        connection.destroy();
        return;
    }

    let ytDlpProcess;
    try {
        ytDlpProcess = execa(ytDlpPath, [
            "-f", "bestaudio",
            "-o", "-",
            "--no-warnings",
            "--no-call-home",        // IMPORTANT for Railway!!! prevents bot flag
            "--extractor-args", "youtube:player_client=default", // Avoid JS runtime error
            song.url
        ], { stdout: "pipe" });

    } catch (err) {
        msg.channel.send(`❌ Error starting yt-dlp.`);
        queue.shift();
        queueMap.set(msg.guild.id, queue);
        if (queue.length) playNext(msg, connection, queue);
        else connection.destroy();
        return;
    }

    const resource = createAudioResource(ytDlpProcess.stdout, {
        inputType: StreamType.Arbitrary
    });

    const player = createAudioPlayer();
    connection.subscribe(player);
    player.play(resource);

    player.on(AudioPlayerStatus.Idle, () => {
        try { ytDlpProcess.kill(); } catch {}
        queue.shift();
        queueMap.set(msg.guild.id, queue);

        if (queue.length) playNext(msg, connection, queue);
        else connection.destroy();
    });
}
