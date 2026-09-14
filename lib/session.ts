import { SignJWT, jwtVerify } from 'jose';
import { env } from '@/lib/env';

/**
 * Signed, short-lived session tokens carried as httpOnly cookies. Not a DB
 * session table - see docs/DECISIONS.md D4 for why. HS256 signed with
 * SESSION_SECRET (validated >=32 bytes in lib/env.ts).
 */

const WALLET_SESSION_TTL_SECONDS = 15 * 60; // 15 minutes
export const WALLET_SESSION_COOKIE = 'atelier_wallet_session';

interface WalletSessionPayload {
  sub: string; // normalized (lowercase) wallet address - the cryptographically verified identity
  purpose: 'wallet-session';
}

function getSigningKey(): Uint8Array {
  if (!env.SESSION_SECRET) {
    // Fails loudly rather than issuing an unsigned/weak session - this
    // should only happen if SESSION_SECRET was left unset, which
    // lib/env.ts's schema will also reject once it's marked required.
    throw new Error('SESSION_SECRET is not configured.');
  }
  return new TextEncoder().encode(env.SESSION_SECRET);
}

/**
 * Issues a session token for a wallet whose signature has just been
 * cryptographically verified (see app/api/auth/verify/route.ts). The wallet
 * address here must already be normalized and must never come from
 * unverified client input.
 */
export async function createWalletSessionToken(wallet: string): Promise<string> {
  return new SignJWT({ purpose: 'wallet-session' } satisfies Omit<WalletSessionPayload, 'sub'>)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(wallet)
    .setIssuedAt()
    .setExpirationTime(`${WALLET_SESSION_TTL_SECONDS}s`)
    .sign(getSigningKey());
}

/**
 * Verifies a session token and returns the authenticated wallet address, or
 * null if the token is missing, malformed, expired, or was signed for a
 * different purpose. Callers must treat null as "not authenticated" - never
 * fall back to a client-supplied address.
 */
export async function verifyWalletSessionToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSigningKey());
    if (payload.purpose !== 'wallet-session' || typeof payload.sub !== 'string') {
      return null;
    }
    return payload.sub;
  } catch {
    // Expired, malformed, or bad signature - all treated identically as
    // "not authenticated" rather than leaking which case it was.
    return null;
  }
}

export const WALLET_SESSION_MAX_AGE_SECONDS = WALLET_SESSION_TTL_SECONDS;

/**
 * Admin sessions: same signing mechanism (HS256, SESSION_SECRET) and cookie
 * approach as wallet sessions, but a distinct cookie name, JWT `purpose`,
 * and TTL - an admin token must never be accepted where a wallet token is
 * expected or vice versa (`purpose` is checked on every verify). Longer TTL
 * than wallet sessions (60 min vs 15 min) since an admin reviewing claims is
 * a longer, more active session than a one-shot wallet-auth handshake.
 */
const ADMIN_SESSION_TTL_SECONDS = 60 * 60; // 60 minutes
export const ADMIN_SESSION_COOKIE = 'atelier_admin_session';
export const ADMIN_SESSION_MAX_AGE_SECONDS = ADMIN_SESSION_TTL_SECONDS;

interface AdminSessionPayload {
  sub: string; // AdminUser.id
  email: string;
  /** Compared against admin_users.tokenVersion at verify time (see
   *  lib/require-admin-session.ts) - a mismatch means the session has been
   *  revoked (docs/DECISIONS.md D21). */
  tokenVersion: number;
  purpose: 'admin-session';
}

export async function createAdminSessionToken(
  adminId: string,
  email: string,
  tokenVersion: number,
): Promise<string> {
  return new SignJWT({
    email,
    tokenVersion,
    purpose: 'admin-session',
  } satisfies Omit<AdminSessionPayload, 'sub'>)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_TTL_SECONDS}s`)
    .sign(getSigningKey());
}

export async function verifyAdminSessionToken(
  token: string | undefined,
): Promise<{ adminId: string; email: string; tokenVersion: number } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSigningKey());
    if (
      payload.purpose !== 'admin-session' ||
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.tokenVersion !== 'number'
    ) {
      return null;
    }
    return { adminId: payload.sub, email: payload.email, tokenVersion: payload.tokenVersion };
  } catch {
    return null;
  }
}
