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

export const ELIGIBLE_COLLECTIONS = [
  { name: 'Collection 0x116e', contractAddress: '0x116eaa62241751e0c98da43d458600c6c17cd361', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Collection 0x12a4', contractAddress: '0x12a4c7659a4b7c4a2870b5167c4f8b014c7fa690', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Pudgy Penguins', contractAddress: '0xbd3531da5cf5857e7cfaa92426877b022e612cf8', chain: 'ethereum', minimumHeld: 1 },
  { name: 'CryptoPunks', contractAddress: '0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Bored Ape Yacht Club', contractAddress: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Mutant Ape Yacht Club', contractAddress: '0x60e4d786628fea6478f785a6d7e704777c86a7c6', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Collection 0x86ff', contractAddress: '0x86ffb7988913e85a5a07d459a5165ab1273cfe62', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Collection 0x539c', contractAddress: '0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Collection 0xca75', contractAddress: '0xca75df55cc9c476db27a7375d1fc8e794cf80721', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Collection 0x027a', contractAddress: '0x027aca2794e44f24950d81227dcd516ffbb49d6e', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Collection 0x387c', contractAddress: '0x387c41b0b2f1128de44db1bcf8baad085f26392c', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Doodles', contractAddress: '0x8a90cab2b38dba80c64b7734e58ee1db38b8992e', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Azuki', contractAddress: '0xed5af388653567af2f388e6224dc7c4b3241c544', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Collection 0x9eb6', contractAddress: '0x9eb6e2025b64f340691e424b7fe7022ffde12438', chain: 'ethereum', minimumHeld: 1 },
  { name: 'VeeFriends', contractAddress: '0xa3aee8bce55beea1951ef834b99f3ac60d1abeeb', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Moonbirds', contractAddress: '0x23581767a106ae21c074b2276d25e5c3e136a68b', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Milady Maker', contractAddress: '0x5af0d9827e0c53e4799bb226655a1de152a425a5', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Collection 0x0000', contractAddress: '0x0000ec93127baa929e58e97dd0095a2bfb38ec1d', chain: 'ethereum', minimumHeld: 1 },
  { name: 'CyberKongz', contractAddress: '0x57a204aa1042f6e66dd7730813f4024114d74f37', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Collection 0xd4b7', contractAddress: '0xd4b7d9bb20fa20ddada9ecef8a7355ca983cccb1', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Collection 0xb8ea', contractAddress: '0xb8ea78fcacef50d41375e44e6814ebba36bb33c4', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Nouns', contractAddress: '0x9c8ff314c9bc7f6e59a9d9225fb22946427edc03', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Collection 0x307a', contractAddress: '0x307af7d28afee82092aa95d35644898311ca5360', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Meebits', contractAddress: '0x7bd29408f11d2bfc23c34f18275bbf23bb716bc7', chain: 'ethereum', minimumHeld: 1 },
  { name: 'Collection 0x1faf', contractAddress: '0x1fafd33d882e1c275c61066019a23c1999b5006e', chain: 'ethereum', minimumHeld: 1 },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const campaignId = randomUUID();
    const upsertCampaign = await client.query<{ id: string }>(
      `INSERT INTO campaigns (id, slug, name, "eligibilityMode", "maxSpots", active, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Momozuki Genesis Whitelist', 'ANY', 555, true, now(), now())
       ON CONFLICT (slug) DO UPDATE SET "eligibilityMode" = 'ANY', "updatedAt" = now()
       RETURNING id`,
      [campaignId, CAMPAIGN_SLUG],
    );
    const id = upsertCampaign.rows[0]!.id;

    // Remove old test collections for this campaign
    await client.query(`DELETE FROM campaign_collections WHERE "campaignId" = $1`, [id]);

    for (const col of ELIGIBLE_COLLECTIONS) {
      await client.query(
        `INSERT INTO campaign_collections (id, "campaignId", name, chain, "contractAddress", "minimumHeld", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT ("campaignId", chain, "contractAddress") DO UPDATE SET "minimumHeld" = $6, name = $3`,
        [randomUUID(), id, col.name, col.chain, col.contractAddress.toLowerCase(), col.minimumHeld],
      );
    }

    await client.query('COMMIT');
    console.log(`Seeded campaign "${CAMPAIGN_SLUG}" (id=${id}) with ${ELIGIBLE_COLLECTIONS.length} collections.`);
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

