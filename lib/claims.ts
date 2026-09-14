import { randomUUID } from 'node:crypto';
import { pool } from '@/lib/pg-pool';
import { AppError, ErrorCode } from '@/lib/errors';

/**
 * See docs/DECISIONS.md D11 for why this uses raw SQL instead of Prisma
 * Client, and docs/ARCHITECTURE.md §3 / DECISIONS.md D3 for why spot count
 * is derived rather than stored.
 *
 * Concurrency strategy (finalized this checkpoint): `SELECT ... FOR UPDATE`
 * on the campaign row inside a transaction. This serializes concurrent claim
 * attempts *for the same campaign* - the first transaction to acquire the
 * lock counts existing claims, decides if a spot is available, and either
 * inserts or aborts; every other concurrent attempt blocks until it commits
 * or rolls back, then repeats the check against the now-current count.
 * Postgres's default READ COMMITTED isolation is sufficient here (no need
 * for SERIALIZABLE + retry logic) because the row lock itself is what
 * prevents the race, not the isolation level.
 *
 * The `claims_campaignId_destinationWallet_key` unique index is defense in
 * depth: even if this function were ever called outside a proper lock (a
 * bug, a future code path), Postgres itself still refuses a second claim row
 * for the same (campaign, destinationWallet) pair.
 */

export interface RecordClaimInput {
  campaignId: string;
  holderWallet: string; // must already be normalized (lib/wallet.ts)
  destinationWallet: string; // must already be normalized
  qualifyingCollections: unknown; // JSON-serializable eligibility snapshot
  chain: string;
  claimSignature: string;
}

export interface RecordedClaim {
  id: string;
  campaignId: string;
  holderWallet: string;
  destinationWallet: string;
  createdAt: Date;
}

export async function recordClaimAtomically(
  input: RecordClaimInput,
): Promise<RecordedClaim> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the campaign row for the duration of this transaction. Any other
    // concurrent claim attempt against the same campaign blocks here until
    // this transaction commits or rolls back.
    const campaignRes = await client.query<{
      id: string;
      maxSpots: number;
      active: boolean;
    }>('SELECT id, "maxSpots", active FROM campaigns WHERE id = $1 FOR UPDATE', [
      input.campaignId,
    ]);

    const campaign = campaignRes.rows[0];
    if (!campaign) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Campaign not found.');
    }
    if (!campaign.active) {
      throw new AppError(ErrorCode.SOLD_OUT, 'This campaign is not currently active.');
    }

    // Existing claim for this destination wallet? (Also covered by the
    // unique index below, but checking here gives a precise error instead
    // of a generic constraint-violation catch.)
    const existing = await client.query('SELECT id FROM claims WHERE "campaignId" = $1 AND "destinationWallet" = $2', [
      input.campaignId,
      input.destinationWallet,
    ]);
    if ((existing.rowCount ?? 0) > 0) {
      throw new AppError(ErrorCode.ALREADY_CLAIMED);
    }

    const countRes = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM claims WHERE "campaignId" = $1',
      [input.campaignId],
    );
    const claimedCount = Number(countRes.rows[0]?.count ?? '0');

    if (claimedCount >= campaign.maxSpots) {
      throw new AppError(ErrorCode.SOLD_OUT);
    }

    const id = randomUUID();
    const insertRes = await client.query<{
      id: string;
      campaignId: string;
      holderWallet: string;
      destinationWallet: string;
      createdAt: Date;
    }>(
      `INSERT INTO claims
         (id, "campaignId", "holderWallet", "destinationWallet",
          "qualifyingCollections", chain, "claimSignature", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
       RETURNING id, "campaignId", "holderWallet", "destinationWallet", "createdAt"`,
      [
        id,
        input.campaignId,
        input.holderWallet,
        input.destinationWallet,
        JSON.stringify(input.qualifyingCollections),
        input.chain,
        input.claimSignature,
      ],
    );

    await client.query('COMMIT');
    const row = insertRes.rows[0];
    if (!row) {
      // Should be unreachable - INSERT ... RETURNING always returns the row
      // it just inserted inside a committed transaction.
      throw new AppError(ErrorCode.INTERNAL);
    }
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    // Unique-violation from the destinationWallet index (Postgres error
    // code 23505) is the defense-in-depth path mentioned above.
    if (isUniqueViolation(err)) {
      throw new AppError(ErrorCode.ALREADY_CLAIMED);
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function hasClaimed(
  campaignId: string,
  destinationWallet: string,
): Promise<boolean> {
  const res = await pool.query(
    'SELECT 1 FROM claims WHERE "campaignId" = $1 AND "destinationWallet" = $2 LIMIT 1',
    [campaignId, destinationWallet],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function getSpotsRemaining(campaignId: string): Promise<{
  maxSpots: number;
  claimed: number;
  remaining: number;
}> {
  const res = await pool.query<{ maxSpots: number; claimed: string }>(
    `SELECT c."maxSpots" AS "maxSpots", count(cl.id)::text AS claimed
       FROM campaigns c
       LEFT JOIN claims cl ON cl."campaignId" = c.id
      WHERE c.id = $1
      GROUP BY c.id, c."maxSpots"`,
    [campaignId],
  );
  const row = res.rows[0];
  if (!row) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Campaign not found.');
  }
  const claimed = Number(row.claimed);
  return { maxSpots: row.maxSpots, claimed, remaining: row.maxSpots - claimed };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
