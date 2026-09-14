import { NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE } from '@/lib/session';
import { isSameOriginRequest, crossOriginRejectedResponse } from '@/lib/csrf';

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return crossOriginRejectedResponse();

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
