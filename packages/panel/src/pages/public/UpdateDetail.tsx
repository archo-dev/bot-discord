import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReleaseNoteDetail } from "@bot/shared";
import { api, ApiError } from "../../lib/api.js";
import { useDocumentMeta } from "../../lib/seo.js";
import { Badge, Button, EmptyState, ErrorCard } from "../../ui/kit.js";
import { Skeleton } from "../../ui/skeleton.js";
import { CHANGE_TYPE_LABELS, CHANGE_TYPE_TONE, formatUpdateDate } from "./updates-format.js";

/*
 * Page publique /updates/:slug (M5) — détail d'une note PUBLIÉE (lien
 * partageable). Route lazy. Un slug non publié/inconnu → 404 côté Worker →
 * état « introuvable » ici (aucune fuite d'existence). Un seul <main>/<h1>.
 */
export function UpdateDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const query = useQuery({
    queryKey: ["updates", "detail", slug],
    queryFn: () => api<ReleaseNoteDetail>(`/api/updates/${encodeURIComponent(slug)}`),
    retry: false,
  });

  useDocumentMeta({
    title: query.data ? `${query.data.title} — Mises à jour — Archodev` : "Mise à jour — Archodev",
    description: query.data?.summary ?? undefined,
  });

  const notFound = query.isError && query.error instanceof ApiError && query.error.status === 404;

  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <Link to="/updates" className="text-sm font-medium text-indigo-400 hover:underline">
        ← Toutes les mises à jour
      </Link>

      <div className="mt-6">
        {query.isPending ? (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        ) : notFound ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
            }
            title="Note introuvable"
            description="Cette note de mise à jour n'existe pas ou n'est pas publique."
            action={<Button href="/updates" variant="secondary" size="sm">Retour aux mises à jour</Button>}
          />
        ) : query.isError ? (
          <ErrorCard
            message="Impossible de charger cette mise à jour — réessayez plus tard."
            onRetry={() => void query.refetch()}
          />
        ) : (
          <article>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <time dateTime={query.data.publishedAt}>{formatUpdateDate(query.data.publishedAt)}</time>
              {query.data.version && <Badge tone="neutral">v{query.data.version}</Badge>}
            </div>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.02em] text-zinc-50">{query.data.title}</h1>
            {query.data.summary && <p className="mt-3 text-base leading-relaxed text-zinc-400">{query.data.summary}</p>}

            {query.data.bodyMd && (
              <div className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{query.data.bodyMd}</div>
            )}

            {query.data.sections.length > 0 && (
              <div className="mt-8 space-y-6">
                {query.data.sections.map((section) => (
                  <section key={section.type} aria-labelledby={`sec-${section.type}`}>
                    <h2 id={`sec-${section.type}`} className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${CHANGE_TYPE_TONE[section.type]}`}>
                        {CHANGE_TYPE_LABELS[section.type]}
                      </span>
                    </h2>
                    <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-zinc-400">
                      {section.items.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </article>
        )}
      </div>
    </main>
  );
}
