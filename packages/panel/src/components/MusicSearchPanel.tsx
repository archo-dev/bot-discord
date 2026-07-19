import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  MusicPanelEnqueueResponse,
  MusicPanelSearchResponse,
  MusicSearchResultDto,
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
import { Badge, Button, Input } from "../ui/kit.js";

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "live";
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

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
    <div className="mt-3 flex gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
      {result.thumbnail && <img src={result.thumbnail} alt="" className="h-16 w-16 rounded-md object-cover" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-white">{result.title}</p>
          <Badge tone={result.type === "playlist" ? "warning" : "neutral"}>
            {result.type === "playlist" ? "Playlist" : "Piste"}
          </Badge>
          {result.isPreview === true && <Badge tone="warning">Preview</Badge>}
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          {result.author ?? "Auteur inconnu"} · {formatDuration(result.duration)}
          {result.type === "playlist" && ` · ${result.playableTrackCount} piste(s) exploitable(s)`}
          {result.ignoredTrackCount > 0 && ` · ${result.ignoredTrackCount} ignorée(s)`}
        </p>
        <Button className="mt-2" size="sm" variant="secondary" disabled={disabled} onClick={onAdd}>
          {disabled ? "Ajout en cours…" : "Ajouter à la file"}
        </Button>
      </div>
    </div>
  );
}

export function MusicSearchPanel({ guildId, onQueued }: { guildId: string; onQueued: () => Promise<unknown> }) {
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
        if (!response.ok) throw new Error(response.message ?? "Aucun résultat exploitable.");
        setResults(response.results.slice(0, 5));
        setResolvedQuery(normalizedQuery);
        if (response.results.length === 0) setError(response.message ?? "Aucun résultat exploitable.");
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
    onSuccess: async (response) => {
      const position = response.enqueue?.position;
      setNotice(position === 0 ? "Lecture démarrée." : `Ajout réussi à la position ${position}.`);
      setError(null);
      await onQueued();
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Ajout impossible."),
  });

  return (
    <div>
      <label htmlFor="music-search" className="mb-1 block text-sm font-medium text-zinc-300">
        Titre, artiste ou URL publique
      </label>
      <Input
        id="music-search"
        value={input}
        maxLength={MUSIC_SEARCH_MAX_LENGTH}
        autoComplete="off"
        placeholder="Niska Réseaux ou https://soundcloud.com/…"
        onChange={(event) => setInput(event.target.value)}
      />
      <p className="mt-1 text-xs text-zinc-500">
        {MUSIC_SEARCH_MIN_LENGTH} caractères minimum · recherche après {MUSIC_SEARCH_DEBOUNCE_MS / 1000} s.
      </p>
      {loading && <p className="mt-3 text-sm text-indigo-300" aria-live="polite">Recherche en cours…</p>}
      {!loading && results.map((result, index) => (
        <ResultCard
          key={`${result.type}:${result.url ?? result.title}:${index}`}
          result={result}
          disabled={enqueue.isPending}
          onAdd={() => {
            if (!resolvedQuery || !submission.current.begin()) return;
            enqueue.mutateAsync(resolvedQuery).catch(() => undefined).finally(() => submission.current.end());
          }}
        />
      ))}
      {notice && <p className="mt-2 text-sm text-emerald-400" role="status">{notice}</p>}
      {error && <p className="mt-2 text-sm text-red-400" role="alert">{error}</p>}
    </div>
  );
}
