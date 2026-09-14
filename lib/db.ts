import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { pool } from '@/lib/pg-pool';

/**
 * Prisma client for non-concurrency-critical reads/writes (campaign config
 * CRUD, admin dashboard queries, etc.). The concurrency-critical paths
 * (claim recording, nonce consumption) intentionally use raw parameterized
 * SQL instead - see lib/claims.ts, lib/nonce.ts, and docs/DECISIONS.md D11.
 *
 * Uses the `@prisma/adapter-pg` driver adapter (WASM query engine bundled in
 * the npm package) rather than Prisma's native engine binary, both because
 * this project's dev sandbox blocks the binaries.prisma.sh download and
 * because it lets Prisma share the same `pg` pool as the raw-SQL modules.
 *
 * IMPORTANT: `getPrisma()` throws until `prisma generate` has been run
 * successfully at least once (it needs network access to
 * binaries.prisma.sh/npm to fetch its generated types/runtime - this could
 * not be completed in this project's dev sandbox; see docs/CHECKPOINT.md).
 * The getter is lazy specifically so that importing this module doesn't
 * crash callers that don't actually need Prisma yet.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client;
  }
  return client;
}
