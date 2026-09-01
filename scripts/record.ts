/**
 * `pnpm record` — capture live venue payloads into `fixtures/recorded/`.
 *
 * DREAMDEX_ADAPTER.md §5 Step 3: capture, do not transcribe. Reading the documentation and
 * typing what it says produces transcription errors; capturing the actual bytes does not.
 *
 * This is the only script in the repository that touches the network. It writes a dated
 * directory so an earlier capture is never overwritten, and it records the query alongside
 * the response so a reader can reproduce it.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FILL_FIELDS, MARKET_FIELDS, ORDER_FIELDS } from '@kalibra/adapter-dreamdex';

const INDEXER_URL = process.env['DREAMDEX_INDEXER_URL'] ?? 'https://dev.smk.somnia.host/v1/graphql';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function capture(name: string, query: string, outDir: string): Promise<number> {
  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`${name}: indexer returned HTTP ${response.status}`);
  const body = await response.text();
  await writeFile(join(outDir, `${name}.json`), `${body}\n`, 'utf8');
  await writeFile(join(outDir, `${name}.graphql`), `${query.trim()}\n`, 'utf8');
  return body.length;
}

async function main(): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = join(ROOT, 'fixtures', 'recorded', `dreamdex-live-${stamp}`);
  await mkdir(outDir, { recursive: true });

  const marketId = process.argv[2];
  console.log(`capturing from ${INDEXER_URL}`);

  const where = marketId === undefined ? '' : `, marketId: {_eq: "${marketId}"}`;
  let bytes = await capture(
    'markets',
    `{ Market(where: {marketType: {_eq: "BINARY"}${where}}, limit: 20,
       order_by: {createdAtTimestamp: desc}) { ${MARKET_FIELDS} } }`,
    outDir,
  );
  console.log(`  markets.json   ${bytes} bytes`);

  if (marketId !== undefined) {
    bytes = await capture(
      'fills',
      `{ Fill(where: {market_id: {_eq: "${marketId}"}}, order_by: {blockNumber: asc})
         { ${FILL_FIELDS} } }`,
      outDir,
    );
    console.log(`  fills.json     ${bytes} bytes`);
    bytes = await capture(
      'orders',
      `{ Order(where: {market_id: {_eq: "${marketId}"}}, order_by: {placedAtBlock: asc}, limit: 2000)
         { ${ORDER_FIELDS} } }`,
      outDir,
    );
    console.log(`  orders.json    ${bytes} bytes`);
  }

  console.log(`\nwrote ${outDir}`);
  console.log('These are evidence, not test fixtures. Review before committing.');
}

await main();
