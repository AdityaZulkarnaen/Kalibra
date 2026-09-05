import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The documents that are required to agree with each other, checked rather than trusted.
 *
 * `PRD.md` §9 says its limitations are "to be reproduced verbatim in the README", and
 * `CLAUDE.md` §6 makes honesty about limitations a hard requirement rather than a nicety.
 * A copied list is a list that drifts: the interesting edit always lands in one file, and
 * the stale copy is the one a reviewer happens to read. This is the same argument that puts
 * the `API_SPEC.md` example payloads through the server's own Zod schemas.
 *
 * Whitespace is normalised before comparing, so re-wrapping a paragraph in one file does not
 * fail the test. Wording is not: changing what a limitation *says* in one place has to be
 * done in both.
 */

const ROOT = process.cwd();
const read = (name: string): Promise<string> => readFile(join(ROOT, name), 'utf8');

/** Collapses runs of whitespace, so line wrapping is free and wording is not. */
const normalise = (text: string): string => text.replace(/\s+/gu, ' ').trim();

/** The numbered list under a `## Known limitations` heading, to the end of the section. */
function limitations(document: string, heading: string): string {
  const start = document.indexOf(heading);
  expect(start, `${heading} is missing`).toBeGreaterThan(-1);
  const body = document.slice(start + heading.length);
  const first = body.indexOf('1. **');
  expect(first, `no numbered list under ${heading}`).toBeGreaterThan(-1);

  // Stop at the next top-level heading or horizontal rule, whichever comes first.
  const rest = body.slice(first);
  const end = rest.search(/\n(?:## |---)/u);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('the README reproduces PRD.md section 9', () => {
  it('carries every limitation, word for word', async () => {
    const [prd, readme] = await Promise.all([read('docs/PRD.md'), read('README.md')]);
    expect(normalise(limitations(readme, '## Known limitations'))).toBe(
      normalise(limitations(prd, '## 9. Known limitations')),
    );
  });

  it('keeps them numbered contiguously, so none was dropped in the copy', async () => {
    const prd = await read('docs/PRD.md');
    const numbers = [...limitations(prd, '## 9. Known limitations').matchAll(/^(\d+)\. \*\*/gmu)];
    expect(numbers.length).toBeGreaterThanOrEqual(5);
    expect(numbers.map((match) => Number(match[1]))).toEqual(
      numbers.map((_match, index) => index + 1),
    );
  });
});

/**
 * The status vocabulary of the real-vs-mocked table is fixed by `CLAUDE.md` §6. A row
 * carrying some other word reads as a status without being one, which is the failure mode
 * that section exists to prevent.
 */
describe('the real-vs-mocked table', () => {
  /**
   * Only the table itself, not the prose sections under it. Those carry tables of their own
   * — the Guard throttling figures, for one — whose columns mean something else entirely.
   */
  const tableRows = async (): Promise<string[]> => {
    const readme = await read('README.md');
    const start = readme.indexOf('## What is real vs mocked');
    expect(start, 'the real-vs-mocked table is missing').toBeGreaterThan(-1);
    const body = readme.slice(start);
    const end = body.slice(10).search(/\n(?:## |### )/u);
    const table = end === -1 ? body : body.slice(0, end + 10);
    return table
      .split('\n')
      .filter((line) => line.startsWith('| ') && !line.includes('|---'))
      .filter((line) => !line.startsWith('| Component |'));
  };

  it('uses only the four documented statuses', async () => {
    const statuses = (await tableRows())
      .map((row) => row.split('|')[2]?.replace(/\*/gu, '').trim())
      .filter((status): status is string => status !== undefined);

    expect(statuses.length).toBeGreaterThan(5);
    for (const status of statuses) {
      expect(['LIVE', 'REPLAY', 'SYNTHETIC', 'STUB'], `unknown status "${status}"`).toContain(
        status,
      );
    }
  });

  /** `CLAUDE.md` §6: never LIVE without a transaction hash or a captured response. */
  it('backs every LIVE row with a transaction hash or a captured fixture', async () => {
    const live = (await tableRows()).filter((row) => /\|\s*\*\*LIVE\*\*\s*\|/u.test(row));

    expect(live.length).toBeGreaterThan(0);
    for (const row of live) {
      const component = row.split('|')[1]?.trim() ?? row;
      const evidence = /0x[0-9a-f]{16}|fixtures\/recorded\//iu.test(row);
      expect(evidence, `LIVE row "${component}" cites no hash or fixture`).toBe(true);
    }
  });
});

/**
 * The ten real ranked wallets are quoted in prose, and prose about live data goes stale the
 * moment another window settles. The numbers were already wrong once between capturing the
 * snapshot and writing the table, which is the whole argument for checking them: a figure a
 * reader can verify against committed bytes is evidence, and the same figure drifting quietly
 * is the discovered overclaiming `CLAUDE.md` §6 calls fatal.
 *
 * So the table is compared against the capture it cites. Updating one without the other fails
 * here rather than in front of a judge.
 */
describe('the ten real ranked wallets', () => {
  const CAPTURE = 'fixtures/recorded/live-index-2026-09-05/leaderboard-ranked.json';

  /** Every `| 0x… | score | n |` row of the section, as the README writes them. */
  async function readmeWallets(): Promise<Map<string, [number, number]>> {
    const readme = await read('README.md');
    const start = readme.indexOf('### The ten real ranked wallets');
    expect(start, 'the real-wallet table is missing from README.md').toBeGreaterThan(-1);

    const section = readme.slice(start, readme.indexOf('###', start + 10));
    const rows = [...section.matchAll(/\|\s*`(0x[0-9a-f]{40})`\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/gu)];
    return new Map(rows.map((m) => [m[1]!, [Number(m[2]), Number(m[3])]]));
  }

  /** The ranked entries of the capture whose address is not from the synthetic fixture set. */
  async function capturedWallets(): Promise<Map<string, [number, number]>> {
    const body: unknown = JSON.parse(await read(CAPTURE));
    const entries = (body as { entries?: Array<Record<string, unknown>> }).entries ?? [];
    return new Map(
      entries
        .filter((entry) => !String(entry.wallet).startsWith('0x0000000000000000'))
        .map((entry) => [String(entry.wallet), [Number(entry.score), Number(entry.n)]]),
    );
  }

  it('quotes the score and sample size the committed capture carries', async () => {
    expect(await readmeWallets()).toEqual(await capturedWallets());
  });

  it('accounts for every real wallet in the capture, so none was quietly dropped', async () => {
    const captured = await capturedWallets();
    expect(captured.size).toBe(10);
    expect([...(await readmeWallets()).keys()].sort()).toEqual([...captured.keys()].sort());
  });
});

/**
 * `CLAUDE.md` §6 forbids a `LIVE` row without a transaction hash or a captured response. The
 * hashes were present from the start; the receipts were not, so for several days the strongest
 * claims in the README were the only ones a reader had to leave the repository to check.
 *
 * Now that they are committed, this asserts the two agree. A hash edited in the README without
 * its receipt, or a receipt swapped for a different transaction, fails here.
 */
describe('the committed chain receipts', () => {
  const DIR = 'fixtures/recorded/chain-receipts-2026-09-05';

  interface Receipt {
    readonly hash: string;
    readonly status: string;
    readonly block_number: number;
  }

  async function receipts(): Promise<Receipt[]> {
    const names = (await readdir(join(ROOT, DIR))).filter((name) => name.endsWith('.json'));
    return Promise.all(
      names.map(async (name) => JSON.parse(await read(`${DIR}/${name}`)) as Receipt),
    );
  }

  it('records a successful transaction for every receipt', async () => {
    const all = await receipts();
    expect(all).toHaveLength(5);
    for (const receipt of all) {
      expect(receipt.status, `${receipt.hash} did not succeed`).toBe('ok');
    }
  });

  it('carries a hash the README actually cites', async () => {
    const readme = await read('README.md');
    for (const receipt of await receipts()) {
      // The README abbreviates hashes in link text but spells them out in the explorer href.
      expect(readme, `no README reference to ${receipt.hash}`).toContain(receipt.hash);
    }
  });

  it('agrees with the block number the README prints beside it', async () => {
    const readme = await read('README.md');
    for (const receipt of await receipts()) {
      expect(
        readme,
        `README does not print block ${receipt.block_number} for ${receipt.hash}`,
      ).toContain(String(receipt.block_number));
    }
  });
});
