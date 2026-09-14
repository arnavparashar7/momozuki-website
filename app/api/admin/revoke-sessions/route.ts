import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/require-admin-session';
import { revokeAllAdminSessions } from '@/lib/admin-auth';
import { ADMIN_SESSION_COOKIE } from '@/lib/session';
import { toErrorResponse } from '@/lib/errors';
import { isSameOriginRequest, crossOriginRejectedResponse } from '@/lib/csrf';

/**
 * Immediately invalidates every outstanding session for the calling admin,
 * including the one making this request - the caller should expect to be
 * signed out and need to log in again. This is what makes "an admin session
 * leaked" a recoverable situation rather than a 60-minute wait (see
 * DECISIONS.md D21).
 */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return crossOriginRejectedResponse();

  try {
    const admin = await requireAdminSession(req);
    await revokeAllAdminSessions(admin.adminId);

    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_SESSION_COOKIE, '', { path: '/', maxAge: 0 });
    return res;
  } catch (err) {
    return toErrorResponse(err);
  }
}
