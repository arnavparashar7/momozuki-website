import { NextResponse } from 'next/server';

/**
 * Basic liveness check. Deliberately does NOT touch the database yet -
 * a DB-connectivity check is added once real models exist (Checkpoint 2),
 * so this endpoint stays useful even if the DB is briefly unreachable.
 */
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'atelier-ix', checkpoint: 1 });
}
