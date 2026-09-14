import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAdminCredentials } from '@/lib/admin-auth';
import { createAdminSessionToken, ADMIN_SESSION_COOKIE, ADMIN_SESSION_MAX_AGE_SECONDS } from '@/lib/session';
import { AppError, ErrorCode, toErrorResponse } from '@/lib/errors';
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit';
import { isSameOriginRequest, crossOriginRejectedResponse } from '@/lib/csrf';

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Real credential-based admin auth - not a hidden URL. Same email/password
 * response for "no such account" and "wrong password" (both surface as
 * ADMIN_UNAUTHENTICATED with a generic message) so this endpoint can't be
 * used to enumerate admin accounts.
 *
 * Two-tier rate limiting: a broad per-IP cap (resists a single source
 * hammering the endpoint regardless of which email it's guessing) and a
 * tighter per-IP+email cap (resists credential stuffing against one known
 * account specifically, without that single account's lockout blocking
 * other legitimate login attempts from the same shared/NAT'd IP).
 */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return crossOriginRejectedResponse();

  const ip = getClientIp(req);
  const broadRl = checkRateLimit(`admin-login-ip:${ip}`, 20, 15 * 60 * 1000);
  if (!broadRl.allowed) return rateLimitedResponse(broadRl);

  try {
    const json = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION);
    }

    const perAccountRl = checkRateLimit(
      `admin-login-account:${ip}:${parsed.data.email.toLowerCase()}`,
      5,
      15 * 60 * 1000,
    );
    if (!perAccountRl.allowed) return rateLimitedResponse(perAccountRl);

    const admin = await verifyAdminCredentials(parsed.data.email, parsed.data.password);
    if (!admin) {
      throw new AppError(ErrorCode.ADMIN_UNAUTHENTICATED, 'Invalid email or password.');
    }

    const token = await createAdminSessionToken(admin.adminId, admin.email, admin.tokenVersion);

    const res = NextResponse.json({ email: admin.email });
    res.cookies.set(ADMIN_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
    });
    return res;
  } catch (err) {
    return toErrorResponse(err);
  }
}
