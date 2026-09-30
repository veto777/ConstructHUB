# Lane a7 — Domains and provider mail alerts

Worktree: `/home/veto/ConstructHUB-a7`; only port **8189** and database **constructhub_dev_a7** were used. No deployment, push, registrar change, live Google call, or paid call was performed. External transports in tests are fixtures. SMTP uses `EMAIL_FORCE_SINK=1`.

## What was built and where

The growth app’s **Google Business → Domains** (`/domains`) and **Mail alerts** (`/mail-alerts`) entries expose the two new pages. These are growth pages, so browser tests use `VITE_FORCE_PORTAL=false`; CRM tests use their existing portal harness.

### Domains

- Two working allowlisted adapters: **Porkbun API v3** and **Name.com CORE v1**. Multiple labelled registrar accounts per user. Credentials use the existing AES-256-GCM `v1` token-crypto envelope and are never returned. The new parser boundary also prevents malformed credential JSON from reaching the general error logger.
- Server-side paginated/searchable inventory, connection lists, job history and location choices. Registrar/client filters on the inventory API; 25 rows by default, at most 100. Domain inventory omits large cached record arrays. Bulk local add, client mapping, discovery, monitoring, nameserver/DNS preview, confirmation and rollback-preview endpoints accept at most 100 items.
- Domains automatically map to a uniquely matching owned GBP website hostname (apex or `www`); ambiguous matches stay unmapped. The UI supports explicit bulk mapping to an owned client location.
- Every provider write uses a saved before/after preview → explicit confirmation → existing `requireRecentAuth` → queued apply → public DoH verification. Previews expire after 15 minutes; confirmed authorizations expire after 10 minutes. Fresh provider reads reject stale snapshots and changed connections. Email-related records are identified from both the actual old and new record, so relabelling an MX operation cannot bypass acknowledgement.
- Rollback snapshots and inverse operations are saved before contacting the provider. Rollback itself creates a new preview and requires the same confirmation/re-authentication. An uncertain network outcome is **not automatically replayed**. A create with an unknown returned ID can be rolled back only when a new preview identifies a unique matching record.
- The adapters expose only list/read, set nameservers, and create/update/delete A/AAAA/CNAME/TXT/MX/CAA records. No generic public request method. Tests scan adapter source for forbidden endpoint patterns. No transfer, EPP/auth-code retrieval, lock, ownership/contact, purchase, renewal, billing, privacy or domain-deletion operation exists.
- Background discovery and daily monitoring are persisted in Postgres. A database advisory lock prevents overlapping workers; shared growth budgets cap registrar/DoH requests at 120/minute and 2/second. Interactive changes take priority over inventory/monitor jobs. Google Business Profile APIs are not called by this module.
- Alerts: closest expiry band (60/30/7 days), auto-renew off, observed NS or DNS data drift, failed HTTPS availability, and TLS certificates expiring within 30 days. Alert fingerprints prevent repeat email on unchanged conditions. Routine successful syncs do not generate account activity.
- Website checks are HTTPS-only, resolve and reject private/non-global addresses, pin the validated address into the socket, and do not follow redirects. No arbitrary fetch URL is accepted.

How to use: create scoped registrar credentials using the in-app guide; connect and re-authenticate; wait for discovery; select domains; map clients; preview nameservers or a DNS edit; expand each job to read Before/After; select ready previews, acknowledge email interruption risk, confirm, and re-authenticate if required. Watch `verifying` become `verified`; it is not reported as verified just because the registrar accepted it. Select applied jobs and choose **Preview rollback** to restore the saved setting through the same workflow.

### Forwarding and optional Gmail API

