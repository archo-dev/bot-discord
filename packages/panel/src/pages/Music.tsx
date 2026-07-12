import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MusicStateDto, PlaylistSummaryDto } from "@bot/shared";
import { api } from "../lib/api.js";
import { Badge, Button, Card, EmptyState, ErrorCard, InfoCard } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";
import { Skeleton, SkeletonList } from "../ui/skeleton.js";
import { useCanWrite } from "../lib/access.js";

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
  const canWrite = useCanWrite();

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
    meta: { errorMessage: "Contrôle indisponible — gateway hors ligne ?" },
    onSuccess: () => setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["music-state", guildId] }), 500),
  });

  const s = state.data;
  const current = s?.current ?? null;
  const progress = current && current.duration > 0 ? Math.min(100, (s!.elapsed / current.duration) * 100) : 0;

  return (
    // M21 : masonry 2 colonnes (lecture / file / playlists).
    <div className="columns-1 gap-5 xl:columns-2 [&>*]:mb-5 [&>*]:break-inside-avoid">
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
        {state.isPending ? (
          <div className="flex gap-4" aria-busy="true">
            <Skeleton className="h-20 w-20 rounded-lg" />
            <div className="flex-1 space-y-2 pt-1">
              <Skeleton className="h-4 w-56 max-w-full" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="mt-4 h-1.5 w-full rounded-full" />
            </div>
          </div>
        ) : state.isError ? (
          <ErrorCard message="Impossible de charger l'état de lecture." onRetry={() => void state.refetch()} />
        ) : current ? (
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

            {/* Contrôles masqués en lecture seule (M15) : modérateur = consultation uniquement. */}
            {canWrite && (
              <>
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
              </>
            )}
          </div>
        ) : (
          <EmptyState
            icon={<Icon.music />}
            title="Rien en lecture"
            description={
              <>
                Lancez une musique sur Discord avec <code className="text-zinc-300">/play</code> — l'état apparaîtra ici
                en temps réel.
              </>
            }
          />
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
        {playlists.isPending ? (
          <SkeletonList rows={3} />
        ) : playlists.data && playlists.data.length > 0 ? (
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
          <EmptyState
            icon={<Icon.music />}
            title="Aucune playlist enregistrée"
            description={
              <>
                Sauvegardez la file en cours depuis Discord avec{" "}
                <code className="text-zinc-300">/playlist save nom</code>.
              </>
            }
          />
        )}
      </Card>

      <InfoCard icon={<Icon.music />} title="Astuce">
        Lance la lecture depuis Discord avec <code>/play</code> ; les contrôles ci-dessus pilotent le bot en temps réel
        via le Gateway. L'état se rafraîchit automatiquement toutes les 4 s.
      </InfoCard>
    </div>
  );
}
