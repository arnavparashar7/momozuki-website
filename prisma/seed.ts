import { randomUUID } from 'node:crypto';
import { pool } from '../lib/pg-pool';

/**
 * Seeds the Momozuki genesis whitelist campaign (single-collection ANY
 * mode, matching the product copy in reference/momozuki-3d.prototype.html:
 * 555 companions, 555 spots, one qualifying collection). Multi-collection
 * ANY/ALL support is proven separately by lib/eligibility.ts's unit tests -
 * this seed doesn't need to exercise that too.
 *
 * Uses the raw `pg` pool (same as lib/claims.ts / lib/nonce.ts - see
 * docs/DECISIONS.md D11) rather than Prisma Client, so it can run without
 * `prisma generate` having been completed.
 *
 * Idempotent: safe to re-run - upserts on the campaign's unique slug.
 *
 * Run with: pnpm db:seed
 */

const CAMPAIGN_SLUG = 'momozuki-genesis';
const GENESIS_CONTRACT_ADDRESS = '0x000000000000000000000000000000000000a1';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const campaignId = randomUUID();
    const upsertCampaign = await client.query<{ id: string }>(
      `INSERT INTO campaigns (id, slug, name, "eligibilityMode", "maxSpots", active, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Momozuki Genesis Whitelist', 'ANY', 555, true, now(), now())
       ON CONFLICT (slug) DO UPDATE SET "updatedAt" = now()
       RETURNING id`,
      [campaignId, CAMPAIGN_SLUG],
    );
    const id = upsertCampaign.rows[0]!.id;

    await client.query(
      `INSERT INTO campaign_collections (id, "campaignId", name, chain, "contractAddress", "minimumHeld", "createdAt")
       VALUES ($1, $2, 'Momozuki Genesis', 'ethereum', $3, 1, now())
       ON CONFLICT ("campaignId", chain, "contractAddress") DO NOTHING`,
      [randomUUID(), id, GENESIS_CONTRACT_ADDRESS],
    );

    await client.query('COMMIT');
    console.log(`Seeded campaign "${CAMPAIGN_SLUG}" (id=${id}) with 1 collection.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
