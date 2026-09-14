-- Migration: admin_token_version
--
-- Adds a monotonically-increasing version counter to admin_users, used to
-- make admin sessions revocable. A JWT-only session (D4/D20) can't be
-- individually invalidated before it expires - this adds a cheap way to
-- invalidate ALL of an admin's outstanding sessions at once (e.g. "I think
-- my laptop/session was compromised") without standing up a full DB-backed
-- session table: the admin JWT embeds the tokenVersion at issue time, and
-- every admin request re-checks it against the current DB value. Bumping
-- the column immediately invalidates every previously-issued token for
-- that admin, including the one making the bump request (forces re-login).
--
-- Same provenance note as the initial migration: hand-authored and applied
-- directly via psql rather than `prisma migrate dev`, because the Prisma
-- CLI cannot run in this sandbox (see docs/CHECKPOINT.md). Standard Prisma
-- migration-folder format, so a real environment's `prisma migrate deploy`
-- will pick this up normally.

ALTER TABLE "admin_users" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
