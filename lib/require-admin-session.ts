import { parse as parseCookies } from 'cookie';
import { verifyAdminSessionToken, ADMIN_SESSION_COOKIE } from '@/lib/session';
import { getAdminTokenVersion } from '@/lib/admin-auth';
import { AppError, ErrorCode } from '@/lib/errors';

/**
 * The ONLY sanctioned way for an admin route to learn who's asking. Mirrors
 * lib/require-wallet-session.ts (Request-based, not next/headers - see
 * DECISIONS.md D15) but reads the distinct admin cookie/token, so a wallet
 * session can never be mistaken for admin access.
 *
 * Unlike wallet sessions, this also checks the token's embedded
 * `tokenVersion` against the admin's CURRENT value in the database
 * (docs/DECISIONS.md D21). A JWT's signature being valid only proves it was
 * issued by us and hasn't expired - it says nothing about whether the admin
 * has since revoked it (POST /api/admin/revoke-sessions). This DB read is
 * the whole point of that feature; skipping it would make revocation a
 * no-op.
 */
export async function requireAdminSession(req: Request): Promise<{ adminId: string; email: string }> {
  const admin = await getAdminSession(req);
  if (!admin) {
    throw new AppError(ErrorCode.ADMIN_UNAUTHENTICATED);
  }
  return admin;
}

export async function getAdminSession(req: Request): Promise<{ adminId: string; email: string } | null> {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const cookies = parseCookies(cookieHeader);
  const token = cookies[ADMIN_SESSION_COOKIE];
  const payload = await verifyAdminSessionToken(token);
  if (!payload) return null;

  const currentVersion = await getAdminTokenVersion(payload.adminId);
  if (currentVersion === null || currentVersion !== payload.tokenVersion) {
    // Admin was deleted, or this token was revoked (tokenVersion bumped)
    // since it was issued.
    return null;
  }

  return { adminId: payload.adminId, email: payload.email };
}
