'use client';

import { useEffect, useRef } from 'react';

import { docLink } from '@/lib/links';
import { drift, driftTarget, lerp, presence, scrollProgress } from '@/lib/parallax';

/**
 * The landing page's second screen: the argument the score exists to settle, delivered over a
 * sky that moves as the reader scrolls.
 *
 * Everything drawn here is geometry — a gradient, one arc, two banks of fog, a horizon line.
 * Nothing on it plots a number, which matters on a page whose first screen has to caption its
 * backdrop as schematic: there is no curve here for a reader to mistake for somebody's record.
 *
 * The motion is deliberately the only authored moment below the hero. Sections further down
 * hold still, so this one carries the page's single change of light.
 */

/** How far the arc travels across the section, in pixels, from entry to exit. */
const ARC_FROM = 130;
const ARC_TO = -170;

/** How far each fog bank waits beyond its own edge before it slides in. */
const FOG_TRAVEL = 260;

/** Progress the banks arrive at and leave by. Outside this the section is not the subject. */
const FOG_ENTRY = 0.12;
const FOG_EXIT = 0.92;

/** Per-frame smoothing. The arc is the heavier body and lags further behind the scroll. */
const ARC_EASE = 0.06;
const FOG_EASE = 0.045;

/** One resting frame for a reader who asked for less motion: the section at its own middle. */
const STILL_PROGRESS = 0.5;

export function DawnSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const arcRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const arc = arcRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    if (section === null || arc === null || left === null || right === null) return;

    const place = (arcY: number, leftX: number, rightX: number, fogY: number) => {
      arc.style.transform = `translate3d(0, ${arcY.toFixed(2)}px, 0)`;
      left.style.transform = `translate3d(${leftX.toFixed(2)}px, ${fogY.toFixed(2)}px, 0)`;
      right.style.transform = `translate3d(${rightX.toFixed(2)}px, ${fogY.toFixed(2)}px, 0)`;
      left.style.opacity = presence(leftX, FOG_TRAVEL).toFixed(3);
      right.style.opacity = presence(rightX, FOG_TRAVEL).toFixed(3);
    };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      place(drift(STILL_PROGRESS, ARC_FROM, ARC_TO), 0, 0, STILL_PROGRESS * -50);
      return;
    }

    // The rendered position, which chases the scroll rather than tracking it exactly. Seeded
    // off-screen so the banks have an arrival to show on the first scroll through.
    let arcY = ARC_FROM;
    let leftX = -FOG_TRAVEL;
    let rightX = FOG_TRAVEL;
    let frame = 0;

    const tick = () => {
      const rect = section.getBoundingClientRect();
      const progress = scrollProgress(rect.top, rect.height, window.innerHeight);

      arcY = lerp(arcY, drift(progress, ARC_FROM, ARC_TO), ARC_EASE);
      leftX = lerp(leftX, driftTarget(progress, FOG_ENTRY, FOG_EXIT, -FOG_TRAVEL), FOG_EASE);
      rightX = lerp(rightX, driftTarget(progress, FOG_ENTRY, FOG_EXIT, FOG_TRAVEL), FOG_EASE);

      // The banks lift as the section passes, so the sky does not read as one rigid plate.
      place(arcY, leftX, rightX, progress * -50);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // Reading the section's rectangle every frame while it is nowhere near the screen is a
    // forced layout for nothing. The same guard the hero canvas uses, for the same reason.
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting === false) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (frame === 0) {
        frame = requestAnimationFrame(tick);
      }
    });
    observer.observe(section);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      aria-labelledby="dawn-statement"
      className="relative flex min-h-[44rem] flex-col justify-center overflow-hidden sm:min-h-svh"
    >
      <Sky />

      <div
        ref={arcRef}
        className="pointer-events-none absolute inset-x-0 top-0 z-10 will-change-transform"
        aria-hidden="true"
      >
        <Arc />
      </div>

      {/*
       * The banks overflow their own edge by design: a fog bank that fits inside the viewport
       * has a visible end, and the end is the thing that gives away that it is a shape.
       */}
      <FogBank ref={leftRef} className="-left-[18%] bottom-[12%] h-[19rem] w-[36rem]" />
      <FogBank
        ref={rightRef}
        className="-right-[22%] bottom-[19%] h-[21rem] w-[42rem] [&>div]:scale-x-[-1]"
      />

      <Horizon />

      <div className="relative z-20 mx-auto w-full max-w-4xl px-6 pt-24 pb-40 sm:pt-28 sm:pb-52">
        <h2
          id="dawn-statement"
          className="display-glow font-display text-2xl leading-[1.32] font-normal tracking-[-0.015em] text-balance text-white sm:text-3xl md:text-4xl lg:text-[2.75rem] lg:leading-[1.28]"
        >
          A profit-and-loss leaderboard can only see the balance. Ranked by profit, capital outranks
          judgement, and the trader who was wrong loudly and got paid outranks the one who was right
          quietly.
        </h2>

        <p className="mt-7 max-w-2xl text-sm leading-relaxed text-white/85 sm:text-base sm:leading-relaxed">
          Calibration reads the other half of the record: whether the probabilities a wallet
          revealed were better than the ones the book was already quoting. Conviction is measured
          against that wallet&rsquo;s own trailing stakes, so the answer arrives on one scale for a
          wallet holding ten dollars and a wallet holding ten million.
        </p>

        <Counterweight />
      </div>
    </section>
  );
}

