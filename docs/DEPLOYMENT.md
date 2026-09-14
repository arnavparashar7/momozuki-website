# Production Deployment Guide - Momozuki Whitelist Platform

This guide explains how to deploy the Momozuki NFT-Gated Whitelist Claim Platform to production.

---

## 1. System Requirements & Architecture

The application is built as a single deployable Next.js 14 (App Router) project providing both the Web3 public interface, the protected admin portal, and server-side API routes.

### Minimum Server Requirements
- **Node.js**: 18.17.0+ or 20.x LTS
- **Package Manager**: `pnpm` (version 9.x recommended)
- **Database**: PostgreSQL 14+ (hosted on Supabase, Neon, AWS RDS, or self-hosted)

---

## 2. Database Configuration

The application requires PostgreSQL for transaction integrity, atomic spot decrementing (`SELECT ... FOR UPDATE`), and duplicate claim enforcement via unique constraints.

### 2.1 Connection Strings

When using connection poolers like **PgBouncer** (e.g. Supabase port 6543):

1. **`DATABASE_URL`**: Transaction-pooled connection string used at runtime by Node/pg drivers.
   ```env
   DATABASE_URL="postgresql://user:password@db.supabase.co:6543/postgres?pgbouncer=true"
   ```
2. **`DIRECT_URL`**: Direct connection string (port 5432) used for running schema migrations.
   ```env
   DIRECT_URL="postgresql://user:password@db.supabase.co:5432/postgres"
   ```

### 2.2 Database Migrations

Hand-authored migrations are located in `prisma/migrations/`. In a standard deployment pipeline with network access to Prisma engine repositories:

```bash
# Apply pending database migrations to production
pnpm prisma migrate deploy
```

In air-gapped or restricted sandbox environments where Prisma CLI engine downloads are unavailable:

```bash
# Execute migration SQL files directly via psql
psql "$DIRECT_URL" -f prisma/migrations/00000000000000_init/migration.sql
psql "$DIRECT_URL" -f prisma/migrations/00000000000001_admin_token_version/migration.sql
```

---

## 3. Environment Variables

Create `.env.local` for local development or configure these variables in your hosting provider's dashboard (e.g., Vercel / Fly.io / Render Secrets).

| Variable Name | Required | Scope | Description |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | Server | PostgreSQL pooled connection string. |
| `DIRECT_URL` | **Yes** | Server | PostgreSQL direct connection string for migrations. |
| `SESSION_SECRET` | **Yes** | Server | Minimum 32-character random string used to sign wallet & admin JWT cookies. |
| `ADMIN_EMAIL` | **Yes** | Server | Initial admin login email address (used by `pnpm db:seed-admin`). |
| `ADMIN_PASSWORD` | **Yes** | Server | Initial admin login password (used by `pnpm db:seed-admin`). |
| `ALCHEMY_API_KEY` | **Yes** | Server | Alchemy API Key for querying NFT holdings. Never expose to client. |
| `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` | **Yes** | Client | thirdweb Client ID for the Connect Wallet modal UI. |

> [!CAUTION]
> Never set `ALCHEMY_API_KEY` or `SESSION_SECRET` with `NEXT_PUBLIC_`. Keep them strictly server-side.

---

## 4. Initializing Seed Data

After database migrations have completed:

### 4.1 Seed Campaign & Collection
```bash
# Provision the initial Momozuki Genesis campaign (555 max spots, ANY eligibility mode)
pnpm db:seed
```

### 4.2 Seed Admin Account
```bash
# Provision the initial admin account using ADMIN_EMAIL and ADMIN_PASSWORD
pnpm db:seed-admin
```

---

## 5. Hosting Platform Deployment Instructions

### Option A: Deploying on Vercel (Recommended)

1. Import the repository into Vercel.
2. In **Environment Variables**, add:
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `SESSION_SECRET`
   - `ALCHEMY_API_KEY`
   - `NEXT_PUBLIC_THIRDWEB_CLIENT_ID`
3. Vercel automatically detects Next.js. Build settings:
   - **Build Command**: `pnpm build`
   - **Output Directory**: `.next`
4. Trigger Deployment.

### Option B: Deploying on Fly.io / Render / VPS (Docker / Node)

1. Build production application:
   ```bash
   pnpm install --frozen-lockfile
   pnpm build
   ```
2. Launch production server:
   ```bash
   pnpm start
   ```
   The application runs on `http://localhost:3000` by default. Set `PORT` env var to override.

---

## 6. Health & Verification Check

Once deployed, verify the health status endpoint:

```bash
curl https://your-domain.com/api/health
```

Expected Response:
```json
{
  "status": "ok",
  "timestamp": "2026-09-15T03:30:00.000Z"
}
```
