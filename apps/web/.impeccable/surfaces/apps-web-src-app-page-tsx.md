---
version: 1
slug: "apps-web-src-app-page-tsx"
primary_target: "apps/web/src/app/page.tsx"
related_targets: []
---

## Scope

`apps/web/src/app/page.tsx` and the landing-only components it composes. Visitor mode:
Persuade. Leaderboard, Arena, profile and the shared header/footer keep their instrument
styling; only the landing page enters the world below.

## Audience and action

The agent builder and the hackathon judge, arriving cold. Action: open the index, or read
the scoring spec. Proof is the committed V3 vector, `/v1/stats` at request time, and the
README's real-vs-mocked table rendered on the page.

## Direction contract

THESIS: dusk-to-dawn observatory — the score is a reading taken at first light, and the
page moves through one sky to deliver it. Refuses the SaaS stack of eyebrow, hero metric
and three icon cards.

OWN-WORLD: near-black ground, one cyan `--signal`, a dawn ramp derived from that same hue.
Display voice is a large light serif against the existing UI sans; measured values stay
mono. Hairlines and full-bleed bands, no card grids.

STORY: a price is already a forecast, a position disputes it, and PnL cannot tell which
disputes carried information. Calibration can, on the same scale for every wallet.

FIRST VIEWPORT: full-bleed calibration field, chromeless header, serif headline at
clamp(2.5rem, 9vw, 6.75rem) centred and lifted above centre, one line of sub-copy, two pill
actions with the index primary, and a bottom rail carrying the schematic disclaimer.

FORM: brief-pinned by the user's reference (full-viewport video hero, glass nav, display
serif, pill CTAs, scroll-parallax statement section). No concept-seed roll: a pinned
direction beats it.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review,
the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Constraints

No webfont download and no external asset: invariant I3 keeps the build hermetic, so the
display face is a system serif with an optional self-hosted slot, and every parallax layer
is drawn in CSS/SVG. CLAUDE.md §6 requires the real-vs-mocked table to stay accurate, so
the rendered copy is asserted against README.md by a test rather than transcribed.

## Unresolved

Whether to commit a licensed display face to `public/fonts/`. Left to the owner; the
`@font-face` slot is wired and falls back silently when no file is present.

**The finish review is undischarged, and the reason is evidence, not judgement.** The session
that built this had no browser and no screenshot tool, so nobody has looked at the render. What
was verified instead: `pnpm verify` green (typecheck, lint, format, 489 tests, offline demo
byte-identical), a production `next build`, all five routes answering 200 with their content
present in the server-rendered HTML, every new Tailwind utility confirmed in the emitted CSS,
and one advisory detector finding on the pre-existing `.field-grid` class, which is a
measurement surface and earns it. The visual checks a capture would have settled — the dawn
gradient's contrast under real type, fog-bank silhouettes, the counters strip over the seam,
and the whole page at 375px — are open. Run the finish review with captures before treating
this surface as shipped.
