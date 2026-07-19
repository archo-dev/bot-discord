import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MusicControlRequest, MusicStateDto, PlaylistSummaryDto } from "@bot/shared";
import { api } from "../lib/api.js";
import { Badge, Button, Card, EmptyState, ErrorCard, InfoCard, Input, Select } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";
import { Skeleton, SkeletonList } from "../ui/skeleton.js";
import { useCanWrite } from "../lib/access.js";
import { interpolateMusicElapsed, musicPollInterval, newestMusicState } from "../lib/music-state.js";
import { MusicSeekBar } from "../components/MusicSeekBar.js";
import { MusicSearchPanel } from "../components/MusicSearchPanel.js";

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

const STATUS_LABELS: Record<MusicStateDto["status"], string> = {
  idle: "Inactif",
  buffering: "Chargement…",
  playing: "En lecture",
  paused: "En pause",
  stopped: "Arrêté",
  error: "Erreur",
};

export function MusicPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [volume, setVolume] = useState(50);

  const stateKey = ["music-state", guildId] as const;
  const state = useQuery<MusicStateDto>({
    queryKey: stateKey,
    queryFn: async () => {
      const incoming = await api<MusicStateDto>(`/api/guilds/${guildId}/music-state`);
      return newestMusicState(queryClient.getQueryData<MusicStateDto>(stateKey), incoming);
    },
    refetchInterval: (query) => musicPollInterval(query.state.data, query.state.fetchFailureCount),
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
  });
  const playlists = useQuery({
    queryKey: ["playlists", guildId],
    queryFn: () => api<PlaylistSummaryDto[]>(`/api/guilds/${guildId}/playlists`),
  });

  const control = useMutation({
    mutationFn: (request: MusicControlRequest) =>
      api(`/api/guilds/${guildId}/music-control`, { method: "POST", body: JSON.stringify(request) }),
    meta: { errorMessage: "Contrôle indisponible — gateway hors ligne ?" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: stateKey }),
  });

  const s = state.data;
  const current = s?.current ?? null;
  useEffect(() => {
    if (s) setVolume(s.volume);
  }, [s?.sequence]);
  const receipt = useRef({ sequence: -1, at: performance.now() });
  if (s && receipt.current.sequence !== s.sequence) {
    receipt.current = { sequence: s.sequence, at: performance.now() };
  }
  const [, renderClock] = useState(0);
  useEffect(() => {
    if (s?.status !== "playing") return;
    const timer = window.setInterval(() => renderClock((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [s?.status, s?.sequence]);
  const displayedElapsed = s
    ? interpolateMusicElapsed(s, performance.now() - receipt.current.at)
    : 0;
  const progress = current && current.duration > 0
    ? Math.min(100, (displayedElapsed / current.duration) * 100)
    : 0;

  return (
    // M21 : masonry 2 colonnes (lecture / file / playlists).
    <div className="columns-1 gap-4 xl:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
      {canWrite && (
        <Card title="Rechercher et ajouter">
          <MusicSearchPanel
            guildId={guildId!}
            onQueued={() => queryClient.invalidateQueries({ queryKey: stateKey })}
          />
        </Card>
      )}
      <Card
        title="Lecture en cours"
        action={
          s ? (
            <Badge
              tone={
                s.status === "error"
                  ? "danger"
                  : s.status === "paused" || s.status === "buffering"
                    ? "warning"
                    : s.status === "playing"
                      ? "success"
                      : "neutral"
              }
            >
              {STATUS_LABELS[s.status]}
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
        ) : state.isError && !s ? (
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

            {canWrite ? (
              <MusicSeekBar
                value={displayedElapsed}
                duration={current.duration}
                sequence={s!.sequence}
                disabled={!s!.seekable || s!.status === "error" || control.isPending}
                onSeek={(position) => control.mutateAsync({ action: "seek", position }).then(() => undefined)}
              />
            ) : (
              <div className="mt-4">
                <div className="h-1.5 w-full rounded-full bg-zinc-800">
                  <div className="h-1.5 rounded-full bg-indigo-600" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-xs text-zinc-500">
                  <span>{formatDuration(displayedElapsed)}</span>
                  <span>{current.duration > 0 ? formatDuration(current.duration) : "live"}</span>
                </div>
              </div>
            )}

            {/* Contrôles masqués en lecture seule (M15) : modérateur = consultation uniquement. */}
            {canWrite && (
              <>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => control.mutate({ action: s!.paused ? "resume" : "pause" })} disabled={control.isPending}>
                    {s!.paused ? "▶️ Reprendre" : "⏸️ Pause"}
                  </Button>
                  <Button variant="secondary" onClick={() => control.mutate({ action: "skip" })} disabled={control.isPending}>
                    ⏭️ Suivant
                  </Button>
                  <Button variant="secondary" onClick={() => control.mutate({ action: "shuffle" })} disabled={control.isPending || s!.queue.length < 2}>
                    🔀 Mélanger
                  </Button>
                  <Button variant="danger" onClick={() => control.mutate({ action: "stop" })} disabled={control.isPending}>
                    ⏹️ Stop
                  </Button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Select
                    aria-label="Mode de répétition"
                    value={s!.loop}
                    disabled={control.isPending}
                    onChange={(event) => control.mutate({
                      action: "repeat",
                      mode: event.target.value as MusicStateDto["loop"],
                    })}
                  >
                    <option value="off">Sans répétition</option>
                    <option value="song">Répéter la piste</option>
                    <option value="queue">Répéter la file</option>
                  </Select>
                  <Input
                    aria-label="Volume en pourcentage"
                    type="number"
                    min={0}
                    max={150}
                    value={volume}
                    disabled={control.isPending}
                    onChange={(event) => setVolume(Number(event.target.value))}
                  />
                  <Button
                    variant="secondary"
                    disabled={control.isPending || !Number.isInteger(volume) || volume < 0 || volume > 150}
                    onClick={() => control.mutate({ action: "volume", value: volume })}
                  >
                    Appliquer
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
              <li key={`${t.url}:${i}`} className="flex items-center gap-2 text-zinc-300">
                <span className="text-zinc-600">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="text-zinc-500">{t.duration > 0 ? formatDuration(t.duration) : "live"}</span>
                {canWrite && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Retirer ${t.title}`}
                    disabled={control.isPending}
                    onClick={() => control.mutate({ action: "remove", position: i + 1 })}
                  >
                    Retirer
                  </Button>
                )}
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
        La recherche et les contrôles utilisent le même moteur Gateway que <code>/play</code>. Le panel interpole
        localement la progression et adapte sa synchronisation à l'état réel.
      </InfoCard>
    </div>
  );
}
