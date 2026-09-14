import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/require-admin-session';
import { getDashboardMetrics } from '@/lib/admin-claims';
import { DEFAULT_CAMPAIGN_SLUG } from '@/lib/campaigns';
import { toErrorResponse } from '@/lib/errors';

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);
    const url = new URL(req.url);
    const slug = url.searchParams.get('campaign') ?? DEFAULT_CAMPAIGN_SLUG;
    const metrics = await getDashboardMetrics(slug);
    return NextResponse.json(metrics);
  } catch (err) {
    return toErrorResponse(err);
  }
}
