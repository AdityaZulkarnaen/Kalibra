/**
 * `pnpm place-one` — send a single real order to Shannon and print its transaction hash.
 *
 * This is the proof behind the LIVE row in the README's real-vs-mocked table. The write path
 * had never run against the venue, only against documentation, so this exists to find out
 * whether it works before three agents depend on it.
 *
 * It rests a small post-only order rather than crossing. Testnet books are thin: an IOC with
 * nothing to cross would cancel and prove only that a transaction can be signed, whereas a
 * resting order that the pool accepts proves the price and size actually landed on the grid.
 *
 * Sends one order per invocation. Nothing here loops.
 */
import { LiveAdapter, SomniaWriter, addressForKey, readLiveTouch } from '@kalibra/adapter-dreamdex';

import { parseAgentKeys } from '../apps/guard/src/config.js';

const INDEXER_URL = process.env['DREAMDEX_INDEXER_URL'] ?? 'https://dev.smk.somnia.host/v1/graphql';

/** Gotcha 9: a window minutes from close can lock between the snapshot and the send. */
const MIN_HEADROOM_MS = 5 * 60 * 1000;

/** Small enough to be uninteresting, large enough to clear the venue's minimum. */
const STAKE = 5n * 10n ** 6n;

async function main(): Promise<void> {
  const keys = parseAgentKeys(process.env['GUARD_AGENT_KEYS'] ?? '');
  const first = [...keys][0];
  if (first === undefined) {
    console.log('GUARD_AGENT_KEYS is empty; nothing can be signed. See .env.example.');
    process.exitCode = 1;
    return;
  }
  const [agentId, privateKey] = first;
  console.log(`signing as ${agentId} (${await addressForKey(privateKey)})`);

  const reader = new LiveAdapter({ indexerUrl: INDEXER_URL, marketLimit: 50 });
  const now = Date.now();
  const open = (await reader.listMarkets())
    .filter((market) => market.status === 'OPEN' && market.windowEnd - now > MIN_HEADROOM_MS)
    .sort((a, b) => a.windowEnd - b.windowEnd);

  const market = open[0];
  if (market === undefined) {
    console.log('no open market with enough headroom right now; try again in a few minutes');
    process.exitCode = 1;
    return;
  }

  const minutes = Math.round((market.windowEnd - now) / 60000);
  console.log(`market  ${market.marketId}`);
  console.log(`        ${market.underlying}, closes in ${minutes} min`);

  // The live book from the contract, not the reconstruction getQuote returns. The
  // reconstruction is the mid at a past fill, which is what scoring wants and what pricing
  // must not use: the first order sent from here was refused PostOnlyWouldCross against a
  // book that had moved since the last trade.
  const touch = await readLiveTouch({ indexerUrl: INDEXER_URL }, market.marketId);
  console.log(
    `book    bid=${touch.bestBidUp ?? '-'} ask=${touch.bestAskUp ?? '-'} mid=${touch.midUp ?? '-'} (live)`,
  );

  // Rest strictly under the live ask so post-only cannot cross. With no ask at all, a price
  // near the middle is as good a guess as any and the order simply sits there.
  const tick = Number(touch.tickSize) / 10 ** touch.decimals;
  const limitProb =
    touch.bestAskUp === null
      ? (touch.bestBidUp ?? 0.5)
      : Math.max(tick, touch.bestAskUp - 2 * tick);

  const writer = new SomniaWriter({ indexerUrl: INDEXER_URL, privateKey });
  const result = await writer.placeOrder({
    marketId: market.marketId,
    side: 'UP',
    stake: STAKE,
    limitProb,
    clientOrderId: `place-one-${now}`,
    postOnly: true,
  });

  console.log(`\norder   UP, stake ${STAKE} base units, limit P(UP)=${limitProb.toFixed(3)}`);
  if (!result.accepted) {
    console.log(`refused ${result.rejectReason ?? 'no reason given'}`);
    process.exitCode = 1;
    return;
  }
  console.log(`tx      ${result.txHash}`);
  console.log(`venue   order id ${result.venueOrderId ?? '(filled, none rested)'}`);
}

await main();

// The SDK's WebSocket keeps a handle open past close().
process.exit(process.exitCode ?? 0);
