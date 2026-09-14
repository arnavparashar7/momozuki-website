# Architectural Decisions

Format: Decision → Rationale → Alternatives considered → Status.

---

### D1. Single Next.js app (frontend + API routes) instead of separate frontend/backend services
**Rationale:** Project scope is one campaign flow + a small admin surface. A single
deployable reduces operational complexity and is easier for another developer to
maintain, per the "do not over-engineer" principle.
**Alternatives considered:** Separate Express/Fastify API + separate SPA - more moving
parts for no real benefit at this scale.
**Status:** Decided.

### D2. PostgreSQL (via Prisma) as source of truth, not CSV/JSON
**Rationale:** Explicit requirement; also the only realistic way to get transactional
guarantees against overselling spots and duplicate claims under concurrency.
**Alternatives considered:** SQLite for everything - rejected for production because
its write concurrency model is weaker than Postgres for this kind of contention
(many simultaneous claim attempts near sell-out); SQLite remains fine for local dev.
**Status:** Decided.

### D3. Spot count is derived (COUNT of claims), not a mutable counter column
**Rationale:** A separate counter is a second source of truth that can drift from the
claims table if any write fails partway. Deriving it removes that failure mode
entirely.
**Concurrency primitive (finalized at Checkpoint 2):** `SELECT ... FOR UPDATE` on the
campaign row inside a transaction, which serializes concurrent claim attempts for the
same campaign - the transaction holding the lock counts existing claims and either
inserts or aborts before releasing it. Default READ COMMITTED isolation is sufficient;
no SERIALIZABLE + retry logic needed, since the row lock itself prevents the race.
Verified with an automated test that fires 10 concurrent claim attempts against a
campaign with `maxSpots = 1`: exactly 1 succeeds, 9 receive `SOLD_OUT`, confirmed
against a real Postgres instance (see `tests/db-constraints.test.ts`).
**Alternatives considered:** `UPDATE campaign SET spotsClaimed = spotsClaimed + 1`
guarded by a `WHERE spotsClaimed < maxSpots` - viable and slightly cheaper, but
reintroduces a counter that must stay in lockstep with `claims`; not needed since the
row-lock approach already performs correctly under test.
**Status:** Decided and verified.

### D4. Wallet sessions and admin sessions as signed cookies, not DB-backed sessions
**Rationale:** Wallet sessions are short-lived and narrow-purpose (verify identity for
one claim attempt); a DB session table adds write load and a table to manage for
something disposable. Admin sessions could go either way but are kept consistent with
the same mechanism for simplicity.
**Alternatives considered:** DB-backed sessions with revocation lists - more robust for
the admin side (real revocation), reconsider if security review at Checkpoint 8 flags
this as insufficient.
**Status (Checkpoint 3):** Implemented for wallet sessions as designed - signed HS256
JWT (`jose`), httpOnly/secure/sameSite=lax cookie, 15-minute expiry, carrying only the
cryptographically-verified wallet address as subject. `lib/session.ts` /
`lib/require-wallet-session.ts`. Admin sessions remain future work (Checkpoint 7).
Flagged for re-evaluation at Checkpoint 8.

