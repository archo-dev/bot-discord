import type { ReactNode } from "react";

/** En-tête canonique d'une page autonome ou d'une section de premier niveau. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 font-display text-eyebrow font-semibold uppercase tracking-[0.16em] text-indigo-300">{eyebrow}</div>}
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-zinc-100 sm:text-[26px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-body leading-relaxed text-zinc-400">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Barre commune pour recherche, filtres et actions de liste. */
export function Toolbar({ children, actions, className = "" }: { children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 rounded-xl border border-zinc-800/90 bg-(--surface-1) p-2.5 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">{children}</div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Affiche une table sur écran large et son équivalent compact sur mobile. */
export function ResponsiveData({ table, cards }: { table: ReactNode; cards: ReactNode }) {
  return (
    <>
      <div className="hidden sm:block">{table}</div>
      <div className="space-y-2 sm:hidden">{cards}</div>
    </>
  );
}
