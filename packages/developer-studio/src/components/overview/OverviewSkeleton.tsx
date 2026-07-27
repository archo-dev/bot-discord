/** Loading placeholder for the Overview, mirroring its real layout (Lot 3). */
function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-zinc-800 ${className}`} />;
}

export function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      {/* Header */}
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="space-y-2">
          <Block className="h-6 w-56" />
          <Block className="h-4 w-72" />
        </div>
        <Block className="h-8 w-28" />
      </div>
      {/* Health strip */}
      <div className="mb-4 flex flex-wrap gap-8 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Block className="h-3 w-16" />
            <Block className="h-4 w-24" />
          </div>
        ))}
      </div>
      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <Block className="size-8" />
            <Block className="h-7 w-16" />
            <Block className="h-3 w-20" />
          </div>
        ))}
      </div>
      {/* Two columns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <Block className="h-4 w-40" />
          <Block className="h-10 w-full" />
          <Block className="h-10 w-full" />
        </div>
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <Block className="h-4 w-40" />
          <Block className="h-10 w-full" />
          <Block className="h-10 w-full" />
        </div>
      </div>
    </div>
  );
}
