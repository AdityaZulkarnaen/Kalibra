/**
 * A titled band of the landing page: what it is about, why, then the thing itself.
 *
 * Two layouts, because five consecutive bands of heading-then-box read as one long list and
 * flatten the difference between an argument, a walkthrough, and a set of links. `split` puts
 * the prose in a column that stays put while the content beside it scrolls, which suits a
 * section whose content is one wide figure; `stack` suits content that needs the full width.
 *
 * The headings are set in the display serif the hero uses. It is the only thread that carries
 * the top of the page into the argument below it, and it is what stops the reader arriving at
 * the first section feeling they have left the site they just looked at.
 */
export function Section({
  title,
  lead,
  layout = 'stack',
  children,
}: {
  title: string;
  lead: string;
  layout?: 'stack' | 'split';
  children: React.ReactNode;
}) {
  if (layout === 'split') {
    return (
      <section className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Heading title={title} lead={lead} />
        </div>
        <div className="min-w-0">{children}</div>
      </section>
    );
  }

  return (
    <section>
      <Heading title={title} lead={lead} wide />
      <div className="mt-10">{children}</div>
    </section>
  );
}

function Heading({ title, lead, wide }: { title: string; lead: string; wide?: boolean }) {
  return (
    <>
      <h2
        className={`font-display text-[1.75rem] leading-[1.2] font-normal tracking-[-0.015em] text-balance sm:text-4xl ${
          wide === true ? 'max-w-3xl' : ''
        }`}
      >
        {title}
      </h2>
      <p
        className={`mt-4 text-sm leading-relaxed text-muted-foreground ${
          wide === true ? 'max-w-2xl' : ''
        }`}
      >
        {lead}
      </p>
    </>
  );
}
