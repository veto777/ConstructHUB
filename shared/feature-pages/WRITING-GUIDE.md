# Writing a feature page

Every feature gets an intro page at `/features/<slug>` so a contractor can see what it does and
decide whether they want it. All pages share one template (the `/call-assistant` look); you only
write **data** in your feature's own file: `shared/feature-pages/<key>.ts`. Never edit the
template, the registry (`index.ts`) or another feature's file.

The reference is **`siteScan.ts`**. Copy its shape, not its words.

## Which file is mine

| group | keys |
| --- | --- |
| Grow | `gbp`, `reviews`, `profileGuard`, `rankingGrid`, `gbpContent`, `social`, `siteScan`, `media` |
| Protect | `clickGuard`, `ipTracker`, `vpnShield`, `cloudflare`, `searchConsole`, `domains`, `mailAlerts` |
| Win jobs | `permits`, `property`, `competitors`, `adsManager`, `lsaLeads` |
| Run the business | `crm`, `crmSchedule`, `crmLeads`, `texting`, `agency` (the AI Call Assistant keeps its own `/call-assistant` page) |
| Learn | `masterClass`, `guides`, `reinstatement` |
| The platform | `gabe`, `customerApi` |

The file is `shared/feature-pages/<key>.ts`; the URL is `/features/<slug>` where the slug is already
set in the file (kebab-case of the key: `profileGuard` → `/features/profile-guard`). Don't change
`key`, `slug` or `group`.

## Voice

- Plain, confident, contractor-facing. Short sentences. Say what it does for the job, not how clever it is.
- Title Case for the H1 and section headings (as on `/call-assistant`); sentence case everywhere else.
- Use the feature's name exactly as the app's sidebar and page call it.
- No exclamation marks, no "revolutionary", "game-changing", "dominate", "#1", "guaranteed".
- No competitor names (no other software products, agencies or marketplaces by name).

## Every claim traceable to code

Before you write a sentence, find the code that makes it true and list the file in `sources`.

- **What it does** → the page in `client/src/pages/`, its server routes and worker in `server/`.
- **Limits and caps** (pages per scan, sites per schedule, days a link lasts) → the code that enforces
  them. If a number lives only in a route handler, you may state it, but prefer wording that survives a
  change ("a daily cap") unless the number matters to the buyer.
- **Anything that depends on configuration** (a Google API key, a carrier, a provider) → say what
  happens when it isn't available, or don't claim it. Example: Site Scan's speed scores appear "when
  Google returns them", because PageSpeed needs a server key.
- If you can't find the code for a claim, cut the claim.

### How to verify a claim

1. `grep -rn "<the thing>" server client/src shared` and read the handler, not just the UI label.
2. Check the gate: `requirePlan`, `reserveQuotaFor(...)`, `requireModule(...)`, the add-on, or none.
   That decides `pricing.kind` (below).
3. Check what a visitor needs first: a Google connection (`server/gbp/grants.ts`), a synced profile, a
   tracking snippet on their site, an MCC link, a CRM org. Say it in the FAQ.
4. Run the feature in the dev app if you can (`/site-scan`, etc.) and compare what you wrote.

## No stats, no testimonials, no sample data

- **No statistics** (customer counts, "saves 10 hours", "3x more calls") unless an existing endpoint
  computes them live — and then they don't belong in a static content file anyway.
- **No testimonials, reviews, logos or quotes** from customers.
- **No real customer data.** The dev database holds real-looking CRM rows: never copy a client name,
  number, address or screenshot into a page. The spotlight panel lists **field names** ("Overall score",
  "Fix checklist"), never values.
- Illustrations are the mascots only (`hero.mascot`: `"standing"` or `"gabe"`).

## Pricing only through the helpers

Never type a price (`$29`, `$1,999`) or a plan's allowance number. The vitest rejects any `$` + digit in
a content file. Pick how the feature is **sold** and the template prices it from `shared/plans.ts`:

| the code's gate | `pricing` |
| --- | --- |
| `requirePlan` with no test (any active plan) | `{ kind: "plan" }` (+ `allowance` when a limit meters it) |
| a plan limit that is 0 on some plans (`protectedSites`, `competitorScans`, …) | `{ kind: "allowance", allowance: { limit, unit, period } }` |
| `requireModule("…")` (Agency-only modules) | `{ kind: "module", module }` |
| an add-on (`ADDONS`) | `{ kind: "addon", addon }` |
| no plan check at all | `{ kind: "account" }` |
| a one-time service in the price book | `{ kind: "service", service }` |
| quoted by a sales rep (at or above the sales threshold) | `{ kind: "sales", topic }` |

An `allowance` names a numeric key of `PlanLimits` (`limit`), an optional per-location key for Agency
(`perLocation`), a plural `unit` and `period` (`"month"` or `"count"`). The page then lists it plan by plan.
If you need a number in a sentence (an FAQ answer), build it with a helper — e.g.
`` `${allowanceLine(SCANS)}` `` from `./pricing`, or `formatUsd`/`planNamesWhere` from `../plan-copy` —
never type it. `pricing.note` is one plain sentence with no `$` amounts.

## The fields

| field | what to write |
| --- | --- |
| `status` | `"stub"` until you're done; set `"ready"` when every rule here holds. Ready pages enter the sitemap, and a retired landing page (`legacyPath`) starts redirecting to yours. |
| `title` | The feature's name as the app uses it. |
| `kicker` | 1–3 words above the H1 ("Website audit"). |
| `headline` | `lead` + `swipe` (the orange marker phrase, 1–3 words) + optional `tail`. Use ` ` to keep the swipe on one line. |
| `lede` | 1–2 sentences: what it does, for whom. |
| `hero.bubble` | One short, friendly line the mascot says. No claims. |
| `steps` | **3–5** steps from sign-up to the first result. Each: a 2–5 word title, one sentence. |
| `cards` | 4–9 capabilities the code really has. `icon` from `FEATURE_ICONS` in `types.ts`. |
| `spotlight` | Optional deep-dive: 3–5 `points` + a navy `panel` of **field names**. |
| `audience` | 2–4 short profiles of who it's for. |
| `faqs` | **3–5** questions a buyer asks. Always cover: what it needs from me (Google connection, a snippet on my site, a synced profile…), which plan, and what it does **not** do. Answer honestly, including limits. |
| `related` | 2–3 registry keys of features that work with it. |
| `app` | The in-app route for "Open <feature>" (`surface: "portal"` for CRM pages). Must be a route in `client/src/App.tsx`. |
| `tryIt` | Only when a no-account version exists (e.g. the free site scan). |
| `headings` | Optional overrides for section headings: `{ title, em }` — `em` is the orange italic part. |
| `seo` | `title` ≤ ~60 chars ending in `| ConstructHUB`; `description` ≤ ~160 chars, factual. |
| `legacyPath` / `flag` | Already set where they apply. Keep them. |
| `sources` | Every file that backs a claim on the page. The vitest checks they exist. |

## Before you set `status: "ready"`

- [ ] `npm run check` is clean and `npx vitest run server/feature-pages.test.ts` passes.
- [ ] Every sentence has a source; nothing promises rankings, revenue or results.
- [ ] No `$` amounts, no stats, no testimonials, no competitor names, no customer data.
- [ ] 3–5 steps, 3–5 FAQs (needs-from-me, plan, does-not-do), 2–4 audience profiles.
- [ ] The page reads well at 390 px (long words in the H1 can wrap; keep the swipe short).
- [ ] Look at it: `/features/<slug>` signed out (public header) and signed in (sidebar).
