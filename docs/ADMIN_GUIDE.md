# Operator & Admin Guide - Momozuki Whitelist Platform

This guide details the operation, security management, and administration of the Momozuki Whitelist Claim Platform.

---

## 1. Admin Account Provisioning

The Momozuki Admin Panel uses credential-based authentication (`email` + `password`) backed by Argon2 password hashing. There is no public registration page.

### 1.1 Provisioning the Initial Admin User

1. Set your admin credentials in `.env.local` (or server environment):
   ```env
   ADMIN_EMAIL="admin@momozuki.io"
   ADMIN_PASSWORD="Your-Secure-High-Entropy-Password-123!"
   ```

2. Run the seed script:
   ```bash
   pnpm db:seed-admin
   ```

3. The script hashes the password with Argon2id and inserts or updates the record in the `admin_users` database table.

> [!NOTE]
> The admin seed script is idempotent. Re-running it with the same `ADMIN_EMAIL` will update the password hash if changed, without creating duplicate accounts.

---

## 2. Login & Session Management

### 2.1 Logging In

1. Navigate to `/admin` in your web browser.
2. Enter your registered admin email and password.
3. Upon successful validation, the server issues a signed JWT cookie (`ADMIN_SESSION_COOKIE`).

### 2.2 Security Features
- **Argon2id Hashing**: Admin credentials are hashed using `argon2` v0.41+.
- **Constant-Time Responses**: Login failures return generic 401 `ADMIN_UNAUTHENTICATED` errors without revealing whether the email or password was invalid (preventing user enumeration).
- **Session Cookie Security**: The session cookie is `httpOnly`, `Secure` (in production), `SameSite=Lax`, and distinct from wallet session cookies.
- **Session Duration**: Admin sessions expire automatically after 60 minutes.

### 2.3 Revoking All Active Admin Sessions

If an admin token is suspected of being compromised:

1. Click **Revoke All Admin Sessions** in the admin header, or issue a POST request to `/api/admin/revoke-sessions`.
2. The server atomically increments the admin's `tokenVersion` in the database.
3. Every outstanding session token issued before the revocation becomes instantly invalid on its next request.

---

## 3. Admin Dashboard Features

Access the dashboard at `/admin` after authenticating.

### 3.1 Overview Metrics
- **Total Spots**: Allocated max spots for the active campaign.
- **Spots Claimed**: Real-time count of confirmed claims in the database.
- **Spots Remaining**: Spots remaining before sell-out (`maxSpots - claimed`).
- **Percentage Claimed**: Visual progress bar indicating campaign progress.

### 3.2 Campaign Configuration Summary
View current campaign settings:
- Campaign Slug & Name
- Eligibility Mode (`ANY` vs `ALL`)
- Configured NFT Collections & Minimum Quantities (`minimumHeld`)

---

## 4. Viewing & Exporting Claims

### 4.1 Real-Time Claims Table
The claims table displays every confirmed claim in real time:
- **Holder Wallet**: The connected NFT-holding wallet that proved ownership.
- **Destination Wallet**: The destination/mint wallet specified for the whitelist.
- **Qualifying Collection**: Snapshot of collection(s) satisfied at claim time.
- **Chain**: EVM network chain identifier.
- **Timestamp**: UTC timestamp of claim confirmation.

### 4.2 Search & Filter
Use the search bar at the top of the claims table to filter claims by:
- Holder wallet address (e.g. `0xABC...`)
- Destination wallet address (e.g. `0xXYZ...`)

### 4.3 Exporting Whitelist Data

Admin operators can export the authoritative claim list directly from the database at any time.

#### CSV Export (`GET /api/admin/claims/export/csv`)
Click **Export CSV** in the admin header. The server streams a standard CSV file with headers:
```csv
holder_wallet,destination_wallet,claimed_at,qualifying_collection,chain
0x1111111111111111111111111111111111111111,0x2222222222222222222222222222222222222222,2026-09-15T03:30:00.000Z,Momozuki Genesis,ethereum
```

#### JSON Export (`GET /api/admin/claims/export/json`)
Click **Export JSON** to download a structured JSON array containing complete claim records.
