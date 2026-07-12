/** Musique — embeds Discord « en lecture » et « file d'attente ». */

import { EmbedBuilder } from "discord.js";
import type { Queue } from "distube";
import { formatDuration, progressBar } from "./format.js";

export function nowPlayingEmbed(queue: Queue): EmbedBuilder {
  const song = queue.songs[0]!;
  const elapsed = Math.floor(queue.currentTime);
  const total = song.duration ?? 0;
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(queue.paused ? "⏸️ En pause" : "🎶 En lecture")
    .setDescription(`**[${song.name}](${song.url})**`)
    .addFields(
      { name: "Progression", value: `${progressBar(elapsed, total)}\n${formatDuration(elapsed)} / ${total ? formatDuration(total) : "live"}` },
      { name: "Demandé par", value: song.user ? `<@${song.user.id}>` : "—", inline: true },
      { name: "En attente", value: `${queue.songs.length - 1} piste(s)`, inline: true },
    )
    .setThumbnail(song.thumbnail ?? null);
}

export function queueEmbed(queue: Queue): EmbedBuilder {
  const [current, ...rest] = queue.songs;
  const lines = rest.slice(0, 10).map((s, i) => `**${i + 1}.** [${s.name}](${s.url}) \`${s.formattedDuration}\``);
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📜 File d'attente")
    .setDescription(
      (current ? `▶️ **${current.name}**\n\n` : "") +
        (lines.length ? lines.join("\n") : "*Aucune piste en attente.*") +
        (rest.length > 10 ? `\n… et ${rest.length - 10} autre(s)` : ""),
    );
}
