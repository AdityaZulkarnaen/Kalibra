import type { Metadata } from 'next';

import { SiteHeader } from '@/components/site-header';

import './globals.css';

/**
 * No webfont is fetched. `next/font/google` downloads at build time, which would mean an
 * offline clone cannot build the app — the same failure invariant I3 rules out for the
 * demo. The system stack costs nothing and keeps the build hermetic.
 */
export const metadata: Metadata = {
  title: 'Kalibra',
  description: 'Calibration index for DreamDEX event contracts on Somnia',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
