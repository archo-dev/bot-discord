import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReleaseNoteSummary, ReleaseNotesListResponse } from "@bot/shared";
import { api } from "../../lib/api.js";
import { useDocumentMeta } from "../../lib/seo.js";
import { Badge, EmptyState, ErrorCard } from "../../ui/kit.js";
import { Skeleton } from "../../ui/skeleton.js";
import { CHANGE_TYPE_LABELS, CHANGE_TYPE_TONE, formatUpdateDate, moduleFilterOptions } from "./updates-format.js";

/*
 * Page publique /updates (M5) — liste des notes de mise à jour PUBLIÉES.
 * Route lazy (chunk séparé) → hors bundle initial. La visibilité (publié /
 * fenêtre / audience) est décidée côté Worker ; le front n'affiche que ce qu'il
 * reçoit. Un seul <main>, un seul <h1>.
 */
function ChangeBadges({ note }: { note: ReleaseNoteSummary }) {
  if (note.changeTypes.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {note.changeTypes.map((t) => (
        <span key={t} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${CHANGE_TYPE_TONE[t]}`}>
          {CHANGE_TYPE_LABELS[t]}
        </span>
      ))}
    </div>
  );
}

function NoteCard({ note }: { note: ReleaseNoteSummary }) {
  return (
    <article className="rounded-2xl border border-(--border) bg-zinc-900/60 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <time dateTime={note.publishedAt}>{formatUpdateDate(note.publishedAt)}</time>
        {note.version && <Badge tone="neutral">v{note.version}</Badge>}
      </div>
      <h2 className="mt-2 font-display text-lg font-semibold tracking-[-0.01em] text-zinc-50">
        <Link to={`/updates/${note.slug}`} className="hover:underline focus-visible:underline">
          {note.title}
        </Link>
      </h2>
      {note.summary && <p className="mt-2 text-sm leading-relaxed text-zinc-400">{note.summary}</p>}
      <ChangeBadges note={note} />
      <div className="mt-4">
        <Link to={`/updates/${note.slug}`} className="text-sm font-medium text-indigo-400 hover:underline">
          Lire la note →
        </Link>
      </div>
    </article>
  );
}

export function UpdatesPage() {
  useDocumentMeta({
    title: "Mises à jour — Archodev",
    description: "Les notes de version publiques d'Archodev : nouveautés, améliorations et corrections du bot Discord.",
  });
  const [module, setModule] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["updates", module],
    queryFn: () =>
      api<ReleaseNotesListResponse>(`/api/updates?pageSize=20${module ? `&module=${encodeURIComponent(module)}` : ""}`),
    retry: false,
  });

  const filters = moduleFilterOptions(query.data?.modules ?? []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <header className="text-center">
        <div className="mb-3 font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-300">Archodev</div>
        <h1 className="font-display text-3xl font-semibold tracking-[-0.02em] text-zinc-50 sm:text-4xl">Mises à jour</h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-zinc-400">
          Les nouveautés, améliorations et corrections apportées au bot, publiées au fil des versions.
        </p>
      </header>

      {filters.length > 1 && (
        <div className="mt-8 flex flex-wrap justify-center gap-2" role="group" aria-label="Filtrer par module">
          {filters.map((opt) => {
            const active = opt.value === module;
            return (
              <button
                key={opt.value ?? "__all__"}
                type="button"
                aria-pressed={active}
                onClick={() => setModule(opt.value)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
                  active ? "bg-indigo-500 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-10">
        {query.isPending ? (
          <div className="space-y-4" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 w-full rounded-2xl" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorCard
            message="Impossible de charger les mises à jour — réessayez plus tard."
            onRetry={() => void query.refetch()}
          />
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16v16H4z" />
                <path d="M8 9h8M8 13h5" />
              </svg>
            }
            title="Aucune note pour le moment"
            description={module ? "Aucune mise à jour ne correspond à ce module." : "Les prochaines mises à jour seront publiées ici."}
          />
        ) : (
          <div className="space-y-4">
            {query.data.items.map((note) => (
              <NoteCard key={note.slug} note={note} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
