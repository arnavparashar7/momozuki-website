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

interface PendingBatch {
  contractAddresses: Set<string>;
  resolvers: Array<(results: Map<string, number>) => void>;
  rejecters: Array<(err: unknown) => void>;
  scheduled: boolean;
}

const pendingBatches = new Map<string, PendingBatch>();

async function executeBatch(chain: string, wallet: string, batch: PendingBatch) {
  const addresses = Array.from(batch.contractAddresses);
  try {
    const client = getAlchemyClient(chain);
    const results = new Map<string, number>();
    for (const addr of addresses) {
      results.set(addr.toLowerCase(), 0);
    }

    const MAX_PAGES = 10;
    let pageKey: string | undefined;
    let pages = 0;

    do {
      const res = await client.nft.getNftsForOwner(wallet, {
        contractAddresses: addresses,
        omitMetadata: true,
        pageKey,
      });
      for (const nft of res.ownedNfts) {
        const addr = (nft.contractAddress || (nft as any).contract?.address || '').toLowerCase();
        if (addr) {
          const current = results.get(addr) ?? 0;
          results.set(addr, current + Number(nft.balance ?? '1'));
        }
      }
      pageKey = res.pageKey;
      pages += 1;
    } while (pageKey && pages < MAX_PAGES);

    // Cache all fetched results
    const now = Date.now();
    for (const [addr, total] of results.entries()) {
      const cacheKey = `${chain}:${wallet.toLowerCase()}:${addr}`;
      quantityCache.set(cacheKey, { value: total, expiresAt: now + CACHE_TTL_MS });
    }

    for (const resolve of batch.resolvers) {
      resolve(results);
    }
  } catch (err) {
    const error = err instanceof AppError ? err : new AppError(ErrorCode.PROVIDER_UNAVAILABLE);
    for (const reject of batch.rejecters) {
      reject(error);
    }
  }
}

/**
 * Total quantity of tokens `wallet` holds in `contractAddress` on `chain`.
 * Sums `balance` across all owned NFTs matching the contract, which is
 * correct for both ERC-721 (each entry has balance "1") and ERC-1155
 * (entries can have balance > 1). Paginates up to a safety cap.
 * Batches parallel calls for the same wallet into a single Alchemy API request.
 */
export async function getHeldQuantity(
  chain: string,
  wallet: string,
  contractAddress: string,
): Promise<number> {
  const normalizedAddr = contractAddress.toLowerCase();
  const cacheKey = `${chain}:${wallet.toLowerCase()}:${normalizedAddr}`;
  const cached = quantityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const batchKey = `${chain}:${wallet.toLowerCase()}`;
  let batch = pendingBatches.get(batchKey);

  if (!batch) {
    batch = {
      contractAddresses: new Set(),
      resolvers: [],
      rejecters: [],
      scheduled: false,
    };
    pendingBatches.set(batchKey, batch);
  }

  batch.contractAddresses.add(normalizedAddr);

  const promise = new Promise<number>((resolve, reject) => {
    batch!.resolvers.push((results) => {
      resolve(results.get(normalizedAddr) ?? 0);
    });
    batch!.rejecters.push(reject);
  });

  if (!batch.scheduled) {
    batch.scheduled = true;
    Promise.resolve().then(() => {
      const b = pendingBatches.get(batchKey);
      if (b) {
        pendingBatches.delete(batchKey);
        executeBatch(chain, wallet, b);
      }
    });
  }

  return promise;
}

