import { Network } from 'alchemy-sdk';

/**
 * Chain identifiers used throughout the app (campaign_collections.chain,
 * claims.chain) are free-form strings, not a DB enum - see
 * prisma/schema.prisma's comment on CampaignCollection.chain. This is where
 * they're validated and mapped to an Alchemy network. Adding a new chain
 * means adding one line here, not a migration.
 */
export const SUPPORTED_CHAINS: Record<string, Network> = {
  ethereum: Network.ETH_MAINNET,
  base: Network.BASE_MAINNET,
  polygon: Network.MATIC_MAINNET,
  optimism: Network.OPT_MAINNET,
  arbitrum: Network.ARB_MAINNET,
};

export function isSupportedChain(chain: string): chain is keyof typeof SUPPORTED_CHAINS {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_CHAINS, chain);
}
