import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/require-admin-session';

/**
 * Fails closed: if the DB check inside getAdminSession throws (e.g. a
 * transient connection issue), we report "not authenticated" rather than
 * letting an unhandled exception surface Next's generic error page - this
 * is purely a session-status check, not something a user could lose data
 * over, so the safe default is "you appear logged out, try again."
 */
export async function GET(req: Request) {
  try {
    const admin = await getAdminSession(req);
    return NextResponse.json({ authenticated: admin !== null, email: admin?.email ?? null });
  } catch (err) {
    console.error('Admin session check failed:', err);
    return NextResponse.json({ authenticated: false, email: null });
  }
}
