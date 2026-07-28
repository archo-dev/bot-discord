import { useEffect, useRef, useState } from "react";
import { useOutletContext, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelOption, GuildModulesResponse, MusicCommandResult, MusicControlRequest, MusicStateDto, PlaylistSummaryDto } from "@bot/shared";
import { api } from "../lib/api.js";
import { Badge, Button, Card, EmptyState, ErrorCard, InfoCard, Input, OperationalState, Select } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";
import { Skeleton, SkeletonList } from "../ui/skeleton.js";
import { useCanWrite } from "../lib/access.js";
import { interpolateMusicElapsed, musicPollInterval, newestMusicState } from "../lib/music-state.js";
import { formatMusicDuration, musicLoopLabel, musicSourceLabel, musicStatusLabel } from "../lib/music-view.js";
import { MusicSeekBar } from "../components/MusicSeekBar.js";
import { MusicSearchPanel } from "../components/MusicSearchPanel.js";
import { UserCell } from "../ui/cells.js";
import type { GuildOutletContext } from "./GuildLayout.js";

function ContextLine({ label, value, tone = "neutral" }: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    neutral: "text-zinc-300",
    success: "text-emerald-300",
    warning: "text-amber-300",
    danger: "text-red-300",
  }[tone];
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2 last:border-0">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`max-w-[64%] break-words text-right text-xs font-medium ${toneClass}`}>{value}</dd>
    </div>
  );
}

