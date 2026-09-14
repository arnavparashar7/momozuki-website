import { NextResponse } from 'next/server';
import { getCampaignBySlug } from '@/lib/campaigns';
import { getSpotsRemaining } from '@/lib/claims';
import { toErrorResponse } from '@/lib/errors';

/**
 * Public, unauthenticated: the landing page needs to show "N spots
 * remaining" and the campaign name before a wallet is even connected. Only
 * non-sensitive display fields are returned - no collection contract
 * addresses, no internal IDs beyond the campaign's own public slug/id.
 */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  try {
    const campaign = await getCampaignBySlug(params.slug);
    const { maxSpots, remaining } = await getSpotsRemaining(campaign.id);

    return NextResponse.json({
      slug: campaign.slug,
      name: campaign.name,
      active: campaign.active,
      maxSpots,
      spotsRemaining: Math.max(0, remaining),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
