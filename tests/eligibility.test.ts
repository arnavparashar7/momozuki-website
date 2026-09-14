import { describe, expect, it } from 'vitest';
import { checkEligibility, type CampaignEligibilityConfig } from '@/lib/eligibility';
import { AppError } from '@/lib/errors';

const collectionA = {
  id: 'col-a',
  name: 'Project A',
  chain: 'ethereum',
  contractAddress: '0xaaa',
  minimumHeld: 1,
};
const collectionB = {
  id: 'col-b',
  name: 'Project B',
  chain: 'base',
  contractAddress: '0xbbb',
  minimumHeld: 2,
};

function mockLookup(held: Record<string, number | Error>) {
  return async (chain: string, wallet: string, contractAddress: string) => {
    const value = held[contractAddress];
    if (value instanceof Error) throw value;
    return value ?? 0;
  };
}

describe('checkEligibility - ANY mode', () => {
  const campaign: CampaignEligibilityConfig = {
    eligibilityMode: 'ANY',
    collections: [collectionA, collectionB],
  };

  it('is eligible if at least one collection meets its minimum', async () => {
    const result = await checkEligibility(
      '0xwallet',
      campaign,
      mockLookup({ '0xaaa': 1, '0xbbb': 0 }),
    );
    expect(result.eligible).toBe(true);
    expect(result.matchedCollections).toHaveLength(1);
    expect(result.matchedCollections[0]?.collectionId).toBe('col-a');
  });

  it('is ineligible if no collection meets its minimum and all checks succeeded', async () => {
    const result = await checkEligibility(
      '0xwallet',
      campaign,
      mockLookup({ '0xaaa': 0, '0xbbb': 1 }), // B needs 2, only has 1
    );
    expect(result.eligible).toBe(false);
    expect(result.matchedCollections).toHaveLength(0);
  });

  it('enforces minimumHeld precisely (quantity = minimum - 1 fails, = minimum passes)', async () => {
    const belowMin = await checkEligibility(
      '0xwallet',
      { eligibilityMode: 'ANY', collections: [collectionB] },
      mockLookup({ '0xbbb': 1 }),
    );
    expect(belowMin.eligible).toBe(false);

    const atMin = await checkEligibility(
      '0xwallet',
      { eligibilityMode: 'ANY', collections: [collectionB] },
      mockLookup({ '0xbbb': 2 }),
    );
    expect(atMin.eligible).toBe(true);
  });

  it('succeeds via a matched collection even if another collection errors', async () => {
    const result = await checkEligibility(
      '0xwallet',
      campaign,
      mockLookup({ '0xaaa': 1, '0xbbb': new Error('provider down') }),
    );
    expect(result.eligible).toBe(true);
    expect(result.matchedCollections[0]?.collectionId).toBe('col-a');
  });

  it('throws PROVIDER_UNAVAILABLE rather than a false "ineligible" when nothing matched and something errored', async () => {
    await expect(
      checkEligibility(
        '0xwallet',
        campaign,
        mockLookup({ '0xaaa': 0, '0xbbb': new Error('provider down') }),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});

describe('checkEligibility - ALL mode', () => {
  const campaign: CampaignEligibilityConfig = {
    eligibilityMode: 'ALL',
    collections: [collectionA, collectionB],
  };

  it('is eligible only if every collection meets its minimum', async () => {
    const result = await checkEligibility(
      '0xwallet',
      campaign,
      mockLookup({ '0xaaa': 1, '0xbbb': 2 }),
    );
    expect(result.eligible).toBe(true);
    expect(result.matchedCollections).toHaveLength(2);
  });

  it('is ineligible if any collection falls short, even if others are fine', async () => {
    const result = await checkEligibility(
      '0xwallet',
      campaign,
      mockLookup({ '0xaaa': 1, '0xbbb': 1 }), // B needs 2
    );
    expect(result.eligible).toBe(false);
  });

  it('returns ineligible (not a provider error) when a known shortfall already decides ALL, even if another leg errored', async () => {
    const result = await checkEligibility(
      '0xwallet',
      campaign,
      mockLookup({ '0xaaa': 0, '0xbbb': new Error('provider down') }), // A already fails ALL
    );
    expect(result.eligible).toBe(false);
  });

  it('throws PROVIDER_UNAVAILABLE when a leg errors and no shortfall is yet known', async () => {
    await expect(
      checkEligibility(
        '0xwallet',
        campaign,
        mockLookup({ '0xaaa': 1, '0xbbb': new Error('provider down') }), // A passes, B unknown
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});

describe('checkEligibility - misconfiguration', () => {
  it('rejects a campaign with no collections configured', async () => {
    await expect(
      checkEligibility(
        '0xwallet',
        { eligibilityMode: 'ANY', collections: [] },
        mockLookup({}),
      ),
    ).rejects.toBeInstanceOf(AppError);
  });
});
