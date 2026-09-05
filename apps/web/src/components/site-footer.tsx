import { docLink, REPO_URL } from '@/lib/links';

/**
 * `PRD.md` §6 lists what this project deliberately does not do. Saying so here is cheaper than
 * a reader looking for a connect-wallet button that was never going to exist.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-x-10 gap-y-6 px-6 py-10">
        <div className="max-w-md">
          <p className="text-sm font-medium">Kalibra</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            A calibration and reputation layer for DreamDEX Event Contracts. The read surface is
            public and anonymous: no accounts, no wallet login, no token, no points.
          </p>
        </div>
        <nav className="flex gap-x-12 gap-y-2 text-sm">
          <ul className="space-y-2">
            <li>
              <FooterLink href={REPO_URL}>Source</FooterLink>
            </li>
            <li>
              <FooterLink href={docLink('README.md')}>Real vs mocked</FooterLink>
            </li>
          </ul>
          <ul className="space-y-2">
            <li>
              <FooterLink href={docLink('docs/SCORING_SPEC.md')}>Scoring spec</FooterLink>
            </li>
            <li>
              <FooterLink href={docLink('docs/API_SPEC.md')}>API spec</FooterLink>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
    >
      {children}
    </a>
  );
}
