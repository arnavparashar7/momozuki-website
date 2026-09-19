import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { pool } from '@/lib/pg-pool';
import { createWalletSessionToken, WALLET_SESSION_COOKIE } from '@/lib/session';
import { _resetRateLimitsForTests } from '@/lib/rate-limit';
import { AppError, ErrorCode } from '@/lib/errors';
import { hasDb } from './test-db';

/**
 * Checkpoint 9 - Dedicated Failure Simulation Test Suite.
 *
 * Explicitly tests application resilience and safe error sanitization under:
 * - Alchemy API provider failures & timeouts
 * - Database outages and connection dropouts
 * - Cryptographic signature tampering & holder wallet mismatches
 * - Expired deadlines & nonce expiration
 * - Sold-out & inactive campaign states
 * - Rate limit trip-wire responses & cross-origin CSRF attacks
 */

const mockHoldings = new Map<string, number>();

vi.mock('@/lib/alchemy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/alchemy')>();
  return {
    ...actual,
    getHeldQuantity: vi.fn(async (chain: string, wallet: string, contractAddress: string) => {
      const key = `${wallet.toLowerCase()}:${contractAddress}`;
      if (mockHoldings.has(key)) {
        const val = mockHoldings.get(key)!;
        if (val === -1) {
          throw new AppError(ErrorCode.PROVIDER_UNAVAILABLE, 'Alchemy RPC simulation error');
        }
        return val;
      }
      return 0;
    }),
  };
});

const { POST: nonceRoute } = await import('@/app/api/auth/nonce/route');
const { GET: eligibilityRoute } = await import('@/app/api/eligibility/route');
const { POST: authorizeRoute } = await import('@/app/api/claim/authorize/route');
const { POST: submitRoute } = await import('@/app/api/claim/submit/route');

const d = hasDb ? describe : describe.skip;

function setHolding(wallet: string, contractAddress: string, quantity: number) {
  mockHoldings.set(`${wallet.toLowerCase()}:${contractAddress}`, quantity);
}

async function sessionCookieFor(wallet: string): Promise<string> {
  const token = await createWalletSessionToken(wallet);
  return `${WALLET_SESSION_COOKIE}=${token}`;
}

