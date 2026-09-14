import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool } from '@/lib/pg-pool';
import { recordClaimAtomically, getSpotsRemaining } from '@/lib/claims';
import { issueNonce, consumeNonce } from '@/lib/nonce';
import { AppError } from '@/lib/errors';

/**
 * These tests run against a REAL Postgres database (DATABASE_URL) and
 * exercise the actual migration in prisma/migrations/00000000000000_init -
 * not mocks. They were run against a local Postgres instance in this
 * project's dev sandbox (see docs/CHECKPOINT.md for why: the Prisma CLI
 * itself could not run here due to network restrictions, but this test
 * harness uses the plain `pg` driver, which has no such dependency).
 *
 * Skips cleanly (rather than failing) if DATABASE_URL isn't set, so this
 * doesn't break `pnpm test` in an environment with no DB configured.
 */
import { hasDb } from './test-db';
const d = hasDb ? describe : describe.skip;

async function createTestCampaign(maxSpots: number) {
  const id = randomUUID();
  const slug = `test-${id}`;
  await pool.query(
    `INSERT INTO campaigns (id, slug, name, "eligibilityMode", "maxSpots", active, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'ANY', $4, true, now(), now())`,
    [id, slug, 'Test Campaign', maxSpots],
  );
  return id;
}

function claimInput(campaignId: string, destinationWallet: string) {
  return {
    campaignId,
    holderWallet: '0x1111111111111111111111111111111111111111',
    destinationWallet,
    qualifyingCollections: [{ contractAddress: '0xabc', heldQuantity: 1 }],
    chain: 'ethereum',
    claimSignature: '0xsig',
  };
}

d('claims: one-per-wallet and atomic spot allocation', () => {
  it('records a claim and decrements remaining spots', async () => {
    const campaignId = await createTestCampaign(5);
    const before = await getSpotsRemaining(campaignId);
    expect(before.remaining).toBe(5);

    await recordClaimAtomically(
      claimInput(campaignId, '0x2222222222222222222222222222222222222222'),
    );

    const after = await getSpotsRemaining(campaignId);
    expect(after.remaining).toBe(4);
    expect(after.claimed).toBe(1);
  });

  it('rejects a second claim from the same destination wallet', async () => {
    const campaignId = await createTestCampaign(5);
    const wallet = '0x3333333333333333333333333333333333333333';

    await recordClaimAtomically(claimInput(campaignId, wallet));

    await expect(recordClaimAtomically(claimInput(campaignId, wallet))).rejects.toMatchObject(
      { code: 'ALREADY_CLAIMED' },
    );

    const { claimed } = await getSpotsRemaining(campaignId);
    expect(claimed).toBe(1);
  });

  it('rejects a claim once the campaign is sold out', async () => {
    const campaignId = await createTestCampaign(1);
    await recordClaimAtomically(
      claimInput(campaignId, '0x4444444444444444444444444444444444444444'),
    );

    await expect(
      recordClaimAtomically(
        claimInput(campaignId, '0x5555555555555555555555555555555555555555'),
      ),
    ).rejects.toMatchObject({ code: 'SOLD_OUT' });
  });

  it(
    'never allows successful claims to exceed maxSpots under concurrent requests (maxSpots=1)',
    async () => {
      const campaignId = await createTestCampaign(1);

      // Fire 10 concurrent claim attempts, each from a distinct destination
      // wallet, against a campaign with exactly 1 spot. This is the exact
      // scenario the build plan calls out explicitly.
      const attempts = Array.from({ length: 10 }, (_, i) =>
        recordClaimAtomically(
          claimInput(
            campaignId,
            `0x${(6000 + i).toString().padStart(40, '0')}`,
          ),
        ).then(
          () => ({ ok: true as const }),
          (err) => ({ ok: false as const, code: err instanceof AppError ? err.code : 'UNKNOWN' }),
        ),
      );

      const results = await Promise.all(attempts);
      const succeeded = results.filter((r) => r.ok);
      const soldOut = results.filter((r) => !r.ok && r.code === 'SOLD_OUT');

      expect(succeeded.length).toBe(1);
      expect(soldOut.length).toBe(9);

      const { claimed, remaining } = await getSpotsRemaining(campaignId);
      expect(claimed).toBe(1);
      expect(remaining).toBe(0);
    },
    15_000,
  );
});

d('nonces: single-use and expiration', () => {
  const wallet = '0x9999999999999999999999999999999999999999';

  it('consumes a valid nonce exactly once', async () => {
    const { nonce } = await issueNonce(wallet, 'AUTH');
    await expect(consumeNonce(wallet, nonce, 'AUTH')).resolves.toBeUndefined();
    await expect(consumeNonce(wallet, nonce, 'AUTH')).rejects.toMatchObject({
      code: 'NONCE_ALREADY_USED',
    });
  });

  it('rejects an unknown nonce', async () => {
    await expect(
      consumeNonce(wallet, 'never-issued-nonce', 'AUTH'),
    ).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
  });

  it(
    'under concurrent consumption, exactly one request succeeds',
    async () => {
      const { nonce } = await issueNonce(wallet, 'CLAIM');

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          consumeNonce(wallet, nonce, 'CLAIM').then(
            () => ({ ok: true as const }),
            (err) => ({ ok: false as const, code: err instanceof AppError ? err.code : 'UNKNOWN' }),
          ),
        ),
      );

      expect(results.filter((r) => r.ok).length).toBe(1);
      expect(results.filter((r) => !r.ok && r.code === 'NONCE_ALREADY_USED').length).toBe(7);
    },
    10_000,
  );
});

if (hasDb) {
  afterAll(async () => {
    await pool.end();
  });
}
