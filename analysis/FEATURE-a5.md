# Round 4 — Cloudflare and Search Console

See [FEATURE-a5-cf-gsc.md](FEATURE-a5-cf-gsc.md) for the implementation, walkthrough, owner configuration, limits and test evidence. New UI: growth sidebar → Cloudflare / Search Console; Guides, Locations Insights and Site Scan hooks.

---

# Lane a5 — Site Scan

Built in `/home/veto/ConstructHUB-a5`, branch `lane/a5`, using only port **8169** and database **constructhub_dev_a5**. No deployment, push, production access, other lane process changes, real provider writes or paid API calls.

## What was built

- Separate `server/sitescan/` module: crawler, robots parser, audit rules, provider adapters, durable jobs, monthly scheduler, authenticated/report-token/public/admin routes and idempotent schema initialization. Boot registration sits beside `ensureGbpSchema()`; no Drizzle push or changes to GBP/auth modules.
- HTTP(S) only; reject credentials, nonstandard ports, loopback/private/link-local/metadata, CGNAT, mapped IPv6 and transition addresses. All DNS answers must be public. The validated address is pinned into the actual HTTP socket lookup, closing the DNS-rebinding gap. Each redirect is revalidated. Five redirects, 10-second request timeout, 5-second DNS timeout and 2 MB response ceiling.
- Robots rules, longest matching allow/disallow, bot-specific groups, crawl delay, XML sitemap/index discovery, breadth-first internal links, checkpoint after each page, default 150/max 500 pages. One request at a time with at least 300 ms spacing. Expired worker leases resume saved work; heartbeat and lease tokens prevent stale workers from overwriting another worker's progress. Five interrupted-worker attempts maximum.
- Technical/content findings: HTTP failures, sampled broken links, redirects, HTTPS/mixed content, canonicals, noindex/nofollow, robots and sitemap coverage, titles/metas/duplicates, headings, thin text, alt attributes, HTML size and sampled large images.
- Performance: injectable PageSpeed v5 adapter, mobile and desktop for 0–5 pages (default 1), Lighthouse score/LCP/CLS/blocking time/speed index/transfer size/image audits, page-level and origin-level CrUX data when supplied. Missing data is `null`/unavailable, never a fabricated measurement.
- Local: read-only, owner-scoped last-synced GBP snapshot; NAP matching, basic business JSON-LD validation, explicit service and service-area heading gaps, Maps/click-to-call/testimonial signals. Reports say when GBP comparisons were not assessed and show the sync timestamp when available.
- AI-search: GPTBot, ClaudeBot, PerplexityBot and Google-Extended robots policies; llms.txt, FAQ, structured data and limited server-rendered-text heuristics.
- Overall and category scores; history shows the delta against the previous completed scan of the same URL. Monthly rescans use fresh synced GBP data. Budget-exhausted scheduled work retries the following day. Concurrent scheduler ticks cannot enqueue the same due schedule twice.
- Draft-only AI fix plans through a small injectable `PlanProvider`, using the existing OpenAI environment variables. Batches cover every crawled page, at most 30 pages per prompt. Prompt requests prioritized fixes, per-page titles/metas, factual FAQ drafts and missing service/city outlines. GBP JSON-LD is constructed deterministically from known values and labelled draft. Nothing writes changes to the customer's website.
- Server-side PDF export, 256-bit random read-only share links expiring after 30 days, rotation and revocation. Tokens are stored as one-way SHA-256 hashes, not recoverable plaintext. No new provider credentials are stored. API request logs redact token path segments and omit Site Scan response bodies. The existing shared analytics sanitizer also removes Site Scan bearer tokens from page paths and referrers before collection/storage.
- Public lead magnet: 11-page quick scan with budgeted home-page PSI; email verification; pre-verification summary limited to scores and five findings; complete quick-scan report available only with the emailed verification token. Leads appear in the existing platform-admin console. Email goes through the existing sender/sink. Configured reCAPTCHA is required server-side.

## UI and use

1. Growth sidebar → **Site Scan** (`/site-scan`). Select a linked, synced GBP location or choose no GBP comparison. The selected location's website is prefilled.
2. Choose page cap and PageSpeed sample size, then **Start scan**. Progress and final results update automatically; completed reports stop polling.
3. Inspect category/severity findings and affected URLs. **Generate AI fix plan** creates reviewed-before-use drafts; **Copy draft** copies the text or JSON-LD. Large plans can take several minutes because page batches are sequential.
4. **Export PDF**, **Create share link**, and **Revoke share link** are available on a completed report. Creating another link rotates the old one. A shared report includes its drafts and GBP comparison facts: share only with intended recipients.
5. **Enable monthly rescan** on the chosen URL; use the same control to disable it. History shows previous scans and score changes.
6. Marketing landing page has a **Free 60-second website scan** link to `/free-site-scan`. Enter URL/email, inspect the summary, then open the verification email to unlock the full quick-scan report. Tokens expire after seven days.
7. `/admin` → **Site Scan leads** uses the existing platform-admin credential/email gate. It lists the latest 500 leads with website, verification state and scan status.

## Budgets and notifications

Persistent `takeBudget()` counters: 5 authenticated scans/user/day, 20 PSI calls/user/day and 100 globally/day; 3 AI plan requests/user/day, 20 model page-batch calls/user/day and 100 globally/day. Each PSI strategy costs one call. Schedules count toward the same scan budget. Public submissions: 3/IP/day, 2/normalized email/day and 100 globally/day, plus a separate request limiter. Public quick scans share a separate 20-call/day PSI pool within the global ceiling and skip PSI when either budget is exhausted; they never invoke AI.

