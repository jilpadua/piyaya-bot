import { SlashCommandBuilder } from "discord.js";
import playdl from "play-dl";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} from "@discordjs/voice";

export default {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song from YouTube")
    .addStringOption(option =>
      option
        .setName("query")
        .setDescription("Song name or YouTube URL")
        .setRequired(true)
    ),

  async execute(interaction) {
    const query = interaction.options.getString("query");
    const voiceChannel = interaction.member.voice.channel;

    // Check if user is in a voice channel
    if (!voiceChannel)
      return interaction.reply("❌ You must join a voice channel first!");

    // Check bot permissions
    if (!voiceChannel.joinable || !voiceChannel.speakable)
      return interaction.reply(
        "❌ I don't have permission to join or speak in your voice channel."
      );

    // Acknowledge the command to prevent timeout
    await interaction.deferReply();

    let result;
    try {
      // Search YouTube for the song
      result = await playdl.search(query, { limit: 1 });
    } catch (err) {
      console.error(err);
      return interaction.editReply("❌ Error searching for the song.");
    }

    if (!result || result.length === 0)
      return interaction.editReply("❌ No results found!");

    const song = result[0];

    let stream;
    try {
      // Get audio stream
      stream = await playdl.stream(song.url);
    } catch (err) {
      console.error(err);
      return interaction.editReply("❌ Failed to get the audio stream.");
    }

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });

    // Join the voice channel
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator,
    });

    // Create and play audio
    const player = createAudioPlayer();
    player.play(resource);
    connection.subscribe(player);

    // Destroy connection when finished
    player.on(AudioPlayerStatus.Idle, () => {
      connection.destroy();
    });

    return interaction.editReply(
      `🎶 **Now playing:** ${song.title}\n🔗 ${song.url}`
    );
  },
};
