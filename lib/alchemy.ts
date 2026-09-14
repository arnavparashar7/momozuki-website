import { Alchemy } from 'alchemy-sdk';
import { env } from '@/lib/env';
import { SUPPORTED_CHAINS, isSupportedChain } from '@/lib/chains';
import { AppError, ErrorCode } from '@/lib/errors';

/**
 * The only module that talks to Alchemy directly. Everything else
 * (lib/eligibility.ts) depends on the narrow `getHeldQuantity` function
 * signature, not on Alchemy's SDK types, so it can be tested with a mock
 * implementation - see tests/eligibility.test.ts, which doesn't need a real
 * ALCHEMY_API_KEY or network access.
 */

const clientCache = new Map<string, Alchemy>();

function getAlchemyClient(chain: string): Alchemy {
  if (!isSupportedChain(chain)) {
    throw new AppError(ErrorCode.VALIDATION, `Unsupported chain: ${chain}`);
  }
  if (!env.ALCHEMY_API_KEY) {
    // Distinct from "unsupported chain" - this is a configuration gap, not
    // a bad request, so it maps to 503 PROVIDER_UNAVAILABLE rather than 400.
    throw new AppError(ErrorCode.PROVIDER_UNAVAILABLE, 'NFT ownership check is not configured.');
  }

  const cached = clientCache.get(chain);
  if (cached) return cached;

  const client = new Alchemy({ apiKey: env.ALCHEMY_API_KEY, network: SUPPORTED_CHAINS[chain] });
  clientCache.set(chain, client);
  return client;
}

interface CacheEntry {
  value: number;
  expiresAt: number;
}

// Small, short-TTL cache: safe because eligibility doesn't need
// sub-30-second freshness, and useful because a single page load can
// trigger several ownership checks (multiple collections) plus the
// occasional refresh/reconnect within the same short window.
const CACHE_TTL_MS = 30_000;
const quantityCache = new Map<string, CacheEntry>();

/**
 * Total quantity of tokens `wallet` holds in `contractAddress` on `chain`.
 * Sums `balance` across all owned NFTs matching the contract, which is
 * correct for both ERC-721 (each entry has balance "1") and ERC-1155
 * (entries can have balance > 1). Paginates up to a safety cap - a
 * legitimate eligibility check should never need more than a handful of
 * pages; hitting the cap almost certainly indicates a misconfigured
 * contract address rather than a real collector, so we stop rather than
 * loop indefinitely.
 */
export async function getHeldQuantity(
  chain: string,
  wallet: string,
  contractAddress: string,
): Promise<number> {
  const cacheKey = `${chain}:${wallet}:${contractAddress}`;
  const cached = quantityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const client = getAlchemyClient(chain);
  const MAX_PAGES = 10;

  let total = 0;
  let pageKey: string | undefined;
  let pages = 0;

  try {
    do {
      const res = await client.nft.getNftsForOwner(wallet, {
        contractAddresses: [contractAddress],
        omitMetadata: true,
        pageKey,
      });
      for (const nft of res.ownedNfts) {
        total += Number(nft.balance ?? '1');
      }
      pageKey = res.pageKey;
      pages += 1;
    } while (pageKey && pages < MAX_PAGES);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(ErrorCode.PROVIDER_UNAVAILABLE);
  }

  quantityCache.set(cacheKey, { value: total, expiresAt: Date.now() + CACHE_TTL_MS });
  return total;
}
