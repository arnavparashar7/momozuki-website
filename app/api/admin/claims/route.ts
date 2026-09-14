import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/require-admin-session';
import { getCampaignBySlug, DEFAULT_CAMPAIGN_SLUG } from '@/lib/campaigns';
import { listClaims } from '@/lib/admin-claims';
import { toErrorResponse } from '@/lib/errors';

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);
    const url = new URL(req.url);
    const slug = url.searchParams.get('campaign') ?? DEFAULT_CAMPAIGN_SLUG;
    const campaign = await getCampaignBySlug(slug);

    const search = url.searchParams.get('search') ?? undefined;
    const chain = url.searchParams.get('chain') ?? undefined;
    const limit = url.searchParams.get('limit');
    const offset = url.searchParams.get('offset');

    const result = await listClaims({
      campaignId: campaign.id,
      search,
      chain,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
