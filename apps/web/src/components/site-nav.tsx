'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * "Which page am I on" is a fact the server does not have when the header is a shared layout,
 * and a nav that cannot answer it leaves a reader to work out where they are from the heading
 * alone. That is what makes this a client component, along with `site-header.tsx`, which needs
 * the same answer, and `hero-backdrop.tsx`, which drives a canvas.
 */
const LINKS = [
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/arena', label: 'Arena' },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 text-sm">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'rounded-md bg-secondary px-3 py-1.5 font-medium text-secondary-foreground'
                : 'rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground'
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