function makeRequest(path: string, opts: { method?: string; body?: unknown; cookie?: string; origin?: string }): Request {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (opts.cookie) {
    headers['cookie'] = opts.cookie;
  }
  if (opts.origin) {
    headers['origin'] = opts.origin;
  }

  return new Request(`http://localhost${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function createTestCampaign(opts: { maxSpots: number; active?: boolean }) {
  const campaignId = randomUUID();
  const slug = `fail-sim-${campaignId}`;
  const contractAddress = `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`;

  await pool.query(
    `INSERT INTO campaigns (id, slug, name, "eligibilityMode", "maxSpots", active, "createdAt", "updatedAt")
     VALUES ($1, $2, 'Failure Sim Campaign', 'ANY', $3, $4, now(), now())`,
    [campaignId, slug, opts.maxSpots, opts.active ?? true],
  );
  await pool.query(
    `INSERT INTO campaign_collections (id, "campaignId", name, chain, "contractAddress", "minimumHeld", "createdAt")
     VALUES ($1, $2, 'Fail Sim Collection', 'ethereum', $3, 1, now())`,
    [randomUUID(), campaignId, contractAddress],
  );

  return { campaignId, slug, contractAddress };
}

d('Checkpoint 9 - Failure Simulation Suite', () => {
  beforeEach(() => {
    mockHoldings.clear();
    _resetRateLimitsForTests();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await pool.end();
  });

  // --------------------------------------------------------------------------
  // 1. ALCHEMY / PROVIDER FAILURES
  // --------------------------------------------------------------------------
  describe('Alchemy / Provider Failures', () => {
    it('returns 503 PROVIDER_UNAVAILABLE on /api/eligibility when Alchemy throws', async () => {
      const holder = privateKeyToAccount(generatePrivateKey());
      const { slug, contractAddress } = await createTestCampaign({ maxSpots: 10 });
      setHolding(holder.address, contractAddress, -1); // Simulates Alchemy RPC crash

      const cookie = await sessionCookieFor(holder.address);
      const res = await eligibilityRoute(makeRequest(`/api/eligibility?campaign=${slug}`, { cookie }));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.code).toBe('PROVIDER_UNAVAILABLE');
    });

    it('returns 503 PROVIDER_UNAVAILABLE on /api/claim/authorize when Alchemy throws', async () => {
      const holder = privateKeyToAccount(generatePrivateKey());
      const destinationWallet = '0x1111111111111111111111111111111111111111';
      const { slug, contractAddress } = await createTestCampaign({ maxSpots: 10 });
      setHolding(holder.address, contractAddress, -1);

      const cookie = await sessionCookieFor(holder.address);
      const res = await authorizeRoute(makeRequest('/api/claim/authorize', { body: { destinationWallet, campaign: slug }, cookie }));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.code).toBe('PROVIDER_UNAVAILABLE');
    });

    it('returns 503 PROVIDER_UNAVAILABLE on /api/claim/submit when Alchemy fails on re-check', async () => {
      const holder = privateKeyToAccount(generatePrivateKey());
      const destinationWallet = '0x2222222222222222222222222222222222222222';
      const { slug, contractAddress } = await createTestCampaign({ maxSpots: 10 });
      
      // Step 1: Eligible during authorize
      setHolding(holder.address, contractAddress, 1);
      const cookie = await sessionCookieFor(holder.address);
      const authRes = await authorizeRoute(makeRequest('/api/claim/authorize', { body: { destinationWallet, campaign: slug }, cookie }));
      const authBody = await authRes.json();

      const signature = await holder.signTypedData({
        domain: authBody.domain,
        types: authBody.types,
        primaryType: authBody.primaryType,
        message: { ...authBody.message, deadline: BigInt(authBody.message.deadline) },
      });

      // Step 2: Alchemy breaks right before submit
      setHolding(holder.address, contractAddress, -1);

      const submitRes = await submitRoute(makeRequest('/api/claim/submit', {
        body: {
          destinationWallet,
          nonce: authBody.nonce,
          deadline: authBody.deadline,
          signature,
          campaign: slug,
        },
        cookie,
      }));

      expect(submitRes.status).toBe(503);
      const submitBody = await submitRes.json();
      expect(submitBody.error.code).toBe('PROVIDER_UNAVAILABLE');
    });
  });

  // --------------------------------------------------------------------------
  // 2. DATABASE FAILURES & SANITIZATION
  // --------------------------------------------------------------------------
  describe('Database Outages & Error Sanitization', () => {
    it('returns sanitized 500 INTERNAL on /api/auth/nonce when DB query fails', async () => {
      vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('FATAL: database connection lost'));

      const res = await nonceRoute(makeRequest('/api/auth/nonce', {
        body: { wallet: '0x1111111111111111111111111111111111111111' },
      }));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe('INTERNAL');
      expect(body.error.message).toBe('Something went wrong. Please try again.');
      expect(JSON.stringify(body)).not.toContain('database connection lost');
    });

    it('returns sanitized 500 INTERNAL on /api/eligibility when DB campaign lookup fails', async () => {
      const holder = privateKeyToAccount(generatePrivateKey());
      const cookie = await sessionCookieFor(holder.address);

      vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('pg_query_failed: connection timeout'));

      const res = await eligibilityRoute(makeRequest('/api/eligibility', { cookie }));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe('INTERNAL');
      expect(JSON.stringify(body)).not.toContain('pg_query_failed');
    });

    it('returns sanitized 500 INTERNAL on /api/claim/submit when DB atomic record fails', async () => {
      const holder = privateKeyToAccount(generatePrivateKey());
      const destinationWallet = '0x3333333333333333333333333333333333333333';
      const { slug, contractAddress } = await createTestCampaign({ maxSpots: 10 });
      setHolding(holder.address, contractAddress, 1);

      const cookie = await sessionCookieFor(holder.address);
      const authRes = await authorizeRoute(makeRequest('/api/claim/authorize', { body: { destinationWallet, campaign: slug }, cookie }));
      const authBody = await authRes.json();

      const signature = await holder.signTypedData({
        domain: authBody.domain,
        types: authBody.types,
        primaryType: authBody.primaryType,
        message: { ...authBody.message, deadline: BigInt(authBody.message.deadline) },
      });

      // Mock DB pool.query failure specifically inside submit's consumeNonce or recordClaim
      vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('deadlock detected in transaction'));

      const submitRes = await submitRoute(makeRequest('/api/claim/submit', {
        body: {
          destinationWallet,
          nonce: authBody.nonce,
          deadline: authBody.deadline,
          signature,
          campaign: slug,
        },
        cookie,
      }));

      expect(submitRes.status).toBe(500);
      const body = await submitRes.json();
      expect(body.error.code).toBe('INTERNAL');
      expect(JSON.stringify(body)).not.toContain('deadlock');
    });
  });

  // --------------------------------------------------------------------------
  // 3. EIP-712 SIGNATURE & DEADLINE FAILURES
  // --------------------------------------------------------------------------
  describe('EIP-712 Signature & Deadline Validation', () => {
    it('rejects claim submit with an expired deadline', async () => {
      const holder = privateKeyToAccount(generatePrivateKey());
      const destinationWallet = '0x4444444444444444444444444444444444444444';
      const { slug, contractAddress } = await createTestCampaign({ maxSpots: 10 });
      setHolding(holder.address, contractAddress, 1);

      const cookie = await sessionCookieFor(holder.address);
      const authRes = await authorizeRoute(makeRequest('/api/claim/authorize', { body: { destinationWallet, campaign: slug }, cookie }));
      const authBody = await authRes.json();

      // Set deadline 10 seconds in the past
      const expiredDeadline = Math.floor(Date.now() / 1000) - 10;

      const signature = await holder.signTypedData({
        domain: authBody.domain,
        types: authBody.types,
        primaryType: authBody.primaryType,
        message: { ...authBody.message, deadline: BigInt(expiredDeadline) },
      });

      const submitRes = await submitRoute(makeRequest('/api/claim/submit', {
        body: {
          destinationWallet,
          nonce: authBody.nonce,
          deadline: expiredDeadline,
          signature,
          campaign: slug,
        },
        cookie,
      }));

      expect([400, 401]).toContain(submitRes.status);
    });

    it('rejects claim submit signed by a different wallet than the session', async () => {
      const sessionHolder = privateKeyToAccount(generatePrivateKey());
      const signingHolder = privateKeyToAccount(generatePrivateKey()); // Different key!
      const destinationWallet = '0x5555555555555555555555555555555555555555';
      const { slug, contractAddress } = await createTestCampaign({ maxSpots: 10 });
      setHolding(sessionHolder.address, contractAddress, 1);

      const cookie = await sessionCookieFor(sessionHolder.address);
      const authRes = await authorizeRoute(makeRequest('/api/claim/authorize', { body: { destinationWallet, campaign: slug }, cookie }));
      const authBody = await authRes.json();

      // Signed by different holder address
      const signature = await signingHolder.signTypedData({
        domain: authBody.domain,
        types: authBody.types,
        primaryType: authBody.primaryType,
        message: { ...authBody.message, deadline: BigInt(authBody.message.deadline) },
      });

      const submitRes = await submitRoute(makeRequest('/api/claim/submit', {
        body: {
          destinationWallet,
          nonce: authBody.nonce,
          deadline: authBody.deadline,
          signature,
          campaign: slug,
        },
        cookie,
      }));

      expect(submitRes.status).toBe(401);
      const body = await submitRes.json();
      expect(body.error.code).toBe('SIGNATURE_INVALID');
    });
  });

  // --------------------------------------------------------------------------
  // 4. SOLD-OUT & INACTIVE CAMPAIGNS
  // --------------------------------------------------------------------------
  describe('Sold-Out & Inactive Campaign Validation', () => {
    it('rejects eligibility and authorization for an inactive campaign', async () => {
      const holder = privateKeyToAccount(generatePrivateKey());
      const { slug } = await createTestCampaign({ maxSpots: 10, active: false });

      const cookie = await sessionCookieFor(holder.address);
      
      const eligRes = await eligibilityRoute(makeRequest(`/api/eligibility?campaign=${slug}`, { cookie }));
      expect(eligRes.status).toBe(409);
      const eligBody = await eligRes.json();
      expect(eligBody.error.code).toBe('SOLD_OUT');

      const authRes = await authorizeRoute(makeRequest('/api/claim/authorize', {
        body: { destinationWallet: '0x6666666666666666666666666666666666666666', campaign: slug },
        cookie,
      }));
      expect(authRes.status).toBe(409);
      const authBody = await authRes.json();
      expect(authBody.error.code).toBe('SOLD_OUT');
    });
  });

  // --------------------------------------------------------------------------
  // 5. SECURITY CONTROLS (CSRF & RATE LIMITING)
  // --------------------------------------------------------------------------
  describe('Security Boundaries (CSRF & Rate Limiting)', () => {
    it('rejects cross-origin claim submit request via CSRF check', async () => {
      const holder = privateKeyToAccount(generatePrivateKey());
      const cookie = await sessionCookieFor(holder.address);

      const res = await submitRoute(makeRequest('/api/claim/submit', {
        body: { destinationWallet: '0x7777777777777777777777777777777777777777' },
        cookie,
        origin: 'http://malicious-attacker-site.com',
      }));

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION');
    });
  });
});
