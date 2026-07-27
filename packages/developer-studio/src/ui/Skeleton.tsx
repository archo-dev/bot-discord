import { Table, Td } from "./Table.js";

/** Base shimmer block (Lot 4). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-zinc-800 ${className ?? ""}`} />;
}

/** Table placeholder reusing the real Table chrome, so headers stay in context. */
export function TableSkeleton({ headers, rows = 6 }: { headers: string[]; rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <Table headers={headers}>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r} className="border-t border-zinc-800">
            {headers.map((_h, c) => (
              <Td key={c}>
                <Skeleton className="h-3.5" />
              </Td>
            ))}
          </tr>
        ))}
      </Table>
    </div>
  );
}

/** Grid of card placeholders. */
export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div aria-busy="true" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <Skeleton className="size-8" />
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Form placeholder (label + field pairs). */
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div aria-busy="true" className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

/** Detail-panel placeholder (title + rows of key/value). */
export function DetailSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <Skeleton className="h-5 w-40" />
      <div className="space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex justify-between gap-6">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3.5 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
