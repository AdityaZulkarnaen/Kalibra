import Link from 'next/link';

import { CalibrationGlyph } from '@/components/calibration-mark';
import { DawnSection } from '@/components/dawn-section';
import { EvidenceTable } from '@/components/evidence-table';
import { HeroBackdrop } from '@/components/hero-backdrop';
import { LandingStats } from '@/components/landing-stats';
import { ScoreScale } from '@/components/score-scale';
import { ScoringWalkthrough } from '@/components/scoring-walkthrough';
import { Section } from '@/components/section';
import { SurfaceCards } from '@/components/surface-cards';

/**
 * The landing page.
 *
 * Two full screens open it — the field at night, then the argument at dawn — and the sections
 * under them hold still. That is deliberate: the page has one change of light in it, and
 * spending it twice would leave the reader scrolling through weather instead of an argument.
 *
 * The prose here is static and the counters are not: `LandingStats` reads `/v1/stats` on every
 * request and says so on the page. Nothing here states a quantity written down in this
 * repository except the scoring constants and the committed test vector, and both name their
 * source where they appear. The evidence table is the README's own, held to it by a test.
 */
export const dynamic = 'force-dynamic';

export default function LandingPage() {
  return (
    <main>
      <Hero />
      <DawnSection />

      <div className="mx-auto max-w-6xl px-6 pb-28">
        {/* Lifted over the seam, so the counters read as the first claim of fact after the sky. */}
        <div className="relative z-20 -mt-20">
          <LandingStats />
        </div>

        <div className="mt-28 space-y-28">
          <Section
            layout="split"
            title="500 is not a midpoint. It is the market."
            lead="A trader who quotes exactly what the order book already says scores 500. Everything above it is information the book did not have; everything below it is noise. Anchoring the scale to the market rather than to a population of traders is what makes one wallet's score comparable to another's."
          >
            <div className="rounded-2xl border border-border bg-card/40 p-6 sm:p-8">
              <ScoreScale />
            </div>
          </Section>

          <div className="rule-fade" />

          <Section
            title="From a position to a score"
            lead="An Event Contract position is a claim that the market's probability is wrong, in a stated direction, with money behind it. That is a forecast, and forecasts have been scorable since Brier described how in 1950."
          >
            <ScoringWalkthrough />
          </Section>

          <div className="rule-fade" />

          <Section
            title="Why volume cannot buy a score"
            lead="Each property below falls out of the arithmetic rather than out of a rule somebody has to enforce."
          >
            <dl className="grid gap-x-10 gap-y-9 md:grid-cols-3">
              <Property title="Wash trading converges to 500">
                Trading both sides of one market means one of the two positions is wrong by
                construction. The pair pulls the score back toward the null value it started at.
                Volume buys sample size, not skill.
              </Property>
              <Property title="Dust is not scored">
                A position below the minimum stake is excluded and counted as excluded, so a
                thousand one-cent trades cannot manufacture a track record.
              </Property>
              <Property title="Small samples are shrunk">
                Measured skill is multiplied by n / (n + 25) before it reaches the score, and
                nothing under thirty resolved positions is ranked at all.
              </Property>
            </dl>
          </Section>

          <div className="rule-fade" />

          <Section
            title="An index, a competition, and a risk envelope"
            lead="One score, consumed three ways."
          >
            <SurfaceCards />
          </Section>

          <div className="rule-fade" />

          <Section
            title="What is real here, and what is not"
            lead="Every component of Kalibra with the grade of evidence behind it, reproduced from the README and held to it by a test that fails if the two disagree. Most of this system runs on generated data, and the table says so before anything else on this page can imply otherwise."
          >
            <EvidenceTable />
          </Section>
        </div>
      </div>
    </main>
  );
}

/**
 * The first screen: the calibration field at full bleed, with the mechanism stated over it.
 *
 * Nothing sits above the headline. A label there would be read before the sentence it labels,
 * and the sentence is the whole offer — the two facts a reader needs are in the rail along the
 * bottom, where they are found after the claim rather than in front of it.
 *
 * The ground is the top of the same sky the next screen finishes. It starts on the page's own
 * black, so the header has something to match, and arrives at `--dawn-night` exactly where the
 * dawn section's ramp begins — which is why there is no scrim along the bottom edge and no
 * seam for one to hide. The two screens are one night, and the light only comes up once.
 */
function Hero() {
  return (
    <section className="relative -mt-(--header-h) flex min-h-[max(42rem,calc(100svh+var(--header-h)))] flex-col overflow-hidden bg-[linear-gradient(to_bottom,var(--background)_0%,var(--background)_34%,var(--dawn-night)_100%)]">
      <HeroBackdrop />

      {/*
       * Two layers over the field. The vignette keeps contrast behind the headline wherever the
       * animation happens to be bright and settles the field into the ground at every edge; the
       * top one sinks it under the header, in the page's black rather than the sky's.
       */}
      <div
        className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(ellipse_at_50%_44%,transparent_4%,var(--dawn-night)_90%)] opacity-80"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-56 bg-linear-to-b from-background via-background/70 to-transparent"
        aria-hidden="true"
      />

      <div className="relative z-20 mx-auto flex w-full max-w-5xl grow flex-col items-center justify-center px-6 pt-[calc(var(--header-h)+4rem)] pb-32 text-center">
        <h1
          className="rise display-glow max-w-4xl font-display text-[clamp(2.35rem,6.2vw,5.5rem)] leading-[1.04] font-normal tracking-[-0.025em] text-balance"
          style={{ animationDelay: '0.05s' }}
        >
          The price is already a forecast. A position disputes it.
        </h1>

        <p
          className="rise mt-8 max-w-2xl text-base leading-relaxed text-balance text-muted-foreground"
          style={{ animationDelay: '0.18s' }}
        >
          Kalibra scores every DreamDEX Event Contract position against the price the book was
          quoting when it was taken, and publishes one number per wallet &mdash; anchored so that
          500 means exactly as good as the market.
        </p>

        <div
          className="rise mt-10 flex flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: '0.3s' }}
        >
          <Link
            href="/leaderboard"
            className="rounded-full bg-foreground px-7 py-3.5 text-sm font-medium text-background shadow-[0_2px_28px_oklch(0.9_0.04_200/0.28)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-signal"
          >
            Open the index
          </Link>
          <Link
            href="/arena"
            className="rounded-full border border-white/20 bg-white/5 px-7 py-3.5 text-sm font-medium backdrop-blur-md transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-signal"
          >
            Agent arena
          </Link>
        </div>
      </div>

      <HeroRail />
    </section>
  );
}

/**
 * The strip along the bottom of the hero.
 *
 * The left half is not decoration. The backdrop draws a calibration field, and a reader who is
 * not told otherwise may reasonably take an animated curve for somebody's record.
 */
function HeroRail() {
  return (
    <div
      className="rise relative z-20 mx-auto w-full max-w-6xl px-6 pb-9"
      style={{ animationDelay: '0.42s' }}
    >
      <div className="rule-fade" />
      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/15">
            <CalibrationGlyph className="size-4" />
          </span>
          <p className="text-xs leading-snug text-muted-foreground">
            Schematic field
            <br />
            not a wallet&rsquo;s record
          </p>
        </div>

        <p className="flex items-center gap-2.5 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
          DreamDEX Event Contracts &middot; Somnia Shannon testnet
        </p>
      </div>
    </div>
  );
}

function Property({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-5">
      <dt className="text-sm font-medium">{title}</dt>
      <dd className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{children}</dd>
    </div>
  );
}
