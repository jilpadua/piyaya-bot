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
const playerMap = new Map();

export async function handleMusicCommand(command, msg, args) {
    const guildId = msg.guild.id;

    if (!msg.member.voice.channel) {
        msg.reply('You must be in a voice channel!');
        return;
    }

    let queue = queueMap.get(guildId) || [];
    let connection = getVoiceConnection(guildId);

    if (command === 'play') {
        const query = args.join(' ');
        msg.reply(`🔍 Searching for: ${query}`);

        let info;
        try {
            info = await ytdlp(`ytsearch1:${query}`, {
                dumpSingleJson: true,
                noCheckCertificate: true
            });
        } catch {
            msg.reply('No results found!');
            return;
        }

        const entry = info.entries?.[0];
        if (!entry) {
            msg.reply('No results found!');
            return;
        }

        const url = entry.url || entry.webpage_url;
        if (!url) {
            msg.reply('Invalid video.');
            return;
        }

        const song = { title: entry.title, url };

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

        if (queue.length === 1) playNext(msg, connection, queue);
    }

    if (command === 'stop') {
        if (connection) connection.destroy();
        queueMap.set(guildId, []);
        msg.reply('⏹️ Music stopped!');
    }

    if (command === 'queue') {
        if (!queue.length) {
            msg.reply('Queue is empty!');
            return;
        }
        const list = queue.map((s, i) => `${i + 1}. ${s.title}`).join('\n');
        msg.reply(`**Queue:**\n${list}`);
    }
}

async function findYTDLP() {
    const possible = [
        path.join(process.cwd(), 'node_modules', 'yt-dlp-exec', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
        path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
    ];

    for (const p of possible) {
        if (fs.existsSync(p)) return p;
    }

    // test global yt-dlp
    try {
        await execa('yt-dlp', ['--version']);
        return 'yt-dlp';
    } catch {
        return null;
    }
}

async function playNext(msg, connection, queue) {
    const guildId = msg.guild.id;

    if (!queue.length) {
        setTimeout(() => connection?.destroy(), 500);
        return;
    }

    const song = queue[0];
    msg.channel.send(`🎵 Now playing: **${song.title}**`);

    const ytDlpPath = await findYTDLP();
    if (!ytDlpPath) {
        msg.channel.send('❌ yt-dlp not installed. Install yt-dlp or yt-dlp-exec.');
        connection.destroy();
        return;
    }

    let ytProcess;
    try {
        ytProcess = execa(ytDlpPath, [
            '-f', 'bestaudio',
            '-o', '-',
            song.url
        ], { stdout: 'pipe' });
    } catch (err) {
        msg.channel.send('❌ Failed to run yt-dlp.');
        queue.shift();
        queueMap.set(guildId, queue);
        return playNext(msg, connection, queue);
    }

    const resource = createAudioResource(ytProcess.stdout, {
        inputType: StreamType.Raw
    });

    let player = playerMap.get(guildId);
    if (!player) {
        player = createAudioPlayer();
        playerMap.set(guildId, player);
        connection.subscribe(player);
    }

    player.play(resource);

    player.once(AudioPlayerStatus.Idle, () => {
        try { ytProcess.kill(); } catch {}

        queue.shift();
        queueMap.set(guildId, queue);

        if (queue.length) playNext(msg, connection, queue);
        else {
            setTimeout(() => connection.destroy(), 500);
        }
    });

    player.on('error', (err) => {
        console.error(err);
        try { ytProcess.kill(); } catch {}
    });
}
