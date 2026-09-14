import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireWalletSession } from '@/lib/require-wallet-session';
import { normalizeAddress } from '@/lib/wallet';
import { getCampaignBySlug, DEFAULT_CAMPAIGN_SLUG } from '@/lib/campaigns';
import { checkEligibility } from '@/lib/eligibility';
import { hasClaimed } from '@/lib/claims';
import { issueNonce } from '@/lib/nonce';
import { buildClaimTypedData } from '@/lib/claim-typed-data';
import { AppError, ErrorCode, toErrorResponse } from '@/lib/errors';
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit';
import { isSameOriginRequest, crossOriginRejectedResponse } from '@/lib/csrf';

const bodySchema = z.object({
  destinationWallet: z.string(),
  campaign: z.string().optional(),
});

/**
 * Step 1 of the claim flow. Re-checks eligibility server-side rather than
 * trusting an earlier /api/eligibility response from the same browser
 * session - state can change (NFT transferred, campaign edited) and the
 * frontend is never authoritative. Only if the user is genuinely eligible
 * right now do we hand back something to sign.
 */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return crossOriginRejectedResponse();

  const rl = checkRateLimit(`claim-authorize:${getClientIp(req)}`, 15, 5 * 60 * 1000);
  if (!rl.allowed) return rateLimitedResponse(rl);

  try {
    const holderWallet = await requireWalletSession(req);

    const json = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION);
    }

    let destinationWallet: string;
    try {
      destinationWallet = normalizeAddress(parsed.data.destinationWallet);
    } catch {
      throw new AppError(ErrorCode.INVALID_DESTINATION_WALLET);
    }

    const campaign = await getCampaignBySlug(parsed.data.campaign ?? DEFAULT_CAMPAIGN_SLUG);
    if (!campaign.active) {
      throw new AppError(ErrorCode.SOLD_OUT);
    }

    if (await hasClaimed(campaign.id, destinationWallet)) {
      throw new AppError(ErrorCode.ALREADY_CLAIMED);
    }

    const eligibility = await checkEligibility(holderWallet, campaign);
    if (!eligibility.eligible) {
      throw new AppError(ErrorCode.INELIGIBLE);
    }

    const { nonce, expiresAt } = await issueNonce(holderWallet, 'CLAIM');
    const deadline = Math.floor(expiresAt.getTime() / 1000);

    const typedData = buildClaimTypedData({
      holderWallet,
      destinationWallet,
      campaignId: campaign.id,
      nonce,
      deadline,
    });

    // bigint (the `deadline` field) isn't JSON-serializable - send the
    // domain/types/message the frontend needs in a JSON-safe shape; the
    // frontend's wallet library reconstructs the bigint before signing.
    return NextResponse.json({
      campaignId: campaign.id,
      destinationWallet,
      nonce,
      deadline,
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: {
        ...typedData.message,
        deadline: deadline.toString(),
      },
      matchedCollections: eligibility.matchedCollections,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
