/**
 * Client-safe environment values only. Everything here is bundled into the
 * browser - never put a secret in this file. Next.js statically replaces
 * `process.env.NEXT_PUBLIC_*` references at build time, which is why this
 * reads `process.env.X` directly rather than going through lib/env.ts's
 * server-only validated config.
 */
export const THIRDWEB_CLIENT_ID = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID ?? '';
