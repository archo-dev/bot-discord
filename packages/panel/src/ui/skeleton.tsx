/*
 * Skeletons « Nocturne 2 » (docs/design_system_v2.md §4.4).
 * Règle d'or : reproduire la géométrie de l'état final — zéro layout shift.
 */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div data-skeleton className={`skeleton ${className}`} aria-hidden="true" />;
}

/** Rangée de 4 cartes KPI (Dashboard). */
export function SkeletonStatRow() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="min-h-[132px] rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-3.5 w-24" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Liste de lignes dans une carte (mod-actions, tickets, commandes…). */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-white/5" aria-busy="true" aria-label="Chargement du contenu">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  );
}

/** Carte de section avec champs (pages de réglages). */
export function SkeletonFormCard({ fields = 2 }: { fields?: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5" aria-busy="true" aria-label="Chargement des réglages">
      <Skeleton className="h-4 w-44" />
      <Skeleton className="mt-2 h-3 w-72 max-w-full" />
      <div className="mt-5 space-y-4">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Page de réglages complète (empilement de cartes). */
export function SkeletonSettingsPage({ cards = 3 }: { cards?: number }) {
  return (
    <div className="max-w-2xl space-y-4" aria-busy="true" aria-label="Chargement de la page">
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonFormCard key={i} fields={i === 0 ? 1 : 2} />
      ))}
    </div>
  );
}

/** Dashboard dense complet : en-tête, 4 KPI, 3 aperçus et 4 cartes de pilotage. */
export function SkeletonDashboard() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Chargement du tableau de bord">
      <div className="flex min-h-[76px] items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/45 px-4 py-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>
      <SkeletonStatRow />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-12">
        {[5, 3, 4].map((span, index) => (
          <div
            key={`${span}-${index}`}
            className={`min-h-[390px] rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5 ${
              index === 2 ? "md:col-span-2" : ""
            } ${span === 5 ? "xl:col-span-5" : span === 3 ? "xl:col-span-3" : "xl:col-span-4"}`}
          >
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-3/4" />
            <div className="mt-5">
              <SkeletonList rows={3} />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="min-h-[286px] rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="mt-2 h-3 w-4/5" />
            <div className="mt-5">
              <SkeletonList rows={4} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Grille de cartes serveur (GuildList). */
export function SkeletonGuildGrid({ count = 4 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Chargement des serveurs">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </li>
      ))}
    </ul>
  );
}
