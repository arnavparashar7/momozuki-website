import { beforeEach, describe, expect, it } from 'vitest';
import { _resetRateLimitsForTests } from '@/lib/rate-limit';
import { hasDb } from './test-db';

const d = hasDb ? describe : describe.skip;

d('CSRF origin check wired into routes', () => {
  beforeEach(() => {
    _resetRateLimitsForTests();
  });

  it('rejects a POST whose Origin header does not match the request host', async () => {
    const { POST: nonceRoute } = await import('@/app/api/auth/nonce/route');
    const res = await nonceRoute(
      new Request('http://localhost/api/auth/nonce', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'https://evil-attacker-site.example',
        },
        body: JSON.stringify({ wallet: '0x1234567890123456789012345678901234567890' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('accepts a POST whose Origin header matches the request host', async () => {
    const { POST: nonceRoute } = await import('@/app/api/auth/nonce/route');
    const res = await nonceRoute(
      new Request('http://localhost/api/auth/nonce', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({ wallet: '0x1234567890123456789012345678901234567890' }),
      }),
    );
    expect(res.status).toBe(200);
  });
});
