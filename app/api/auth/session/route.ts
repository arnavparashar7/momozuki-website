import { NextResponse } from 'next/server';
import { getWalletSession } from '@/lib/require-wallet-session';

/**
 * Used by the frontend on load/reconnect to check whether an existing
 * session cookie is still valid, so a page refresh doesn't force the user
 * through wallet-connect + signing again within the session's lifetime.
 */
export async function GET(req: Request) {
  const wallet = await getWalletSession(req);
  return NextResponse.json({ authenticated: wallet !== null, wallet });
}
