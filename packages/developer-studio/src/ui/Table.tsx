import type { ReactNode } from "react";

/** Dense table primitives + pager — extracted verbatim from App (M12). */

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-zinc-500">
            {headers.map((h) => (
              <th key={h} className="px-2 py-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children }: { children: ReactNode }) {
  return <td className="px-2 py-1.5 font-mono text-xs text-zinc-300">{children}</td>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-zinc-500">
      <span>Page {page} sur {totalPages} · {total} résultats</span>
      <div className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded border border-zinc-700 px-2 py-1 disabled:opacity-40">Précédent</button>
        <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="rounded border border-zinc-700 px-2 py-1 disabled:opacity-40">Suivant</button>
      </div>
    </div>
  );
}