export function MusicPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const { guild } = useOutletContext<GuildOutletContext>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [volume, setVolume] = useState(50);
  const idleSince = useRef(Date.now());
  const previousStatus = useRef<MusicStateDto["status"] | undefined>(undefined);

  const stateKey = ["music-state", guildId] as const;
  const state = useQuery<MusicStateDto>({
    queryKey: stateKey,
    queryFn: async ({ signal }) => {
      const incoming = await api<MusicStateDto>(`/api/guilds/${guildId}/music-state`, { signal });
      return newestMusicState(queryClient.getQueryData<MusicStateDto>(stateKey), incoming);
    },
    refetchInterval: (query) => musicPollInterval(
      query.state.data,
      query.state.fetchFailureCount,
      Date.now() - idleSince.current,
    ),
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    staleTime: 0,
  });
  const playlists = useQuery({
    queryKey: ["playlists", guildId],
    queryFn: ({ signal }) => api<PlaylistSummaryDto[]>(`/api/guilds/${guildId}/playlists`, { signal }),
  });
  const modules = useQuery({
    queryKey: ["modules", guildId],
    queryFn: ({ signal }) => api<GuildModulesResponse>(`/api/guilds/${guildId}/modules`, { signal }),
    staleTime: 60_000,
  });
  const channels = useQuery({
    queryKey: ["channels", guildId],
    queryFn: ({ signal }) => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`, { signal }),
    staleTime: 60_000,
  });

  const control = useMutation<MusicCommandResult, Error, MusicControlRequest>({
    mutationFn: async (request: MusicControlRequest) => {
      const result = await api<MusicCommandResult>(`/api/guilds/${guildId}/music-control`, {
        method: "POST",
        body: JSON.stringify(request),
      });
      if (!result.ok) throw new Error(result.message);
      return result;
    },
    meta: { errorMessage: "Contrôle indisponible — gateway hors ligne ?" },
    onSuccess: (result) => {
      if (result.state) {
        queryClient.setQueryData<MusicStateDto>(stateKey, (currentState) =>
          newestMusicState(currentState, result.state!));
      }
      void queryClient.invalidateQueries({ queryKey: stateKey });
    },
  });

  const s = state.data;
  const current = s?.current ?? null;
  useEffect(() => {
    if (!s) return;
    const idle = s.status === "idle" || s.status === "stopped" || s.status === "error";
    const wasIdle = previousStatus.current === "idle" ||
      previousStatus.current === "stopped" || previousStatus.current === "error";
    if (idle && !wasIdle) idleSince.current = Date.now();
    previousStatus.current = s.status;
  }, [s?.status]);
  useEffect(() => {
    const resetIdleDetection = () => {
      idleSince.current = Date.now();
    };
    window.addEventListener("focus", resetIdleDetection);
    window.addEventListener("online", resetIdleDetection);
    return () => {
      window.removeEventListener("focus", resetIdleDetection);
      window.removeEventListener("online", resetIdleDetection);
    };
  }, []);
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
  const module = modules.data?.modules.find((candidate) => candidate.id === "music");
  const voiceChannel = channels.data?.find((channel) => channel.id === s?.voiceChannelId)?.name;
  const gatewayConnected = guild?.gatewayConnected === true;
  const realtimeAvailable = canWrite && gatewayConnected && modules.isSuccess && module?.enabled === true;
  const statusTone = !s || s.status === "idle" || s.status === "stopped"
    ? "neutral"
    : s.status === "error"
      ? "danger"
      : s.status === "paused" || s.status === "buffering"
        ? "warning"
        : "success";

  return (
    <div className="min-w-0 space-y-4 pb-3">
      {(modules.isError || channels.isError) && (
        <ErrorCard
          compact
          title="Contexte du lecteur incomplet"
          message={modules.isError
            ? "Impossible de vérifier l’état du module. Les contrôles sont neutralisés, mais le dernier état musical reste visible."
            : "Impossible de résoudre le nom du salon vocal. Le lecteur continue d’afficher les données réellement reçues."}
          onRetry={() => {
            if (modules.isError) void modules.refetch();
            if (channels.isError) void channels.refetch();
          }}
          retrying={modules.isFetching || channels.isFetching}
        />
      )}
      {!canWrite && (
        <OperationalState kind="readonly" title="Lecteur en lecture seule" description="L’état de lecture et la file restent visibles, mais aucun contrôle temps réel n’est disponible." />
      )}
      {!gatewayConnected && (
        <OperationalState kind="gateway" title="Gateway indisponible" description="Lecture, recherche et gestion de la file sont momentanément impossibles." action={<Button to={`/guilds/${guildId}/health`} variant="secondary" size="sm">Voir le diagnostic</Button>} />
      )}
      {module && !module.enabled && (
        <OperationalState kind="module" title="Module Musique désactivé" description="Les nouveaux contrôles sont arrêtés, sans détruire une lecture déjà engagée." action={<Button to={`/guilds/${guildId}/modules`} variant="secondary" size="sm">Ouvrir Modules</Button>} />
      )}
      {state.isError && s && (
        <div role="status" className="rounded-xl border border-amber-900/60 bg-amber-950/25 px-3 py-2.5 text-xs text-amber-200">
          La synchronisation a échoué. Le dernier état réel reçu reste affiché.
        </div>
      )}

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-12">
        <section aria-labelledby="music-player-title" className="min-w-0 lg:col-span-8">
          <header className="mb-3 px-1">
            <h2 id="music-player-title" className="font-display text-[15px] font-semibold text-zinc-100">Lecteur et état</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Instantané réel du moteur musical, synchronisé sans simuler de piste.</p>
          </header>
          <Card
            title={current ? "Lecture en cours" : "Lecteur"}
            action={s ? <Badge tone={statusTone}>{musicStatusLabel(s.status)}</Badge> : undefined}
          >
            <div className="sr-only" aria-live="polite" aria-atomic="true">
              {s ? `${musicStatusLabel(s.status)}${current ? ` : ${current.title}` : ""}` : "État de lecture non disponible"}
            </div>
            {state.isPending ? (
              <div className="flex gap-4" aria-busy="true">
                <Skeleton className="h-24 w-24 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2 pt-1">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="mt-5 h-2 w-full rounded-full" />
                </div>
              </div>
            ) : state.isError && !s ? (
              <ErrorCard message="Impossible de charger l’état de lecture." onRetry={() => void state.refetch()} />
            ) : current ? (
              <div className="min-w-0">
                <div className="flex min-w-0 gap-3 sm:gap-4">
                  {current.thumbnail ? (
                    <img src={current.thumbnail} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover sm:h-24 sm:w-24" />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/50 text-indigo-300 sm:h-24 sm:w-24" aria-hidden>
                      <Icon.music />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <a href={current.url} target="_blank" rel="noreferrer" className="block break-words text-base font-semibold text-white hover:underline">
                      {current.title}
                    </a>
                    <p className="mt-1 break-all text-xs text-zinc-500">{musicSourceLabel(current.url)}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
                      <span>{musicLoopLabel(s!.loop)}</span>
                      <span>Volume {s!.volume}%</span>
                      <span>{voiceChannel ? `Salon ${voiceChannel}` : s!.voiceChannelId ? `Salon ${s!.voiceChannelId}` : "Salon vocal non disponible"}</span>
                    </div>
                    {current.requestedBy && <p className="mt-2 inline-flex items-center gap-1 text-xs text-zinc-500">Demandée par <UserCell userId={current.requestedBy} /></p>}
                  </div>
                </div>

                {canWrite ? (
                  <MusicSeekBar
                    value={displayedElapsed}
                    duration={current.duration}
                    sequence={s!.sequence}
                    disabled={!realtimeAvailable || !s!.seekable || s!.status === "error" || control.isPending}
                    onSeek={(position) => control.mutateAsync({ action: "seek", position }).then(() => undefined)}
                  />
                ) : (
                  <div className="mt-4" aria-label={`Progression ${formatMusicDuration(displayedElapsed)} sur ${formatMusicDuration(current.duration)}`}>
                    <div className="h-2 w-full rounded-full bg-zinc-800">
                      <div className="h-2 rounded-full bg-indigo-600" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="mt-1 flex justify-between text-xs text-zinc-500">
                      <span>{formatMusicDuration(displayedElapsed)}</span>
                      <span>{formatMusicDuration(current.duration)}</span>
                    </div>
                  </div>
                )}

                {canWrite && (
                  <>
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                      <Button className="w-full sm:w-auto" variant="secondary" onClick={() => control.mutate({ action: s!.paused ? "resume" : "pause" })} disabled={!realtimeAvailable || control.isPending}>
                        {s!.paused ? "Reprendre la lecture" : "Mettre en pause"}
                      </Button>
                      <Button className="w-full sm:w-auto" variant="secondary" onClick={() => control.mutate({ action: "skip" })} disabled={!realtimeAvailable || control.isPending}>
                        Piste suivante
                      </Button>
                      <Button className="w-full sm:w-auto" variant="secondary" onClick={() => control.mutate({ action: "shuffle" })} disabled={!realtimeAvailable || control.isPending || s!.queue.length < 2}>
                        Mélanger la file
                      </Button>
                      <Button className="w-full sm:w-auto" variant="danger" onClick={() => control.mutate({ action: "stop" })} disabled={!realtimeAvailable || control.isPending}>
                        Arrêter
                      </Button>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <Select
                        aria-label="Mode de répétition"
                        value={s!.loop}
                        disabled={!realtimeAvailable || control.isPending}
                        onChange={(event) => control.mutate({ action: "repeat", mode: event.target.value as MusicStateDto["loop"] })}
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
                        disabled={!realtimeAvailable || control.isPending}
                        onChange={(event) => setVolume(Number(event.target.value))}
                      />
                      <Button
                        variant="secondary"
                        disabled={!realtimeAvailable || control.isPending || !Number.isInteger(volume) || volume < 0 || volume > 150}
                        onClick={() => control.mutate({ action: "volume", value: volume })}
                      >
                        Appliquer le volume
                      </Button>
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-500">Ces contrôles agissent en temps réel et ne créent aucun brouillon de configuration.</p>
                    {control.isError && <p className="mt-2 text-sm text-red-400" role="alert">Contrôle indisponible. L’état affiché reste celui du dernier instantané reçu.</p>}
                  </>
                )}
              </div>
            ) : (
              <EmptyState
                icon={<Icon.music />}
                title="Aucune piste en cours"
                description={s?.connected ? "Le bot est connecté, mais aucune piste n’est lue." : "Le moteur musical n’est connecté à aucun salon vocal."}
              />
            )}
          </Card>

          <section aria-labelledby="music-search-title" className="mt-4 min-w-0">
            <header className="mb-3 px-1">
              <h2 id="music-search-title" className="font-display text-[15px] font-semibold text-zinc-100">Recherche</h2>
              <p className="mt-0.5 text-xs text-zinc-500">Résultats réels du moteur existant, sans nouvelle source musicale.</p>
            </header>
            <Card title="Rechercher et ajouter" pad="compact">
              {realtimeAvailable ? (
                <MusicSearchPanel
                  guildId={guildId!}
                  onQueued={(incoming) => {
                    if (incoming) {
                      queryClient.setQueryData<MusicStateDto>(stateKey, (currentState) => newestMusicState(currentState, incoming));
                    }
                    void queryClient.invalidateQueries({ queryKey: stateKey });
                  }}
                />
              ) : (
                <EmptyState
                  icon={<Icon.music />}
                  title={canWrite ? "Recherche indisponible" : "Recherche en lecture seule"}
                  description={canWrite ? "Reconnectez la Gateway et activez le module pour rechercher une piste." : "Seuls les administrateurs peuvent rechercher et ajouter des pistes."}
                />
              )}
            </Card>
          </section>

          <section aria-labelledby="music-queue-title" className="mt-4 min-w-0">
            <header className="mb-3 px-1">
              <h2 id="music-queue-title" className="font-display text-[15px] font-semibold text-zinc-100">File d’attente</h2>
              <p className="mt-0.5 text-xs text-zinc-500">Ordre réel du moteur ; aucun déplacement n’est proposé car le contrat ne l’expose pas.</p>
            </header>
            <Card title={`File d’attente (${s?.queue.length ?? 0})`}>
              {state.isPending ? (
                <SkeletonList rows={4} />
              ) : !s || s.queue.length === 0 ? (
                <EmptyState icon={<Icon.music />} title="File d’attente vide" description="Aucune piste n’attend après la lecture courante." />
              ) : (
                <ol className="grid gap-2 xl:grid-cols-2">
                  {s.queue.slice(0, 20).map((track, index) => (
                    <li key={`${track.url}:${index}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-950 text-xs font-semibold text-indigo-300">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <a href={track.url} target="_blank" rel="noreferrer" className="block break-words text-sm font-medium text-zinc-200 hover:underline">{track.title}</a>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                          <span>{formatMusicDuration(track.duration)}</span>
                          {track.requestedBy && <span className="inline-flex items-center gap-1">Demandée par <UserCell userId={track.requestedBy} /></span>}
                        </p>
                      </div>
                      {canWrite && (
                        <Button
                          className="shrink-0"
                          size="sm"
                          variant="ghost"
                          aria-label={`Retirer ${track.title} de la file`}
                          disabled={!realtimeAvailable || control.isPending}
                          onClick={() => control.mutate({ action: "remove", position: index + 1 })}
                        >
                          Retirer
                        </Button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </section>
        </section>

        <aside aria-labelledby="music-context-title" className="min-w-0 lg:sticky lg:top-20 lg:col-span-4">
          <header className="mb-3 px-1">
            <h2 id="music-context-title" className="font-display text-[15px] font-semibold text-zinc-100">Contexte</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Service, Gateway, accès et limites réellement disponibles.</p>
          </header>
          <div className="space-y-3">
            <Card title="État du service" pad="compact">
              <dl>
                <ContextLine label="Module" value={module?.state === "enabled" ? "Actif" : module?.enabled === false ? "Désactivé" : modules.isPending ? "Chargement…" : "Non disponible"} tone={module?.state === "enabled" ? "success" : "warning"} />
                <ContextLine label="Gateway" value={gatewayConnected ? "Connectée" : "Indisponible"} tone={gatewayConnected ? "success" : "danger"} />
                <ContextLine label="Moteur" value={s?.connected ? "Connecté" : s ? "Déconnecté" : "Non disponible"} tone={s?.connected ? "success" : "warning"} />
                <ContextLine label="Salon vocal" value={voiceChannel ?? s?.voiceChannelId ?? "Non disponible"} />
                <ContextLine label="Votre accès" value={canWrite ? "Contrôle autorisé" : "Lecture seule"} tone={canWrite ? "success" : "warning"} />
              </dl>
            </Card>
            <Card title="Permissions et quota" description="Contrats du module Musique." pad="compact">
              <ul className="space-y-2 text-xs text-zinc-400">
                {(module?.requiredPermissions ?? ["view_channel", "send_messages", "connect", "speak"]).map((permission) => (
                  <li key={permission} className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" aria-hidden />{permission}</li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                Les contrôles utilisent un quota journalier par utilisateur. L’utilisation courante n’est pas exposée ici.
              </p>
            </Card>
            <Card title="Configuration" description="Capacités réellement exposées." pad="compact">
              <p className="text-xs leading-relaxed text-zinc-400">
                Aucun réglage musical persistant n’est disponible dans le contrat panel actuel. Volume, répétition et file sont des états temps réel ; aucune SaveBar n’est donc affichée.
              </p>
            </Card>
          </div>

          <section aria-labelledby="music-playlists-title" className="mt-4 min-w-0">
            <header className="mb-3 px-1">
              <h2 id="music-playlists-title" className="font-display text-[15px] font-semibold text-zinc-100">Playlists</h2>
              <p className="mt-0.5 text-xs text-zinc-500">Playlists enregistrées réellement disponibles.</p>
            </header>
            <Card title="Playlists enregistrées" pad="compact">
              {playlists.isPending ? (
                <SkeletonList rows={3} />
              ) : playlists.isError ? (
                <ErrorCard message="Impossible de charger les playlists." onRetry={() => void playlists.refetch()} />
              ) : playlists.data && playlists.data.length > 0 ? (
                <ul className="divide-y divide-white/5">
                  {playlists.data.map((playlist) => (
                    <li key={playlist.name} className="flex min-w-0 items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="min-w-0 break-words font-medium text-zinc-200">{playlist.name}</span>
                      <span className="shrink-0 text-xs text-zinc-500">{playlist.trackCount} piste(s)</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={<Icon.music />} title="Aucune playlist enregistrée" description="Aucune playlist réelle n’est disponible pour ce serveur." />
              )}
            </Card>
          </section>
        </aside>
      </div>

      <InfoCard icon={<Icon.music />} title="Synchronisation honnête">
        Le panel interpole localement la progression entre deux instantanés réels. Recherche, lecture et file utilisent les endpoints et le moteur Gateway existants ; aucune source ou configuration persistante n’a été ajoutée.
      </InfoCard>
    </div>
  );
}
