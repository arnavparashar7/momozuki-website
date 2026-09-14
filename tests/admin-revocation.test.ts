import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool } from '@/lib/pg-pool';
import { createAdminUser } from '@/lib/admin-auth';
import { ADMIN_SESSION_COOKIE } from '@/lib/session';
import { _resetRateLimitsForTests } from '@/lib/rate-limit';
import { POST as login } from '@/app/api/admin/login/route';
import { POST as revokeSessions } from '@/app/api/admin/revoke-sessions/route';
import { GET as dashboard } from '@/app/api/admin/dashboard/route';

import { hasDb } from './test-db';
const d = hasDb ? describe : describe.skip;

const EMAIL = `revoke-test-${randomUUID()}@example.com`;
const PASSWORD = 'another-reasonably-long-password';

function getReq(path: string, cookie?: string): Request {
  return new Request(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });
}
function postJson(path: string, body: unknown, cookie?: string): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function loginCookie(): Promise<string> {
  const res = await login(postJson('/api/admin/login', { email: EMAIL, password: PASSWORD }));
  const token = res.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  return `${ADMIN_SESSION_COOKIE}=${token}`;
}

d('admin session revocation (D21)', () => {
  beforeEach(() => {
    _resetRateLimitsForTests();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('an admin session token stops working immediately after revoke-sessions is called', async () => {
    await createAdminUser(EMAIL, PASSWORD);

    const cookieA = await loginCookie();
    const cookieB = await loginCookie(); // a second, independent session for the same admin

    // Both sessions work before revocation.
    expect((await dashboard(getReq('/api/admin/dashboard', cookieA))).status).not.toBe(401);
    expect((await dashboard(getReq('/api/admin/dashboard', cookieB))).status).not.toBe(401);

    // Revoke using session A.
    const revokeRes = await revokeSessions(postJson('/api/admin/revoke-sessions', {}, cookieA));
    expect(revokeRes.status).toBe(200);

    // BOTH sessions - including the one that made the revoke call - are now
    // rejected. This is the entire point: a leaked token can be killed
    // without needing to know which specific token leaked.
    expect((await dashboard(getReq('/api/admin/dashboard', cookieA))).status).toBe(401);
    expect((await dashboard(getReq('/api/admin/dashboard', cookieB))).status).toBe(401);

    // A fresh login works again (new tokenVersion baked into the new token).
    const cookieC = await loginCookie();
    expect((await dashboard(getReq('/api/admin/dashboard', cookieC))).status).not.toBe(401);
  });

  it('revoke-sessions itself requires an admin session', async () => {
    const res = await revokeSessions(postJson('/api/admin/revoke-sessions', {}));
    expect(res.status).toBe(401);
  });
});
