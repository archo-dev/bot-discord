import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReleaseNotesListResponse } from "@bot/shared";
import { api } from "../../../lib/api.js";
import { Badge } from "../../../ui/kit.js";
import { formatUpdateDate } from "../../../pages/public/updates-format.js";

/*
 * Aperçu « Dernières mises à jour » sur la landing (M5). Rendu UNIQUEMENT quand
 * `platform.publicSite` est ON (décidé par l'appelant `LandingContent`), donc
 * absent en production. Robuste par conception : rend `null` tant qu'il n'y a
 * pas de note publiée (chargement / erreur / liste vide) → n'invente aucun
 * contenu et ne casse jamais la landing.
 */
export function LatestUpdates() {
  const query = useQuery({
    queryKey: ["updates", "landing-preview"],
    queryFn: () => api<ReleaseNotesListResponse>("/api/updates?pageSize=3"),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const items = query.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="latest-updates-title" className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-300">
            Produit vivant
          </div>
          <h2 id="latest-updates-title" className="font-display text-2xl font-semibold tracking-[-0.01em] text-zinc-50">
            Dernières mises à jour
          </h2>
        </div>
        <Link to="/updates" className="shrink-0 text-sm font-medium text-indigo-400 hover:underline">
          Tout voir →
        </Link>
      </div>

      <ul className="mt-6 space-y-3">
        {items.map((note) => (
          <li key={note.slug}>
            <Link
              to={`/updates/${note.slug}`}
              className="flex flex-col gap-1 rounded-xl border border-(--border) bg-zinc-900/60 p-4 transition-colors hover:border-indigo-500/40 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-zinc-100">{note.title}</span>
                {note.summary && <span className="mt-0.5 block truncate text-sm text-zinc-500">{note.summary}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-zinc-500">
                {note.version && <Badge tone="neutral">v{note.version}</Badge>}
                <time dateTime={note.publishedAt}>{formatUpdateDate(note.publishedAt)}</time>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
