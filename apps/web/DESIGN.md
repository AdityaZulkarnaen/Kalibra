---
name: Kalibra
description: A calibration index read as an instrument at night, opening on one sunrise.
colors:
  background: 'oklch(0.145 0 0)'
  foreground: 'oklch(0.985 0 0)'
  card: 'oklch(0.205 0 0)'
  muted-foreground: 'oklch(0.708 0 0)'
  border: 'oklch(1 0 0 / 10%)'
  signal: 'oklch(0.78 0.14 195)'
  band-strong: 'oklch(0.8 0.15 165)'
  band-edge: 'oklch(0.78 0.13 195)'
  band-market: 'oklch(0.9 0 0)'
  band-noise: 'oklch(0.8 0.13 75)'
  band-worse: 'oklch(0.7 0.17 25)'
  dawn-night: 'oklch(0.16 0.045 255)'
  dawn-deep: 'oklch(0.28 0.075 240)'
  dawn-mid: 'oklch(0.45 0.085 218)'
  dawn-rise: 'oklch(0.63 0.09 202)'
  dawn-horizon: 'oklch(0.84 0.075 196)'
typography:
  display:
    fontFamily: "'Kalibra Display', ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif"
    fontSize: 'clamp(2.35rem, 6.2vw, 5.5rem)'
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: '-0.025em'
  headline:
    fontFamily: "'Kalibra Display', ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif"
    fontSize: 'clamp(1.5rem, 3.4vw, 2.75rem)'
    fontWeight: 400
    lineHeight: 1.28
    letterSpacing: '-0.015em'
  title:
    fontFamily: "'Kalibra Display', ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif"
    fontSize: '2.25rem'
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: '-0.015em'
  body:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: '0.6875rem'
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: '0.14em'
rounded:
  md: '0.5rem'
  lg: '0.625rem'
  '2xl': '1.125rem'
  full: '9999px'
spacing:
  gutter: '1.5rem'
  stack: '1.75rem'
  section: '7rem'
components:
  button-primary:
    backgroundColor: '{colors.foreground}'
    textColor: '{colors.background}'
    typography: '{typography.body}'
    rounded: '{rounded.full}'
    padding: '0.875rem 1.75rem'
  button-glass:
    backgroundColor: 'rgb(255 255 255 / 0.05)'
    textColor: '{colors.foreground}'
    typography: '{typography.body}'
    rounded: '{rounded.full}'
    padding: '0.875rem 1.75rem'
  button-glass-hover:
    backgroundColor: 'rgb(255 255 255 / 0.10)'
  surface-card:
    backgroundColor: '{colors.card}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.2xl}'
    padding: '1.5rem'
  stat-cell:
    backgroundColor: 'oklch(0.145 0 0 / 0.8)'
    textColor: '{colors.foreground}'
    padding: '1.5rem 1.25rem'
---

# Design System: Kalibra

<!-- Written from the built world, not ahead of it. Values here are read out of
     `src/app/globals.css` and the components that consume them; where this file and the code
     disagree, the code is right and this file is stale. -->

## Overview

**Creative north star: the instrument at night.** Kalibra publishes one number per wallet and
the number only means anything next to the sentence that says 500 is the market's own forecast.
So the surface is a dark measuring room: near-black ground, hairlines instead of boxes, one cyan
that is reserved for measurement, and numbers set in a face that lines them up.

The landing page is the one room in the building with a window. It opens on the calibration
field at night, passes through a single sunrise, and returns to instrument black for the
argument. That sunrise is the whole motion budget: one change of light, spent once, and every
section under it holds still.

The voice is governed by `CLAUDE.md` §6 and it binds the visuals too. Nothing on the surface may
overstate what the system has. The evidence table is on the landing page rather than behind a
link for that reason, and the hero backdrop carries a caption saying it plots nobody's record.

Anti-reference: the SaaS marketing page — eyebrow label, hero metric, three icon cards, a
gradient on the heading. None of those appear, and the eyebrow in particular is gone from the
landing page on purpose.

## Colors

