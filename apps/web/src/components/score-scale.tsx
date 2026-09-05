import { SCORE_BANDS } from '@/lib/band';

/**
 * The whole 0–1000 range with its five interpretation bands, and the anchor marked.
 *
 * `PRD.md` §2 calls the anchoring "the product": 500 is not a midpoint chosen for looks, it is
 * the score of a trader who forecast exactly what the order book already said. Drawing the
 * scale is the shortest way to say that.
 */

/** Low to high, so the bar reads left to right the way the axis under it does. */
const ASCENDING = [...SCORE_BANDS].reverse();

export function ScoreScale({
  marker,
  bands = true,
}: {
  /** A published score to place on the scale. Omitted where there is nothing to place. */
  marker?: number;
  /** The legend. Off where a band label already sits beside the number. */
  bands?: boolean;
}) {
  return (
    <div>
      <div className="flex h-2.5 gap-px overflow-hidden rounded-full">
        {ASCENDING.map((band) => (
          <div
            key={band.id}
            className={`${band.fill} opacity-75`}
            style={{ flexGrow: band.ceiling - band.floor + 1 }}
          />
        ))}
      </div>

      <div className="relative mt-2 h-5">
        <Tick at={0} label="0" />
        <Tick at={0.5} label="500" emphasis />
        <Tick at={1} label="1000" />
        {marker !== undefined && (
          <span
            className="absolute -top-[17px] size-2.5 -translate-x-1/2 rounded-full border-2 border-background bg-foreground"
            style={{ left: `${marker / 10}%` }}
            aria-hidden="true"
          />
        )}
      </div>

      {bands && (
        <dl className="mt-5 divide-y divide-border/60 border-y border-border/60">
          {SCORE_BANDS.map((band) => (
            <div key={band.id} className="flex items-baseline gap-4 py-2.5">
              <dt className={`w-24 shrink-0 font-mono text-xs tabular-nums ${band.text}`}>
                {band.floor}&ndash;{band.ceiling}
              </dt>
              <dd className="text-sm text-muted-foreground">{band.label}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Tick({ at, label, emphasis }: { at: number; label: string; emphasis?: boolean }) {
  return (
    <span
      className={`absolute -translate-x-1/2 font-mono text-[11px] tabular-nums ${
        emphasis ? 'text-foreground' : 'text-muted-foreground'
      }`}
      style={{ left: `${at * 100}%` }}
    >
      {label}
    </span>
  );
}
