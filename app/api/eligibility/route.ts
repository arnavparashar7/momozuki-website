import { NextResponse } from 'next/server';
import { requireWalletSession } from '@/lib/require-wallet-session';
import { getCampaignBySlug, DEFAULT_CAMPAIGN_SLUG } from '@/lib/campaigns';
import { checkEligibility } from '@/lib/eligibility';
import { AppError, ErrorCode, toErrorResponse } from '@/lib/errors';

/**
 * Reads the wallet from the verified session (never from a query param or
 * body - see lib/require-wallet-session.ts) and returns structured
 * eligibility information. Which campaign to check defaults to the seeded
 * sample campaign's slug; passing ?campaign=<slug> overrides it. Multi-
 * campaign selection UX can evolve later without touching the eligibility
 * engine itself.
 */
export async function GET(req: Request) {
  try {
    const wallet = await requireWalletSession(req);
    const url = new URL(req.url);
    const slug = url.searchParams.get('campaign') ?? DEFAULT_CAMPAIGN_SLUG;

    const campaign = await getCampaignBySlug(slug);
    if (!campaign.active) {
      throw new AppError(ErrorCode.SOLD_OUT, 'This campaign is not currently active.');
    }

    const result = await checkEligibility(wallet, campaign);
    return NextResponse.json({ campaignId: campaign.id, ...result });
  } catch (err) {
    return toErrorResponse(err);
  }
}