New kind map: `SITESCAN_KINDS` in `server/sitescan/schema.ts` exports **`sitescan.completed`** and **`sitescan.regressed`**. `notifyUser` delivers them; `logActivity` records starting, drafting and sharing. `KIND_DEFAULTS` was not edited. These kinds currently use the existing fallback channels (in-app on, email off); the shared notification-preferences screen does not enumerate this separate map. A regression is a lower overall score or a new critical finding/affected-URL set compared with the previous completed report for that URL.

## Validation

All external boundaries in new tests are injected fixtures. Browser crawling uses an injected HTTP adapter; browser AI is intercepted and an explicitly labelled fixture draft is stored. The public browser summary uses intercepted fixture responses; real persistence, verification and email-boundary behavior are separately tested against lane Postgres with an injected sender.

- `npm run check`: **0 errors**.
- `CRM_TEST_SINGLE_PORT=true npx vitest run`: **814 passed, 43 skipped** (84 passing files, 2 skipped files). The skips belong to the existing suite; no new Site Scan test is skipped.
- Site Scan unit/integration subset: **30 passed**. Covers address variants, DNS/redirect pinning, robots exclusion, BFS/resume, unavailable robots, canonical-origin bootstrap, honest scoring/field data, all-page AI batching, idempotent schema, owner isolation, validation, persisted worker recovery, notifications, provider injection, hashed/revoked shares, public summary/verification, email budgets, and concurrent monthly scheduling/regression.
- `E2E_PORT=8169 E2E_DB=constructhub_dev_a5 npx playwright test --config playwright.sitescan.config.ts`: **2 passed**. Authenticated flow covers scan creation, queued→completed progress, findings, draft copying, actual PDF bytes, actual share/revoke APIs and monthly scheduling. Public flow covers form→summary and email-verification guidance.

## Configuration and honest limits

- Run with Node 20 and `.env` exported, as in the lane instructions. During validation the server uses `GBP_SYNC_DISABLED=true`, `SITESCAN_WORKER_DISABLED=true`, `EMAIL_FORCE_SINK=1`; tests explicitly invoke the Site Scan worker with offline dependencies. Normal operation requires `SITESCAN_WORKER_DISABLED` unset/false. Workers run in the app process every five seconds and need the app running.
- Set a valid `APP_URL` for emailed links. Configure a real `AI_INTEGRATIONS_OPENAI_API_KEY` and optional `AI_INTEGRATIONS_OPENAI_BASE_URL`; `SITESCAN_AI_MODEL` defaults to `gpt-4o-mini`. The lane's placeholder key is not a working AI service. `ANTHROPIC_API_KEY` is not currently consumed: a future adapter can implement `PlanProvider` without changing crawl/report logic.
- `PAGESPEED_API_KEY` is optional; keyless operation may hit Google's quota. Configure matching `RECAPTCHA_SECRET_KEY` and `RECAPTCHA_SITE_KEY` (or `VITE_RECAPTCHA_SITE_KEY`) when using CAPTCHA. Existing real-email configuration is required outside the local sink.
- “60 seconds” is an approximate quick-scan target, not a guaranteed SLA. Queueing, robots delays, DNS and slow sites can take longer. Quick scans request home-page mobile/desktop PSI only while quota remains; the full emailed report is the complete **11-page quick scan**, not a 150-page account scan.
- Scores are transparent heuristics, not ranking predictions, accessibility certification or exhaustive schema validation. Category deductions are 20/8/2 per critical/warning/info finding, floored at zero; overall is the mean of available categories. Performance uses the mean of measured Lighthouse scores and remains unavailable without measurements. Site changes and incomplete coverage can affect trends.
- HTML crawl only, no browser execution. Text matching can miss spelling/format variants; service gaps compare titles/H1s and can be false positives. Review all findings before acting. Schema validity checks parse JSON-LD and basic business fields, not every schema.org subtype/property.
- At most 10 sitemap documents, 5,000 sitemap URLs, bounded discovered queue and 25 MB persisted crawl-state ceiling, 20-minute crawl stage for account scans/50 seconds for the public crawl stage, 40 sampled link targets, 30 sampled images, and a 2 MB response limit. Link failures caused by access/network policy are not labelled confirmed broken links. Unknown CDN images are skipped until their robots policy is known. Full page transfer weight comes from PageSpeed, not the HTML byte count. Compressed sitemap files are not decoded in this version.
- Cross-origin page crawling is excluded. Bootstrap supports same-host HTTP/HTTPS and www redirects of robots.txt; unrelated redirected domains must be scanned directly. Robots retrieval fails closed on server errors, denied access and quota responses. Crawl delays over 30 seconds require a manual audit. Oversized/unreachable/non-HTML responses make coverage incomplete and are disclosed.
- AI uses up to 1,400 characters of readable evidence per page, with findings and synced GBP facts. Provider inputs above 200,000 characters are rejected rather than silently truncating a batch. Generated text can still be wrong: it stays labelled draft and must be reviewed. The provider is never given tools or permission to publish, crawl additional sites, or follow instructions embedded in page text. Provider-call reservations are not refunded after failures.
- Leads/report rows have no automated retention deletion yet; access links expire independently. Report tokens are bearer access: revocation blocks future reads but cannot recall an already downloaded/copied report. PDF uses PDFKit's standard font; complex non-Latin typography may require a future embedded font.
