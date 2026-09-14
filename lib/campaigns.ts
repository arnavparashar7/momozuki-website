import { pool } from '@/lib/pg-pool';
import { AppError, ErrorCode } from '@/lib/errors';
import type { CampaignEligibilityConfig } from '@/lib/eligibility';

/**
 * Which campaign the public site targets when no ?campaign=<slug> is given.
 * Centralized here rather than repeated as a string literal in every route
 * that needs a default.
 */
export const DEFAULT_CAMPAIGN_SLUG = 'momozuki-genesis';

/**
 * Raw SQL rather than Prisma Client, for the same reason as lib/claims.ts /
 * lib/nonce.ts - see docs/DECISIONS.md D11. These reads aren't
 * concurrency-critical like claim recording, but staying on one data-access
 * approach for now means this code actually runs and is tested in this
 * project's sandbox (Prisma CLI still can't run here). Fine to migrate to
 * Prisma Client later once `prisma generate` succeeds somewhere.
 */

export interface CampaignRecord extends CampaignEligibilityConfig {
  id: string;
  slug: string;
  name: string;
  maxSpots: number;
  active: boolean;
}

export async function getCampaignBySlug(slug: string): Promise<CampaignRecord> {
  const campaignRes = await pool.query<{
    id: string;
    slug: string;
    name: string;
    eligibilityMode: 'ANY' | 'ALL';
    maxSpots: number;
    active: boolean;
  }>(
    `SELECT id, slug, name, "eligibilityMode", "maxSpots", active
       FROM campaigns WHERE slug = $1`,
    [slug],
  );
  const campaign = campaignRes.rows[0];
  if (!campaign) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Campaign not found.');
  }

  const collectionsRes = await pool.query<{
    id: string;
    name: string;
    chain: string;
    contractAddress: string;
    minimumHeld: number;
  }>(
    `SELECT id, name, chain, "contractAddress", "minimumHeld"
       FROM campaign_collections
      WHERE "campaignId" = $1
      ORDER BY "createdAt" ASC`,
    [campaign.id],
  );

  return {
    id: campaign.id,
    slug: campaign.slug,
    name: campaign.name,
    eligibilityMode: campaign.eligibilityMode,
    maxSpots: campaign.maxSpots,
    active: campaign.active,
    collections: collectionsRes.rows,
  };
}
