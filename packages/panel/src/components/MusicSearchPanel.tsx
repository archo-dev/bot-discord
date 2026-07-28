import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  MusicPanelEnqueueResponse,
  MusicPanelSearchResponse,
  MusicSearchResultDto,
  MusicStateDto,
} from "@bot/shared";
import { api } from "../lib/api.js";
import {
  isAbortError,
  MUSIC_SEARCH_DEBOUNCE_MS,
  MUSIC_SEARCH_MAX_LENGTH,
  MUSIC_SEARCH_MIN_LENGTH,
  MusicSearchCoordinator,
  MusicSubmissionGuard,
  musicSearchErrorMessage,
} from "../lib/music-search.js";
import { formatMusicDuration, musicSourceLabel } from "../lib/music-view.js";
import { Badge, Button, EmptyState, Input } from "../ui/kit.js";
import { Skeleton } from "../ui/skeleton.js";
import { Icon } from "../ui/icons.js";

function ResultCard({
  result,
  disabled,
  onAdd,
}: {
  result: MusicSearchResultDto;
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
    <li className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950/45 p-3">
      <article className="flex min-w-0 gap-3">
        {result.thumbnail ? (
          <img src={result.thumbnail} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-indigo-300" aria-hidden>
            <Icon.music />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 break-words text-sm font-medium text-white">{result.title}</p>
            <Badge tone={result.type === "playlist" ? "warning" : "neutral"}>
              {result.type === "playlist" ? "Playlist" : "Piste"}
            </Badge>
            {result.isPreview === true && <Badge tone="warning">Extrait</Badge>}
          </div>
          <p className="mt-1 break-words text-xs leading-relaxed text-zinc-500">
            {result.author ?? "Auteur non disponible"} · {formatMusicDuration(result.duration)}
          </p>
          <p className="mt-0.5 break-all text-[11px] text-zinc-600">{musicSourceLabel(result.url)}</p>
          {result.type === "playlist" && (
            <p className="mt-1 text-[11px] text-zinc-500">
              {result.playableTrackCount} piste(s) exploitable(s)
              {result.ignoredTrackCount > 0 && ` · ${result.ignoredTrackCount} ignorée(s)`}
            </p>
          )}
          <Button className="mt-2 w-full sm:w-auto" size="sm" variant="secondary" disabled={disabled} onClick={onAdd}>
            {disabled ? "Ajout en cours…" : "Ajouter à la file"}
          </Button>
        </div>
      </article>
    </li>
  );
}

export function MusicSearchPanel({
  guildId,
  onQueued,
}: {
  guildId: string;
  onQueued: (state: MusicStateDto | undefined) => void;
}) {
  const [input, setInput] = useState("");
  const [resolvedQuery, setResolvedQuery] = useState("");
  const [results, setResults] = useState<MusicSearchResultDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const coordinator = useRef(new MusicSearchCoordinator());
  const submission = useRef(new MusicSubmissionGuard());

  useEffect(() => {
    const query = input.trim();
    setLoading(false);
    setNotice(null);
    setResults([]);
    setResolvedQuery("");
    if (query.length < MUSIC_SEARCH_MIN_LENGTH) {
      coordinator.current.schedule(query, guildId, () => undefined);
      setError(null);
      return;
    }
    coordinator.current.schedule(query, guildId, (normalizedQuery, request) => {
      setLoading(true);
      setError(null);
      void api<MusicPanelSearchResponse>(`/api/guilds/${guildId}/music-search`, {
        method: "POST",
        body: JSON.stringify({ query: normalizedQuery }),
        signal: request.signal,
      }).then((response) => {
        if (!request.isCurrent()) return;
        if (!response.ok) throw new Error(response.message ?? "Recherche indisponible.");
        setResults(response.results.slice(0, 5));
        setResolvedQuery(normalizedQuery);
      }).catch((reason: unknown) => {
        if (!request.isCurrent() || isAbortError(reason)) return;
        setResults([]);
        setResolvedQuery("");
        setError(musicSearchErrorMessage(reason));
      }).finally(() => {
        if (request.isCurrent()) setLoading(false);
      });
    });
  }, [guildId, input]);

  useEffect(() => () => coordinator.current.cancel(), []);

  const enqueue = useMutation({
    mutationFn: async (query: string) => {
      const response = await api<MusicPanelEnqueueResponse>(`/api/guilds/${guildId}/music-enqueue`, {
        method: "POST",
        body: JSON.stringify({ query }),
      });
      if (!response.ok) throw new Error(response.message ?? "Ajout impossible.");
      return response;
    },
    meta: { silentError: true },
    onSuccess: (response) => {
      const position = response.enqueue?.position;
      setNotice(position === 0 ? "Lecture démarrée." : position ? `Ajout réussi à la position ${position}.` : "Ajout réussi.");
      setError(null);
      onQueued(response.state);
      window.requestAnimationFrame(() => document.getElementById("music-search")?.focus());
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Ajout impossible."),
  });

  const addResult = (result: MusicSearchResultDto) => {
    const query = result.url ?? resolvedQuery;
    if (!query || !submission.current.begin()) return;
    enqueue.mutateAsync(query).catch(() => undefined).finally(() => submission.current.end());
  };

  return (
    <div className="min-w-0">
      <label htmlFor="music-search" className="mb-1 block text-sm font-medium text-zinc-300">
        Titre, artiste ou URL publique
      </label>
      <Input
        id="music-search"
        value={input}
        maxLength={MUSIC_SEARCH_MAX_LENGTH}
        autoComplete="off"
        aria-describedby="music-search-hint"
        placeholder="Rechercher une piste ou coller une URL…"
        onChange={(event) => setInput(event.target.value)}
      />
      <p id="music-search-hint" className="mt-1 text-xs leading-relaxed text-zinc-500">
        {MUSIC_SEARCH_MIN_LENGTH} caractères minimum · recherche après {MUSIC_SEARCH_DEBOUNCE_MS / 1000} s · la recherche précédente est annulée si vous continuez à écrire.
      </p>

      {loading && (
        <div className="mt-3 space-y-2" aria-label="Recherche musicale en cours" aria-busy="true">
          {[0, 1].map((index) => (
            <div key={index} className="flex gap-3 rounded-xl border border-zinc-800 p-3">
              <Skeleton className="h-16 w-16 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2 pt-1">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-8 w-32" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && results.length > 0 && (
        <section className="mt-3" aria-labelledby="music-results-title">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 id="music-results-title" className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Résultats ({results.length})
            </h3>
            <span className="text-[11px] text-zinc-600">Moteur existant</span>
          </div>
          <ul className="space-y-2">
            {results.map((result, index) => (
              <ResultCard
                key={`${result.type}:${result.url ?? result.title}:${index}`}
                result={result}
                disabled={enqueue.isPending}
                onAdd={() => addResult(result)}
              />
            ))}
          </ul>
        </section>
      )}

      {!loading && resolvedQuery && results.length === 0 && !error && (
        <div className="mt-3">
          <EmptyState icon={<Icon.music />} title="Aucun résultat exploitable" description={`Aucun résultat n’a été retourné pour « ${resolvedQuery} ».`} />
        </div>
      )}
      <div className="mt-2 min-h-5" aria-live="polite" aria-atomic="true">
        {notice && <p className="text-sm text-emerald-400" role="status">{notice}</p>}
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      </div>
    </div>
  );
}
