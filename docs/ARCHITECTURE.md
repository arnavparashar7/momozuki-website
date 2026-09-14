# Architecture - Atelier IX Whitelist Claim Platform

## 0. Repository state at time of this checkpoint

The repo contained a single artifact: `atelier-ix.html`, a fully static, self-contained
front-end prototype (inline CSS + vanilla JS). It has no backend, no real wallet
connection, no signature verification, and no persistence - wallet addresses are
randomly generated (`fakeAddr()`), eligibility is `Math.random() > 0.3`, and the admin
table is filled with synthetic rows. It also ships a "prototype review panel" that lets
a viewer jump directly to any UI state (already-claimed, sold-out, admin, etc.) for
design review purposes.

It has been preserved at `reference/atelier-ix.prototype.html` as the **visual/design
reference only**. None of its JS logic, state handling, or "jump to any state" panel
will ship in the production build - that panel in particular is a design-review tool
and would be a serious security/integrity bug in production (it lets anyone view
"already claimed" / "success" / admin screens without any real check).

The design system (colors, type, spacing tokens defined in `:root`) is worth keeping -
it's a legitimate premium Web3 aesthetic. The plan is to port those design tokens into
real components rather than reuse the static HTML/JS.

## 1. Stack decision

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14 (App Router), TypeScript | Single deployable for frontend + API routes (route handlers) as the backend; avoids a separate backend service for a project this size; large ecosystem for wallet/Web3 tooling; easy to deploy on Vercel or any Node host. |
| Package manager | pnpm | Fast, disk-efficient, good monorepo story if this ever needs to split. |
| Database | Supabase (managed PostgreSQL) via Prisma ORM | Need real transactional guarantees (atomic decrement, unique constraints) - Postgres row locking / unique constraints / serializable transactions handle the "never oversell spots" and "one claim per wallet" requirements correctly. Supabase gives a managed Postgres instance (plus optional auth/storage that we don't need here) without standing up our own DB host. Prisma stays as the ORM/migration tool on top of it - we are not using Supabase's client SDK or its own Auth product, since wallet-signature auth and admin auth are custom (see Security Model). SQLite is acceptable for local dev only (see below). |
| Wallet connection | thirdweb SDK (`@thirdweb-dev/react` + `@thirdweb-dev/sdk`) | Explicitly requested. Gives MetaMask, WalletConnect, Coinbase Wallet, and hardware-wallet-via-MetaMask/WalletConnect support without hand-rolling wallet infra. |
| Signature verification | `viem` (`verifyMessage`, `verifyTypedData`) | Modern, well-audited, works server-side without a wallet provider. Used for both the nonce-signing auth step and the EIP-712 claim authorization. |
| NFT ownership data | Alchemy NFT API (`alchemy-sdk`), server-side only | Explicitly requested. `getNftsForOwner` / `getOwnersForContract` style calls per chain. |
| Auth session (wallet) | Short-lived, signed, httpOnly cookie (custom, via `jose` for JWT) scoped to a single authenticated wallet + campaign | Wallet auth isn't a persistent user account system - it's "prove you controlled this address for this claim attempt." A signed session cookie is enough; no need for a full auth framework. |
| Admin auth | Separate credential-based login (email+password with hashed credentials via `argon2`, or a single admin invite-based account) + its own session cookie, distinct from wallet sessions | Admin panel must not be reachable by a "hidden URL" alone (explicit requirement) - needs real authentication, ideally with the option to add TOTP 2FA later. |
| Testing | Vitest (unit/integration), Playwright (E2E, added later at Checkpoint 9) | Fast unit tests colocated with code; Playwright for full claim-flow simulation including concurrency tests. |
| Lint/format | ESLint + Prettier, TypeScript strict mode | Standard, low-friction. |
| Deployment target | Node-compatible host (Vercel, Fly.io, Render, or a VPS) with a managed Postgres (Neon/Supabase/RDS) | Kept generic; documented concretely in Checkpoint 10. |

### Why not a separate backend service?
The product is a single campaign flow plus a small admin surface - not a multi-service
system. Next.js route handlers give a real server runtime (not just edge functions) for
things like Alchemy calls and DB transactions, while keeping deployment and local dev
to one process. If this evolves into multiple concurrent campaigns with heavy traffic,
splitting the API into its own service is a natural, non-breaking future step because
the API layer will already be cleanly isolated in `app/api/**`.

## 2. High-level flow → component mapping

```
[Browser]                          [Next.js server]                    [External]
Landing/Connect Wallet  ──────────▶ POST /api/auth/nonce         ──────▶ (DB: create Nonce row)
Sign nonce w/ wallet    ──────────▶ POST /api/auth/verify        ──────▶ viem.verifyMessage
                                    (issue wallet session cookie)        (DB: consume nonce, single-use)
Verifying screen        ──────────▶ GET  /api/eligibility        ──────▶ Alchemy NFT API (per chain)
                                    (server reads wallet from session,   (DB: read campaign config)
                                     never trusts client-supplied addr)
Eligible → destination
wallet input             ─────────▶ POST /api/claim/authorize    ──────▶ builds EIP-712 typed data
                                    (nonce/deadline bound to session)
User signs EIP-712 claim ─────────▶ POST /api/claim/submit       ──────▶ viem.verifyTypedData
                                                                          (DB transaction: atomic
                                                                           insert + spot decrement,
                                                                           unique constraint on
                                                                           destinationWallet)
Success / Already
claimed / Sold out       ◀───────── response reflects DB truth
Admin login               ─────────▶ POST /api/admin/login       ──────▶ (DB: verify admin credential)
Admin dashboard            ────────▶ GET  /api/admin/claims etc. ──────▶ (session-guarded, DB reads)
CSV/JSON export             ───────▶ GET  /api/admin/export.csv  ──────▶ generated from DB query
```

Key invariant: **every screen transition on the frontend reflects a server response**;
there is no client-side "pretend eligible" or "pretend claimed" state as in the
prototype.

### 1.1 Supabase + Prisma connection details

Supabase's Postgres sits behind PgBouncer for pooled connections (port 6543) and also
exposes a direct connection (port 5432). Prisma needs both:

- `DATABASE_URL` - the pooled connection string (`...:6543/postgres?pgbouncer=true`),
  used at runtime by the app.
- `DIRECT_URL` - the direct connection string (`...:5432/postgres`), used only by
  Prisma Migrate/`db push`, since migrations need a non-pooled connection.

Both are referenced in `prisma/schema.prisma`'s `datasource` block and documented in
`.env.example`. This is set up in Checkpoint 1 even though no tables exist yet, so the
DB connection itself can be verified early.

**Sandbox limitation, and how it was worked around (Checkpoint 2):** the Prisma CLI
(`prisma generate`, `prisma migrate`, even `prisma --help`) could not run in this
project's dev sandbox - it unconditionally tries to download engine binaries from
`binaries.prisma.sh` at every invocation, and that host is blocked by this sandbox's
network egress rules. This is specific to the sandbox, not the architecture: a normal
dev machine, CI runner, or deployment target should reach that host fine. To still
deliver and *verify* Checkpoint 2's database work here, the initial migration was
hand-authored to exactly match `schema.prisma` (`prisma/migrations/00000000000000_init/
migration.sql`, in Prisma's standard migration-folder format so a real environment's
`prisma migrate deploy`/`dev` will recognize and track it normally), applied directly
via `psql`, and verified with real, executed tests using the plain `pg` driver (which
has no such dependency). See `docs/DECISIONS.md` D11 for the resulting scope decision:
the two concurrency-critical modules (`lib/claims.ts`, `lib/nonce.ts`) use raw
parameterized SQL over a shared `pg` pool rather than Prisma Client; Prisma Client
(`lib/db.ts`) remains the intended tool for everything else once `prisma generate` can
run somewhere with normal network access - it's written and typechecks now, via a lazy
`getPrisma()` getter, but hasn't been exercised yet for that reason.

## 3. Data model (implemented and migrated at Checkpoint 2)

```
Campaign
  id, slug (unique), name, maxSpots (CHECK > 0), eligibilityMode (ANY|ALL),
  active (bool), createdAt, updatedAt

CampaignCollection
  id, campaignId (FK, cascade delete), name, chain, contractAddress,
  minimumHeld (CHECK > 0, default 1), createdAt
  UNIQUE (campaignId, chain, contractAddress)

Claim
  id, campaignId (FK, restrict delete), holderWallet (lowercase-normalized),
  destinationWallet (lowercase-normalized),
  qualifyingCollections (JSONB: which collection(s)/quantities satisfied eligibility
    at claim time - a snapshot, not a live join, so later edits to campaign
    collections can't retroactively change what a past claim "qualified" under),
  chain, status (CONFIRMED - no partial states, since writes are atomic),
  claimSignature (claim signature, stored for audit), createdAt, updatedAt
  UNIQUE (campaignId, destinationWallet)  ← core anti-duplicate/anti-oversell guarantee

AuthNonce
  id, wallet (lowercase-normalized), nonce, purpose (AUTH | CLAIM), expiresAt,
  consumedAt (nullable - NULL means unused), createdAt
  UNIQUE (wallet, nonce); consumedAt set exactly once inside the same transaction
  that verifies the nonce, so verify-and-consume cannot race

AdminUser
  id, email (unique), passwordHash, createdAt, updatedAt

WalletSession / AdminSession
  Implemented as signed JWT cookies rather than a DB session table, to avoid a second
  source of truth for something short-lived (~10–15 min for wallet session, longer with
  rotation for admin). Revocation isn't a hard requirement here since sessions are
  narrow-purpose and short-lived; this will be revisited if requirements change.
  (Not yet implemented - Checkpoint 3.)
```

Migration: `prisma/migrations/00000000000000_init/migration.sql` (see the sandbox-
limitation note above for why it's hand-authored rather than CLI-generated, and how it
was verified). Wallet addresses are stored lowercase-normalized (`lib/wallet.ts`,
built on viem's checksum-aware address parsing - not the permissive regex the original
prototype used); checksummed display formatting happens client-side only.

Spot count is **derived**, not stored as a mutable counter:
`spotsRemaining = campaign.maxSpots - COUNT(claims WHERE campaignId = ?)`
(`lib/claims.ts` → `getSpotsRemaining`). The "never exceed maxSpots under concurrent
claims" requirement is enforced by `SELECT ... FOR UPDATE` on the campaign row inside
the claim-recording transaction (`lib/claims.ts` → `recordClaimAtomically`) - see
`docs/DECISIONS.md` D3 for the finalized rationale and the concurrency test that
verifies it against a real database.

## 4. Security model

- **Frontend is never authoritative** for eligibility, spot count, duplicate
  prevention, or wallet identity - restated from requirements, and enforced by:
  every mutating/eligibility-determining action requires a server round-trip that
  re-derives wallet identity from a verified session, never from a request body field.
- **Wallet auth**: nonce-based, single-use, short expiration, tied to one wallet
  address; the resulting session cookie is httpOnly + `Secure` + `SameSite=Lax` (or
  `Strict` if compatible with the wallet-connect popup flow) and is what all
  subsequent eligibility/claim calls key off, not a client-supplied address.
- **Claim authorization**: EIP-712 typed data binding holder wallet, destination
  wallet, campaign/claim identifier, a claim-purpose nonce, and an expiration; verified
  server-side before the DB write; nonce is marked consumed in the same transaction as
  the claim insert.
- **Secrets**: Alchemy API key and any DB credentials live only in server-side env
  vars, never bundled into client JS (Next.js `NEXT_PUBLIC_*` prefix is never used for
  secrets).
- **Admin**: real credential-based login + session cookie, all `/api/admin/**` routes
  server-verify the session before touching data; no security-by-obscure-URL.
- **Rate limiting**: applied at minimum to nonce issuance and claim submission
  endpoints (in-memory/Upstash-Redis-backed depending on deployment target - decided
  concretely at Checkpoint 8).
- **Input validation**: `zod` schemas at every API boundary; EVM address validation
  uses checksum-aware parsing (viem's `isAddress`/`getAddress`), not a naive regex like
  the prototype's `/^0x[a-fA-F0-9]{6,40}$/` (which is too permissive on length and
  doesn't checksum-validate).
- **Error surface**: API errors are mapped to a small enum of user-safe messages;
  raw exceptions/stack traces/DB errors are logged server-side only.

## 5. Deployment assumptions (documented in full at Checkpoint 10)

- Single Next.js app, deployed to a Node-compatible host.
- Managed Postgres instance (connection string via env var).
- Alchemy API key per supported chain, server-side env vars.
- Admin bootstrap: first admin account created via a seed script / CLI, not a public
  signup route.
