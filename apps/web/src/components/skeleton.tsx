import { PageBand } from '@/components/page-header';

/**
 * What a data route shows while its server render is in flight.
 *
 * Every page under `/leaderboard`, `/arena` and `/w/:address` is `force-dynamic` and fetches
 * from the API before it can return a byte, so without a `loading.tsx` a click is a blank
 * pending navigation for however long that takes. Next.js streams this in its place.
 *
 * It deliberately shows shape and not numbers. A skeleton that guessed at a rank or a score
 * would be fabricated data on a read surface, which principle 4 of `PRODUCT.md` rules out even
 * for the few hundred milliseconds nobody is meant to read.
 */
function Bar({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-muted-foreground/12 motion-reduce:animate-none ${className}`}
    />
  );
}

/** The banded heading, as a shape. Mirrors `PageHeader`'s eyebrow, title and lede. */
export function HeaderSkeleton() {
  return (
    <PageBand>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="w-full">
          <Bar className="h-3 w-28" />
          <Bar className="mt-3 h-9 w-64" />
          <Bar className="mt-4 h-4 w-full max-w-xl" />
        </div>
      </div>
    </PageBand>
  );
}

/** A table of `rows` placeholder lines, under a header rule. */
export function TableSkeleton({ rows = 12 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      <Bar className="h-3 w-40" />
      <div className="mt-6 border-t border-border">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-6 border-b border-border/60 py-3.5">
            <Bar className="h-4 w-6 shrink-0" />
            <Bar className="h-4 w-44 shrink-0" />
            <Bar className="ml-auto h-4 w-16 shrink-0" />
            <Bar className="hidden h-4 w-14 shrink-0 sm:block" />
            <Bar className="hidden h-4 w-14 shrink-0 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The whole of a list route: heading band, then a table. */
export function ListPageSkeleton({ rows = 12 }: { rows?: number }) {
  return (
    <main>
      <HeaderSkeleton />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <TableSkeleton rows={rows} />
      </div>
      <span className="sr-only" role="status">
        Loading
      </span>
    </main>
  );
}
