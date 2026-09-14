import { pool } from '@/lib/pg-pool';
import { getCampaignBySlug } from '@/lib/campaigns';

export interface DashboardMetrics {
  campaign: {
    id: string;
    slug: string;
    name: string;
    eligibilityMode: 'ANY' | 'ALL';
    active: boolean;
    maxSpots: number;
    collections: Array<{
      id: string;
      name: string;
      chain: string;
      contractAddress: string;
      minimumHeld: number;
    }>;
  };
  totalSpots: number;
  claimedSpots: number;
  remainingSpots: number;
  percentageClaimed: number;
}

export async function getDashboardMetrics(slug: string): Promise<DashboardMetrics> {
  const campaign = await getCampaignBySlug(slug);

  const countRes = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM claims WHERE "campaignId" = $1',
    [campaign.id],
  );
  const claimedSpots = Number(countRes.rows[0]?.count ?? '0');
  const remainingSpots = Math.max(0, campaign.maxSpots - claimedSpots);
  const percentageClaimed =
    campaign.maxSpots > 0 ? Math.round((claimedSpots / campaign.maxSpots) * 1000) / 10 : 0;

  return {
    campaign: {
      id: campaign.id,
      slug: campaign.slug,
      name: campaign.name,
      eligibilityMode: campaign.eligibilityMode,
      active: campaign.active,
      maxSpots: campaign.maxSpots,
      collections: campaign.collections,
    },
    totalSpots: campaign.maxSpots,
    claimedSpots,
    remainingSpots,
    percentageClaimed,
  };
}

export interface ClaimRow {
  id: string;
  holderWallet: string;
  destinationWallet: string;
  chain: string;
  qualifyingCollections: unknown;
  status: string;
  createdAt: Date;
}

export interface ListClaimsOptions {
  campaignId: string;
  search?: string;
  chain?: string;
  limit?: number;
  offset?: number;
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function listClaims(
  opts: ListClaimsOptions,
): Promise<{ claims: ClaimRow[]; total: number }> {
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = Math.max(opts.offset ?? 0, 0);

  const conditions: string[] = ['"campaignId" = $1'];
  const params: unknown[] = [opts.campaignId];

  if (opts.search) {
    params.push(`%${opts.search.toLowerCase()}%`);
    conditions.push(`(lower("holderWallet") LIKE $${params.length} OR lower("destinationWallet") LIKE $${params.length})`);
  }
  if (opts.chain) {
    params.push(opts.chain);
    conditions.push(`chain = $${params.length}`);
  }

  const where = conditions.join(' AND ');

  const totalRes = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM claims WHERE ${where}`,
    params,
  );
  const total = Number(totalRes.rows[0]?.count ?? '0');

  params.push(limit);
  params.push(offset);
  const rowsRes = await pool.query<ClaimRow>(
    `SELECT id, "holderWallet", "destinationWallet", chain, "qualifyingCollections", status, "createdAt"
       FROM claims
      WHERE ${where}
      ORDER BY "createdAt" DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { claims: rowsRes.rows, total };
}

/** All claims for a campaign, for CSV/JSON export - no pagination, but still
 *  bounded (a campaign's maxSpots caps how many rows can ever exist). */
export async function getAllClaimsForExport(campaignId: string): Promise<ClaimRow[]> {
  const res = await pool.query<ClaimRow>(
    `SELECT id, "holderWallet", "destinationWallet", chain, "qualifyingCollections", status, "createdAt"
       FROM claims
      WHERE "campaignId" = $1
      ORDER BY "createdAt" ASC`,
    [campaignId],
  );
  return res.rows;
}

export function claimsToCsv(claims: ClaimRow[]): string {
  const header = ['claim_id', 'holder_wallet', 'destination_wallet', 'claimed_at', 'qualifying_collection', 'chain', 'status'];
  const lines = [header.join(',')];

  for (const c of claims) {
    const qualifying = Array.isArray(c.qualifyingCollections)
      ? (c.qualifyingCollections as Array<{ name?: string }>).map((q) => q.name).filter(Boolean).join(' | ')
      : '';
    const row = [
      c.id,
      c.holderWallet,
      c.destinationWallet,
      c.createdAt.toISOString(),
      qualifying,
      c.chain,
      c.status,
    ].map(csvEscape);
    lines.push(row.join(','));
  }

  return lines.join('\n');
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
