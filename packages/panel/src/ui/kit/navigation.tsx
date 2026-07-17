import type { KeyboardEvent, ReactNode } from "react";

/* Kit Nocturne — navigation : Tabs ARIA (v2 §3), TableWrap, Pagination (v2 §4.8). */

/* --- Onglets in-page — pattern ARIA Tabs complet (D.S. v2 §3) : rôles + flèches ←/→ --- */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: ReactNode }[];
  active: T;
  onChange: (id: T) => void;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === active);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
    onChange(next.id);
    const el = e.currentTarget.querySelector<HTMLElement>(`[data-tab-id="${next.id}"]`);
    el?.focus();
  };
  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className="no-scrollbar -mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-zinc-800 px-4 sm:mx-0 sm:px-0"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          data-tab-id={t.id}
          aria-selected={active === t.id}
          tabIndex={active === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] transition lg:py-2 ${
            active === t.id
              ? "border-indigo-500 font-semibold text-white"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* --- Conteneur de table : défilement horizontal sur mobile --- */
export function TableWrap({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <table className={`w-full min-w-[34rem] text-sm ${className}`}>{children}</table>
    </div>
  );
}

/* --- v2 §4.8 Pagination --- */
const pgArrow =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40";

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total?: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-3 text-[13px] text-zinc-400">
      <span style={{ fontFeatureSettings: '"tnum" 1' }}>
        {total != null && (
          <>
            <span className="font-semibold text-zinc-300">{total}</span> résultat{total > 1 ? "s" : ""} ·{" "}
          </>
        )}
        page {page}/{totalPages}
      </span>
      <button
        type="button"
        aria-label="Page précédente"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className={pgArrow}
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="Page suivante"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        className={pgArrow}
      >
        ›
      </button>
    </div>
  );
}
