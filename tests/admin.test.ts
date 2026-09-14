import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool } from '@/lib/pg-pool';
import { createAdminUser } from '@/lib/admin-auth';
import { ADMIN_SESSION_COOKIE } from '@/lib/session';
import { _resetRateLimitsForTests } from '@/lib/rate-limit';
import { POST as login } from '@/app/api/admin/login/route';
import { POST as logout } from '@/app/api/admin/logout/route';
import { GET as session } from '@/app/api/admin/session/route';
import { GET as dashboard } from '@/app/api/admin/dashboard/route';
import { GET as claimsList } from '@/app/api/admin/claims/route';
import { GET as exportCsv } from '@/app/api/admin/claims/export/csv/route';
import { GET as exportJson } from '@/app/api/admin/claims/export/json/route';

import { hasDb } from './test-db';
const d = hasDb ? describe : describe.skip;

const ADMIN_EMAIL = `admin-test-${randomUUID()}@example.com`;
const ADMIN_PASSWORD = 'a-reasonably-long-test-password';

function getReq(path: string, cookie?: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

function postJson(path: string, body: unknown, cookie?: string): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function createTestCampaignWithClaims() {
  const campaignId = randomUUID();
  const slug = `admin-test-${campaignId}`;
  await pool.query(
    `INSERT INTO campaigns (id, slug, name, "eligibilityMode", "maxSpots", active, "createdAt", "updatedAt")
     VALUES ($1, $2, 'Admin Test Campaign', 'ANY', 10, true, now(), now())`,
    [campaignId, slug],
  );
  await pool.query(
    `INSERT INTO campaign_collections (id, "campaignId", name, chain, "contractAddress", "minimumHeld", "createdAt")
     VALUES ($1, $2, 'Test Collection', 'ethereum', '0xabc0000000000000000000000000000000abc0', 1, now())`,
    [randomUUID(), campaignId],
  );

  const claimWallets = [
    ['0xaaa1111111111111111111111111111111aaa1', '0xbbb1111111111111111111111111111111bbb1'],
    ['0xaaa2222222222222222222222222222222aaa2', '0xbbb2222222222222222222222222222222bbb2'],
  ];
  for (const [holder, destination] of claimWallets) {
    await pool.query(
      `INSERT INTO claims (id, "campaignId", "holderWallet", "destinationWallet", "qualifyingCollections", chain, "claimSignature", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'ethereum', '0xsig', now(), now())`,
      [randomUUID(), campaignId, holder, destination, JSON.stringify([{ name: 'Test Collection' }])],
    );
  }

  return { campaignId, slug };
}

d('admin panel', () => {
  let slug: string;

  beforeAll(async () => {
    await createAdminUser(ADMIN_EMAIL, ADMIN_PASSWORD);
    const campaign = await createTestCampaignWithClaims();
    slug = campaign.slug;
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(() => {
    _resetRateLimitsForTests();
  });

  it('rejects login with a wrong password', async () => {
    const res = await login(postJson('/api/admin/login', { email: ADMIN_EMAIL, password: 'wrong' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ADMIN_UNAUTHENTICATED');
  });

  it('rejects login for an unknown email with the SAME error shape (no enumeration)', async () => {
    const unknownRes = await login(
      postJson('/api/admin/login', { email: 'nobody@example.com', password: 'whatever' }),
    );
    const wrongPasswordRes = await login(
      postJson('/api/admin/login', { email: ADMIN_EMAIL, password: 'wrong' }),
    );
    const unknownBody = await unknownRes.json();
    const wrongBody = await wrongPasswordRes.json();
    expect(unknownRes.status).toBe(wrongPasswordRes.status);
    expect(unknownBody.error.code).toBe(wrongBody.error.code);
    expect(unknownBody.error.message).toBe(wrongBody.error.message);
  });

  it('accepts correct credentials and issues an admin session cookie', async () => {
    const res = await login(postJson('/api/admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }));
    expect(res.status).toBe(200);
    const token = res.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    expect(token).toBeTruthy();
  });

  it('rejects dashboard/claims access without an admin session', async () => {
    const dashRes = await dashboard(getReq(`/api/admin/dashboard?campaign=${slug}`));
    expect(dashRes.status).toBe(401);
    const claimsRes = await claimsList(getReq(`/api/admin/claims?campaign=${slug}`));
    expect(claimsRes.status).toBe(401);
  });

  it('rejects a wallet session cookie on an admin route (distinct cookie/purpose)', async () => {
    const res = await dashboard(getReq(`/api/admin/dashboard?campaign=${slug}`, 'atelier_wallet_session=garbage'));
    expect(res.status).toBe(401);
  });

  async function loginCookie(): Promise<string> {
    const res = await login(postJson('/api/admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }));
    const token = res.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    return `${ADMIN_SESSION_COOKIE}=${token}`;
  }

  it('returns real dashboard metrics for an authenticated admin', async () => {
    const cookie = await loginCookie();
    const res = await dashboard(getReq(`/api/admin/dashboard?campaign=${slug}`, cookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalSpots).toBe(10);
    expect(body.claimedSpots).toBe(2);
    expect(body.remainingSpots).toBe(8);
    expect(body.percentageClaimed).toBe(20);
    expect(body.campaign.collections).toHaveLength(1);
  });

  it('lists claims and supports search filtering', async () => {
    const cookie = await loginCookie();
    const all = await claimsList(getReq(`/api/admin/claims?campaign=${slug}`, cookie));
    const allBody = await all.json();
    expect(allBody.total).toBe(2);

    const filtered = await claimsList(
      getReq(`/api/admin/claims?campaign=${slug}&search=aaa1`, cookie),
    );
    const filteredBody = await filtered.json();
    expect(filteredBody.total).toBe(1);
    expect(filteredBody.claims[0].holderWallet).toContain('aaa1');
  });

  it('confirms admin session via /api/admin/session', async () => {
    const cookie = await loginCookie();
    const res = await session(getReq('/api/admin/session', cookie));
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    expect(body.email).toBe(ADMIN_EMAIL.toLowerCase());
  });

  it('exports claims as CSV with the expected columns and rows', async () => {
    const cookie = await loginCookie();
    const res = await exportCsv(getReq(`/api/admin/claims/export/csv?campaign=${slug}`, cookie));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'claim_id,holder_wallet,destination_wallet,claimed_at,qualifying_collection,chain,status',
    );
    expect(lines.length).toBe(3); // header + 2 claims
    expect(csv).toContain('aaa1');
    expect(csv).toContain('Test Collection');
  });

  it('exports claims as JSON', async () => {
    const cookie = await loginCookie();
    const res = await exportJson(getReq(`/api/admin/claims/export/json?campaign=${slug}`, cookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
  });

  it('rejects export routes without an admin session', async () => {
    const csvRes = await exportCsv(getReq(`/api/admin/claims/export/csv?campaign=${slug}`));
    expect(csvRes.status).toBe(401);
    const jsonRes = await exportJson(getReq(`/api/admin/claims/export/json?campaign=${slug}`));
    expect(jsonRes.status).toBe(401);
  });

  it('logout clears the session', async () => {
    const cookie = await loginCookie();
    const logoutRes = await logout(getReq('/api/admin/logout'));
    const clearedCookie = logoutRes.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    expect(clearedCookie).toBe('');

    // The original cookie value itself is still cryptographically valid
    // until it expires - logout clears the browser's copy, it doesn't
    // revoke the JWT (consistent with D4: sessions are short-lived signed
    // tokens, not a revocable DB-backed session). Confirm this is the
    // documented behavior rather than silently assuming server-side
    // revocation exists.
    const stillWorks = await dashboard(getReq(`/api/admin/dashboard?campaign=${slug}`, cookie));
    expect(stillWorks.status).toBe(200);
  });
});