/**
 * The sky: the ramp, the light under the horizon, and a scrim over the half of it the
 * statement is read on.
 *
 * The ramp ends on `--background` rather than on its brightest stop, so the luminous band
 * lands at four fifths of the height and the ground below it hands the reader back to the dark
 * page with no seam left for a scrim to hide.
 */
function Sky() {
  return (
    <div
      className="absolute inset-0 bg-[linear-gradient(to_bottom,var(--dawn-night)_0%,var(--dawn-deep)_30%,var(--dawn-mid)_56%,var(--dawn-rise)_74%,var(--dawn-horizon)_84%,var(--background)_100%)]"
      aria-hidden="true"
    >
      {/* First light, low and centred: the source the horizon band is lit by. */}
      <div className="absolute inset-0 bg-[radial-gradient(60%_36%_at_50%_88%,oklch(0.95_0.05_198/0.5),transparent_72%)]" />
      {/* Night is not evenly dark. Cornering the top keeps the display type off a flat field. */}
      <div className="absolute inset-0 bg-[radial-gradient(80%_55%_at_18%_0%,oklch(0.1_0.03_265/0.75),transparent_70%)]" />
      {/*
       * The statement is set over the stretch of ramp that is already climbing toward the
       * horizon, and white body text on it would fall under 4.5:1 unweighted. This holds that
       * half down and releases before the horizon band, so the light stays where it is the point.
       */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,oklch(0.12_0.03_255/0.5)_0%,oklch(0.12_0.03_255/0.42)_46%,transparent_74%)]" />
    </div>
  );
}

/**
 * The arc of light bending over the section — the layer that moves furthest as the page
 * scrolls, and the reason the sky reads as depth rather than as a painted backdrop.
 *
 * Two strokes on one path. The wide blurred one is the light; the hairline over it is what
 * keeps the result a drawn edge instead of a smudge, which is the difference between a
 * deliberate effect and a glow filter left on.
 */
function Arc() {
  return (
    <svg
      viewBox="0 0 1200 520"
      preserveAspectRatio="xMidYMin slice"
      className="h-[34rem] w-full sm:h-[40rem]"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="dawn-arc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="oklch(0.8 0.09 205)" stopOpacity="0" />
          <stop offset="28%" stopColor="oklch(0.86 0.08 200)" stopOpacity="0.5" />
          <stop offset="52%" stopColor="oklch(0.95 0.05 196)" stopOpacity="0.78" />
          <stop offset="76%" stopColor="oklch(0.86 0.08 200)" stopOpacity="0.42" />
          <stop offset="100%" stopColor="oklch(0.8 0.09 205)" stopOpacity="0" />
        </linearGradient>
        <filter id="dawn-arc-soft" x="-10%" y="-40%" width="120%" height="220%">
          <feGaussianBlur stdDeviation="34" />
        </filter>
      </defs>

      <path
        d="M -140 470 Q 600 -110 1340 470"
        fill="none"
        stroke="url(#dawn-arc)"
        strokeWidth="78"
        strokeLinecap="round"
        filter="url(#dawn-arc-soft)"
      />
      <path
        d="M -140 470 Q 600 -110 1340 470"
        fill="none"
        stroke="url(#dawn-arc)"
        strokeWidth="1.25"
        strokeOpacity="0.55"
      />
    </svg>
  );
}

/**
 * One bank of fog. The wrapper is what the parallax transform is written to; the child owns
 * the blur, so the expensive filter is rasterised once and only its position changes.
 */
function FogBank({ ref, className }: { ref: React.Ref<HTMLDivElement>; className: string }) {
  return (
    <div
      ref={ref}
      className={`pointer-events-none absolute z-10 hidden opacity-0 will-change-transform sm:block ${className}`}
      aria-hidden="true"
    >
      <div className="fog-mass size-full" />
    </div>
  );
}

/** The line the light sits on. Faded at both ends, so it reads as distance and not as a rule. */
function Horizon() {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-[16%] z-10 h-px bg-[linear-gradient(to_right,transparent,oklch(0.97_0.03_198/0.55)_30%,oklch(0.97_0.03_198/0.55)_70%,transparent)]"
      aria-hidden="true"
    />
  );
}

/**
 * What the statement above deliberately does not say, in the words of the document that says
 * it. `PRD.md` §8 is a non-goal, and the page that argues calibration beats profit as a
 * measure of skill is the exact place a reader could take it for a claim about profit.
 */
function Counterweight() {
  return (
    <figure className="mt-10 max-w-2xl border-t border-white/25 pt-5">
      <blockquote className="text-sm leading-relaxed text-white/90">
        &ldquo;Kalibra does <strong className="font-medium text-white">not</strong> claim to
        identify profitable traders. Calibration and profitability are different properties; a
        well-calibrated trader can lose money through poor sizing, and a badly calibrated one can
        profit through luck or favourable fills.&rdquo;
      </blockquote>
      <figcaption className="mt-3 font-mono text-[11px] tracking-[0.14em] text-white/70 uppercase">
        <a
          href={docLink('docs/PRD.md')}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-4 transition-colors hover:text-white hover:underline"
        >
          docs/PRD.md &sect;8 &mdash; non-goals for the score itself
        </a>
      </figcaption>
    </figure>
  );
}
