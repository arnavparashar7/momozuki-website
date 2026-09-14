import { NextResponse } from 'next/server';

/**
 * Error handling foundation for API routes.
 *
 * Principle (per SECURITY requirements): users never see stack traces, raw
 * exception messages, database errors, or internal infrastructure details.
 * Every route should throw/catch an `AppError` with one of the codes below,
 * and let `toErrorResponse` turn it into a safe, consistent JSON shape.
 * Anything unexpected gets logged server-side and reduced to a generic
 * message before it reaches the client.
 */

export const ErrorCode = {
  // Generic
  INTERNAL: 'INTERNAL',
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',

  // Auth (Checkpoint 3)
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  NONCE_EXPIRED: 'NONCE_EXPIRED',
  NONCE_ALREADY_USED: 'NONCE_ALREADY_USED',

  // Eligibility (Checkpoint 4)
  INELIGIBLE: 'INELIGIBLE',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',

  // Claim (Checkpoint 5)
  ALREADY_CLAIMED: 'ALREADY_CLAIMED',
  SOLD_OUT: 'SOLD_OUT',
  INVALID_DESTINATION_WALLET: 'INVALID_DESTINATION_WALLET',

  // Admin (Checkpoint 7)
  ADMIN_UNAUTHENTICATED: 'ADMIN_UNAUTHENTICATED',
  ADMIN_FORBIDDEN: 'ADMIN_FORBIDDEN',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

const STATUS_BY_CODE: Record<ErrorCodeType, number> = {
  INTERNAL: 500,
  VALIDATION: 400,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  UNAUTHENTICATED: 401,
  SIGNATURE_INVALID: 401,
  NONCE_EXPIRED: 401,
  NONCE_ALREADY_USED: 401,
  INELIGIBLE: 403,
  PROVIDER_UNAVAILABLE: 503,
  ALREADY_CLAIMED: 409,
  SOLD_OUT: 409,
  INVALID_DESTINATION_WALLET: 400,
  ADMIN_UNAUTHENTICATED: 401,
  ADMIN_FORBIDDEN: 403,
};

/** User-facing copy - deliberately vague where detail would leak internals. */
const MESSAGE_BY_CODE: Record<ErrorCodeType, string> = {
  INTERNAL: 'Something went wrong. Please try again.',
  VALIDATION: 'That request could not be processed.',
  NOT_FOUND: 'Not found.',
  RATE_LIMITED: 'Too many requests. Please slow down and try again.',
  UNAUTHENTICATED: 'Please reconnect your wallet.',
  SIGNATURE_INVALID: 'We could not verify that signature. Please try again.',
  NONCE_EXPIRED: 'That request expired. Please try again.',
  NONCE_ALREADY_USED: 'That request was already used. Please try again.',
  INELIGIBLE: 'You are not eligible for this whitelist.',
  PROVIDER_UNAVAILABLE: 'We could not verify NFT ownership right now. Please try again shortly.',
  ALREADY_CLAIMED: "You've already claimed your spot.",
  SOLD_OUT: 'Whitelist Fully Claimed.',
  INVALID_DESTINATION_WALLET: 'Enter a valid wallet address to continue.',
  ADMIN_UNAUTHENTICATED: 'Please sign in.',
  ADMIN_FORBIDDEN: 'You do not have access to this resource.',
};

export class AppError extends Error {
  readonly code: ErrorCodeType;

  constructor(code: ErrorCodeType, message?: string) {
    super(message ?? MESSAGE_BY_CODE[code]);
    this.code = code;
    this.name = 'AppError';
  }
}

/** Converts any thrown value into a safe NextResponse JSON error. */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: { code: err.code, message: MESSAGE_BY_CODE[err.code] } },
      { status: STATUS_BY_CODE[err.code] },
    );
  }

  // Unknown/unexpected error: log full detail server-side only, return a
  // generic message to the client.
  console.error('Unhandled error in API route:', err);
  return NextResponse.json(
    { error: { code: ErrorCode.INTERNAL, message: MESSAGE_BY_CODE.INTERNAL } },
    { status: 500 },
  );
}
