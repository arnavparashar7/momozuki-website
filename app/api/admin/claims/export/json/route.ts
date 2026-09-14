import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/require-admin-session';
import { getCampaignBySlug, DEFAULT_CAMPAIGN_SLUG } from '@/lib/campaigns';
import { getAllClaimsForExport } from '@/lib/admin-claims';
import { toErrorResponse } from '@/lib/errors';

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);
    const url = new URL(req.url);
    const slug = url.searchParams.get('campaign') ?? DEFAULT_CAMPAIGN_SLUG;
    const campaign = await getCampaignBySlug(slug);
    const claims = await getAllClaimsForExport(campaign.id);

    const res = NextResponse.json(claims);
    res.headers.set('Content-Disposition', `attachment; filename="${campaign.slug}-claims.json"`);
    return res;
  } catch (err) {
    return toErrorResponse(err);
  }
}
