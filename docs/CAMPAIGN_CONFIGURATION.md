# Campaign Configuration Guide - Momozuki Whitelist Platform

This guide explains how to define, configure, and manage whitelist campaigns and NFT eligibility rules.

---

## 1. Overview & Data Model

Campaign configurations control eligibility rules, spot allocations, and active status. All campaign parameters are managed server-side in PostgreSQL.

### 1.1 Data Schema

#### `campaigns` Table
- `id`: Unique UUID identifier.
- `slug`: Unique string identifier used in URLs/API parameters (e.g. `momozuki-genesis`).
- `name`: Display name of the campaign (e.g. `Momozuki Genesis Whitelist`).
- `maxSpots`: Maximum number of whitelist claims permitted. Must be `> 0`.
- `eligibilityMode`: Mode evaluation algorithm: `ANY` or `ALL`.
- `active`: Boolean flag (`true` = open for claims, `false` = sold out/paused).

#### `campaign_collections` Table
- `id`: Unique UUID identifier.
- `campaignId`: Foreign key referencing `campaigns.id`.
- `name`: Collection display name (e.g. `Momozuki Genesis`).
- `chain`: EVM network identifier (e.g. `ethereum`, `base`, `polygon`, `arbitrum`, `optimism`).
- `contractAddress`: Lowercase-normalized EVM contract address (`0x...`).
- `minimumHeld`: Minimum number of NFTs required from this contract. Must be `>= 1`.

---

## 2. Eligibility Modes

### 2.1 `ANY` Mode (Logical OR)
Under `ANY` mode, a user is eligible for the whitelist if their wallet holds at least the `minimumHeld` quantity for **at least one** configured collection.

```json
{
  "slug": "partner-collab",
  "eligibilityMode": "ANY",
  "collections": [
    { "name": "Project Alpha", "chain": "ethereum", "contractAddress": "0x111...", "minimumHeld": 1 },
    { "name": "Project Beta", "chain": "base", "contractAddress": "0x222...", "minimumHeld": 1 }
  ]
}
```
*Result*: Holding 1 NFT from Project Alpha OR 1 NFT from Project Beta confers eligibility.

### 2.2 `ALL` Mode (Logical AND)
Under `ALL` mode, a user must hold at least the `minimumHeld` quantity for **every single** configured collection.

```json
{
  "slug": "vip-access",
  "eligibilityMode": "ALL",
  "collections": [
    { "name": "Genesis Pass", "chain": "ethereum", "contractAddress": "0xAAA...", "minimumHeld": 1 },
    { "name": "Badge Token", "chain": "ethereum", "contractAddress": "0xBBB...", "minimumHeld": 2 }
  ]
}
```
*Result*: User must hold at least 1 Genesis Pass AND at least 2 Badge Tokens to be eligible.

---

## 3. Supported Chains & Multi-Chain Campaigns

The platform supports any EVM chain indexed by the Alchemy NFT API:
- `ethereum` (Ethereum Mainnet)
- `base` (Base Mainnet)
- `polygon` (Polygon Mainnet)
- `arbitrum` (Arbitrum One)
- `optimism` (Optimism Mainnet)

Different collections in the same campaign can live on different EVM chains. The eligibility engine queries Alchemy per chain for the connected wallet address.

---

## 4. Seeding & Managing Campaigns

### 4.1 Modifying Seed Data (`prisma/seed.ts`)

To update default campaign settings for a deployment, edit `prisma/seed.ts`:

```typescript
const campaignId = '00000000-0000-0000-0000-000000000001';
const slug = 'momozuki-genesis';

await pool.query(
  `INSERT INTO campaigns (id, slug, name, "eligibilityMode", "maxSpots", active, "createdAt", "updatedAt")
   VALUES ($1, $2, 'Momozuki Genesis Whitelist', 'ANY', 555, true, now(), now())
   ON CONFLICT (slug) DO UPDATE SET
     "maxSpots" = EXCLUDED."maxSpots",
     active = EXCLUDED.active,
     "updatedAt" = now()`,
  [campaignId, slug],
);
```

### 4.2 Executing Seed Script

Run the seed command:
```bash
pnpm db:seed
```

> [!TIP]
> The seed script uses `ON CONFLICT (slug) DO UPDATE` to safely update campaign parameters without deleting existing whitelist claims.
