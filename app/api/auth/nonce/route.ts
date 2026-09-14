import { NextResponse } from 'next/server';
import { z } from 'zod';
import { normalizeAddress } from '@/lib/wallet';
import { issueNonce } from '@/lib/nonce';
import { buildAuthMessage } from '@/lib/auth-message';
import { AppError, ErrorCode, toErrorResponse } from '@/lib/errors';
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit';
import { isSameOriginRequest, crossOriginRejectedResponse } from '@/lib/csrf';

const bodySchema = z.object({
  wallet: z.string(),
});

/**
 * Step 1 of wallet auth: client connects a wallet and posts its address
 * here. We normalize/validate it, issue a single-use nonce, and return the
 * exact message the wallet must sign. The frontend never constructs this
 * message itself - that would let a compromised/buggy client sign something
 * other than what the server will verify.
 */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return crossOriginRejectedResponse();

  const rl = checkRateLimit(`auth-nonce:${getClientIp(req)}`, 10, 5 * 60 * 1000);
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

    const { nonce, expiresAt } = await issueNonce(wallet, 'AUTH');
    const message = buildAuthMessage(wallet, nonce);

    return NextResponse.json({ nonce, message, expiresAt });
  } catch (err) {
    return toErrorResponse(err);
  }
}
