import { z } from 'zod';

/**
 * Single source of truth for server-side configuration. Every env var the app
 * depends on is declared and validated here, so a missing/malformed value fails
 * fast at boot rather than surfacing as a confusing runtime error deep in a
 * request handler.
 *
 * IMPORTANT: nothing in this file is imported by client components. Secrets
 * (Alchemy keys, DB URLs, session secret) must never reach the browser bundle.
 * If a value genuinely needs to be public, it belongs in a separate
 * `publicEnv` export prefixed `NEXT_PUBLIC_` - none exist yet.
 */

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Database (Supabase-hosted Postgres via Prisma).
  // DATABASE_URL: pooled connection (PgBouncer, port 6543) - used at runtime,
  // required as of Checkpoint 2 since lib/db.ts constructs a real pg Pool.
  // DIRECT_URL: direct connection (port 5432) - used only by Prisma
  // Migrate/db push, kept optional here since only the CLI needs it.
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  // Wallet auth / claim signing session secret (used to sign session cookies).
  // Required as of Checkpoint 3. Generate with: openssl rand -base64 32
  SESSION_SECRET: z.string().min(32),

  // Alchemy - server-side only, never exposed to the client.
  ALCHEMY_API_KEY: z.string().optional(),

  // thirdweb.
  THIRDWEB_SECRET_KEY: z.string().optional(),

  // Admin bootstrap (used by a seed script, not a public signup route).
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD_HASH: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Fields marked `.optional()` above are genuinely optional for Checkpoint 1
 * (no DB models, no auth, no Alchemy calls exist yet). As each subsystem is
 * built, its required vars should move to `.min(1)` / dropped `.optional()`
 * so a missing value fails validation instead of failing silently later.
 */
function loadServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast and loudly at boot - this should never surface to a user.
    console.error('Invalid environment configuration:', parsed.error.flatten());
    throw new Error('Invalid environment configuration. See server logs.');
  }
  return parsed.data;
}

let cachedEnv: ServerEnv | undefined;

/**
 * `env` is a lazy proxy: validation runs on first property access, not on
 * import. This matters because several modules (e.g. lib/alchemy.ts) are
 * imported for their exported *functions* by code that only calls those
 * functions conditionally (lib/eligibility.ts's injectable
 * `getHeldQuantity` parameter, used as a fallback default). Eager
 * validation at import time would force every var in the schema -
 * including ones the current code path never touches, like DATABASE_URL in
 * a pure eligibility unit test with a mocked lookup - to be present just to
 * import the module. Lazy access means a test that never actually calls
 * the Alchemy-backed default doesn't need ALCHEMY_API_KEY, DATABASE_URL, or
 * SESSION_SECRET set at all.
 */
export const env: ServerEnv = new Proxy({} as ServerEnv, {
  get(_target, prop: string | symbol) {
    if (!cachedEnv) {
      cachedEnv = loadServerEnv();
    }
    return cachedEnv[prop as keyof ServerEnv];
  },
});
