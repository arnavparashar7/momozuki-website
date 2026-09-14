import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyTypedData } from 'viem';
import { requireWalletSession } from '@/lib/require-wallet-session';
import { normalizeAddress } from '@/lib/wallet';
import { getCampaignBySlug, DEFAULT_CAMPAIGN_SLUG } from '@/lib/campaigns';
import { checkEligibility } from '@/lib/eligibility';
import { consumeNonce } from '@/lib/nonce';
import { recordClaimAtomically } from '@/lib/claims';
import { CLAIM_DOMAIN, CLAIM_TYPES } from '@/lib/claim-typed-data';
import { AppError, ErrorCode, toErrorResponse } from '@/lib/errors';
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit';
import { isSameOriginRequest, crossOriginRejectedResponse } from '@/lib/csrf';

const bodySchema = z.object({
  destinationWallet: z.string(),
  nonce: z.string().min(1),
  deadline: z.number().int().positive(),
  signature: z.string(),
  campaign: z.string().optional(),
});

/**
 * Step 2 of the claim flow. Order of operations matters, same principle as
 * app/api/auth/verify/route.ts:
 *
 * 1. Verify the EIP-712 signature cryptographically (pure computation, no
 *    DB access) - confirms the holder wallet actually authorized exactly
 *    this destination wallet + campaign + nonce + deadline.
 * 2. Atomically consume the CLAIM nonce (DB-backed single-use + expiry) -
 *    only after the signature is confirmed, so junk signatures can't be
 *    used to probe/burn nonces.
 * 3. Re-run eligibility FRESH (not reused from authorize) - closes the gap
 *    between "was eligible when they clicked authorize" and "is eligible
 *    right now", and produces the qualifyingCollections snapshot actually
 *    stored on the claim row (schema comment: "a snapshot ... at claim
 *    time", not whatever authorize saw earlier).
 * 4. Only then call recordClaimAtomically, which is where the real
 *    anti-oversell / anti-duplicate guarantee lives (Checkpoint 2, proven
 *    under concurrency) - everything above this is about establishing WHO
 *    is claiming and THAT they're allowed to, not the atomicity itself.
 */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return crossOriginRejectedResponse();

  const rl = checkRateLimit(`claim-submit:${getClientIp(req)}`, 15, 5 * 60 * 1000);
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

    const signatureValid = await verifyTypedData({
      address: holderWallet as `0x${string}`,
      domain: CLAIM_DOMAIN,
      types: CLAIM_TYPES,
      primaryType: 'Claim',
      message: {
        holderWallet: holderWallet as `0x${string}`,
        destinationWallet: destinationWallet as `0x${string}`,
        campaignId: campaign.id,
        nonce: parsed.data.nonce,
        deadline: BigInt(parsed.data.deadline),
      },
      signature: parsed.data.signature as `0x${string}`,
    }).catch(() => false);

    if (!signatureValid) {
      throw new AppError(ErrorCode.SIGNATURE_INVALID);
    }

    // Belt-and-suspenders: the signed deadline itself shouldn't be trusted
    // as the freshness check (a signature is valid forever as a piece of
    // cryptography - it's OUR nonce tracking that expires). Still worth
    // rejecting an obviously-stale deadline before touching the DB.
    if (parsed.data.deadline * 1000 < Date.now()) {
      throw new AppError(ErrorCode.NONCE_EXPIRED);
    }

    await consumeNonce(holderWallet, parsed.data.nonce, 'CLAIM');

    if (!campaign.active) {
      throw new AppError(ErrorCode.SOLD_OUT);
    }

    const eligibility = await checkEligibility(holderWallet, campaign);
    if (!eligibility.eligible) {
      throw new AppError(ErrorCode.INELIGIBLE);
    }

    const primaryChain = eligibility.matchedCollections[0]?.chain ?? campaign.collections[0]?.chain;
    if (!primaryChain) {
      // Unreachable in practice: checkEligibility requires >=1 configured
      // collection and eligible=true requires >=1 match in ANY mode / all
      // matches in ALL mode, so matchedCollections is non-empty whenever
      // eligible is true. Guarded anyway rather than asserting.
      throw new AppError(ErrorCode.INTERNAL);
    }

    const claim = await recordClaimAtomically({
      campaignId: campaign.id,
      holderWallet,
      destinationWallet,
      qualifyingCollections: eligibility.matchedCollections,
      chain: primaryChain,
      claimSignature: parsed.data.signature,
    });

    return NextResponse.json({
      claimId: claim.id,
      campaignId: claim.campaignId,
      destinationWallet: claim.destinationWallet,
      createdAt: claim.createdAt,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
