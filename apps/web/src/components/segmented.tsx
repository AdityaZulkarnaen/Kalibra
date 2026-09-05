import Link from 'next/link';

/** A two-way filter. The active leg is filled so the current view is readable at a glance. */
export function Segmented({ children }: { children: React.ReactNode }) {
  return (
    <nav className="flex items-center gap-1 rounded-lg border border-border bg-card/40 p-1 text-sm">
      {children}
    </nav>
  );
}

export function SegmentedLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'rounded-md bg-secondary px-3 py-1.5 font-medium text-secondary-foreground'
          : 'rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground'
      }
    >
      {children}
    </Link>
  );
}
