import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '@/lib/pg-pool';
import { getCampaignBySlug, DEFAULT_CAMPAIGN_SLUG } from '@/lib/campaigns';

import { hasDb } from './test-db';
const d = hasDb ? describe : describe.skip;

d('getCampaignBySlug', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('reads the seeded sample campaign with its collections', async () => {
    const campaign = await getCampaignBySlug(DEFAULT_CAMPAIGN_SLUG);
    expect(campaign.eligibilityMode).toBe('ANY');
    expect(campaign.maxSpots).toBe(555);
    expect(campaign.collections.length).toBeGreaterThanOrEqual(1);
    const names = campaign.collections.map((c) => c.name);
    expect(names).toContain('Momozuki Genesis');
  });

  it('throws NOT_FOUND for an unknown slug', async () => {
    await expect(getCampaignBySlug('does-not-exist')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
