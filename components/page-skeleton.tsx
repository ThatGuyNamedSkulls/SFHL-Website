/**
 * Loading placeholders (docs/PERFORMANCE_PLAN.md step 8): shown the moment a
 * league or team page is opened, while its data loads on the server.
 */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-white/[0.06] ${className}`} />;
}

/** A league tab: a filter row, a few cards, and a table. */
export function LeagueTabSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Bar className="h-10 w-56" />
        <Bar className="h-12 w-full max-w-md" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Bar className="h-20" />
        <Bar className="h-20" />
        <Bar className="hidden h-20 xl:block" />
      </div>
      <div className="space-y-2 rounded-xl border border-white/[0.08] bg-[#121212] p-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Bar key={i} className="h-9" />
        ))}
      </div>
    </div>
  );
}

/** The team page: banner, name row, tabs and two columns. */
export function TeamPageSkeleton() {
  return (
    <div className="hl-page space-y-5" aria-busy="true" aria-label="Loading">
      <Bar className="h-4 w-20" />
      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d0d0d]">
        <Bar className="aspect-[7/2] w-full rounded-none" />
        <div className="flex items-end gap-4 px-4 pb-4 sm:px-7">
          <Bar className="-mt-12 h-24 w-24 rounded-full" />
          <div className="flex-1 space-y-2 pb-1">
            <Bar className="h-7 w-64" />
            <Bar className="h-5 w-48" />
          </div>
        </div>
        <div className="flex gap-6 border-t border-white/[0.06] px-4 py-3 sm:px-7">
          <Bar className="h-5 w-20" />
          <Bar className="h-5 w-14" />
          <Bar className="h-5 w-16" />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Bar className="h-80" />
        <Bar className="h-64" />
      </div>
    </div>
  );
}
