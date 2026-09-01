import {
  SCORE_ANCHOR,
  aggregatePositions,
  paramsHash,
  scoreWallet,
  type AggregatedPosition,
  type ScorablePosition,
} from '@kalibra/core';
import {
  listScores,
  loadMarketResolutions,
  loadTradesForAggregation,
  replaceCalibrationBins,
  upsertPosition,
  upsertScore,
  type KalibraDatabase,
} from '@kalibra/db';

/**
 * Aggregation and scoring, ordered per SCORING_SPEC.md section 7.
 *
 * This file moves rows and calls pure functions; it does no arithmetic of its own
 * (ARCHITECTURE.md section 3.3). Everything it writes is a function of what is already in
 * the database plus the `computedAt` it is handed, so two runs over the same rows produce
 * identical output.
 */

export interface PipelineOptions {
  /** Injected, never read from a clock here, so a rerun is byte-identical. */
  readonly computedAt: number;
}

export interface PipelineSummary {
  readonly positionsWritten: number;
  readonly positionsScored: number;
  readonly positionsExcluded: number;
  readonly walletsSeen: number;
  readonly walletsRanked: number;
  readonly paramsHash: string;
}

export function runPipeline(db: KalibraDatabase, options: PipelineOptions): PipelineSummary {
  const hash = paramsHash();
  const positions = aggregatePositions(loadTradesForAggregation(db), loadMarketResolutions(db));

  const scorableByWallet = new Map<string, ScorablePosition[]>();
  const excludedByWallet = new Map<string, number>();
  for (const position of positions) {
    if (!scorableByWallet.has(position.wallet)) scorableByWallet.set(position.wallet, []);
    if (position.excludedReason !== null || position.outcomeY === null) {
      excludedByWallet.set(position.wallet, (excludedByWallet.get(position.wallet) ?? 0) + 1);
      continue;
    }
    scorableByWallet.get(position.wallet)?.push(toScorable(position));
  }

  const lambdaByPosition = new Map<string, { lambda: number; forecast: number }>();
  let walletsRanked = 0;

  for (const wallet of [...scorableByWallet.keys()].sort()) {
    const scorable = scorableByWallet.get(wallet) ?? [];
    const { metrics, positions: scored } = scoreWallet(scorable);
    for (const position of scored) {
      lambdaByPosition.set(position.positionId, {
        lambda: position.lambda,
        forecast: position.forecast,
      });
    }
    if (metrics.status === 'RANKED') walletsRanked += 1;

    upsertScore(db, {
      wallet,
      n: metrics.n,
      bsTrader: metrics.bsTrader,
      bsMarket: metrics.bsMarket,
      bss: metrics.bss,
      bssShrunk: metrics.bssShrunk,
      eceTrader: metrics.eceTrader,
      eceMarket: metrics.eceMarket,
      eceExcess: metrics.eceExcess,
      auc: metrics.auc,
      score: metrics.score,
      scoreInternal: internalScore(metrics.scoreInternal),
      status: metrics.status,
      excludedCount: excludedByWallet.get(wallet) ?? 0,
      paramsHash: hash,
      computedAt: options.computedAt,
    });
    replaceCalibrationBins(
      db,
      wallet,
      metrics.calibration.map((bin) => ({
        binIndex: bin.bin,
        count: bin.count,
        meanForecast: bin.meanForecast,
        observedFreq: bin.observedFrequency,
      })),
    );
  }

  for (const position of positions) {
    const scoring = lambdaByPosition.get(position.positionId);
    upsertPosition(db, {
      ...position,
      lambda: scoring?.lambda ?? null,
      forecast: scoring?.forecast ?? null,
      rawP: Number.isFinite(position.rawP) ? position.rawP : position.p,
    });
  }

  return {
    positionsWritten: positions.length,
    positionsScored: lambdaByPosition.size,
    positionsExcluded: positions.length - lambdaByPosition.size,
    walletsSeen: scorableByWallet.size,
    walletsRanked,
    paramsHash: hash,
  };
}

/**
 * `scores.score_internal` is NOT NULL in API_SPEC.md section 1, but core returns null when
 * a wallet has no scored positions at all — absence of evidence is not evidence of
 * absence. The anchor is used for that case, and it is not a fabricated measurement: with
 * n = 0 the published formula evaluates to exactly SCORE_ANCHOR, because shrunk skill is
 * zero and excess calibration error is zero. It is never published — `score` stays null
 * and `status` stays PROVISIONAL — so no reader can mistake it for a result.
 */
function internalScore(scoreInternal: number | null): number {
  return scoreInternal ?? SCORE_ANCHOR;
}

/** Every wallet gets a row, so the leaderboard's coverage is auditable. */
export function scoreCount(db: KalibraDatabase): number {
  return listScores(db).length;
}

function toScorable(position: AggregatedPosition): ScorablePosition {
  if (position.outcomeY === null || position.settledAt === null) {
    throw new Error(`position ${position.positionId} is not scoreable`);
  }
  return {
    positionId: position.positionId,
    side: position.side,
    p: position.p,
    stake: position.netStake,
    y: position.outcomeY,
    settledAt: position.settledAt,
  };
}
