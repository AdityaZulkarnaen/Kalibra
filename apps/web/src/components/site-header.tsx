'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { SiteNav } from '@/components/site-nav';

import mark from '../../public/icon/icon.png';

/**
 * The header sits over the landing hero rather than above it, so the backdrop starts at the
 * top of the viewport. It only earns a background once there is page behind it: on every route
 * except `/`, and on `/` as soon as the reader scrolls.
 *
 * That background is glass rather than a solid bar because of where the landing page goes
 * next. The second screen is a lit sky, and a bar opaque enough to look right over a table
 * would sit on it as a black slab.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const overHero = pathname === '/' && !scrolled;

  return (
    <header
      className={`sticky top-0 z-30 h-(--header-h) border-b transition-colors duration-300 ${
        overHero
          ? 'border-transparent bg-transparent'
          : 'border-border bg-background/70 backdrop-blur-xl'
      }`}
    >
      <div className="mx-auto flex h-full max-w-6xl items-center gap-x-4 px-6">
        <Link href="/" className="flex items-center gap-2.5">
          {/*
           * `width` and `height` are the rendered size, not the file's: without them Next has to
           * assume the mark could fill the viewport and builds a srcset up to 3840px wide, which
           * is a 1402×1122 source resampled to a poster to draw a 24px logo. The layout still
           * comes from `h-6 w-auto`, so the file's own aspect survives a future swap.
           *
           * `alt` is empty on purpose: the wordmark beside it already says Kalibra, and a screen
           * reader announcing the name twice for one link is worse than a mark it never mentions.
           */}
          <Image
            src={mark}
            alt=""
            priority
            width={30}
            height={24}
            className="h-6 w-auto shrink-0"
          />
          <span className="text-base font-semibold tracking-tight">Kalibra</span>
        </Link>
        <p
          className={`hidden text-sm text-muted-foreground transition-opacity duration-300 lg:block ${
            overHero ? 'opacity-0' : 'opacity-100'
          }`}
        >
          Calibration index for DreamDEX event contracts on Somnia
        </p>
        <div className="ml-auto">
          <SiteNav />
        </div>
      </div>
    </header>
  );
}
