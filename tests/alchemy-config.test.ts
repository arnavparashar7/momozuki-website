import { describe, expect, it } from 'vitest';
import { getHeldQuantity } from '@/lib/alchemy';
import { isSupportedChain } from '@/lib/chains';

describe('chains', () => {
  it('recognizes supported chains', () => {
    expect(isSupportedChain('ethereum')).toBe(true);
    expect(isSupportedChain('base')).toBe(true);
  });

  it('rejects unsupported/unknown chain identifiers', () => {
    expect(isSupportedChain('dogecoin')).toBe(false);
    expect(isSupportedChain('')).toBe(false);
  });
});

describe('getHeldQuantity - configuration failure paths (no network needed)', () => {
  it('rejects an unsupported chain before attempting any network call', async () => {
    await expect(
      getHeldQuantity('not-a-real-chain', '0xwallet', '0xcontract'),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('reports PROVIDER_UNAVAILABLE for a supported chain when ALCHEMY_API_KEY is unset', async () => {
    // env validation is schema-wide (see lib/env.ts), so exercising the
    // ALCHEMY_API_KEY-missing path specifically means giving the other
    // required fields harmless placeholder values first - this test isn't
    // about DATABASE_URL/SESSION_SECRET at all, and lib/env.ts's laziness
    // means these are only read here, not at import time.
    const prevDb = process.env.DATABASE_URL;
    const prevSecret = process.env.SESSION_SECRET;
    const prevAlchemy = process.env.ALCHEMY_API_KEY;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/placeholder';
    process.env.SESSION_SECRET = 'x'.repeat(32);
    delete process.env.ALCHEMY_API_KEY;

    try {
      await expect(
        getHeldQuantity('ethereum', '0xwallet', '0xcontract'),
      ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    } finally {
      if (prevDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDb;
      if (prevSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = prevSecret;
      if (prevAlchemy === undefined) delete process.env.ALCHEMY_API_KEY;
      else process.env.ALCHEMY_API_KEY = prevAlchemy;
    }
  });
});
