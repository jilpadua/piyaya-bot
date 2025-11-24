import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    getVoiceConnection,
    StreamType
} from '@discordjs/voice';

import ytdlp from 'yt-dlp-exec';
import { execa } from 'execa';
import path from 'path';
import fs from 'fs';

const queueMap = new Map();

export async function handleMusicCommand(command, msg, args) {
    const guildId = msg.guild.id;

    if (!msg.member.voice.channel) {
        msg.reply('You must be in a voice channel!');
        return;
    }

    let queue = queueMap.get(guildId) || [];
    let connection = getVoiceConnection(guildId);

    // -------------------------------
    // PLAY COMMAND
    // -------------------------------
    if (command === 'play') {
        const query = args.join(' ');

        if (!query.trim()) {
            msg.reply("❌ Please provide a song name!");
            return;
        }

        msg.reply(`🔍 Searching for: ${query}`);

        let info;

        try {
            info = await ytdlp(`ytsearch1:${query}`, {
                dumpSingleJson: true,
                noCheckCertificate: true
            });
        } catch (err) {
            console.error(err);
            msg.reply("❌ Error searching YouTube.");
            return;
        }

        // -------------------------------
        // FIXED SEARCH RESULT PARSING
        // Supports both formats:
        //  1. info.entries[0]
        //  2. info.webpage_url (single root entry)
        // -------------------------------
        let entry;

        if (info.entries && info.entries.length > 0) {
            entry = info.entries[0];
        } else if (info.webpage_url) {
            entry = info;
        }

        const url = entry?.webpage_url || entry?.url;

        if (!entry || !url) {
            msg.reply("❌ No results found!");
            return;
        }

        const song = {
            title: entry.title,
            url
        };

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

    // -------------------------------
    // STOP COMMAND
    // -------------------------------
    if (command === 'stop') {
        if (connection) connection.destroy();
        queueMap.set(guildId, []);
        msg.reply("⏹️ Music stopped!");
    }

    // -------------------------------
    // QUEUE COMMAND
    // -------------------------------
    if (command === 'queue') {
        if (!queue.length) {
            msg.reply("Queue is empty!");
            return;
        }

        const list = queue.map((s, i) => `${i + 1}. ${s.title}`).join("\n");
        msg.reply(`**Queue:**\n${list}`);
    }
}


// ======================================================
// PLAY FUNCTION
// ======================================================

function playNext(msg, connection, queue) {
    if (!queue.length) return;

    const song = queue[0];

    if (!song.url) {
        msg.channel.send("❌ Error: Song has no valid URL.");
        queue.shift();
        queueMap.set(msg.guild.id, queue);
        if (queue.length) playNext(msg, connection, queue);
        else connection.destroy();
        return;
    }

    msg.channel.send(`🎵 Now playing: **${song.title}**`);

    // Potential locations of yt-dlp executable
    const candidatePaths = [
        path.join(process.cwd(), 'node_modules', 'yt-dlp-exec', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
        path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
        'yt-dlp'
    ];

    let ytDlpPath = candidatePaths.find(p => {
        try {
            if (p === 'yt-dlp') return true;
            return fs.existsSync(p);
        } catch {
            return false;
        }
    });

    if (!ytDlpPath) {
        msg.channel.send("❌ yt-dlp not found. Install it globally or ensure node_modules contains yt-dlp-exec.");
        connection.destroy();
        return;
    }

    // Spawn yt-dlp and pipe audio into Discord
    let ytDlpProcess;

    try {
        ytDlpProcess = execa(ytDlpPath, [
            '-f', 'bestaudio',
            '-o', '-',
            song.url
        ], { stdout: 'pipe' });
    } catch (err) {
        msg.channel.send(`❌ Failed to start yt-dlp: ${err.message}`);
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

    // Handle audio errors
    player.on('error', (err) => {
        console.error("Audio player error:", err);
        try { ytDlpProcess.kill(); } catch {}
    });

    ytDlpProcess.on?.('error', (err) => {
        console.error("yt-dlp process error:", err);
    });

    ytDlpProcess.catch?.(err => {
        console.error("yt-dlp failed:", err);
        msg.channel.send("❌ Error streaming audio — skipping...");
        try { player.stop(); } catch {}
    });

    player.play(resource);
    connection.subscribe(player);

    // When song finishes
    player.on(AudioPlayerStatus.Idle, () => {
        try { ytDlpProcess.kill(); } catch {}
        queue.shift();
        queueMap.set(msg.guild.id, queue);

        if (queue.length) playNext(msg, connection, queue);
        else connection.destroy();
    });
}
