import { requireAdminSession } from '@/lib/require-admin-session';
import { getCampaignBySlug, DEFAULT_CAMPAIGN_SLUG } from '@/lib/campaigns';
import { getAllClaimsForExport, claimsToCsv } from '@/lib/admin-claims';
import { toErrorResponse } from '@/lib/errors';

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);
    const url = new URL(req.url);
    const slug = url.searchParams.get('campaign') ?? DEFAULT_CAMPAIGN_SLUG;
    const campaign = await getCampaignBySlug(slug);
    const claims = await getAllClaimsForExport(campaign.id);
    const csv = claimsToCsv(claims);

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${campaign.slug}-claims.csv"`,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
