import { readFile } from 'node:fs/promises';
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
      const evidence = /0x[0-9a-f]{16}|fixtures\/recorded\/|below/iu.test(row);
      expect(evidence, `LIVE row "${component}" cites no hash or fixture`).toBe(true);
    }
  });
});
