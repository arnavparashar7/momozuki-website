/**
 * EIP-712 typed data for the claim authorization signature. Per the spec:
 * "Prefer a typed-data/EIP-712 approach" and bind holder wallet, destination
 * wallet, claim/challenge identifier, nonce, and expiration. This is an
 * off-chain signature only - there is no verifying contract, so the domain
 * deliberately omits `chainId`/`verifyingContract`; what matters is that the
 * server builds the exact same domain/types/message when verifying as when
 * it issued the challenge (app/api/claim/authorize, app/api/claim/submit).
 *
 * The user sees this as a structured, human-readable signing prompt in
 * their wallet (not a blind hex signature) - MetaMask/most wallets render
 * EIP-712 fields directly, which is part of why this is preferred over a
 * plain signed string for something as consequential as a claim.
 */

export const CLAIM_DOMAIN = { name: 'Momozuki', version: '1' } as const;

export const CLAIM_TYPES = {
  Claim: [
    { name: 'holderWallet', type: 'address' },
    { name: 'destinationWallet', type: 'address' },
    { name: 'campaignId', type: 'string' },
    { name: 'nonce', type: 'string' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export interface ClaimMessageInput {
  holderWallet: string;
  destinationWallet: string;
  campaignId: string;
  nonce: string;
  /** Unix seconds. Plain number for JSON transport; converted to bigint
   *  only where viem requires it (uint256 fields). */
  deadline: number;
}

export function buildClaimTypedData(input: ClaimMessageInput) {
  return {
    domain: CLAIM_DOMAIN,
    types: CLAIM_TYPES,
    primaryType: 'Claim' as const,
    message: {
      holderWallet: input.holderWallet as `0x${string}`,
      destinationWallet: input.destinationWallet as `0x${string}`,
      campaignId: input.campaignId,
      nonce: input.nonce,
      deadline: BigInt(input.deadline),
    },
  };
}