Strategy: **restrained**. Neutrals plus one accent, and the accent has a job rather than a
placement. Dark is not a default here: the shipped theme is dark, pinned by `.dark` on `<html>`
in `layout.tsx`, and the whole palette is authored for it.

### Primary

- **Signal Cyan** (`oklch(0.78 0.14 195)`): every measurement mark and nothing else — the
  calibration curve, the site mark's off-diagonal dot, `LIVE` in the evidence table, the live
  indicator in the hero rail, and links that lead to a document. Restricting it to measurement
  is what keeps it meaningful; using it as a general "brand blue" would spend it.

### Neutral

- **Instrument Black** (`oklch(0.145 0 0)`): the page ground, and the last stop of the dawn
  gradient so the sky can hand the reader back to it without a scrim.
- **Panel** (`oklch(0.205 0 0)`): raised surfaces, always at partial alpha (`bg-card/40`) so the
  ground reads through and a card never becomes a lid.
- **Hairline** (`oklch(1 0 0 / 10%)`): the only structural line in the system. Sections are
  separated by these, not by boxes.

### Tertiary — the five interpretation bands

`band-strong` / `band-edge` / `band-market` / `band-noise` / `band-worse` are the ranges of
`docs/SCORING_SPEC.md` §6.2, and they are data, not decoration. The scale **diverges from
`band-market`** — a neutral grey — rather than running warm to cool, because 500 is the metric's
null value and colouring it as good would contradict the anchor the product is built on. These
five never appear outside a score context.

### The dawn ramp

`dawn-night` → `dawn-deep` → `dawn-mid` → `dawn-rise` → `dawn-horizon`, used by exactly one
component. Every stop sits on the same hue arc as the signal (196–255) rather than on a generic
sky blue, which is what makes the second screen read as this product at a different hour instead
of as stock photography. The ramp is defined outside the theme blocks: the section is dark in
both themes because the page is.

Contrast rule that survives redesign: white body copy over the ramp needs help above roughly
`dawn-mid`. The sky carries a reading scrim over its upper 74% for exactly that reason, and the
statement block is padded off the horizon band rather than centred into it.

## Typography

Two families, both resolved from the system stack, plus one optional file.

- **Display** — a serif, used for the hero headline, the dawn statement, and every landing
  section heading. It is the only face on the site that is not the UI sans, and that difference
  is what carries the landing page's change of room. `--font-display` names an optional
  self-hosted face first (`public/fonts/display.woff2`, absent by default) and falls through to
  `ui-serif, Georgia` when no file is present. No webfont is ever fetched: invariant I3 requires
  the build to work offline.
- **Sans** — the UI voice everywhere else. Boards, tables, navigation, body copy.
- **Mono** — measured values, module paths, evidence grades, and axis labels. Never a costume
  for "technical": if it is set in mono it is a number, a path, or a fixed vocabulary word.

Scale: display `clamp(2.35rem, 6.2vw, 5.5rem)`; dawn statement `1.5rem` to `2.75rem`; section
heading `1.75rem` to `2.25rem`; body `0.875rem` to `1rem`; label `0.6875rem` at `0.14em`–`0.18em`
tracking, uppercase. Display tracking never goes past `-0.025em`. Headings and hero copy carry
`text-balance`; body measure stays inside `max-w-2xl` / `max-w-3xl`.

## Layout

- Container `max-w-6xl` with a `1.5rem` gutter for everything below the fold; the two opening
  screens run full bleed.
- Vertical rhythm between landing sections is `7rem`, closed by a `rule-fade` hairline that
  fades out at both ends rather than a full-width border.
- Two full-viewport screens open the page: the hero at
  `max(42rem, 100svh + var(--header-h))` — it pulls itself up under the floating header by the
  header's exact height — and the dawn section at `min-h-svh` from the `sm` breakpoint up.
- The header is `sticky`, chromeless over the landing hero and glass once there is page behind
  it. It is never `fixed`: the rest of the site needs it in flow.
- The counters strip is lifted `-5rem` over the seam where the sky meets the page, so the first
  hard fact stands on the ground under that sky.
- Responsive behaviour is what Tailwind gives for free, by product constraint. Two exceptions
  are deliberate: the fog banks are hidden below `sm`, and long module paths in the evidence
  table break inside the word rather than pushing a phone into a sideways scroll.