### D5. thirdweb for wallet connection tooling
**Rationale:** Explicitly requested ("use thirdweb Wallet Connect / wallet tooling
rather than implementing wallet connection infrastructure from scratch").
**Status (Checkpoint 3):** Implemented - `thirdweb`'s `ThirdwebProvider` +
`ConnectButton` +`useActiveAccount` handle connection/signing UI
(`components/ConnectAndAuthenticate.tsx`). Our own nonce/verify protocol
(`app/api/auth/**`) drives the actual authentication, rather than thirdweb's built-in
SIWE auth wiring - see D5a below for why.

### D5a. Custom nonce/verify protocol instead of thirdweb's built-in `ConnectButton` `auth` prop
**Rationale:** thirdweb's `ConnectButton` supports a full custom-backend auth handshake
via its `auth={{ getLoginPayload, doLogin, isLoggedIn, doLogout }}` prop, but that
wiring expects a SIWE-shaped payload (domain, statement, uri, version, chain_id,
issued_at, expiration_time, resources, etc.) matching thirdweb's own auth library.
Reworking our already-designed-and-tested nonce/message/session flow into that exact
shape added scope without a clear benefit - thirdweb is still doing the actual job it
was requested for (wallet connection + `account.signMessage()`), and our own
nonce-based flow already satisfies every requirement in AUTHENTICATION (single-use
nonce, non-static message, replay prevention) with full test coverage.
**Status:** Decided.

### D6. viem for signature creation/verification (server-side) rather than ethers.js
**Rationale:** Smaller, TypeScript-first, actively maintained, and pairs cleanly with
thirdweb v5 which itself is viem-based. Avoids mixing two competing web3 libraries.
**Alternatives considered:** ethers.js - mature and fine, but no compelling reason to
add a second library when viem covers everything needed.
**Status:** Decided. `viem.verifyMessage` implemented and tested in
`app/api/auth/verify/route.ts` (Checkpoint 3).

### D7. Alchemy SDK (`alchemy-sdk`) for NFT ownership, called only from server routes
**Rationale:** Explicit requirement; API key must never reach the client.
**Status:** Decided. Not yet implemented - Checkpoint 4.

### D8. The prototype's "jump to any state" review panel and randomized eligibility will not ship
**Rationale:** It's a design-review convenience with no place in a security-sensitive
production app - it would let anyone view or trigger UI states without passing real
checks. The visual design tokens are being kept; the state-jumping mechanism and fake
data generation are not.
**Status:** Decided.

### D9. EVM address validation uses checksum-aware parsing, not the prototype's regex
**Rationale:** `/^0x[a-fA-F0-9]{6,40}$/` accepts malformed/short addresses and doesn't
checksum-validate. Production validation uses viem's address utilities.
**Status:** Decided and implemented - `lib/wallet.ts::normalizeAddress`, used by both
auth API routes (Checkpoint 3).

### D10. Supabase as the managed Postgres provider (user decision, Checkpoint 0 follow-up)
**Rationale:** Gives a hosted Postgres instance without standing up our own DB host;
free/cheap tier is enough for development and a modest campaign launch. Prisma remains
the ORM/migration tool on top of it - Supabase's own client SDK, Auth, Storage, and
Realtime products are not used, since wallet-signature auth and admin auth are custom
and there's no file-storage or realtime-subscription need in this product.
**Consequence:** Prisma requires two connection strings against Supabase - a pooled one
(`DATABASE_URL`, PgBouncer port 6543) for runtime queries and a direct one
(`DIRECT_URL`, port 5432) for running migrations. Both are wired into
`prisma/schema.prisma` and `.env.example` starting in Checkpoint 1.
**Status:** Decided.

### D11. Claim recording and nonce consumption use raw parameterized SQL (`pg`), not Prisma Client
**Rationale:** Two reasons. First, precision: these two code paths need exact
transaction/locking semantics (`FOR UPDATE`, atomic `UPDATE ... WHERE consumedAt IS
NULL`) that are simplest to express and reason about as raw SQL - this is a common
pattern even in Prisma-based apps for genuinely concurrency-critical paths (Prisma
itself would require `$queryRaw`/`$executeRaw` for the same locking clause). Second,
practically: this sandbox's network egress blocks `binaries.prisma.sh`, so the Prisma
CLI (`generate`/`migrate`) cannot run here at all - not even `--help` completes,
because it unconditionally tries to fetch engine binaries first. Raw SQL via `pg` has
no such dependency, which is also what let Checkpoint 2's constraints actually be
tested against a real database in this environment rather than merely asserted.
**Scope:** This applies specifically to `lib/claims.ts` and `lib/nonce.ts`. Prisma
Client (`lib/db.ts`, lazily constructed via `getPrisma()`) remains the intended tool
for everything else - campaign/collection CRUD, admin dashboard reads - once
`prisma generate` can run in an environment with normal network access. It has not
been exercised yet in this project for that reason; `lib/db.ts` is written and
typechecks, but `getPrisma()` will throw until generation succeeds somewhere with
access to binaries.prisma.sh (documented inline and in CHECKPOINT.md).
**Status:** Decided.

### D12. thirdweb's Coinbase Smart Wallet / x402-payment code path is excluded from the client bundle
**Rationale:** `thirdweb@5.121` pulls in `@coinbase/cdp-sdk` and `@base-org/account`
(used for Coinbase Smart Wallet's x402 micropayments feature) through its
`base-account-web` wallet connector. That subtree references packages
(`@x402/svm`, `@x402/evm`, `@x402/core`) that aren't published as resolvable
dependencies, which broke `next build` outright. This app doesn't use Coinbase Smart
Wallet or x402 payments - only standard EOA wallet connection (MetaMask, WalletConnect,
Coinbase Wallet as a normal injected/QR wallet, hardware wallets via those) - so the
whole subtree was aliased to `false` in `next.config.js`'s webpack config, which tells
webpack to treat any import of it as an empty module rather than failing the build.
**Consequence:** if Coinbase Smart Wallet / x402 support is ever wanted, these aliases
need to be removed and the missing `@x402/*` packages installed/resolved properly.
**Status:** Decided.

### D13. lib/env.ts validates lazily (on first property access), not eagerly at import
**Rationale:** Discovered during Checkpoint 4 - `lib/eligibility.ts` imports
`lib/alchemy.ts` for its default `getHeldQuantity` parameter, which in turn imported
`lib/env.ts`. With eager validation (`export const env = loadServerEnv()` at module
top-level), merely *importing* the eligibility engine forced every required env var
(`DATABASE_URL`, `SESSION_SECRET`) to be present - even in a pure unit test that
injects a mock lookup and never touches the database or Alchemy at all. This also
meant the "skips cleanly if DATABASE_URL isn't set" comments in `tests/db-constraints.
test.ts` and `tests/auth.test.ts` were inaccurate: those files would have thrown at
import time, before their `describe.skip` guard ever ran, if DATABASE_URL were unset.
Fixed by making `env` a `Proxy` that validates on first property access rather than on
import. Modules that construct something eagerly at module scope from an env value
(e.g. `lib/pg-pool.ts`'s `new Pool({ connectionString: env.DATABASE_URL })`) still
require that value at *their own* import time, which is correct - a DB pool module
should need a DB URL to exist. What's fixed is that unrelated modules merely importing
*that* module's neighbor no longer pay the same cost.
**Status:** Decided and fixed; verified by running `tests/eligibility.test.ts` and
`tests/alchemy-config.test.ts` with zero environment variables set at all.

### D14. Eligibility-check failures ("unknown") are never conflated with "holds zero"
**Rationale:** See the extended comment in `lib/eligibility.ts`. In short: if Alchemy
is unreachable for one collection, treating that as "holds 0" could wrongly tell a real
NFT holder they're ineligible. The engine instead short-circuits to a confident answer
wherever the campaign's mode already allows it (ANY: any confirmed match is enough
regardless of other errors; ALL: any confirmed shortfall is enough regardless of other
errors), and only throws `PROVIDER_UNAVAILABLE` when a definitive answer genuinely can't
be given yet. Covered by `tests/eligibility.test.ts`.
**Status:** Decided and implemented.

### D15. Session reading moved from next/headers' `cookies()` to reading `Request.headers` directly
**Rationale:** Discovered while writing Checkpoint 5's claim-flow tests. `next/headers`'s
`cookies()` relies on Next's per-request `AsyncLocalStorage` context and throws
("`cookies` was called outside a request scope") whenever a route handler is invoked
directly rather than through Next's own request pipeline - confirmed empirically. This
blocked unit-testing any session-authenticated route (`/api/eligibility`, both
`/api/claim/**` routes) with anything faster than a real running server + HTTP calls,
unlike the Checkpoint 3 auth routes (which only *write* cookies via
`NextResponse.cookies.set`, never read them, so they were unaffected). Fixed by having
`lib/require-wallet-session.ts` parse the `Cookie` header directly off the `Request`
object it's handed (via the `cookie` package), which behaves identically whether the
`Request` came from Next's real pipeline or a `new Request(...)` in a test.
**Consequence:** every route calling `requireWalletSession`/`getWalletSession` now
passes its own `req` through, rather than the functions reading ambient context.
**Status:** Decided and implemented; this is what let
`tests/claim-flow.test.ts` test the actual route handlers directly (including the
maxSpots=1 concurrency test through the real `/api/claim/submit` handler, not just the
underlying `lib/claims.ts` function).

### D16. Claim authorize/submit split into two requests, with eligibility re-checked at both
**Rationale:** `POST /api/claim/authorize` re-runs `checkEligibility` and only issues an
EIP-712 challenge to sign if the holder is genuinely eligible right now (not trusting an
earlier `/api/eligibility` response from the same browser session - state can change).
`POST /api/claim/submit` verifies the signature, atomically consumes the CLAIM nonce,
then re-runs `checkEligibility` again *fresh* - this closes the gap between "was
eligible when they clicked authorize" and "is eligible right now" (e.g. NFT transferred
away in between), and produces the `qualifyingCollections` snapshot actually stored on
the claim row, matching the schema comment that it should reflect the eligibility
decision "at claim time," not whatever authorize saw earlier. The 30-second Alchemy
cache (lib/alchemy.ts) means this second check is nearly free in the common case where
authorize and submit happen close together.
**Status:** Decided and implemented; covered by `tests/claim-flow.test.ts`.

### D17. The reference's Three.js/GLB cinematic hero was not reproduced
**Rationale:** `reference/momozuki-3d.prototype.html` embeds a ~1.1MB base64-encoded
GLB (glTF) 3D model of a torii gate, rendered via Three.js in a 400vh scroll-jacked
"cinema" section. The spec's actual requirement is a "premium, luxury, modern Web3
aesthetic" - a specific 3D scene was the prototype designer's creative choice, not a
functional requirement. Reproducing it faithfully (asset pipeline, scroll-linked
camera/chapter transitions, WebGL fallback for `prefers-reduced-motion`/no-WebGL) is a
substantial, decorative-only undertaking relative to the rest of this checkpoint's
scope. Built a static hero instead, using the identical design tokens, palette,
typography, and copy ("Small souls, a seat reserved," the vertical Japanese text, the
eyebrow/tagline treatment) - same visual identity, without the 3D asset or scroll
choreography.
**Consequence:** if the immersive scroll experience is wanted specifically, it's a
scoped follow-up (asset hosting/optimization for the GLB, Three.js scene setup,
scroll-linked chapter reveal logic) rather than something silently dropped - flagged
here rather than pretending it was ported.
**Status:** Decided.

### D18. Rebrand applied (Atelier IX → Momozuki); next/font/google reverted to plain `<link>` tags
**Rationale:** The user-provided `momozuki-3d.prototype.html` clearly supersedes the
original `atelier-ix.html` prototype's branding - applied across every user/wallet-
facing string: page title/metadata, the EIP-712 signing domain (`lib/claim-typed-
data.ts`), the wallet-auth signing message (`lib/auth-message.ts`), and the seeded
campaign (renamed slug `momozuki-genesis`, name "Momozuki Genesis Whitelist", 555
spots matching the reference's copy, single collection matching the product copy's
"one qualifying collection" story - multi-collection ANY/ALL support remains fully
tested at the unit level regardless of what the seed data exercises).
Separately: initially used `next/font/google` for the reference's fonts (Rampart One,
Zen Maru Gothic, IBM Plex Mono) - the more idiomatic Next.js 14 approach - but that
needs network access to `fonts.googleapis.com` at BUILD time, which this sandbox
blocks (same class of restriction as the Prisma binaries issue, D11/D13). Reverted to
plain `<link>` tags in `app/layout.tsx`, which fetch fonts client-side at runtime
instead - works identically here and in any real deployment, at the cost of one
non-blocking ESLint warning (`no-page-custom-font`, a legacy Pages-Router-era check
that doesn't meaningfully apply to the App Router pattern used here) which is
suppressed inline with a comment explaining why.
**Status:** Decided.

### D19. argon2 for admin password hashing - native binary, confirmed working in this sandbox
**Rationale:** Explicit intent from Checkpoint 0's architecture (ARCHITECTURE.md's
admin-auth row). Unlike Prisma's engine binaries (blocked - `binaries.prisma.sh` isn't
reachable, D11/D13), `argon2`'s prebuilt native binary downloads from GitHub Releases
(`github.com/ranisalt/node-argon2/releases/...`), which this sandbox's network egress
does allow (`release-assets.githubusercontent.com` is on the allowlist). Installed and
verified with a real hash/verify round-trip before relying on it.
**Status:** Decided and verified working.

