import { adminExistsByEmail, createAdminUser } from '../lib/admin-auth';
import { pool } from '../lib/pg-pool';

/**
 * Creates the first admin account from env vars. There is deliberately no
 * public admin-signup route (per the SECURITY requirements) - provisioning
 * happens here, run manually against whichever database you're targeting.
 *
 * Accepts either:
 *   ADMIN_EMAIL + ADMIN_PASSWORD   (plaintext - hashed here with argon2)
 * or, if you've already generated a hash yourself:
 *   ADMIN_EMAIL + ADMIN_PASSWORD_HASH
 *
 * Idempotent-ish: refuses to overwrite an existing account with this email
 * rather than silently resetting its password - run `pnpm db:seed-admin`
 * again with a different email, or handle password rotation as a deliberate
 * separate action, not a side effect of re-running this script.
 *
 * Run with: pnpm db:seed-admin
 */

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!email) {
    throw new Error('Set ADMIN_EMAIL before running this script.');
  }
  if (!password && !passwordHash) {
    throw new Error('Set ADMIN_PASSWORD (plaintext, will be hashed) or ADMIN_PASSWORD_HASH.');
  }

  if (await adminExistsByEmail(email)) {
    console.log(`Admin account for ${email} already exists - not overwriting. Exiting.`);
    return;
  }

  if (passwordHash) {
    // Insert directly with the pre-computed hash, bypassing createAdminUser
    // (which always hashes its `password` argument itself).
    const { randomUUID } = await import('node:crypto');
    await pool.query(
      `INSERT INTO admin_users (id, email, "passwordHash", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now())`,
      [randomUUID(), email.toLowerCase(), passwordHash],
    );
    console.log(`Created admin account for ${email} (using provided ADMIN_PASSWORD_HASH).`);
    return;
  }

  const admin = await createAdminUser(email, password!);
  console.log(`Created admin account for ${admin.email} (id=${admin.adminId}).`);
}

main()
  .catch((err) => {
    console.error('Admin seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
