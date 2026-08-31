import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * The invariants in CLAUDE.md are only real if the lint rules meant to enforce them
 * actually fire. This asserts they do, against fixtures that are excluded from every
 * other script. Loading ESLint in-process is slow, hence the explicit timeout.
 */

const TIMEOUT_MS = 180_000;
const eslint = new ESLint({ ignore: false });

const lint = async (file: string): Promise<ESLint.LintResult> => {
  const [result] = await eslint.lintFiles([file]);
  if (result === undefined) throw new Error(`eslint returned no result for ${file}`);
  return result;
};

const ruleIds = (result: ESLint.LintResult): Array<string | null> =>
  result.messages.map((message) => message.ruleId);

describe('invariant I1 — packages/core performs no I/O', () => {
  it(
    'rejects a test file inside packages/core that imports axios',
    async () => {
      const result = await lint('packages/core/src/__fixtures__/axios-in-core.test.ts');
      expect(result.errorCount).toBeGreaterThan(0);
      expect(ruleIds(result)).toContain('no-restricted-imports');
    },
    TIMEOUT_MS,
  );

  it(
    'accepts the real core sources',
    async () => {
      const result = await lint('packages/core/src/score.ts');
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
    },
    TIMEOUT_MS,
  );
});

describe('invariant I2 — only the adapter names the venue', () => {
  it(
    'rejects a venue endpoint URL written outside the adapter',
    async () => {
      const result = await lint('packages/core/src/__fixtures__/venue-url-in-core.ts');
      expect(result.errorCount).toBeGreaterThan(0);
      expect(ruleIds(result)).toContain('no-restricted-syntax');
    },
    TIMEOUT_MS,
  );
});