- Default forwarding needs no Gmail API scope. Each user gets an unguessable address `alerts+<192-bit random token>@INBOUND_MAIL_DOMAIN`. The token is hashed for lookup and encrypted for display.
- `POST /api/inbound-mail` checks `x-inbound-mail-secret` using a timing-safe comparison before reading a bounded 256 KiB body. It accepts raw RFC822/MIME or `{from,to,subject,text,html,headers}` JSON. The authenticated worker can send `x-inbound-mail-to` for the actual envelope recipient; Gmail forwarding often preserves the original `To` header.
- Known sender and subject rules classify GBP, Search Console, Ads, Cloudflare, registrar and Blotato events. Unmatched messages are dropped before any body is stored. Registrar transfer messages are critical alerts. Deduplication prevents repeated delivery from creating duplicate alerts.
- Gmail forwarding confirmations display a parsed code and allowlisted Google confirmation URL. HTML is reduced to text; attachments and remote images are not rendered. Matched bodies are capped at 16,000 characters; original raw email is not persisted.
- Unique owned domain matches map alerts to a client, with a business-name fallback. Ambiguity stays visible as unmapped. Bulk manual mapping and read-state actions are owner-scoped. The inbox supports server-side pagination/search/provider/severity/client filtering.
- Messages disappear at their expiry (no more than 30 days from reception; Gmail uses the original message date), and a minute worker deletes expired bodies. Cleanup runs even while Gmail OAuth is disabled. As with any scheduled deletion, a stopped application needs cleanup to run again; expired rows remain inaccessible through the API.
- Optional `gmail.readonly` uses separate encrypted grant rows and separate OAuth state/callbacks, never GBP’s token store. The flag defaults off. Sync pages contain at most 20 message IDs, query only the sender allowlist and last 30 days, inspect metadata before fetching matched bodies, and skip already-stored messages. Multiple Gmail accounts are supported; a shared 200-request/minute budget and worker lock bound reads. No Gmail send, modify or delete API exists.
- Connect/disconnect uses recent authentication. Disconnect removes local Gmail grants/data; the UI explicitly directs the owner to remove the Google permission to finish remote revocation, avoiding accidental revocation of the separate GBP integration under the same OAuth application.

How to use: open Mail alerts, copy the address, then Gmail → Settings → See all settings → Forwarding and POP/IMAP → Add forwarding address. Read the confirmation in ConstructHUB and complete Google’s confirmation. Create filters for the shown provider senders with **Forward it to** this address. Do not enable whole-inbox forwarding. Open provider dashboards directly when acting on security/billing alerts; sender matching alone is not proof of email authenticity.

## Official registrar/API research (checked 2026-09-29/30)

Only the first two adapters are implemented and recommended by the connection UI. Other candidates are deliberately distinguished from supported integrations.

