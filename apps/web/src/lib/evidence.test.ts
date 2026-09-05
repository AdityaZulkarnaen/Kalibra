import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { countByStatus, EVIDENCE_ROWS, splitCode } from './evidence';

/**
 * The landing page reproduces the README's real-vs-mocked table, and this is what stops the
 * two from drifting apart.
 *
 * `CLAUDE.md` §6 requires the table to be updated in the same commit as the code it describes.
 * A copy nobody checks turns that requirement into a requirement to remember, and the copy a
 * reviewer happens to read is always the stale one. `docs-consistency.test.ts` makes the same
 * argument about `PRD.md` §9, and enforces it the same way: parse the source of truth, compare.
 *
 * Vitest runs from the repository root, which is what puts `README.md` one join away.
 */

const README = join(process.cwd(), 'README.md');

/** The table under `## What is real vs mocked`, and nothing under the prose headings after it. */
async function readmeRows(): Promise<Array<{ component: string; status: string }>> {
  const readme = await readFile(README, 'utf8');
  const start = readme.indexOf('## What is real vs mocked');
  expect(start, 'the real-vs-mocked table is missing from README.md').toBeGreaterThan(-1);

  const body = readme.slice(start);
  const end = body.slice(10).search(/\n(?:## |### )/u);
  const table = end === -1 ? body : body.slice(0, end + 10);

  return table
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.includes('|---'))
    .filter((line) => !line.startsWith('| Component |'))
    .map((line) => {
      const cells = line.split('|');
      return {
        component: cells[1]?.trim() ?? '',
        // Bold is how the README emphasises a LIVE row. It is presentation, not part of the word.
        status: cells[2]?.replace(/\*/gu, '').trim() ?? '',
      };
    });
}

describe('the rendered real-vs-mocked table', () => {
  it('is the README table, row for row and in the same order', async () => {
    expect(EVIDENCE_ROWS.map((row) => ({ component: row.component, status: row.status }))).toEqual(
      await readmeRows(),
    );
  });

  it('carries every row, so none was dropped from the copy', async () => {
    const rows = await readmeRows();
    expect(rows.length).toBeGreaterThan(5);
    expect(EVIDENCE_ROWS).toHaveLength(rows.length);
  });

  /** `CLAUDE.md` §6 fixes the vocabulary. A fifth word would read as a grade without being one. */
  it('grades every row with one of the four documented statuses', () => {
    for (const row of EVIDENCE_ROWS) {
      expect(
        ['LIVE', 'REPLAY', 'SYNTHETIC', 'STUB'],
        `unknown status on "${row.component}"`,
      ).toContain(row.status);
    }
  });

  it('counts the grades from the rows rather than from a written-down number', () => {
    const counts = countByStatus(EVIDENCE_ROWS);
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    expect(total).toBe(EVIDENCE_ROWS.length);
    expect(counts.get('LIVE')).toBe(EVIDENCE_ROWS.filter((row) => row.status === 'LIVE').length);
  });
});

describe('splitCode', () => {
  it('marks the backticked runs as code and leaves the rest alone', () => {
    expect(splitCode('Web app (`apps/web`)')).toEqual([
      { code: false, text: 'Web app (' },
      { code: true, text: 'apps/web' },
      { code: false, text: ')' },
    ]);
  });

  it('handles a name that is nothing but code', () => {
    expect(splitCode('`pnpm demo`')).toEqual([{ code: true, text: 'pnpm demo' }]);
  });

  it('handles a name with no code at all', () => {
    expect(splitCode('Guard enforcement in the live loop')).toEqual([
      { code: false, text: 'Guard enforcement in the live loop' },
    ]);
  });

  it('reassembles every README component name without losing a character', () => {
    for (const row of EVIDENCE_ROWS) {
      expect(
        splitCode(row.component)
          .map((segment) => segment.text)
          .join(''),
      ).toBe(row.component.replaceAll('`', ''));
    }
  });
});
