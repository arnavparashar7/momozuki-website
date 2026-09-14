import { beforeEach, describe, expect, it } from 'vitest';
import { checkRateLimit, _resetRateLimitsForTests } from '@/lib/rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    _resetRateLimitsForTests();
  });

  it('allows requests up to the limit, then blocks', () => {
    const key = 'test-key';
    for (let i = 0; i < 5; i++) {
      const res = checkRateLimit(key, 5, 60_000);
      expect(res.allowed).toBe(true);
    }
    const sixth = checkRateLimit(key, 5, 60_000);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tracks distinct keys independently', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit('key-a', 5, 60_000).allowed).toBe(true);
    }
    expect(checkRateLimit('key-a', 5, 60_000).allowed).toBe(false);
    // A different key has its own budget, unaffected by key-a being exhausted.
    expect(checkRateLimit('key-b', 5, 60_000).allowed).toBe(true);
  });

  it('resets after the window elapses', () => {
    const key = 'test-window';
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, 3, 50).allowed).toBe(true);
    }
    expect(checkRateLimit(key, 3, 50).allowed).toBe(false);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(checkRateLimit(key, 3, 50).allowed).toBe(true);
        resolve();
      }, 70);
    });
  });
});

import { hasDb } from './test-db';
const d = hasDb ? describe : describe.skip;

d('rate limiting wired into routes', () => {
  beforeEach(() => {
    _resetRateLimitsForTests();
  });

  it('blocks nonce issuance after the per-IP limit is exceeded', async () => {
    const { POST: nonceRoute } = await import('@/app/api/auth/nonce/route');
    const wallet = '0x1234567890123456789012345678901234567890';
    const makeReq = () =>
      new Request('http://localhost/api/auth/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.5' },
        body: JSON.stringify({ wallet }),
      });

    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await nonceRoute(makeReq());
      lastStatus = res.status;
      if (i < 10) {
        expect(res.status).toBe(200);
      }
    }
    expect(lastStatus).toBe(429);
  });

  it('blocks admin login after the per-account limit, independent of other accounts from the same IP', async () => {
    const { POST: login } = await import('@/app/api/admin/login/route');
    const ip = '203.0.113.9';
    const makeReq = (email: string) =>
      new Request('http://localhost/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ email, password: 'wrong' }),
      });

    for (let i = 0; i < 5; i++) {
      const res = await login(makeReq('victim@example.com'));
      expect(res.status).toBe(401); // wrong password, but not yet rate-limited
    }
    const sixth = await login(makeReq('victim@example.com'));
    expect(sixth.status).toBe(429);

    // A different account from the same IP still gets its own budget (the
    // per-account limit isn't a blanket per-IP lockout).
    const otherAccount = await login(makeReq('someone-else@example.com'));
    expect(otherAccount.status).toBe(401);
  });
});
