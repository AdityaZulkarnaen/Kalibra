import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-4 gap-y-2 px-6 py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Kalibra
        </Link>
        <p className="text-sm text-muted-foreground">
          Calibration index for DreamDEX event contracts on Somnia
        </p>
        <nav className="ml-auto flex items-baseline gap-4 text-sm">
          <Link href="/" className="text-muted-foreground hover:text-foreground">
            Leaderboard
          </Link>
          <Link href="/arena" className="text-muted-foreground hover:text-foreground">
            Arena
          </Link>
        </nav>
      </div>
    </header>
  );
}
