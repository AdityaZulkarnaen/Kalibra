import { openDatabase } from '@kalibra/db';
import { z } from 'zod';

import { buildServer } from './server.js';

/**
 * `pnpm api`. Read-only and public, so there is no authentication to configure and no
 * credential to leak. Configuration is parsed once, and a malformed value is a crash.
 */
const configSchema = z.object({
  KALIBRA_DB_PATH: z.string().min(1).default('./kalibra.db'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

const config = configSchema.parse(process.env);
const { db } = openDatabase(config.KALIBRA_DB_PATH);
const app = buildServer(db);

await app.listen({ port: config.API_PORT, host: '127.0.0.1' });
console.log(`kalibra api on http://127.0.0.1:${config.API_PORT}/v1`);
