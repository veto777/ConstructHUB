# Housecall Pro — notes for ConstructHUB

Owner, 2026-10-04, trying to connect Alpine's Housecall Pro account: "not available. Lets take notes for constructhub".
Background research (July 2026): `analysis/hcp-crawl/` (gitignored; their OpenAPI spec, product map, pricing).

## What we saw in Housecall Pro
- **API keys are MAX-only.** HCP → My Apps → API Key Management shows Basic "Not Available", Essentials "Not
  Available" (Alpine's current plan), MAX "Available", with an Upgrade button. A paying Essentials customer cannot get
  their own data out through the API. The only ways out are CSV exports, or the logged-in web app (which is what our
  importer uses).
- The same Apps page lists **Webhooks** and **Zapier** next to API Key Management. Their plan gating was not checked;
  assume MAX until verified.
- Alpine's HCP dashboard (2026-10-04): 36 open estimates ($1,682,301.77), 40 unscheduled jobs ($1,321,532.67),
  35 open invoices ($744,576.96).

## What it means for ConstructHUB
1. **Never hold a customer's data hostage.** Our public API (`/api/v1`, `chub_` keys) is on Pro and up
   (shared/plans.ts `apiUnitsPerMonth`: Starter 0, Pro 10k, Growth 50k, Agency 250k). Decision for the owner:
   - give Starter a small API allowance, or at least a full CSV/JSON export on every plan; and
   - market "your data is yours — API from Pro, export on every plan" against HCP's MAX-only API.
2. **"Switch from Housecall Pro" is a real acquisition path.** `scripts/import-hcp.ts` already imports a full HCP
   account idempotently: customers, jobs, estimates with options and items, invoices, payments and lead sources,
   cents-exact. It runs from a logged-in browser export (`analysis/hcp-export/dump.js`) because HCP's API is MAX-only.
   Productizing it means: (a) accept HCP's own CSV exports in the Migration Center (`server/crm/migrate.ts`), and
   (b) offer a done-for-you import where we pull the account with the customer's logged-in session.
3. **Plan pages should say what each tier includes up front.** HCP shows an "Upgrade" wall only after you click into
   an app. Our pricing and feature pages already list per-plan limits. Keep it that way for every gated feature.
