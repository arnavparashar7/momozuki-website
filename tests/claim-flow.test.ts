import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { pool } from '@/lib/pg-pool';
import { createWalletSessionToken } from '@/lib/session';
import { WALLET_SESSION_COOKIE } from '@/lib/session';
import { _resetRateLimitsForTests } from '@/lib/rate-limit';

/**
 * Full claim-flow integration tests. Runs against a REAL Postgres database
 * and calls the actual route handlers with real Web `Request` objects
 * (including a real signed session cookie, and real EIP-712 signatures via
 * viem - no browser needed). The one thing that can't be real here is
 * Alchemy (no API key in this environment - see docs/CHECKPOINT.md), so
 * `lib/alchemy`'s `getHeldQuantity` is mocked to return deterministic
 * holdings per test. Everything downstream of that one seam - eligibility
 * evaluation, EIP-712 verification, nonce consumption, atomic claim
 * recording including the maxSpots=1 concurrency guarantee - is real.
 */

const mockHoldings = new Map<string, number>(); // key: `${wallet}:${contractAddress}`

vi.mock('@/lib/alchemy', () => ({
  getHeldQuantity: vi.fn(async (_chain: string, wallet: string, contractAddress: string) => {
    return mockHoldings.get(`${wallet.toLowerCase()}:${contractAddress}`) ?? 0;
  }),
}));

// Imported AFTER the mock is registered (vi.mock is hoisted by Vitest, so
// this ordering in source doesn't actually matter, but keeping it here for
// readability).
const { POST: authorize } = await import('@/app/api/claim/authorize/route');
const { POST: submit } = await import('@/app/api/claim/submit/route');

import { hasDb } from './test-db';
const d = hasDb ? describe : describe.skip;

function setHolding(wallet: string, contractAddress: string, quantity: number) {
  mockHoldings.set(`${wallet.toLowerCase()}:${contractAddress}`, quantity);
}

async function createTestCampaign(opts: { maxSpots: number; minimumHeld?: number }) {
  const campaignId = randomUUID();
  const slug = `claim-test-${campaignId}`;
  const contractAddress = `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`;

  await pool.query(
    `INSERT INTO campaigns (id, slug, name, "eligibilityMode", "maxSpots", active, "createdAt", "updatedAt")
     VALUES ($1, $2, 'Claim Test Campaign', 'ANY', $3, true, now(), now())`,
    [campaignId, slug, opts.maxSpots],
  );
  await pool.query(
    `INSERT INTO campaign_collections (id, "campaignId", name, chain, "contractAddress", "minimumHeld", "createdAt")
     VALUES ($1, $2, 'Test Collection', 'ethereum', $3, $4, now())`,
    [randomUUID(), campaignId, contractAddress, opts.minimumHeld ?? 1],
  );

  return { campaignId, slug, contractAddress };
}

async function sessionCookieFor(wallet: string): Promise<string> {
  const token = await createWalletSessionToken(wallet);
  return `${WALLET_SESSION_COOKIE}=${token}`;
}

function postJson(path: string, body: unknown, cookie?: string): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

