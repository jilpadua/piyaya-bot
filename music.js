import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection, StreamType } from '@discordjs/voice';
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
    let queue = queueMap.get(msg.guild.id) || [];
    let connection = getVoiceConnection(msg.guild.id);

    if (command === 'play') {
        const query = args.join(' ');
        msg.reply(`🔍 Searching for: ${query}`);
        let info;
        try {
            // Use ytsearch1: to get the top result only
            info = await ytdlp(`ytsearch1:${query}`, { dumpSingleJson: true, noCheckCertificate: true });
        } catch (err) {
            msg.reply('No results found!');
            return;
        }
        let entry = info.entries && info.entries[0];
        // Use webpage_url if url is missing
        const url = entry?.url || entry?.webpage_url;
        if (!entry || !url) {
            msg.reply('No results found!');
            return;
        }
        const song = { title: entry.title, url };
        queue.push(song);
        queueMap.set(msg.guild.id, queue);
        msg.reply(`✅ Added to queue: **${song.title}**`);
        if (!connection) {
            connection = joinVoiceChannel({
                channelId: msg.member.voice.channel.id,
                guildId: msg.guild.id,
                adapterCreator: msg.guild.voiceAdapterCreator
            });
        }
        if (queue.length === 1) {
            playNext(msg, connection, queue);
        }
    }

    if (command === 'stop') {
        if (connection) connection.destroy();
        queueMap.set(msg.guild.id, []);
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

function playNext(msg, connection, queue) {
    if (!queue.length) return;
    const song = queue[0];
    if (!song.url) {
        msg.channel.send('❌ Error: No valid URL for this song.');
        queue.shift();
        queueMap.set(msg.guild.id, queue);
        if (queue.length) {
            playNext(msg, connection, queue);
        } else {
            connection.destroy();
        }
        return;
    }

    msg.channel.send(`🎵 Now playing: **${song.title}**`);

    // possible yt-dlp executable locations (prefer package binary)
    const candidatePaths = [
        path.join(process.cwd(), 'node_modules', 'yt-dlp-exec', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
        path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
        'yt-dlp' // fallback to global in PATH
    ];

    let ytDlpPath = candidatePaths.find(p => {
        try {
            // if it's a simple command like 'yt-dlp', assume it is available (can't fs.existsSync)
            if (p === 'yt-dlp') return true;
            return fs.existsSync(p);
        } catch {
            return false;
        }
    });

    if (!ytDlpPath) {
        msg.channel.send('❌ yt-dlp executable not found. Install yt-dlp globally or ensure node_modules contains yt-dlp-exec.');
        connection.destroy();
        return;
    }

    // spawn yt-dlp and stream stdout into discord audio resource
    let ytDlpProcess;
    try {
        ytDlpProcess = execa(ytDlpPath, [
            '-f', 'bestaudio',
            '-o', '-',
            song.url
        ], { stdout: 'pipe' });
    } catch (err) {
        msg.channel.send(`❌ Failed to start yt-dlp: ${err.message}`);
        // remove problematic song and continue
        queue.shift();
        queueMap.set(msg.guild.id, queue);
        if (queue.length) playNext(msg, connection, queue);
        else connection.destroy();
        return;
    }

    const resource = createAudioResource(ytDlpProcess.stdout, { inputType: StreamType.Arbitrary });
    const player = createAudioPlayer();

    // ensure process is killed if player errors or stops
    player.on('error', (err) => {
        console.error('Audio player error:', err);
        try { ytDlpProcess.kill(); } catch {}
    });

    ytDlpProcess.on && ytDlpProcess.on('error', (err) => {
        console.error('yt-dlp process error:', err);
    });

    // if yt-dlp exits with error, inform channel and skip
    ytDlpProcess.catch?.((err) => {
        console.error('yt-dlp failed:', err);
        msg.channel.send('❌ Error while streaming audio, skipping song.');
        try { player.stop(); } catch {}
    });

    player.play(resource);
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
        try { ytDlpProcess.kill(); } catch {}
        queue.shift();
        queueMap.set(msg.guild.id, queue);
        if (queue.length) {
            playNext(msg, connection, queue);
        } else {
            connection.destroy();
        }
    });

    player.on(AudioPlayerStatus.Playing, () => {
        // optional: could log or update now-playing message
    });
}