## Elevation & Depth

The system is **flat and layered**, not lifted. Depth comes from tonal separation and hairlines;
a shadow appears in exactly one place.

- Elevation is declared once per element — a border or a shadow, never both.
- The one shadow is on the counters strip (`shadow-2xl shadow-black/50`), which is the only
  element that overlaps another surface and needs to say so.
- Glass is used where it is doing a job and nowhere else: the header over moving footage, the
  secondary hero button, and the counters strip lifted over the sky. It is a legibility device
  here, not a material.
- The dawn section builds depth out of parallax rate instead: the arc travels 300px across the
  section, the fog banks 260px in from their own edges, and the sky does not move at all.

## Shapes

- Radii: `0.625rem` base, `1.125rem` on panels, fully round on small controls. Pills are for
  buttons and status dots only; a pill-shaped container is a mistake.
- The recurring form is the **field**: a square plot with a dashed 45° diagonal across it. It is
  the favicon, the wordmark glyph, the hero backdrop, and the profile chart, and it is the
  reason the calibration chart's plot area is pinned square — the diagonal only means perfect
  calibration when both axes are scaled alike.
- Every decorative layer on the landing page is geometry: gradients, one quadratic arc, three
  offset radial gradients per fog bank, a hairline horizon. No illustration, no texture, no
  noise filter.

## Components

- **button-primary** — a `foreground`-on-`background` pill. One per screen, and on the hero it
  carries a soft cyan-tinted shadow because it sits over moving footage.
- **button-glass** — the secondary action: a hairline border over 5% white with a backdrop blur.
- **surface-card** — `bg-card/40` with a hairline. Cards are containers of last resort here;
  most sections are a heading, a lead, and content on the bare ground.
- **stat-cell** — a counter in a four-up strip, `80%` opaque over a backdrop blur, separated by
  1px gaps that show the strip's hairline colour through.
- **status label** — mono, uppercase, `0.14em` tracking. `LIVE` alone takes the signal colour
  and a filled dot; the other three grades are muted. Colouring all four would make the page's
  most important distinction the least visible thing on it.
- **rule-fade** — the section divider. A 1px gradient that fades at both ends.
- Focus is visible on every interactive element: a 2px signal outline at 3px offset.
- Browser surfaces are themed rather than left at their defaults — selection sits at 30% signal,
  the caret is signal, and the scrollbar thumb is 22% foreground on a transparent track.

## Motion

- One authored moment below the hero: the dawn section's scroll parallax, driven by a single
  `requestAnimationFrame` loop that writes `translate3d` to three layers and eases each toward
  its target by a per-frame fraction. The arithmetic lives in `src/lib/parallax.ts` and is
  tested; the component only measures and writes.
- The hero opens on a staggered `rise` (14px, 0.75s, `cubic-bezier(0.22, 1, 0.36, 1)`, delays
  0.05s to 0.42s). Nothing below the two opening screens animates on entry.
- Every loop stops when its section leaves the viewport, via `IntersectionObserver`.
- `prefers-reduced-motion` removes all of it. CSS animation is disabled by media query; the two
  JavaScript-driven layers check `matchMedia` themselves, render one settled frame, and never
  open a loop.

## Do's and Don'ts

- **Do** put the limitation next to the number. The evidence table is on the landing page and
  the hero says its backdrop is schematic; that is the house register, not a disclaimer.
- **Do** keep the signal cyan for measurement. If it is not measuring something, it is grey.
- **Do** state elevation once. A hairline under a wide soft shadow is a ghost card.
- **Don't** add an eyebrow or a kicker above a heading anywhere on the landing page. They were
  removed deliberately.
- **Don't** fetch a font, an image, or a video over the network. Invariant I3 makes the build
  hermetic, and every asset slot in this app is a committed file or nothing.
- **Don't** put a number on a decorative layer. Anything drawn rather than measured has to be
  incapable of being read as a wallet's record, or captioned where it appears.
- **Don't** spend the motion budget twice. One change of light per page.
- **Don't** reach for a card. Most content here belongs on the ground with a hairline over it.
