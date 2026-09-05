# Hero footage

Put an mp4 at `hero.mp4` in this directory and restart the web server to play it over the
landing hero. Nothing here is required: with no file, `src/lib/hero-video.ts` finds nothing,
the `<video>` element is never rendered, and the hero runs on the calibration field that
`src/components/hero-backdrop.tsx` draws to a canvas.

The video is a background behind live text. It should be muted and loopable — it is played
with `autoplay loop muted playsinline` and no controls — and dark enough that the headline
stays legible over it, since the page keeps its dark theme either way.

No video file is committed. The repository builds and runs offline without one, which is
invariant I3 in `CLAUDE.md`.
