/**
 * How a position becomes a score, traced on real numbers.
 *
 * Every figure here is vector V3 of `docs/SCORING_SPEC.md` §8, which `packages/core` is tested
 * against on each run. Illustrating the pipeline with invented numbers would have been easier
 * and would have made this the one part of the site that cannot be checked.
 */

interface Step {
  readonly symbol: string;
  readonly name: string;
  readonly body: string;
  readonly value: string;
}

const STEPS: readonly Step[] = [
  {
    symbol: 'p',
    name: 'The market’s forecast',
    body: 'The mid of the book when the position was taken, read as a probability. Not the fill price — that would mix forecasting skill with execution quality.',
    value: '0.60 · 0.50 · 0.40 · 0.55',
  },
  {
    symbol: 'λ',
    name: 'Conviction',
    body: 'How large the stake was against the wallet’s own recent p90 stake, capped at LAMBDA_MAX. Sizing is the only evidence of confidence a position leaves behind.',
    value: '0.5 on all four',
  },
  {
    symbol: 'f',
    name: 'The trader’s forecast',
    body: 'Move p toward the certainty the position implies, by fraction λ of the distance left. λ = 0 leaves f = p, which scores exactly zero skill — the correct null.',
    value: '0.80 · 0.75 · 0.20 · 0.275',
  },
  {
    symbol: 'BS',
    name: 'Brier score',
    body: 'Mean squared error of the forecast against what happened, for the trader and for the market over the very same positions.',
    value: 'trader 0.16703125 · market 0.193125',
  },
  {
    symbol: 'BSS',
    name: 'Brier skill score',
    body: '1 − BS_trader / BS_market. Above zero means the deviations from market price carried information; below zero means they were noise.',
    value: '0.13511326860841422',
  },
  {
    symbol: '×n/(n+k)',
    name: 'Shrinkage',
    body: 'Pull toward zero by sample size, k = 25. Four positions keep 14% of the measured skill. This is what stops three lucky trades topping the board.',
    value: '0.018636312911505408',
  },
  {
    symbol: '=',
    name: 'Kalibra Score',
    body: '500 + 1500 × BSS_shrunk − 100 × ECE_excess, rounded and clamped to 0–1000.',
    value: '527.9544693672581 → 528',
  },
];

export function ScoringWalkthrough() {
  return (
    <div>
      {/*
       * A rail rather than a grid of boxes. Each step consumes the one above it, and a two-column
       * grid of equal cards says the opposite — that these are seven parallel facts.
       */}
      <ol className="relative border-l border-border">
        {STEPS.map((step, index) => {
          const last = index === STEPS.length - 1;
          return (
            <li key={step.symbol} className="relative pb-9 pl-7 last:pb-0 sm:pl-9">
              <span
                className={`absolute top-1.5 -left-[4.5px] size-2 rounded-full ring-4 ring-background ${
                  last ? 'bg-signal' : 'bg-border'
                }`}
                aria-hidden="true"
              />
              <div className="grid gap-x-10 gap-y-2 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
                <div>
                  <h3 className="flex items-baseline gap-2.5">
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="font-mono text-base text-signal">{step.symbol}</span>
                    <span className="text-sm font-medium">{step.name}</span>
                  </h3>
                  <p className="mt-2 font-mono text-xs break-words tabular-nums text-foreground/80">
                    {step.value}
                  </p>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        Those are the four positions of test vector V3 in{' '}
        <code className="text-xs">docs/SCORING_SPEC.md</code> §8, asserted against{' '}
        <code className="text-xs">packages/core</code> by <code className="text-xs">pnpm test</code>
        . Note what the index would actually publish for this wallet:{' '}
        <strong className="font-medium text-foreground">nothing</strong>. Four positions is below
        the thirty-position minimum, so it reads <code className="text-xs">PROVISIONAL</code> and
        the 528 is withheld. It is shown here to trace the arithmetic, not as a rank.
      </p>
    </div>
  );
}
