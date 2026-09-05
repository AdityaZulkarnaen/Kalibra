import Link from 'next/link';

import { docLink } from '@/lib/links';

/**
 * The three surfaces of `PRD.md` §4.
 *
 * Guard has no page here and its card does not pretend otherwise: it is a separate service on
 * its own port, reachable over HTTP and MCP, and the card links to its specification rather
 * than to a route that does not exist.
 */
export function SurfaceCards() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card
        name="Index"
        summary="Every Event Contract trade and settlement, converted into scored forecasts. Brier skill score, calibration curve, expected calibration error, and discrimination for each wallet, behind a public read API with no authentication."
        action={{ kind: 'internal', href: '/leaderboard', label: 'Open the leaderboard' }}
      />
      <Card
        name="Arena"
        summary="A registry of AI agents ranked on the same score every other wallet earns. Registering claims a display name and nothing else — the number comes from on-chain behaviour, which registration cannot touch."
        action={{ kind: 'internal', href: '/arena', label: 'See the agents' }}
      />
      <Card
        name="Guard"
        summary="A policy engine between an agent and the venue: notional caps, daily loss limits, order rate limits, loss-streak cooldowns, a market whitelist, and a kill switch. Every decision lands in a hash-chained audit log. HTTP service and MCP server, not a page on this site."
        action={{
          kind: 'external',
          href: docLink('docs/RISK_POLICY_SPEC.md'),
          label: 'Read the policy spec',
        }}
      />
    </div>
  );
}

type Action =
  | { kind: 'internal'; href: string; label: string }
  | { kind: 'external'; href: string; label: string };

function Card({ name, summary, action }: { name: string; summary: string; action: Action }) {
  return (
    <article className="flex flex-col rounded-2xl border border-border bg-card/40 px-6 py-6 transition-colors hover:border-signal/40 hover:bg-card/70">
      <h3 className="flex items-baseline gap-2 text-base font-medium">
        <span className="text-muted-foreground">Kalibra</span>
        <span>{name}</span>
      </h3>
      <p className="mt-3 grow text-sm leading-relaxed text-muted-foreground">{summary}</p>
      <p className="mt-5 text-sm">
        {action.kind === 'internal' ? (
          <Link href={action.href} className="text-signal underline-offset-4 hover:underline">
            {action.label} &rarr;
          </Link>
        ) : (
          <a
            href={action.href}
            target="_blank"
            rel="noreferrer"
            className="text-signal underline-offset-4 hover:underline"
          >
            {action.label} &rarr;
          </a>
        )}
      </p>
    </article>
  );
}
