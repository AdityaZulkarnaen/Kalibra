import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-baseline gap-4 px-6 py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Kalibra
        </Link>
        <p className="text-sm text-muted-foreground">
          Calibration index for DreamDEX event contracts on Somnia
        </p>
      </div>
    </header>
  );
}
