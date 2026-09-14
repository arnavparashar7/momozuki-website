import { Pool } from 'pg';
import { env } from '@/lib/env';

/**
 * Shared Postgres connection pool. This is the actual runtime connection
 * used by the concurrency-critical raw-SQL modules (lib/claims.ts,
 * lib/nonce.ts - see docs/DECISIONS.md D11) and is also handed to the
 * Prisma driver adapter in lib/db.ts for everything else.
 */
const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPg.pgPool = pool;
}
