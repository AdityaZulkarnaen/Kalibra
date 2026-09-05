/**
 * The banded heading every page except the landing page opens with.
 *
 * It runs full-bleed and pulls itself up behind the site header, so a data page starts the way
 * the hero does rather than beginning at an arbitrary offset below a bar. The measurement grid
 * is the same one the hero backdrop draws, at low contrast: enough to carry the identity across
 * routes, not enough to compete with a table.
 */
export function PageHeader({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <PageBand>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div>
          <p className="font-mono text-[11px] tracking-[0.18em] text-signal uppercase">{eyebrow}</p>
          <h1 className="mt-2.5 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <div className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {children}
          </div>
        </div>
        {actions}
      </div>
    </PageBand>
  );
}

/** The band itself, for pages whose heading is not an eyebrow and a title. */
export function PageBand({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative -mt-(--header-h) overflow-hidden border-b border-border">
      <div
        className="field-grid pointer-events-none absolute inset-0 opacity-30 mask-[radial-gradient(ellipse_at_25%_0%,black,transparent_78%)]"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-6 pt-[calc(var(--header-h)+3.5rem)] pb-10">
        {children}
      </div>
    </div>
  );
}
