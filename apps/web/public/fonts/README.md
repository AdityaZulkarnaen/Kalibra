# Display face

Put a variable `woff2` at `display.woff2` in this directory and restart the web server to set
the landing page's headings in it. Nothing here is required: with no file,
`src/lib/display-font.ts` finds nothing, no `@font-face` rule is emitted, and the
`--font-display` stack in `globals.css` falls through to the system serif behind it.

The face is used for the landing hero, the dawn statement and the section headings — nothing
else on the site. Everything on the boards stays in the UI sans, so a missing file changes the
character of one page and breaks nothing.

Two requirements. It has to be a single variable file covering weights 300–700 upright, because
that is what the emitted rule declares, and it has to be a file this repository is licensed to
redistribute, because it is committed rather than fetched.

No font file is committed. `next build` and `pnpm demo` download nothing, which is invariant I3
in `CLAUDE.md`; a face fetched from a font CDN at build time would break it, which is why this
directory is a drop slot rather than an import.
