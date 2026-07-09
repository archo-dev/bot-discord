import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MusicStateDto, PlaylistSummaryDto } from "@bot/shared";
import { api } from "../lib/api.js";

function formatDuration(totalSeconds: number): string {
  const sec = Math.floor(totalSeconds % 60);
  const min = Math.floor(totalSeconds / 60) % 60;
  const hrs = Math.floor(totalSeconds / 3600);
  const mm = String(min).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${min}:${ss}`;
}

const LOOP_LABELS: Record<MusicStateDto["loop"], string> = {
  off: "Répétition désactivée",
  song: "🔂 Répète la piste",
  queue: "🔁 Répète la file",
};

export function MusicPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const state = useQuery({
    queryKey: ["music-state", guildId],
    queryFn: () => api<MusicStateDto>(`/api/guilds/${guildId}/music-state`),
    refetchInterval: 4000,
  });
  const playlists = useQuery({
    queryKey: ["playlists", guildId],
    queryFn: () => api<PlaylistSummaryDto[]>(`/api/guilds/${guildId}/playlists`),
  });

  const control = useMutation({
    mutationFn: (action: "pause" | "resume" | "skip" | "stop") =>
      api(`/api/guilds/${guildId}/music-control`, { method: "POST", body: JSON.stringify({ action }) }),
    onSuccess: () => setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["music-state", guildId] }), 500),
  });

  const s = state.data;
  const current = s?.current ?? null;
  const progress = current && current.duration > 0 ? Math.min(100, (s!.elapsed / current.duration) * 100) : 0;

  return (
    <div className="max-w-2xl space-y-8">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Lecture en cours</h2>
          {s && (
            <span className={`rounded-full px-3 py-1 text-xs ${s.connected ? "bg-green-950 text-green-300" : "bg-zinc-800 text-zinc-400"}`}>
              {s.connected ? (s.paused ? "En pause" : "En lecture") : "Inactif"}
            </span>
          )}
        </div>

        {current ? (
          <div className="mt-4">
            <div className="flex gap-4">
              {current.thumbnail && (
                <img src={current.thumbnail} alt="" className="h-20 w-20 rounded-lg object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <a
                  href={current.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-medium text-white hover:underline"
                >
                  {current.title}
                </a>
                <p className="mt-1 text-xs text-zinc-500">
                  {LOOP_LABELS[s!.loop]} · 🔊 {s!.volume}%
                </p>
              </div>
            </div>

            <div className="mt-4">
              <div className="h-1.5 w-full rounded-full bg-zinc-800">
                <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-xs text-zinc-500">
                <span>{formatDuration(s!.elapsed)}</span>
                <span>{current.duration > 0 ? formatDuration(current.duration) : "live"}</span>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => control.mutate(s!.paused ? "resume" : "pause")}
                disabled={control.isPending}
                className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50"
              >
                {s!.paused ? "▶️ Reprendre" : "⏸️ Pause"}
              </button>
              <button
                onClick={() => control.mutate("skip")}
                disabled={control.isPending}
                className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50"
              >
                ⏭️ Suivant
              </button>
              <button
                onClick={() => control.mutate("stop")}
                disabled={control.isPending}
                className="rounded-lg bg-red-950 px-4 py-2 text-sm font-medium text-red-300 transition hover:bg-red-900 disabled:opacity-50"
              >
                ⏹️ Stop
              </button>
            </div>
            {control.isError && <p className="mt-2 text-sm text-red-400">Contrôle indisponible (gateway hors ligne ?).</p>}
          </div>
        ) : (
          <p className="mt-4 text-sm text-zinc-400">
            Rien en lecture. Lance une musique sur Discord avec <code className="text-zinc-300">/play</code>.
          </p>
        )}
      </section>

      {s && s.queue.length > 0 && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="font-semibold">File d'attente ({s.queue.length})</h2>
          <ol className="mt-3 space-y-1.5 text-sm">
            {s.queue.slice(0, 20).map((t, i) => (
              <li key={i} className="flex gap-2 text-zinc-300">
                <span className="text-zinc-600">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="text-zinc-500">{t.duration > 0 ? formatDuration(t.duration) : "live"}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="font-semibold">Playlists enregistrées</h2>
        {playlists.data && playlists.data.length > 0 ? (
          <ul className="mt-3 space-y-1.5 text-sm text-zinc-300">
            {playlists.data.map((p) => (
              <li key={p.name} className="flex justify-between">
                <span>
                  🎵 <b>{p.name}</b>
                </span>
                <span className="text-zinc-500">{p.trackCount} piste(s)</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-zinc-400">
            Aucune playlist. Sur Discord : <code className="text-zinc-300">/playlist save nom</code>.
          </p>
        )}
      </section>
    </div>
  );
}
