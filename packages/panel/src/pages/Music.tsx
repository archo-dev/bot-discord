import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MusicStateDto, PlaylistSummaryDto } from "@bot/shared";
import { api } from "../lib/api.js";
import { Badge, Button, Card, InfoCard } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";

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
    <div className="max-w-2xl space-y-6">
      <Card
        title="Lecture en cours"
        action={
          s ? (
            <Badge tone={s.connected ? (s.paused ? "warning" : "success") : "neutral"}>
              {s.connected ? (s.paused ? "En pause" : "En lecture") : "Inactif"}
            </Badge>
          ) : undefined
        }
      >
        {current ? (
          <div>
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
                <div className="h-1.5 rounded-full bg-indigo-600" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-xs text-zinc-500">
                <span>{formatDuration(s!.elapsed)}</span>
                <span>{current.duration > 0 ? formatDuration(current.duration) : "live"}</span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => control.mutate(s!.paused ? "resume" : "pause")} disabled={control.isPending}>
                {s!.paused ? "▶️ Reprendre" : "⏸️ Pause"}
              </Button>
              <Button variant="secondary" onClick={() => control.mutate("skip")} disabled={control.isPending}>
                ⏭️ Suivant
              </Button>
              <Button variant="danger" onClick={() => control.mutate("stop")} disabled={control.isPending}>
                ⏹️ Stop
              </Button>
            </div>
            {control.isError && <p className="mt-2 text-sm text-red-400">Contrôle indisponible (gateway hors ligne ?).</p>}
          </div>
        ) : (
          <p className="text-sm text-zinc-400">
            Rien en lecture. Lance une musique sur Discord avec <code className="text-zinc-300">/play</code>.
          </p>
        )}
      </Card>

      {s && s.queue.length > 0 && (
        <Card title={`File d'attente (${s.queue.length})`}>
          <ol className="space-y-1.5 text-sm">
            {s.queue.slice(0, 20).map((t, i) => (
              <li key={i} className="flex gap-2 text-zinc-300">
                <span className="text-zinc-600">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="text-zinc-500">{t.duration > 0 ? formatDuration(t.duration) : "live"}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card title="Playlists enregistrées">
        {playlists.data && playlists.data.length > 0 ? (
          <ul className="space-y-1.5 text-sm text-zinc-300">
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
          <p className="text-sm text-zinc-400">
            Aucune playlist. Sur Discord : <code className="text-zinc-300">/playlist save nom</code>.
          </p>
        )}
      </Card>

      <InfoCard icon={<Icon.music />} title="Astuce">
        Lance la lecture depuis Discord avec <code>/play</code> ; les contrôles ci-dessus pilotent le bot en temps réel
        via le Gateway. L'état se rafraîchit automatiquement toutes les 4 s.
      </InfoCard>
    </div>
  );
}
