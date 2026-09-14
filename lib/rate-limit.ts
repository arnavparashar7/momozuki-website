/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Scope/limitation, stated up front rather than discovered later: this is
 * process-local state. It's correct and useful for a single-instance
 * deployment (which is this project's stated target - see
 * docs/ARCHITECTURE.md's "prefer a simple architecture" principle) but does
 * NOT coordinate across multiple instances behind a load balancer - each
 * instance would enforce its own independent limit, effectively multiplying
 * the real ceiling by the instance count. If this ever runs horizontally
 * scaled, replace the in-memory Map below with a shared store (Redis via
 * Upstash or similar - flagged as an open question in docs/DECISIONS.md
 * since Checkpoint 0) without changing any call site's signature.
 */

import { NextResponse } from 'next/server';

interface Bucket {
  count: number;
  windowStartMs: number;
}

const buckets = new Map<string, Bucket>();

// Periodic cleanup so `buckets` doesn't grow unboundedly over a long
// process lifetime from one-off keys (e.g. many distinct IPs) that are
// never checked again. Not security-critical, just housekeeping.
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let lastCleanup = Date.now();
function maybeCleanup(nowMs: number) {
  if (nowMs - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = nowMs;
  for (const [key, bucket] of buckets) {
    if (nowMs - bucket.windowStartMs > CLEANUP_INTERVAL_MS) {
      buckets.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * `key` should already include whatever the limit is scoped to - e.g.
 * `nonce:${ip}` or `admin-login:${ip}:${email}` - so callers control
 * exactly what's being rate limited rather than this module guessing.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  maybeCleanup(now);

  const existing = buckets.get(key);
  if (!existing || now - existing.windowStartMs >= windowMs) {
    buckets.set(key, { count: 1, windowStartMs: now });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    const retryAfterSeconds = Math.ceil((existing.windowStartMs + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/** Best-effort client IP extraction behind a typical reverse proxy setup.
 *  Not spoof-proof against a client setting these headers directly if the
 *  app is reachable without going through a trusted proxy that overwrites
 *  them - deployment must ensure only the proxy's value is trusted (e.g.
 *  Vercel/most PaaS providers set x-forwarded-for correctly themselves and
 *  strip client-supplied values). Documented rather than silently assumed
 *  safe. */
export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]!.trim();
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}

/** Test-only: clears all buckets so tests don't leak state into each other. */
export function _resetRateLimitsForTests(): void {
  buckets.clear();
}

/** Builds the standard 429 response for a rate-limited request, including
 *  a Retry-After header - used identically by every route that rate-limits
 *  (auth/nonce, auth/verify, claim/authorize, claim/submit, admin/login).
 *  Returns a NextResponse (not a plain Response) so every branch of a route
 *  handler's return type stays consistent - callers elsewhere in these
 *  routes return NextResponse.json(...), which exposes `.cookies`; keeping
 *  this branch's type aligned avoids widening every route's return type to
 *  `Response | NextResponse` and losing that property on early exits. */
export function rateLimitedResponse(result: RateLimitResult): NextResponse {
  const res = NextResponse.json(
    {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please slow down and try again.',
      },
    },
    { status: 429 },
  );
  res.headers.set('Retry-After', String(result.retryAfterSeconds));
  return res;
}
