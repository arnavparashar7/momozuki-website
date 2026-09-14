# Security Architecture & Hardening Model - Momozuki Platform

This document details the security model, cryptographic protocols, concurrency guarantees, and vulnerability mitigations implemented in the Momozuki Platform.

---

## 1. Core Security Invariants

1. **Server-Side Authority**: The frontend is NEVER trusted to determine eligibility, spot availability, duplicate claim status, or wallet identity.
2. **Zero Custody & Gasless**: The application never requests private keys, seed phrases, or gas-paying blockchain transactions.
3. **Cryptographic Proof of Control**: All wallet identities are proven via cryptographic signature verification; address strings supplied in request bodies are never trusted without signatures.
4. **Strict Concurrency Guarantees**: Database transactions prevent overselling spots or duplicate claims, even under high-concurrency race conditions.

---

## 2. Authentication Protocol

The platform uses a secure, challenge-response nonce authentication protocol for wallet connections.

```
[Browser]                                 [Server]
  |                                          |
  |--- 1. POST /api/auth/nonce (wallet) ---->| (Validates address format)
  |<-- 2. Returns { nonce, message } --------| (Stores AuthNonce row, expiresAt=5m)
  |                                          |
  | (User signs message in wallet)           |
  |                                          |
  |--- 3. POST /api/auth/verify (signature)->| (viem.verifyMessage cryptographically checks signature)
  |<-- 4. Sets WALLET_SESSION_COOKIE --------| (Atomically marks nonce consumedAt = NOW())
```

### Nonce & Session Properties
- **Single-Use**: Nonces are marked `consumedAt = NOW()` inside the verification transaction. Replay attempts are rejected with `NONCE_USED`.
- **Expiration**: Nonces expire after 5 minutes.
- **Signed Session Cookie**: Authenticated sessions issue an HTTP-only, Secure (in production), `SameSite=Lax` cookie containing a signed JWT (`jose` HS256) valid for 15 minutes.

---

## 3. Claim Authorization & EIP-712 Typed Data

To authorize a whitelist claim for a destination wallet:

1. **Step 1: Authorization Request (`POST /api/claim/authorize`)**
   - Server reads the verified holder wallet from the session cookie.
   - Re-evaluates NFT eligibility fresh via Alchemy.
   - Generates an EIP-712 typed data structure binding:
     - `holderWallet`
     - `destinationWallet`
     - `campaignId`
     - `nonce` (CLAIM purpose)
     - `deadline` (Unix timestamp)

2. **Step 2: Submission (`POST /api/claim/submit`)**
   - Client presents the holder's EIP-712 signature.
   - Server verifies the EIP-712 signature via `viem.verifyTypedData`.
   - Verifies `Date.now() <= deadline * 1000`.
   - Atomically consumes the claim nonce and inserts the claim inside a single Postgres transaction.
   - Re-runs eligibility fresh right before insert to ensure NFTs were not transferred away between authorization and submission.

---

## 4. Anti-Oversell & Concurrency Guarantees

To guarantee that total confirmed claims never exceed `maxSpots` during simultaneous final-spot claim attempts:

### 4.1 Row-Level Serialization (`SELECT ... FOR UPDATE`)
Inside `lib/claims.ts::recordClaimAtomically`:

```sql
BEGIN;

-- Lock the campaign row for update, serializing concurrent transactions
SELECT "maxSpots", active FROM campaigns WHERE id = $1 FOR UPDATE;

-- Count confirmed claims
SELECT COUNT(*)::int AS count FROM claims WHERE "campaignId" = $1;

-- If count >= maxSpots, abort transaction and return SOLD_OUT error
-- Otherwise, insert claim record
INSERT INTO claims (id, "campaignId", "holderWallet", "destinationWallet", ...)
VALUES ($2, $3, $4, $5, ...);

COMMIT;
```

### 4.2 Database Constraints
- **`UNIQUE (campaignId, destinationWallet)`**: Guarantees a destination wallet can only be recorded once per campaign. Duplicate attempts throw a unique constraint violation and return 409 `ALREADY_CLAIMED`.

---

## 5. Admin Authentication & Session Revocation

### 5.1 Credential Protection
- Admin passwords are hashed with **Argon2id** (`argon2` v0.41+).
- Login endpoint (`/api/admin/login`) uses constant-time verification logic to prevent timing attacks.
- Failed logins return identical 401 `ADMIN_UNAUTHENTICATED` errors regardless of whether the email or password was wrong.

### 5.2 Token Revocation (`tokenVersion`)
- `admin_users` table includes a `tokenVersion` integer column.
- Admin session JWTs embed the issuing `tokenVersion`.
- On every admin API request (`lib/require-admin-session.ts`), the server verifies the JWT's `tokenVersion` matches the current value in the database.
- Executing `POST /api/admin/revoke-sessions` increments `tokenVersion`, invalidating all outstanding admin JWTs instantly.

---

## 6. Edge Security (Rate Limiting & CSRF)

### 6.1 Sliding-Window Rate Limiting (`lib/rate-limit.ts`)
In-memory sliding window rate limits protect mutating endpoints:
- `POST /api/auth/nonce`: 10 requests / 5 min per IP
- `POST /api/auth/verify`: 10 requests / 5 min per IP
- `POST /api/claim/authorize`: 15 requests / 5 min per IP
- `POST /api/claim/submit`: 15 requests / 5 min per IP
- `POST /api/admin/login`: Two-tier limit (20 req / 15 min per IP broad, 5 req / 15 min per IP+email tight)

### 6.2 CSRF Defense-in-Depth (`lib/csrf.ts`)
- All session cookies use `SameSite=Lax`, preventing browser cross-site non-GET requests from attaching cookies.
- All state-changing POST routes evaluate `isSameOriginRequest(req)`, comparing browser-supplied `Origin` or `Referer` headers against the request host. Mismatched origins return 403 `VALIDATION` (CSRF rejected).

---

## 7. Input Validation & Error Sanitization

- **Address Normalization**: EVM addresses are validated and normalized using `viem`'s checksum-aware address utilities (`normalizeAddress`). Naive regexes are rejected.
- **Zod Schema Validation**: All API request bodies pass strict `zod` schema checks.
- **Zero Error Leakage**: `toErrorResponse(err)` maps exceptions to safe, structured error codes (`VALIDATION`, `UNAUTHENTICATED`, `INELIGIBLE`, `SOLD_OUT`, `INTERNAL`, `PROVIDER_UNAVAILABLE`). Raw stack traces and SQL error details are logged server-side only and never returned in API HTTP responses.

---

## 8. Dependency Vulnerability Audit Triage

| Package | Status | Mitigation / Finding |
|---|---|---|
| `cookie` | **Upgraded** to 0.7.2 | Fixed out-of-bounds character parsing issue. |
| `argon2` | **Upgraded** to 0.41.1 | Switched to `node-gyp-build`, eliminating vulnerable `tar` sub-dependency. |
| `next` | **14.2.35** | Reachability analysis confirmed no Server Actions, Middleware, `next/image`, or `rewrites` are used in this app. Upgrade to Next 15 recommended for long-term production maintenance. |
