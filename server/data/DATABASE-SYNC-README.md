# Database Sync: Dev vs Production

## How It Works

Replit uses **completely separate databases** for development and production:

- **Development**: Internal PostgreSQL (only accessible from the dev environment)
- **Production**: Separate Neon PostgreSQL (created when you publish/deploy)

There is **no direct connection** between them. They don't share data.

## The Sync Method: Startup Seeder

The file `server/seed-reference-data.ts` runs automatically every time the app starts (both dev and production). It seeds **reference data** that needs to exist in every environment.

### What gets seeded:

| Data | Source File | Condition |
|------|------------|-----------|
| 50 State Guides | `server/data/state-guides.json` | Only if table is empty |
| 15 State Guide Steps | `server/data/state-guide-steps.json` | Only if table is empty |
| 4 Master Class Modules | `server/data/master-class-modules.json` | Only if table is empty |
| Trial Access Codes | Hardcoded in seeder | Only if code doesn't already exist |
| 32,864 Permit Databases | `server/seed.ts` | Only if count < 20,000 |
| 3,140 Property Appraisers | `server/seed.ts` | Only if count < 100 |

### How to add new data that needs to exist in production:

#### Trial Codes

Edit `server/seed-reference-data.ts` and add to the `trialCodes` array:

```typescript
const trialCodes = [
  { code: "TRIAL-C9D6AC01", trialDays: 0 },       // 0 = unlimited
  { code: "TRIAL-NEWCODE01", trialDays: 14 },      // 14-day trial
  // Add more codes here...
];
```

Then **publish/deploy** to make them available on constructhub.us.

#### Other Reference Data

1. Create a JSON file in `server/data/` with the data
2. Add a new section in `server/seed-reference-data.ts` that:
   - Checks if the data already exists (to avoid duplicates)
   - Inserts it if missing
3. Update `script/build.ts` if you added new JSON files (it already copies `server/data/*.json` to `dist/data/`)
4. Publish/deploy

## What Does NOT Sync

These are **user-generated** and only exist in the environment where they were created:

- User accounts (created via Google OAuth or email signup)
- Subscriptions and purchases
- Search history
- Scrape schedules
- Business locations and citations
- Review requests
- Click tracking data
- SEO contracts
- Admin-generated trial codes (use the seeder instead)

## Workflow

1. **Make changes** in the dev environment (Replit editor)
2. **Add reference data** to the seeder if it needs to exist in production
3. **Publish/deploy** - the production app restarts, the seeder runs, and the data appears
4. **User-specific data** (accounts, subscriptions, etc.) must be created directly on the production site

## Important Notes

- The seeder is **idempotent** - it checks before inserting, so it's safe to run multiple times
- Admin is checked by email (`alpinesidingcompany@gmail.com`, `support@constructhub.us`), not by user ID
- The admin on dev and the admin on production are **different user records** in different databases
- If you generate trial codes from the admin panel on dev, they will NOT work on production - use the seeder instead