### D20. Admin sessions: distinct cookie, distinct JWT purpose, no user enumeration on login
**Rationale:** Per the SECURITY requirements ("Do NOT build an insecure hidden URL as
the only protection", "Do not expose admin APIs to unauthenticated users") and D4's
session-cookie approach. `ADMIN_SESSION_COOKIE` is a different cookie name than
`WALLET_SESSION_COOKIE`, and `verifyAdminSessionToken` checks a `purpose: 'admin-
session'` claim, so a wallet session token could never be mistaken for admin access
even if cookie names collided. Login returns the identical error shape (401
`ADMIN_UNAUTHENTICATED`, same message) for "no such account" and "wrong password" -
verified by a dedicated test comparing both responses byte-for-byte - and burns
roughly constant time either way (argon2.verify against a dummy hash when no account
is found) to avoid a timing side-channel revealing account existence.
**Consequence, documented rather than assumed:** logout clears the browser's cookie but
does not revoke the underlying JWT - a copied token remains valid until its 60-minute
expiry (same tradeoff as D4 for wallet sessions, just written down explicitly here and
covered by a test that confirms this is the actual behavior, not an oversight).
**Status:** Decided and implemented.

### D21. Admin sessions are now revocable via a DB-checked token-version counter
**Rationale:** Flagged as a real gap at the end of Checkpoint 7: a leaked admin session
token would remain valid for its full 60-minute lifetime with no way to kill it early.
Added `admin_users.tokenVersion` (migration `00000000000001_admin_token_version`,
hand-authored and applied the same way as the initial migration - see D11/D13). The
admin JWT now embeds the `tokenVersion` at issue time; `requireAdminSession` re-checks
it against the current DB value on every request. `POST /api/admin/revoke-sessions`
bumps the counter, immediately invalidating every outstanding token for that admin -
including the one used to call it, by design (confirmed via
`tests/admin-revocation.test.ts`: two independently-issued sessions for the same admin
both stop working the instant either one triggers a revoke).
**Consequence:** every admin request now costs one extra DB read compared to wallet
sessions (which remain pure-JWT, no revocation - D4's original tradeoff stands there
since a wallet session is narrow-purpose and short-lived, and losing that one extra
query matters less for the public claim flow's request volume than it does for a small
number of admin requests). This asymmetry is deliberate, not an oversight.
**Status:** Decided and implemented.

### D22. Dependency vulnerability audit (`pnpm audit`) - findings and what was/wasn't fixed
**Findings, in order of what was actually done:**
- **`cookie` (our own direct dependency, used in `lib/require-wallet-session.ts` /
  `lib/require-admin-session.ts`)**: had a moderate out-of-bounds character
  vulnerability in versions <0.7.0. Bumped `^0.6.0` → `^0.7.0` - a safe, low-risk direct
  upgrade. Fixed.
- **`argon2`**: the previously-pinned `^0.31.2` pulled in `@mapbox/node-pre-gyp` →
  vulnerable `tar` versions (path traversal / symlink issues) purely for its
  binary-download/install step. Bumped to `^0.41`, which switched to `node-gyp-build`
  and no longer depends on `tar` at all. Re-verified with a real hash/verify
  round-trip after the bump (same check as D19). Fixed.
- **Next.js 14.2.35 (latest available 14.x patch)**: several critical/high CVEs
  (Server Actions SSRF/DoS, an Image-Optimization RCE via AVIF, a Windows-specific RCE,
  a Pages-Router-middleware/i18n bypass, a rewrites-based SSRF) are only patched in the
  15.x line - there is no newer 14.x release that fixes them (confirmed by checking
  the full published version list). Upgrading to Next 15 is a major version bump
  (React 19, several breaking API changes) that needs its own dedicated regression
  pass across all 18 routes and the full UI - not something to do as a rushed part of
  a hardening checklist item. Traced our actual exposure instead of treating this as a
  binary "vulnerable/not": this app uses no Server Actions (`grep -r "use server"`
  returns nothing), no Middleware, no `next/image` (so the AVIF RCE's trigger path
  doesn't exist in this codebase), and no `rewrites()`/`redirects()` config - which
  meaningfully narrows real exposure for several of these CVEs, though doesn't
  eliminate the Windows RCE risk if ever deployed on Windows (unlikely for a Node
  API/Postgres stack, but not verified against a specific deployment target since none
  has been chosen yet - see the hosting-target open question). **Not fixed - explicitly
  recommended as a priority item before Checkpoint 10 (production readiness)**, not
  silently left off the list.
- **Deep transitive vulnerabilities inside `thirdweb` and `alchemy-sdk`** (`ws`,
  `vite`, `js-yaml`, `postcss`, `toml`, `axios`, `elliptic`, `stream-json`, and others):
  traced each one's actual position in the dependency tree rather than assuming the
  worst. `postcss@8.4.31`'s source-map vulnerability needs attacker-controlled CSS
  input, and the only CSS this app ever processes is its own first-party
  `app/globals.css` - not reachable via any user input. `toml`/`js-yaml` are only used
  by thirdweb's own tooling for parsing files we never feed untrusted data into.
  `vite`'s flagged issue is a `--ui`-server-only vulnerability; this project never runs
  `vitest --ui`, and vitest itself is a devDependency never shipped to production. `ws`
  is the one worth the most caution - it's a real production dependency (WalletConnect's
  websocket transport) - but the flagged DoS requires acting as a malicious/compromised
  peer on connections WE initiate outbound to WalletConnect's own relay infrastructure,
  not an inbound attack surface we expose. **Not fixed** (these are upstream SDK
  dependencies, not ours to patch directly) but not blindly accepted either - each was
  individually assessed for real reachability, documented above rather than just
  counted.
**Status:** Partially fixed (cookie, argon2); remainder explicitly triaged and
recommended for follow-up (Next.js major-version upgrade) or accepted with documented
reasoning (thirdweb/alchemy-sdk transitive deps), not silently ignored.

### D23. Rate limiting: in-memory, single-instance-scoped, applied to every mutating/expensive route
**Rationale:** Previously entirely absent - flagged as a real gap at the end of
Checkpoint 7. `lib/rate-limit.ts` implements a simple sliding-window limiter, wired
into `/api/auth/nonce` (10/5min/IP), `/api/auth/verify` (10/5min/IP),
`/api/claim/authorize` (15/5min/IP), `/api/claim/submit` (15/5min/IP), and
`/api/admin/login` (two-tier: 20/15min/IP broad cap, plus 5/15min/IP+email tighter cap
so credential stuffing against one account can't hide behind volume from other
attempts, while a shared/NAT'd IP trying different legitimate accounts isn't
collectively locked out by one). Explicitly documented as process-local state that
does not coordinate across multiple instances - correct for this project's stated
single-instance-appropriate architecture (D1), but flagged as needing a shared store
(Redis) if ever horizontally scaled, consistent with the open question already noted
since Checkpoint 0.
**Status:** Decided and implemented; verified both via direct unit tests
(`tests/rate-limit.test.ts`) and a real HTTP pass against the running server (7 rapid
admin-login attempts, the 7th correctly rejected with 429 and a `Retry-After` header).

### D24. CSRF: SameSite=Lax cookies (primary) + explicit Origin/Referer check (defense-in-depth)
**Rationale:** No CORS headers are configured anywhere in this app, so browsers already
refuse cross-origin reads of API responses by default. Every session cookie
(`lib/session.ts`) is `SameSite=Lax`, which already stops the classic CSRF pattern (a
foreign page silently firing a POST) since Lax cookies aren't attached to cross-site
non-GET requests - the forged request would arrive with no session at all. Added
`lib/csrf.ts`'s `isSameOriginRequest` as a second, independent layer on every
state-changing route (`/api/auth/nonce`, `/api/auth/verify`, `/api/claim/authorize`,
`/api/claim/submit`, `/api/admin/login`, `/api/admin/logout`,
`/api/admin/revoke-sessions`) - belt-and-suspenders against any browser mishandling
SameSite, or a future route added without this pattern in mind. Compares the
browser-supplied Origin/Referer (which a malicious page cannot forge via
fetch/XHR/form-submit) against the request's own URL host, rather than trusting a
separate `Host` header - deliberately chosen after discovering that hand-constructed
`Request` objects (as used throughout this project's own test suite) don't
automatically populate a `Host` header the way a real HTTP server connection does; the
request's own `url` is reliable in both contexts.
**Status:** Decided and implemented; verified via unit tests (`tests/csrf.test.ts`)
and a real HTTP pass (cross-origin POST → 403, same-origin POST → 200).

---

## Open questions / assumptions to revisit

- **Multi-campaign support**: schema is designed so `Campaign` is a first-class row
  (not a singleton), so multiple simultaneous campaigns are possible later, but the UI
  in this build targets one active campaign at a time unless told otherwise.
- **Hosting target**: left generic (Vercel or any Node host + managed Postgres) until
  Checkpoint 10, since no deployment environment was specified.
- **Admin account provisioning**: resolved at Checkpoint 7 - `prisma/seed-admin.ts`
  (`pnpm db:seed-admin`), reading `ADMIN_EMAIL` + `ADMIN_PASSWORD` (or a pre-computed
  `ADMIN_PASSWORD_HASH`) from env. Refuses to overwrite an existing account with the
  same email rather than silently resetting its password. No public registration
  route exists. Flag if a different admin-invite flow (multiple admins, self-service
  invite links, etc.) is wanted later - this only provisions one account at a time.
- **Next.js major-version upgrade (Next 14 → 15)**: strongly recommended before
  production launch (Checkpoint 10) - see D22 for the full CVE analysis. Several of
  the currently-open CVEs are Next.js framework-level and only patched in the 15.x
  line; this project's actual exposure is narrower than a blanket count suggests (no
  Server Actions, Middleware, `next/image`, or `rewrites()` in this codebase), but the
  gap shouldn't ship to production without either doing the upgrade or making a
  deliberate, informed decision not to. Needs its own dedicated regression pass, not a
  rushed fix mid-checklist - flagged here as a priority follow-up rather than done
  hastily inside Checkpoint 8.
- **Rate limiting backend**: resolved for now at Checkpoint 8 - in-memory (D23),
  correct for this project's single-instance-appropriate architecture. Revisit with a
  shared store (Redis) if this is ever deployed horizontally scaled - the hosting
  target is still generic/undecided (see above), so this can't be fully closed out
  until that's chosen.
- **thirdweb client ID**: no real `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` has been provided
  yet, so the wallet-connect UI is built and typechecks/builds but hasn't been manually
  exercised with a real wallet extension/browser - the auth *protocol* it drives has
  full automated test coverage (`tests/auth.test.ts`, including a real HTTP-level
  end-to-end pass) independent of thirdweb's UI itself.
- **ALCHEMY_API_KEY**: no real key has been provided, so `lib/alchemy.ts`'s actual
  network call to Alchemy's NFT API has never executed - confirmed instead via a real
  HTTP end-to-end pass showing the missing-key path fails gracefully (503
  `PROVIDER_UNAVAILABLE`, not a crash), and via `lib/eligibility.ts`'s full unit-test
  coverage using an injected mock lookup. The Alchemy SDK call shape
  (`client.nft.getNftsForOwner`, pagination via `pageKey`, summing `balance` for
  ERC-1155 support) is written to match Alchemy's documented API but has not been
  exercised against live chain data. Recommend a smoke test against a wallet with known
  holdings once a key is available, before Checkpoint 8's security review.
- **Visual rendering unverified in a real browser**: no headless browser is available
  in this sandbox, so Checkpoint 6's UI has been verified via HTML content checks over
  real HTTP (curl), TypeScript/ESLint/build cleanliness, and direct comparison of the
  ported CSS against the reference file - but not an actual rendered screenshot or
  manual click-through. Recommend a visual pass (`pnpm dev` or a deployed preview)
  before considering the public UI checkpoint fully signed off, particularly for the
  thirdweb `ConnectButton` modal styling, mobile breakpoints, and animation timing,
  none of which can be meaningfully verified from raw HTML/CSS alone.
- **Multi-campaign UI**: `ClaimFlow` hardcodes `CAMPAIGN_SLUG = 'momozuki-genesis'`
  rather than reading it from a route param or config - fine for a single-campaign
  launch (this build's stated target), would need generalizing if multiple concurrent
  campaigns are ever shown on the same site.
