import type { Metadata } from 'next';

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { displayFontFace, displayFontSrc } from '@/lib/display-font';

import './globals.css';

/** Where this instance is served from, so link previews can carry absolute URLs. */
const siteUrl = process.env['KALIBRA_SITE_URL'] ?? 'http://127.0.0.1:3000';

/**
 * No webfont is fetched over the network. `next/font/google` downloads at build time, which
 * would mean an offline clone cannot build the app — the same failure invariant I3 rules out
 * for the demo. The system stack costs nothing and keeps the build hermetic.
 *
 * The landing page's display face is the one exception, and it is not an exception to the
 * invariant: `public/fonts/README.md` describes a file committed to the repository, served
 * from our own origin, and absent by default.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Kalibra',
  description: 'Calibration index for DreamDEX event contracts on Somnia',
  openGraph: {
    title: 'Kalibra',
    description:
      'PnL leaderboards measure capital and luck. Kalibra scores DreamDEX Event Contract positions as probabilistic forecasts, anchored so 500 means exactly as good as the market.',
    siteName: 'Kalibra',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Kalibra',
    description:
      'A calibration and reputation layer for DreamDEX Event Contracts on Somnia. Scored on forecasting skill, not profit.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const displayFont = displayFontSrc();

  return (
    <html lang="en" className="dark">
      {displayFont !== null && (
        <style href="kalibra-display" precedence="default">
          {displayFontFace(displayFont)}
        </style>
      )}
      <body className="flex min-h-screen flex-col bg-background font-sans text-foreground antialiased">
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
