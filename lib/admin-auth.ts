import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { pool } from '@/lib/pg-pool';

/**
 * Raw SQL rather than Prisma Client - same reasoning as lib/claims.ts /
 * lib/nonce.ts / lib/campaigns.ts (docs/DECISIONS.md D11).
 */

export interface AdminCredentialCheck {
  adminId: string;
  email: string;
  tokenVersion: number;
}

/**
 * Verifies email+password against the admin_users table. Returns null for
 * BOTH "no such account" and "wrong password" - the caller must not
 * distinguish these in its response (no user enumeration via error
 * messages). argon2.verify is timing-safe by construction; the two-path
 * shape below (early return vs. verify-then-compare) does leak whether an
 * account exists via timing in principle, mitigated by always running an
 * argon2 verify against a fixed dummy hash when no account is found, so the
 * function takes roughly constant time either way.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

export async function verifyAdminCredentials(
  email: string,
  password: string,
): Promise<AdminCredentialCheck | null> {
  const res = await pool.query<{ id: string; email: string; passwordHash: string; tokenVersion: number }>(
    'SELECT id, email, "passwordHash", "tokenVersion" FROM admin_users WHERE email = $1',
    [email.toLowerCase()],
  );
  const row = res.rows[0];

  if (!row) {
    // Burn roughly the same time as a real verify, so response timing
    // doesn't reveal whether the email exists.
    await argon2.verify(DUMMY_HASH, password).catch(() => false);
    return null;
  }

  const valid = await argon2.verify(row.passwordHash, password).catch(() => false);
  if (!valid) return null;

  return { adminId: row.id, email: row.email, tokenVersion: row.tokenVersion };
}

/** Looks up an admin's current tokenVersion by id, for verifying that an
 *  existing session token hasn't been revoked. Returns null if the admin
 *  no longer exists (also treated as revoked). */
export async function getAdminTokenVersion(adminId: string): Promise<number | null> {
  const res = await pool.query<{ tokenVersion: number }>(
    'SELECT "tokenVersion" FROM admin_users WHERE id = $1',
    [adminId],
  );
  return res.rows[0]?.tokenVersion ?? null;
}

/** Bumps tokenVersion, immediately invalidating every previously-issued
 *  session for this admin (including the one making this call - the caller
 *  must expect to be logged out too). */
export async function revokeAllAdminSessions(adminId: string): Promise<void> {
  await pool.query('UPDATE admin_users SET "tokenVersion" = "tokenVersion" + 1 WHERE id = $1', [
    adminId,
  ]);
}

export async function adminExistsByEmail(email: string): Promise<boolean> {
  const res = await pool.query('SELECT 1 FROM admin_users WHERE email = $1', [email.toLowerCase()]);
  return (res.rowCount ?? 0) > 0;
}

export async function createAdminUser(email: string, password: string): Promise<AdminCredentialCheck> {
  const passwordHash = await argon2.hash(password);
  const id = randomUUID();
  const res = await pool.query<{ id: string; email: string; tokenVersion: number }>(
    `INSERT INTO admin_users (id, email, "passwordHash", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, now(), now())
     RETURNING id, email, "tokenVersion"`,
    [id, email.toLowerCase(), passwordHash],
  );
  const row = res.rows[0]!;
  return { adminId: row.id, email: row.email, tokenVersion: row.tokenVersion };
}
