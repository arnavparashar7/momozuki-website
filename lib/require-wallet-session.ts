import { parse as parseCookies } from 'cookie';
import { verifyWalletSessionToken, WALLET_SESSION_COOKIE } from '@/lib/session';
import { AppError, ErrorCode } from '@/lib/errors';

/**
 * The ONLY sanctioned way for a route handler to learn which wallet is
 * making a request. Every eligibility/claim endpoint must call this rather
 * than trusting a wallet address in the request body - that's the whole
 * point of the session cookie.
 *
 * Reads the `Cookie` header from the `Request` directly, rather than using
 * `next/headers`'s `cookies()`. That API relies on Next's per-request
 * AsyncLocalStorage context and throws ("called outside a request scope")
 * when a route handler is invoked directly outside Next's own request
 * pipeline - which blocked unit-testing every session-authenticated route
 * with anything but a real running server (confirmed empirically while
 * building Checkpoint 5's claim-flow tests). Reading the header directly
 * works identically inside Next (Route Handlers always receive the real
 * `Request` with its headers) and in a plain `new Request(...)` in tests.
 */
export async function requireWalletSession(req: Request): Promise<string> {
  const wallet = await getWalletSession(req);
  if (!wallet) {
    throw new AppError(ErrorCode.UNAUTHENTICATED);
  }
  return wallet;
}

export async function getWalletSession(req: Request): Promise<string | null> {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const cookies = parseCookies(cookieHeader);
  const token = cookies[WALLET_SESSION_COOKIE];
  return verifyWalletSessionToken(token);
}