d('claim flow', () => {
  beforeEach(() => {
    mockHoldings.clear();
    _resetRateLimitsForTests();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rejects authorize/submit without a wallet session', async () => {
    const authRes = await authorize(postJson('/api/claim/authorize', {}));
    expect(authRes.status).toBe(401);

    const submitRes = await submit(postJson('/api/claim/submit', {}));
    expect(submitRes.status).toBe(401);
  });

  it('rejects authorize for an ineligible wallet', async () => {
    const holder = privateKeyToAccount(generatePrivateKey());
    const { slug, contractAddress } = await createTestCampaign({ maxSpots: 10 });
    setHolding(holder.address, contractAddress, 0); // holds nothing

    const cookie = await sessionCookieFor(holder.address.toLowerCase());
    const res = await authorize(
      postJson(
        '/api/claim/authorize',
        { destinationWallet: '0x2222222222222222222222222222222222222222', campaign: slug },
        cookie,
      ),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('INELIGIBLE');
  });

  it('rejects authorize for a malformed destination wallet', async () => {
    const holder = privateKeyToAccount(generatePrivateKey());
    const { slug, contractAddress } = await createTestCampaign({ maxSpots: 10 });
    setHolding(holder.address, contractAddress, 1);

    const cookie = await sessionCookieFor(holder.address.toLowerCase());
    const res = await authorize(
      postJson('/api/claim/authorize', { destinationWallet: 'not-an-address', campaign: slug }, cookie),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_DESTINATION_WALLET');
  });

  it('completes the full authorize -> sign -> submit flow for an eligible wallet', async () => {
    const holder = privateKeyToAccount(generatePrivateKey());
    const destinationWallet = '0x3333333333333333333333333333333333333333';
    const { slug, contractAddress } = await createTestCampaign({ maxSpots: 10 });
    setHolding(holder.address, contractAddress, 1);

    const cookie = await sessionCookieFor(holder.address.toLowerCase());

    const authRes = await authorize(
      postJson('/api/claim/authorize', { destinationWallet, campaign: slug }, cookie),
    );
    expect(authRes.status).toBe(200);
    const authBody = await authRes.json();
    expect(authBody.matchedCollections).toHaveLength(1);

    const signature = await holder.signTypedData({
      domain: authBody.domain,
      types: authBody.types,
      primaryType: authBody.primaryType,
      message: {
        ...authBody.message,
        deadline: BigInt(authBody.message.deadline),
      },
    });

    const submitRes = await submit(
      postJson(
        '/api/claim/submit',
        {
          destinationWallet,
          nonce: authBody.nonce,
          deadline: authBody.deadline,
          signature,
          campaign: slug,
        },
        cookie,
      ),
    );
    expect(submitRes.status).toBe(200);
    const submitBody = await submitRes.json();
    expect(submitBody.destinationWallet).toBe(destinationWallet.toLowerCase());

    // Verify against the DB directly, not just trusting the response.
    const row = await pool.query('SELECT * FROM claims WHERE id = $1', [submitBody.claimId]);
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].destinationWallet).toBe(destinationWallet.toLowerCase());
  });

  it('rejects submit with a tampered destination wallet (signature no longer matches)', async () => {
    const holder = privateKeyToAccount(generatePrivateKey());
    const destinationWallet = '0x4444444444444444444444444444444444444444';
    const attackerDestination = '0x5555555555555555555555555555555555555555';
    const { slug, contractAddress } = await createTestCampaign({ maxSpots: 10 });
    setHolding(holder.address, contractAddress, 1);

    const cookie = await sessionCookieFor(holder.address.toLowerCase());
    const authRes = await authorize(
      postJson('/api/claim/authorize', { destinationWallet, campaign: slug }, cookie),
    );
    const authBody = await authRes.json();

    const signature = await holder.signTypedData({
      domain: authBody.domain,
      types: authBody.types,
      primaryType: authBody.primaryType,
      message: { ...authBody.message, deadline: BigInt(authBody.message.deadline) },
    });

    // Attacker submits the same signature but swaps the destination wallet.
    const submitRes = await submit(
      postJson(
        '/api/claim/submit',
        {
          destinationWallet: attackerDestination,
          nonce: authBody.nonce,
          deadline: authBody.deadline,
          signature,
          campaign: slug,
        },
        cookie,
      ),
    );
    expect(submitRes.status).toBe(401);
    const body = await submitRes.json();
    expect(body.error.code).toBe('SIGNATURE_INVALID');
  });

  it('rejects a second claim attempt for the same destination wallet (already claimed)', async () => {
    const holder = privateKeyToAccount(generatePrivateKey());
    const destinationWallet = '0x6666666666666666666666666666666666666666';
    const { slug, contractAddress } = await createTestCampaign({ maxSpots: 10 });
    setHolding(holder.address, contractAddress, 1);
    const cookie = await sessionCookieFor(holder.address.toLowerCase());

    async function runClaim() {
      const authRes = await authorize(
        postJson('/api/claim/authorize', { destinationWallet, campaign: slug }, cookie),
      );
      const authBody = await authRes.json();
      if (authRes.status !== 200) return { authStatus: authRes.status, authBody };
      const signature = await holder.signTypedData({
        domain: authBody.domain,
        types: authBody.types,
        primaryType: authBody.primaryType,
        message: { ...authBody.message, deadline: BigInt(authBody.message.deadline) },
      });
      const submitRes = await submit(
        postJson(
          '/api/claim/submit',
          { destinationWallet, nonce: authBody.nonce, deadline: authBody.deadline, signature, campaign: slug },
          cookie,
        ),
      );
      return { authStatus: authRes.status, submitStatus: submitRes.status, submitBody: await submitRes.json() };
    }

    const first = await runClaim();
    expect(first.submitStatus).toBe(200);

    const second = await runClaim();
    // Caught at authorize time via hasClaimed() - a UX nicety, not the
    // security boundary (that's the unique constraint + atomic transaction,
    // proven separately in tests/db-constraints.test.ts).
    expect(second.authStatus).toBe(409);
  });

  it(
    'never allows successful claims to exceed maxSpots under concurrent submissions through the real route (maxSpots=1)',
    async () => {
      const { slug, contractAddress, campaignId } = await createTestCampaign({ maxSpots: 1 });

      // 6 distinct eligible holders, each claiming to a distinct destination
      // wallet, all racing for the campaign's single spot.
      const attempts = await Promise.all(
        Array.from({ length: 6 }, async (_, i) => {
          const holder = privateKeyToAccount(generatePrivateKey());
          const destinationWallet = `0x${(7000 + i).toString().padStart(40, '0')}`;
          setHolding(holder.address, contractAddress, 1);
          const cookie = await sessionCookieFor(holder.address.toLowerCase());

          const authRes = await authorize(
            postJson('/api/claim/authorize', { destinationWallet, campaign: slug }, cookie),
          );
          const authBody = await authRes.json();
          if (authRes.status !== 200) {
            return { ok: false as const, stage: 'authorize', status: authRes.status };
          }
          const signature = await holder.signTypedData({
            domain: authBody.domain,
            types: authBody.types,
            primaryType: authBody.primaryType,
            message: { ...authBody.message, deadline: BigInt(authBody.message.deadline) },
          });
          const submitRes = await submit(
            postJson(
              '/api/claim/submit',
              { destinationWallet, nonce: authBody.nonce, deadline: authBody.deadline, signature, campaign: slug },
              cookie,
            ),
          );
          return { ok: submitRes.status === 200, stage: 'submit', status: submitRes.status };
        }),
      );

      const succeeded = attempts.filter((a) => a.ok);
      expect(succeeded.length).toBe(1);

      const claimedCount = await pool.query('SELECT count(*)::int AS n FROM claims WHERE "campaignId" = $1', [
        campaignId,
      ]);
      expect(claimedCount.rows[0].n).toBe(1);
    },
    20_000,
  );
});
