# Momozuki - NFT-Gated Whitelist Claim Platform

A production-ready, security-hardened NFT-gated whitelist claim platform built with Next.js 14, TypeScript, PostgreSQL, thirdweb, viem, and the Alchemy NFT API.

---

## 🌟 Key Features

- **Separate NFT Wallet & Destination Wallet**: Users connect their NFT-holding wallet (e.g. Ledger/hardware wallet) to prove eligibility, then specify a separate destination/mint wallet for the whitelist claim.
- **Server-Side Eligibility Engine**: Evaluates NFT holdings server-side via Alchemy API with support for multi-collection rules (`ANY` or `ALL` modes) and configurable minimum quantity thresholds (`minimumHeld`).
- **Cryptographic Proof of Ownership**: Nonce-based challenge-response authentication (`viem.verifyMessage`) and EIP-712 typed data claim authorization (`viem.verifyTypedData`). No static messages, no gas costs, zero private key exposure.
- **Strict Anti-Oversell Guarantees**: PostgreSQL transaction row locking (`SELECT ... FOR UPDATE`) guarantees total confirmed claims never exceed `maxSpots`, even under high-concurrency race conditions.
- **One Claim Per Destination Wallet**: Enforced via database unique constraints (`UNIQUE (campaignId, destinationWallet)`).
- **Protected Admin Panel (`/admin`)**: Real credential authentication (Argon2id hashing), interactive dashboard metrics (total spots, claimed, remaining, % claimed), searchable claims table, live CSV & JSON exports, and one-click global session revocation (`tokenVersion`).
- **Edge Hardening**: Sliding-window rate limiting on sensitive routes, CSRF defense-in-depth (`isSameOriginRequest`), and sanitized 500/503 error responses (zero stack trace or SQL leakage).

---

## 🛠️ Technology Stack

| Layer | Choice |
|---|---|
| **Framework** | Next.js 14 (App Router) + TypeScript |
| **Styling** | Vanilla CSS (`app/globals.css`) with MOMOZUKI design system tokens |
| **Database** | PostgreSQL (Supabase / Neon / Managed Postgres) via raw parameterized `pg` transactions |
| **Wallet Connection** | thirdweb SDK (`ConnectButton` / `useActiveAccount`) |
| **Cryptography** | `viem` (`verifyMessage`, `verifyTypedData`) |
| **NFT Ownership Data** | Alchemy NFT API (`alchemy-sdk`), server-side only |
| **Admin Hashing** | Argon2id (`argon2`) |
| **Testing** | Vitest (unit, integration, failure simulation) |

---

## 🚀 Getting Started (Local Development)

### 1. Prerequisites
- Node.js 18.17+ or 20.x
- `pnpm` package manager
- Local or managed PostgreSQL instance

### 2. Environment Setup
Clone the repository and copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Configure environment variables in `.env.local`:
```env
DATABASE_URL="postgresql://postgres:localdev@localhost:5432/momozuki_dev"
DIRECT_URL="postgresql://postgres:localdev@localhost:5432/momozuki_dev"
SESSION_SECRET="local-dev-only-secret-min-32-characters-long"
ADMIN_EMAIL="admin@momozuki.io"
ADMIN_PASSWORD="Password123!"
ALCHEMY_API_KEY="your-alchemy-key"
NEXT_PUBLIC_THIRDWEB_CLIENT_ID="your-thirdweb-client-id"
```

### 3. Install Dependencies & Seed Database
```bash
pnpm install

# Apply database migrations
psql "$DIRECT_URL" -f prisma/migrations/00000000000000_init/migration.sql
psql "$DIRECT_URL" -f prisma/migrations/00000000000001_admin_token_version/migration.sql

# Seed initial campaign data
pnpm db:seed

# Seed initial admin credentials
pnpm db:seed-admin
```

### 4. Run Development Server
```bash
pnpm dev
```
Open [http://localhost:3000](http://localhost:3000) to view the public landing page, or [http://localhost:3000/admin](http://localhost:3000/admin) for the admin portal.

---

## 🧪 Testing & Verification

```bash
pnpm test          # Run Vitest test suite (71 tests covering unit, integration & failure simulation)
pnpm typecheck     # Run TypeScript type check (tsc --noEmit)
pnpm lint          # Run ESLint (eslint .)
pnpm build         # Verify Next.js production build
```

---

## 📚 Project Documentation Index

All architectural decisions, deployment steps, and operations guides are located in `/docs`:

- **[`docs/CHECKPOINT.md`](file:///c:/Users/Arnav/Documents/Godheid/Momozuki/Website/atelier-ix-checkpoint8/atelier-ix-checkpoint8/docs/CHECKPOINT.md)** - **Current state & checkpoint tracker (Source of truth)**
- **[`docs/DEPLOYMENT.md`](file:///c:/Users/Arnav/Documents/Godheid/Momozuki/Website/atelier-ix-checkpoint8/atelier-ix-checkpoint8/docs/DEPLOYMENT.md)** - Production deployment guide (Vercel, Fly.io, Render, Postgres connection pooling)
- **[`docs/ADMIN_GUIDE.md`](file:///c:/Users/Arnav/Documents/Godheid/Momozuki/Website/atelier-ix-checkpoint8/atelier-ix-checkpoint8/docs/ADMIN_GUIDE.md)** - Operator guide for admin provisioning, security, dashboard, and CSV/JSON exports
- **[`docs/CAMPAIGN_CONFIGURATION.md`](file:///c:/Users/Arnav/Documents/Godheid/Momozuki/Website/atelier-ix-checkpoint8/atelier-ix-checkpoint8/docs/CAMPAIGN_CONFIGURATION.md)** - Guide for setting up single/multi-collection rules (`ANY`/`ALL` modes) and token thresholds
- **[`docs/SECURITY.md`](file:///c:/Users/Arnav/Documents/Godheid/Momozuki/Website/atelier-ix-checkpoint8/atelier-ix-checkpoint8/docs/SECURITY.md)** - Complete security model, EIP-712 signature verification, transaction locks, and dependency audit triage
- **[`docs/ARCHITECTURE.md`](file:///c:/Users/Arnav/Documents/Godheid/Momozuki/Website/atelier-ix-checkpoint8/atelier-ix-checkpoint8/docs/ARCHITECTURE.md)** - High-level stack decision, component mapping, and database schema
- **[`docs/DECISIONS.md`](file:///c:/Users/Arnav/Documents/Godheid/Momozuki/Website/atelier-ix-checkpoint8/atelier-ix-checkpoint8/docs/DECISIONS.md)** - Decision log detailing architectural choices D1–D24
- **[`docs/IMPLEMENTATION_PLAN.md`](file:///c:/Users/Arnav/Documents/Godheid/Momozuki/Website/atelier-ix-checkpoint8/atelier-ix-checkpoint8/docs/IMPLEMENTATION_PLAN.md)** - 11-checkpoint build plan progress
