import { useMemo, useState, type ReactNode } from "react";
import type { NavIconName } from "../../components/NavIcon.js";
import { EmptyState } from "../EmptyState.js";
import { Pager } from "../Table.js";
import { ActionMenu, type ActionItem } from "./ActionMenu.js";

export type MobileRole = "title" | "badge" | "secondary" | "meta" | "hidden";

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /** When set, the column header is a sort control keyed on this value. */
  sort?: (row: T) => string | number;
  /** Placement inside the mobile card; undefined → collapsible details. */
  mobile?: MobileRole;
  minWidth?: number;
}

export interface FilterDef<T> {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  test: (row: T, value: string) => boolean;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowId: (row: T) => string;
  /** Concatenated searchable text for a row (client-side, page-scoped). */
  search?: (row: T) => string;
  searchPlaceholder?: string;
  filters?: FilterDef<T>[];
  /** Row action items for the "…" menu (already permission-filtered). */
  actions?: (row: T) => ActionItem[];
  pager?: { page: number; pageSize: number; total: number; onPage: (page: number) => void };
  /** True when data is one server page → filters/search apply to that page only. */
  pageScoped?: boolean;
  empty: { icon: NavIconName; title: string; description?: string };
  toolbarExtra?: ReactNode;
}

const alignClass = { left: "text-left", right: "text-right", center: "text-center" } as const;

export function DataTable<T>({
  rows,
  columns,
  rowId,
  search,
  searchPlaceholder = "Rechercher…",
  filters = [],
  actions,
  pager,
  pageScoped = false,
  empty,
  toolbarExtra,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" } | null>(null);

  const activeFilterCount = Object.values(filterValues).filter(Boolean).length + (query.trim() ? 1 : 0);

  const derived = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter((row) => {
      if (q && search && !search(row).toLowerCase().includes(q)) return false;
      for (const f of filters) {
        const v = filterValues[f.id];
        if (v && !f.test(row, v)) return false;
      }
      return true;
    });
    if (sort) {
      const col = columns.find((c) => c.id === sort.id);
      if (col?.sort) {
        const sortFn = col.sort;
        out = [...out].sort((a, b) => {
          const av = sortFn(a);
          const bv = sortFn(b);
          const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "fr");
          return sort.dir === "asc" ? cmp : -cmp;
        });
      }
    }
    return out;
    // columns/filters/search are stable per page; only inputs below drive recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, filterValues, sort]);

  const reset = () => {
    setQuery("");
    setFilterValues({});
    setSort(null);
  };

  const toggleSort = (id: string) => {
    setSort((cur) => {
      if (!cur || cur.id !== id) return { id, dir: "asc" };
      if (cur.dir === "asc") return { id, dir: "desc" };
      return null;
    });
  };

  const titleCol = columns.find((c) => c.mobile === "title");
  const badgeCols = columns.filter((c) => c.mobile === "badge");
  const metaCol = columns.find((c) => c.mobile === "meta");
  const secondaryCols = columns.filter((c) => c.mobile === "secondary");
  const detailCols = columns.filter((c) => !c.mobile);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {search && (
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 sm:max-w-xs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4 shrink-0 text-zinc-500" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label="Rechercher"
              className="w-full min-w-0 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            />
          </div>
        )}
        {filters.map((f) => (
          <label key={f.id} className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span className="hidden sm:inline">{f.label}</span>
            <select
              value={filterValues[f.id] ?? ""}
              onChange={(e) => setFilterValues((cur) => ({ ...cur, [f.id]: e.target.value }))}
              aria-label={f.label}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200"
            >
              <option value="">Tous</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        ))}
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
          >
            Réinitialiser
            <span className="grid min-w-4 place-items-center rounded-full bg-indigo-600 px-1 text-[10px] text-white">{activeFilterCount}</span>
          </button>
        )}
        <div className="ml-auto text-xs text-zinc-500">
          {toolbarExtra}
          <span className="ml-2">
            {pager ? `${derived.length} affiché${derived.length > 1 ? "s" : ""} · ${pager.total} au total` : `${derived.length} résultat${derived.length > 1 ? "s" : ""}`}
          </span>
        </div>
      </div>

      {pageScoped && activeFilterCount > 0 && (
        <p className="text-[11px] text-zinc-500">Recherche et filtres appliqués à la page courante uniquement.</p>
      )}

      {/* Data / empty */}
      {rows.length === 0 ? (
        <EmptyState icon={empty.icon} title={empty.title} description={empty.description} />
      ) : derived.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-10 text-center">
          <p className="text-sm text-zinc-400">Aucun résultat pour ces critères.</p>
          <button type="button" onClick={reset} className="mt-3 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800">
            Réinitialiser les filtres
          </button>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs uppercase text-zinc-500">
                  {columns.map((c) => {
                    const isSorted = sort?.id === c.id;
                    const ariaSort = isSorted ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
                    return (
                      <th
                        key={c.id}
                        scope="col"
                        aria-sort={c.sort ? ariaSort : undefined}
                        style={c.minWidth ? { minWidth: c.minWidth } : undefined}
                        className={`px-2 py-2 font-medium ${alignClass[c.align ?? "left"]}`}
                      >
                        {c.sort ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(c.id)}
                            className="inline-flex items-center gap-1 uppercase hover:text-zinc-300"
                          >
                            {c.header}
                            <span aria-hidden="true" className="text-zinc-600">{isSorted ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                          </button>
                        ) : (
                          c.header
                        )}
                      </th>
                    );
                  })}
                  {actions && <th scope="col" className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {derived.map((row) => (
                  <tr key={rowId(row)} className="border-b border-zinc-800/70 hover:bg-zinc-800/40">
                    {columns.map((c) => (
                      <td key={c.id} className={`px-2 py-2 align-middle ${alignClass[c.align ?? "left"]}`}>
                        {c.cell(row)}
                      </td>
                    ))}
                    {actions && (
                      <td className="px-2 py-2 text-right align-middle">
                        <ActionMenu items={actions(row)} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="flex flex-col gap-2 lg:hidden">
            {derived.map((row) => (
              <div key={rowId(row)} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <div className="flex items-start gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">{badgeCols.map((c) => <span key={c.id}>{c.cell(row)}</span>)}</div>
                  <div className="ml-auto flex items-center gap-1">
                    {metaCol && <span className="text-[11px] text-zinc-500">{metaCol.cell(row)}</span>}
                    {actions && <ActionMenu items={actions(row)} />}
                  </div>
                </div>
                {titleCol && <div className="mt-1.5 text-sm font-medium text-zinc-100">{titleCol.cell(row)}</div>}
                {secondaryCols.map((c) => (
                  <div key={c.id} className="mt-1 flex items-center justify-between gap-3 text-xs">
                    <span className="shrink-0 text-zinc-500">{c.header}</span>
                    <span className="min-w-0 truncate text-right text-zinc-300">{c.cell(row)}</span>
                  </div>
                ))}
                {detailCols.length > 0 && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer select-none text-zinc-500">Plus de détails</summary>
                    <div className="mt-1.5 space-y-1">
                      {detailCols.map((c) => (
                        <div key={c.id} className="flex items-center justify-between gap-3">
                          <span className="shrink-0 text-zinc-500">{c.header}</span>
                          <span className="min-w-0 truncate text-right text-zinc-300">{c.cell(row)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {pager && <Pager page={pager.page} pageSize={pager.pageSize} total={pager.total} onPage={pager.onPage} />}
    </div>
  );
}
