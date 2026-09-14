import { describe, expect, it } from 'vitest';
import { AppError, ErrorCode, toErrorResponse } from '@/lib/errors';

describe('AppError / toErrorResponse', () => {
  it('maps a known AppError to its safe status and message', async () => {
    const res = toErrorResponse(new AppError(ErrorCode.ALREADY_CLAIMED));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('ALREADY_CLAIMED');
    expect(body.error.message).toBe("You've already claimed your spot.");
  });

  it('reduces an unknown thrown value to a generic 500 without leaking detail', async () => {
    const res = toErrorResponse(new Error('some internal db connection string leak'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).not.toContain('db connection string');
  });
});