| Provider | Official documentation / access requirements | Lane status |
|---|---|---|
| Porkbun | [API documentation](https://porkbun.com/api/json/v3/documentation), [domain endpoints](https://porkbun.com/llms/domain), [DNS endpoints](https://porkbun.com/llms/dns). Account API key + secret; enable per-domain API access. Current docs support source-IP and domain restrictions; use them. Exact-domain filtering on `domain/listAll` reads metadata; `getNs`/`updateNs` and DNS CRUD supply the allowed operations. | Implemented. |
| Name.com | [CORE overview](https://docs.name.com/api/v1/overview), [authentication](https://docs.name.com/guides/authentication), [set nameservers](https://docs.name.com/api/v1/reference/domains/set-nameservers), [DNS create](https://docs.name.com/api/v1/reference/dns/create-record), [OpenAPI](https://namedotcom-cdn.name.tools/api-info/namecom.api.yaml). Username + API token via Basic auth, `/core/v1`; nameserver RPC uses `:setNameservers`. Prefer client sub-accounts where available. | Implemented CORE; does not use the deprecated v4 API. |
| Namecheap | [Introduction/IP allowlisting](https://www.namecheap.com/support/api/intro/), [eligibility FAQ](https://www.namecheap.com/support/knowledgebase/article.aspx/9739/63/api-faq/). Production eligibility is **one of** 20 domains, $50 balance, or $50 spent in the preceding two years; support may approve exceptions. IPv4 allowlisting is required. Profile → Tools → Business & Dev Tools → API Access → Manage; enable and whitelist the configured `DOMAINS_EGRESS_IP`. | API capable; no adapter in this lane. Manual guide supplied. |
| GoDaddy | [Current official access rules](https://classic-developer.godaddy.com/getstarted), [Domains guide](https://developer.godaddy.com/en/docs/api-users/domains), [v1 spec](https://developer.godaddy.com/openapi/domains-v1.json). Current page says Management/DNS: **1+ domains OR active Discount Domain Club Domain Pro plan**; Availability: **50+ domains**. This differs from the historical 10-domain restriction. New integrations use PATs; access remains account/provider-controlled. The generic domain-detail response can contain an auth code, another reason not to casually expose the entire API. | API capable; no adapter. Manual guide supplied. |
| Dynadot | [Official command list](https://www.dynadot.com/domain/api-commands) documents `set_ns` and DNS commands. Account API key and account-side IP/access configuration must be verified for the customer. | Candidate only; no adapter or unverified access-eligibility claim. |
| Gandi | [Domain API](https://api.gandi.net/docs/domains/), [LiveDNS](https://api.gandi.net/docs/livedns/), [PAT authentication](https://api.gandi.net/docs/authentication/). Scoped, expiring personal access token; old API-key authentication is deprecated. DNS records use LiveDNS, requiring LiveDNS delegation. | Candidate only; no adapter. |
| IONOS | [Developer API documentation](https://developer.hosting.ionos.com/docs/dns), [official API overview](https://www.ionos.com/help/hosting/ionos-apis/ionos-developer-apis/). Provider API credentials and suitable IONOS products are required. DNS API is documented; this lane did not establish a complete dual DNS/nameserver adapter contract. | Not represented as a supported registrar. |
| AWS Route 53 | [ChangeResourceRecordSets](https://docs.aws.amazon.com/Route53/latest/APIReference/API_ChangeResourceRecordSets.html). Hosted-zone DNS operations use IAM/SigV4 credentials scoped to the hosted zone. DNS hosting is distinct from registrar delegation. | DNS provider candidate, no adapter or AWS charges. |
| Cloudflare Registrar | [Nameserver restrictions](https://developers.cloudflare.com/dns/nameservers/nameserver-options/). Domains registered there already use and must remain on Cloudflare nameservers. | Lane a5 owns Cloudflare; no duplicate adapter. |

### Manual providers

“Manual only in ConstructHUB” is not a claim that no private/reseller API could exist. No supported public dual-capability API was established here.

- **Squarespace Domains:** Domains dashboard → domain → DNS → Domain Nameservers → custom nameservers → enter assigned pair → save. [Official instructions](https://support.squarespace.com/hc/en-us/articles/4404183898125-Review-change-or-reset-your-domain-s-nameservers).
- **Hover:** sign in → domain → Overview → Nameservers → Edit → replace pair → save. [Official instructions](https://support.hover.com/support/solutions/articles/201000064742).
- **Network Solutions:** Account Manager → Domains → domain → Advanced Tools → Manage beside Nameservers (DNS) → enter pair → Save. [Official instructions](https://www.networksolutions.com/help/article/manage-dns-adns-records).
- **Wix:** official guidance says Wix-registered domains **cannot change nameservers**. Use Domains → domain actions → Manage DNS records for allowed manual pointing. A Cloudflare nameserver cutover is unavailable within the no-transfer scope; the UI does not invent a workaround or recommend a transfer. [Official explanation](https://www.wix.com/blog/use-wix-just-as-a-domain-registrar).

Before a permitted Cloudflare nameserver switch, copy website/email records and review DNSSEC at the registrar. This lane does not change DNSSEC or registration settings.

## Owner configuration and a5 merge seam

See [`a7.env.example`](a7.env.example) and the undeployed [`a7-email-worker.js`](a7-email-worker.js).

1. Back up a stable `GBP_TOKEN_KEY` (32 bytes, base64). Production requires it. It also protects registrar credentials, inbound address tokens, and Gmail grants.
2. Set `DOMAINS_EGRESS_IP` to the actual production egress IPv4; this is intentionally not hardcoded. Enable `DOMAINS_WORKER_ENABLED=true` only when ready for user-confirmed provider operations and monitoring.
3. Configure ConstructHUB’s own inbound email domain and an unguessable `INBOUND_MAIL_SECRET`. Install/configure the provided worker yourself; the lane did not deploy it. The owner must configure catch-all/plus-address routing and test actual Gmail delivery. Cloudflare’s [email handler API](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/) documents the worker message interface.
4. Keep `GMAIL_OAUTH_ENABLED=false` for default forwarding. Before public OAuth use, finish Google verification and the applicable annual paid third-party CASA assessment, enable Gmail API, and register `https://<app-host>/api/mail-alerts/oauth/callback`. Google identifies Gmail read scopes as restricted and requires security assessment when server-side restricted data is stored/transmitted: [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
5. a5 seam: `CloudflareZoneLink.zoneNameservers(domain): Promise<string[]|null>` in `server/domains/cloudflare-link.ts`. The default returns null. Bind an owner-scoped **cached, no-network** implementation using `registerDomainRoutes(app, auth, userId => link)`. Until merged, the Cloudflare-assigned-pair shortcut returns a clear configuration error; manually entering the actual assigned pair still uses the full preview workflow.

## Security / schema / notification integration

- `ensureDomainsSchema()` and `ensureMailAlertsSchema()` are idempotent and registered alongside `ensureGbpSchema` in `server/routes.ts`; no drizzle-kit push.
- Every new UI-facing API route is authenticated and scoped by `user_id`; OAuth binds state to the authenticated user. Ingress instead uses its specified shared-secret authentication and maps only a matching private recipient token.
- New kinds live in a separate `server/domains/notification-kinds.ts` map, composed into `server/notification-kinds.ts`: `domains.changed`, `domains.monitor`, `mail.alert`, `mail.security`. `KIND_DEFAULTS` and `server/account-events.ts` were not edited. All alerts/activity use existing `notifyUser`/`logActivity`.
- Cross-cutting changes are boot/route registration, response-log redaction/private parser registration, notification-registry composition, app routes/sidebar, and MIME parser dependencies. The implementation otherwise stays in the new modules/pages.

## Honest limits

- Only Porkbun and Name.com are automated. Other registrar rows are documentation/manual management, not working adapter claims. Provider APIs and real end-to-end OAuth/email delivery were not exercised with live credentials.
- DNS checks inspect apex NS/A/AAAA/CNAME/TXT/MX/CAA and known record names obtained from the supported registrar API (maximum 200 name/type questions per monitor job). Public DNS cannot enumerate arbitrary unknown subdomains or reveal registrar expiry/auto-renew for manual-only domains. TTL countdowns are intentionally not compared as configuration drift.
- Verification uses one public recursive DoH resolver and may lag; retries stop after approximately 24 hours. A successful registrar response alone is not DNS verification. No DNSSEC changes, zone copying, reverse-DNS or unsupported record types are automated.
- Update/delete by relative name requires an unambiguous matching record; the API also accepts an explicit record ID. Bulk DNS changes are independently previewed/applied per domain, not a cross-provider atomic transaction.
- The Cloudflare adapter is a merge stub as requested. Existing Cloudflare nameserver suffixes block registrar DNS edits; custom branded delegation may require the owner to use the correct authoritative provider directly.
- A stopped worker delays monitoring, discovery, propagation checks and physical mail deletion. The API hides expired mail immediately. Gmail disconnect is local; Google account permission removal finishes remote revocation. Business-name matching is conservative but heuristic; ambiguous/unmapped alerts need review.
- Forwarded sender names/addresses can be forged; the private ingress secret authenticates the worker, not the original author. The UI labels this distinction and does not automatically approve transfers, ownership requests or billing actions.

## Validation evidence

Final checks (Node 20.19.6, exported lane `.env`, `CRM_TEST_DATABASE_URL=$DATABASE_URL`, `CRM_TEST_BASE_URL=http://127.0.0.1:8189`, `CRM_TEST_SINGLE_PORT=true`, `EMAIL_FORCE_SINK=1`):

- `npm run check`: **0 errors**.
- `npx vitest run server/domains server/mail-alerts`: **25/25 passed** across five files. Coverage includes both adapter contracts/forbidden endpoints, validation, stale preview and owner rejection, step-up and MX warnings, uncertain-write non-replay, inverse snapshots, public DNS verification, monitoring, MIME/HTML parsing, recipient isolation, forwarding confirmation, retention, Gmail state/scopes/encryption and selective body fetches.
- Scale fixtures: **1,000 domains and 1,000 GBP/client locations** in domain integration tests; **1,000 additional client locations and 1,000 alert rows** in mail integration tests. Pagination, search, filters and tenant isolation are asserted against real lane Postgres. Fixtures are removed.
- `E2E_PORT=8189 E2E_DB=constructhub_dev_a7 npx playwright test -c playwright.domains-mail.config.ts`: **3/3 passed**. Two flows use the real lane server (manual inventory/mapping/monitoring; ingress secret rejection, forwarding confirmation and transfer alert). The third is an explicitly mocked browser contract for DNS preview → confirmation → shared re-auth dialog → verification-pending UI.
- The full `npx vitest run`: **968 passed, 43 skipped, 1 failed** (94 files passed, two skipped, one failed). The unchanged baseline failure is `server/gbp/audit-a2.test.ts:54`: it expects two `gbp.new_review` notifications for initial 2020 review imports. Current `notifyNewReviews` explicitly suppresses initial/history imports; its dedicated tests also expect zero. This failure was reproduced twice and is unrelated to the new modules.
- Browser UI was visually inspected. The Email Worker template passes `node --check`; `git diff --check` is clean. The malformed-credential fixture does not appear in the lane server log.

**Commit status:** no commit was made because the user requires the full suite to pass before every commit. Correcting the one-line GBP test assertion falls outside the explicit a7 module boundary; an asynchronous scope question was sent and remained unanswered at handoff. GBP source/tests are unchanged. A concrete, unapplied [one-line correction patch](a7-gbp-audit-assertion.patch) is included for review. Feature code, tests and reports are staged, including this report via `git add -f`. Do not describe the full suite as passing until that baseline assertion is resolved and the full command is rerun.

No deployment or push was performed. Owner setup, a5 wiring and public OAuth verification are intentionally not performed in this local lane.
