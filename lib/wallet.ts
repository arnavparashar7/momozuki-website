import { isAddress, getAddress } from 'viem';

/**
 * Canonicalizes an EVM address for storage/lookup: validates it (checksum-
 * aware, correct length - NOT the permissive regex the original prototype
 * used) and returns the lowercase form, matching the storage convention
 * documented in prisma/schema.prisma.
 *
 * Throws if the input isn't a syntactically valid EVM address. Callers that
 * need a user-safe error should catch this and raise AppError with
 * ErrorCode.INVALID_DESTINATION_WALLET (or similar) instead of leaking this
 * message directly.
 */
export function normalizeAddress(address: string): string {
  if (!isAddress(address)) {
    throw new Error(`Not a valid EVM address: ${address}`);
  }
  // getAddress both validates checksum (if mixed-case) and normalizes casing;
  // toLowerCase gives us the canonical storage form regardless of how the
  // caller formatted it.
  return getAddress(address).toLowerCase();
}

export function isValidAddress(address: string): boolean {
  return isAddress(address);
}
