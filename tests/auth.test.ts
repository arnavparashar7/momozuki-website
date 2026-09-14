import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { pool } from '@/lib/pg-pool';
import { issueNonce } from '@/lib/nonce';
import { buildAuthMessage } from '@/lib/auth-message';
import { verifyWalletSessionToken, WALLET_SESSION_COOKIE } from '@/lib/session';
import { normalizeAddress } from '@/lib/wallet';
import { _resetRateLimitsForTests } from '@/lib/rate-limit';
import { POST as nonceRoute } from '@/app/api/auth/nonce/route';
import { POST as verifyRoute } from '@/app/api/auth/verify/route';

/**
 * Runs against a REAL Postgres database (DATABASE_URL) and calls the actual
 * route handlers directly (not mocked) with real Web `Request` objects.
 * Signatures are produced with viem's local account signing - real
 * cryptography, no browser/wallet extension needed. Skips cleanly if
 * DATABASE_URL isn't set.
 */
import { hasDb } from './test-db';
const d = hasDb ? describe : describe.skip;

function postJson(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function requestNonce(wallet: string) {
  const res = await nonceRoute(postJson('/api/auth/nonce', { wallet }));
  const body = (await res.json()) as { nonce: string; message: string; expiresAt: string };
  return { status: res.status, ...body };
}

d('wallet auth flow', () => {
  afterAll(async () => {
    await pool.end();
  });

  beforeEach(() => {
    _resetRateLimitsForTests();
  });

  it('issues a nonce and a message to sign for a valid address', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { status, nonce, message } = await requestNonce(account.address);

    expect(status).toBe(200);
    expect(nonce).toHaveLength(64); // 32 random bytes, hex-encoded
    expect(message).toContain(normalizeAddress(account.address));
    expect(message).toContain(nonce);
  });

  it('rejects nonce issuance for a malformed address', async () => {
    const res = await nonceRoute(postJson('/api/auth/nonce', { wallet: 'not-an-address' }));
    expect(res.status).toBe(400);
  });

  it('accepts a valid signature and issues a session cookie for the verified wallet', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { nonce, message } = await requestNonce(account.address);
    const signature = await account.signMessage({ message });

    const res = await verifyRoute(
      postJson('/api/auth/verify', { wallet: account.address, nonce, signature }),
    );
    expect(res.status).toBe(200);

    const token = res.cookies.get(WALLET_SESSION_COOKIE)?.value;
    expect(token).toBeTruthy();

    const sessionWallet = await verifyWalletSessionToken(token);
    expect(sessionWallet).toBe(normalizeAddress(account.address));
  });

  it('rejects an invalid signature', async () => {
    const claimedAccount = privateKeyToAccount(generatePrivateKey());
    const attackerAccount = privateKeyToAccount(generatePrivateKey());
    const { nonce, message } = await requestNonce(claimedAccount.address);

    // Signed by a different key than the wallet address being claimed.
    const signature = await attackerAccount.signMessage({ message });

    const res = await verifyRoute(
      postJson('/api/auth/verify', {
        wallet: claimedAccount.address,
        nonce,
        signature,
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('SIGNATURE_INVALID');
  });

  it('rejects wallet mismatch (correct signature, wrong claimed address)', async () => {
    // Attacker requests a nonce under their OWN address, signs correctly,
    // then tries to submit it while claiming a victim's address instead.
    const attackerAccount = privateKeyToAccount(generatePrivateKey());
    const victimAccount = privateKeyToAccount(generatePrivateKey());
    const { nonce, message } = await requestNonce(attackerAccount.address);
    const signature = await attackerAccount.signMessage({ message });

    const res = await verifyRoute(
      postJson('/api/auth/verify', {
        wallet: victimAccount.address, // claiming to be the victim
        nonce,
        signature,
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('SIGNATURE_INVALID');
  });

  it('rejects an expired nonce even with a valid signature', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const wallet = normalizeAddress(account.address);

    // Issue a nonce that is already expired (ttlMs is negative).
    const { nonce } = await issueNonce(wallet, 'AUTH', { ttlMs: -1000 });
    const message = buildAuthMessage(wallet, nonce);
    const signature = await account.signMessage({ message });

    const res = await verifyRoute(postJson('/api/auth/verify', { wallet, nonce, signature }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('NONCE_EXPIRED');
  });

  it('rejects reuse of an already-consumed nonce', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { nonce, message } = await requestNonce(account.address);
    const signature = await account.signMessage({ message });

    const first = await verifyRoute(
      postJson('/api/auth/verify', { wallet: account.address, nonce, signature }),
    );
    expect(first.status).toBe(200);

    const second = await verifyRoute(
      postJson('/api/auth/verify', { wallet: account.address, nonce, signature }),
    );
    expect(second.status).toBe(401);
    const body = await second.json();
    expect(body.error.code).toBe('NONCE_ALREADY_USED');
  });

  it('supports reconnect: a fresh nonce + sign cycle works again after a prior successful auth', async () => {
    const account = privateKeyToAccount(generatePrivateKey());

    const first = await requestNonce(account.address);
    const firstSig = await account.signMessage({ message: first.message });
    const firstVerify = await verifyRoute(
      postJson('/api/auth/verify', {
        wallet: account.address,
        nonce: first.nonce,
        signature: firstSig,
      }),
    );
    expect(firstVerify.status).toBe(200);

    // Simulate disconnect + reconnect: request a brand new nonce and
    // complete the flow again.
    const second = await requestNonce(account.address);
    expect(second.nonce).not.toBe(first.nonce);
    const secondSig = await account.signMessage({ message: second.message });
    const secondVerify = await verifyRoute(
      postJson('/api/auth/verify', {
        wallet: account.address,
        nonce: second.nonce,
        signature: secondSig,
      }),
    );
    expect(secondVerify.status).toBe(200);
  });
});
