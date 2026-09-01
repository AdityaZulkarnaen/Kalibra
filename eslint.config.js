import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Invariants I1 and I2 from CLAUDE.md are enforced here rather than by convention.
 * `eslint.config.test.ts` asserts that these rules actually fire.
 */

const NETWORK_CLIENTS = [
  'axios',
  'node-fetch',
  'undici',
  'got',
  'ky',
  'superagent',
  'ws',
  'socket.io-client',
];

const IO_MODULE_GROUPS = [
  'fs',
  'fs/*',
  'node:fs',
  'node:fs/*',
  'http',
  'https',
  'node:http',
  'node:https',
  'net',
  'node:net',
  'dgram',
  'node:dgram',
  'dns',
  'node:dns',
  'tls',
  'node:tls',
  'child_process',
  'node:child_process',
  'worker_threads',
  'node:worker_threads',
];

const NO_IO_IN_CORE =
  'packages/core performs no I/O (CLAUDE.md I1). Pass data in as arguments instead.';

const NO_CLIENT_OUTSIDE_ADAPTER =
  'Only packages/adapter-dreamdex talks to the venue (CLAUDE.md I2). Go through the adapter.';

const NON_DETERMINISTIC =
  'Scoring is deterministic (CLAUDE.md I6). Pass the clock or the random source in as an argument.';

/**
 * I1 is about capability, not about imports. `fetch`, `process.env` and `performance.now`
 * are globals, so without this rule packages/core could reach the network, read the
 * environment or read a clock without a single import to catch.
 */
const NO_IO_GLOBALS = [
  { name: 'fetch', message: NO_IO_IN_CORE },
  { name: 'XMLHttpRequest', message: NO_IO_IN_CORE },
  { name: 'WebSocket', message: NO_IO_IN_CORE },
  { name: 'EventSource', message: NO_IO_IN_CORE },
  { name: 'navigator', message: NO_IO_IN_CORE },
  { name: 'process', message: NO_IO_IN_CORE },
  { name: 'performance', message: NON_DETERMINISTIC },
  {
    name: 'crypto',
    message:
      'The global carries getRandomValues (CLAUDE.md I6). Import node:crypto explicitly for a pure hash.',
  },
];

/**
 * An endpoint URL outside the adapter breaks the airlock (CLAUDE.md I2).
 *
 * The selector matches URL-shaped literals only. A broader match on the bare vendor name
 * would also flag `import { DreamDexAdapter } from '@kalibra/adapter-dreamdex'`, which is
 * the intended way for downstream code to consume the airlock, so the remaining half of
 * I2 — venue-specific field names — stays a review-time invariant.
 */
const NO_VENUE_ENDPOINT = {
  selector: String.raw`Literal[value=/^(https?|wss?):\/\/[^\s]*dreamdex/i]`,
  message:
    'Only packages/adapter-dreamdex may name a venue endpoint (CLAUDE.md I2). Consume the canonical types instead.',
};

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '**/__fixtures__/**',
      'apps/web/.next/**',
      'apps/web/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    // .tsx and .mjs are listed so the airlock rule reaches apps/web too: a pasted venue
    // URL in a component is exactly the leak I2 exists to catch.
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs'],
    ignores: ['packages/adapter-dreamdex/**'],
    rules: {
      'no-restricted-syntax': ['error', NO_VENUE_ENDPOINT],
      'no-restricted-imports': [
        'error',
        {
          paths: NETWORK_CLIENTS.map((name) => ({ name, message: NO_CLIENT_OUTSIDE_ADAPTER })),
        },
      ],
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: NETWORK_CLIENTS.map((name) => ({ name, message: NO_IO_IN_CORE })),
          patterns: [
            { group: IO_MODULE_GROUPS, message: NO_IO_IN_CORE },
            {
              group: ['@kalibra/*'],
              message:
                'packages/core may not import another workspace package (ARCHITECTURE.md 2).',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...NO_IO_GLOBALS],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: NON_DETERMINISTIC,
        },
        {
          object: 'Date',
          property: 'now',
          message: NON_DETERMINISTIC,
        },
      ],
      'no-restricted-syntax': [
        'error',
        NO_VENUE_ENDPOINT,
        {
          selector: 'NewExpression[callee.name="Date"]',
          message: 'packages/core reads no clock (CLAUDE.md I1). Pass timestamps in as numbers.',
        },
      ],
    },
  },
);
