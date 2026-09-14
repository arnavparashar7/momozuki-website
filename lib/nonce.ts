import { randomUUID, randomBytes } from 'node:crypto';
import { pool } from '@/lib/pg-pool';
import { AppError, ErrorCode } from '@/lib/errors';

/**
 * See docs/DECISIONS.md D11 for why this uses raw SQL instead of Prisma
 * Client for now.
 *
 * Single-use is enforced by an atomic `UPDATE ... WHERE "consumedAt" IS NULL
 * ... RETURNING`: if two requests race to consume the same nonce, at most
 * one UPDATE affects a row (Postgres serializes concurrent updates to the
 * same row), so the second caller reliably gets zero rows back rather than
 * a race where both could read "unconsumed" before either writes.
 */

export type NoncePurpose = 'AUTH' | 'CLAIM';

const NONCE_TTL_MS = {
  AUTH: 10 * 60 * 1000, // 10 minutes to complete the wallet-auth signing flow
  CLAIM: 5 * 60 * 1000, // 5 minutes to complete the claim-authorization signing flow
} as const;

export async function issueNonce(
  wallet: string, // must already be normalized (lib/wallet.ts)
  purpose: NoncePurpose,
  // ttlMs override exists solely so tests can deterministically produce an
  // already-expired nonce without sleeping; no production caller should
  // pass this.
  opts?: { ttlMs?: number },
): Promise<{ nonce: string; expiresAt: Date }> {
  const nonce = randomBytes(32).toString('hex');
  const ttlMs = opts?.ttlMs ?? NONCE_TTL_MS[purpose];
  const expiresAt = new Date(Date.now() + ttlMs);
  const id = randomUUID();

  await pool.query(
    `INSERT INTO auth_nonces (id, wallet, nonce, purpose, "expiresAt", "createdAt")
     VALUES ($1, $2, $3, $4, $5, now())`,
    [id, wallet, nonce, purpose, expiresAt],
  );

  return { nonce, expiresAt };
}

/**
 * Atomically marks a nonce as consumed and returns it, or throws a specific
 * AppError distinguishing "never existed / wrong wallet", "expired", and
 * "already used" - each maps to a distinct user-facing message.
 */
export async function consumeNonce(
  wallet: string,
  nonce: string,
  purpose: NoncePurpose,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<{
      id: string;
      expiresAt: Date;
      consumedAt: Date | null;
    }>(
      `SELECT id, "expiresAt", "consumedAt" FROM auth_nonces
        WHERE wallet = $1 AND nonce = $2 AND purpose = $3
        FOR UPDATE`,
      [wallet, nonce, purpose],
    );

    const row = existing.rows[0];
    if (!row) {
      throw new AppError(ErrorCode.SIGNATURE_INVALID, 'Unknown or mismatched challenge.');
    }
    if (row.consumedAt) {
      throw new AppError(ErrorCode.NONCE_ALREADY_USED);
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new AppError(ErrorCode.NONCE_EXPIRED);
    }

    const updateRes = await client.query(
      `UPDATE auth_nonces SET "consumedAt" = now()
        WHERE id = $1 AND "consumedAt" IS NULL`,
      [row.id],
    );
    if ((updateRes.rowCount ?? 0) === 0) {
      // Lost the race between our SELECT and UPDATE to a concurrent
      // consumer - treat identically to "already used".
      throw new AppError(ErrorCode.NONCE_ALREADY_USED);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
