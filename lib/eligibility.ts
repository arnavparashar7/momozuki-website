import { getHeldQuantity as defaultGetHeldQuantity } from '@/lib/alchemy';
import { AppError, ErrorCode } from '@/lib/errors';

export interface EligibilityCollectionConfig {
  id: string;
  name: string;
  chain: string;
  contractAddress: string;
  minimumHeld: number;
}

export interface CampaignEligibilityConfig {
  eligibilityMode: 'ANY' | 'ALL';
  collections: EligibilityCollectionConfig[];
}

export interface MatchedCollection {
  collectionId: string;
  name: string;
  chain: string;
  contractAddress: string;
  heldQuantity: number;
  minimumHeld: number;
}

export interface EligibilityResult {
  eligible: boolean;
  matchedCollections: MatchedCollection[];
  /** Held quantity per collection ID, present only for collections that were
   *  actually checked successfully (a failed/errored check is omitted, not
   *  recorded as 0 - 0 and "unknown" are different things). */
  quantities: Record<string, number>;
}

export type HeldQuantityLookup = (
  chain: string,
  wallet: string,
  contractAddress: string,
) => Promise<number>;

/**
 * Returns structured eligibility information - never a UI-facing string, per
 * the spec's example shape. `wallet` must already be the
 * cryptographically-verified session wallet (see
 * lib/require-wallet-session.ts), never a client-supplied value.
 *
 * Failure handling (the part worth reading carefully): a collection whose
 * Alchemy lookup throws is treated as "unknown", not "holds zero". That
 * distinction matters because conflating them would let a transient Alchemy
 * outage wrongly tell a real NFT holder they're ineligible. So:
 *
 * - ANY mode: if any collection is confirmed to meet its minimum, the user
 *   is eligible immediately, regardless of whether other collections
 *   errored. Only if NO collection was confirmed AND at least one errored do
 *   we refuse to guess - we throw PROVIDER_UNAVAILABLE instead of returning
 *   a false "ineligible".
 * - ALL mode: if any collection is confirmed to fall short of its minimum,
 *   the user is ineligible immediately (ALL already fails, regardless of
 *   what an errored collection would have shown). Otherwise, if anything
 *   errored, we throw PROVIDER_UNAVAILABLE rather than guess; only when
 *   every collection was successfully checked and all met their minimum do
 *   we return eligible:true.
 */
export async function checkEligibility(
  wallet: string,
  campaign: CampaignEligibilityConfig,
  getHeldQuantity: HeldQuantityLookup = defaultGetHeldQuantity,
): Promise<EligibilityResult> {
  if (campaign.collections.length === 0) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Campaign has no eligibility collections configured.',
    );
  }

  const checks = await Promise.all(
    campaign.collections.map(async (collection) => {
      try {
        const heldQuantity = await getHeldQuantity(
          collection.chain,
          wallet,
          collection.contractAddress,
        );
        return { collection, heldQuantity, errored: false as const };
      } catch {
        return { collection, heldQuantity: null, errored: true as const };
      }
    }),
  );

  const quantities: Record<string, number> = {};
  const matchedCollections: MatchedCollection[] = [];
  let anyErrored = false;

  for (const check of checks) {
    if (check.errored) {
      anyErrored = true;
      continue;
    }
    quantities[check.collection.id] = check.heldQuantity;
    if (check.heldQuantity >= check.collection.minimumHeld) {
      matchedCollections.push({
        collectionId: check.collection.id,
        name: check.collection.name,
        chain: check.collection.chain,
        contractAddress: check.collection.contractAddress,
        heldQuantity: check.heldQuantity,
        minimumHeld: check.collection.minimumHeld,
      });
    }
  }

  if (campaign.eligibilityMode === 'ANY') {
    if (matchedCollections.length > 0) {
      return { eligible: true, matchedCollections, quantities };
    }
    if (anyErrored) {
      throw new AppError(ErrorCode.PROVIDER_UNAVAILABLE);
    }
    return { eligible: false, matchedCollections: [], quantities };
  }

  // ALL mode.
  const knownShortfall = campaign.collections.some((c) => {
    const q = quantities[c.id];
    return q !== undefined && q < c.minimumHeld;
  });
  if (knownShortfall) {
    return { eligible: false, matchedCollections, quantities };
  }
  if (anyErrored) {
    throw new AppError(ErrorCode.PROVIDER_UNAVAILABLE);
  }

  const allMet = campaign.collections.every(
    (c) => (quantities[c.id] ?? 0) >= c.minimumHeld,
  );
  return { eligible: allMet, matchedCollections, quantities };
}
