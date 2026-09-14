import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyMessage } from 'viem';
import { normalizeAddress } from '@/lib/wallet';
import { consumeNonce } from '@/lib/nonce';
import { buildAuthMessage } from '@/lib/auth-message';
import { createWalletSessionToken, WALLET_SESSION_COOKIE, WALLET_SESSION_MAX_AGE_SECONDS } from '@/lib/session';
import { AppError, ErrorCode, toErrorResponse } from '@/lib/errors';
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit';
import { isSameOriginRequest, crossOriginRejectedResponse } from '@/lib/csrf';

const bodySchema = z.object({
  wallet: z.string(),
  nonce: z.string().min(1),
  signature: z.string(),
});

/**
 * Step 2 of wallet auth. Verifies the signature cryptographically FIRST
 * (pure computation, no DB access, can't be raced), then atomically
 * consumes the nonce (DB-backed single-use check). Only if both succeed do
 * we issue a session cookie - and the wallet address it's scoped to is the
 * one we just verified, never a value taken as-is from the request body
 * beyond what the signature proves.
 */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return crossOriginRejectedResponse();

  const rl = checkRateLimit(`auth-verify:${getClientIp(req)}`, 10, 5 * 60 * 1000);
  if (!rl.allowed) return rateLimitedResponse(rl);

  try {
    const json = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION);
    }

    let wallet: string;
    try {
      wallet = normalizeAddress(parsed.data.wallet);
    } catch {
      throw new AppError(ErrorCode.VALIDATION, 'Enter a valid wallet address.');
    }

    const message = buildAuthMessage(wallet, parsed.data.nonce);

    let signatureValid: boolean;
    try {
      signatureValid = await verifyMessage({
        address: wallet as `0x${string}`,
        message,
        signature: parsed.data.signature as `0x${string}`,
      });
    } catch {
      // Malformed signature bytes, etc. - treat identically to "invalid".
      signatureValid = false;
    }

    if (!signatureValid) {
      throw new AppError(ErrorCode.SIGNATURE_INVALID);
    }

    // Only after the signature is confirmed do we touch the DB to enforce
    // single-use. This also means an attacker probing with junk signatures
    // can't burn through legitimate nonces.
    await consumeNonce(wallet, parsed.data.nonce, 'AUTH');

    const token = await createWalletSessionToken(wallet);

    const res = NextResponse.json({ wallet });
    res.cookies.set(WALLET_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: WALLET_SESSION_MAX_AGE_SECONDS,
    });
    return res;
  } catch (err) {
    return toErrorResponse(err);
  }
}
