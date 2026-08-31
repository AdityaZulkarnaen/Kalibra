// Lint fixture, deliberately invalid. It is excluded from `pnpm test`, `pnpm lint` and
// `pnpm typecheck`; eslint.config.test.ts lints it on purpose and asserts that the
// invariant I1/I2 rules reject it. Do not "fix" this file.
import axios from 'axios';

export const probe = axios;
