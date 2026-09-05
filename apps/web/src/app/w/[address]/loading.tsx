import { HeaderSkeleton, TableSkeleton } from '@/components/skeleton';

/**
 * The profile is a score card and a calibration chart rather than a list, so the square that
 * stands in for the chart is the point: reserving its real footprint is what stops the page
 * from jumping when the curve arrives.
 */
export default function Loading() {
  return (
    <main>
      <HeaderSkeleton />
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-6">
          <div className="h-28 animate-pulse rounded-lg bg-muted-foreground/12 motion-reduce:animate-none" />
          <TableSkeleton rows={6} />
        </div>
        <div
          className="h-[444px] w-[460px] max-w-full animate-pulse rounded-lg bg-muted-foreground/12 motion-reduce:animate-none"
          aria-hidden="true"
        />
      </div>
      <span className="sr-only" role="status">
        Loading
      </span>
    </main>
  );
}
