1. Platform & mechanism

OpenGov Permitting & Licensing / ViewPoint Cloud. This is a blocked, partially implemented adapter, not verified working permit coverage. No permit records were retrieved. Runtime uses politeFetch only; no browser, login, token minting, CAPTCHA solving, or alternate protected endpoint fallback.

Accepted URLs are https://<tenant>.portal.opengov.com/... and https://<tenant>.viewpointcloud.com/..., including category and search paths. The tenant comes exclusively from ctx.searchUrl. The adapter reads the public storefront's store3/config/environment meta tag and its defaultApiUrl, observed as https://api-east.viewpointcloud.com/v2. Credentials, ports, unrelated hosts, and API-service hosts are rejected. Legacy portal redirects are followed only over HTTPS to the same tenant and a portal root. Watertown's observed HTTP 301 redirects to https://watertownma.portal.opengov.com.

The tested shell is Ember with React integration, rather than a standalone React app. Browser network discovery captured GET /v2/<tenant>/general_settings/1. The published storefront bundle identifies these public flows:

- GET /v2/<tenant>/search_results?criteria=location&key=<address>&ignoreCommunity=true&fetchNumber=<limit>
- GET /v2/<tenant>/search_results?criteria=record&key=<number>&ignoreCommunity=true&fetchNumber=<limit>
- GET /v2/<tenant>/records?locationID=<search entityID>
- GET /v2/<tenant>/records/<search entityID>
- The catalog uses record-type resources (/record_types) and category relationships. Catalog reads were not exercised after access denial.

The shared search-bar code supports cumulative fetchNumber, and the JSON:API serializer exposes pagination through links.next. The adapter implements these shapes with finite bounds and rejects unexpected pagination destinations. Successful search pagination and record hydration remain unverified. No public date-filter contract was established. Newburyport's browser search stayed at “Searching...” without sending a successful record/location lookup; the API requests above were confirmed separately over plain HTTP and denied.

Auth-free: shell and general settings yes; successful record/search access not established. Three search-enabled tenants returned HTTP 403 with {"errors":["forbidden"]}. Public client code explicitly places search_results and record reads behind Cloudflare Turnstile. Two other tenants disable public record and location searches in general_settings. Those settings are honored before any search request.

Politeness: max(1000, ctx.politeness.minDelayMs), shared per-host limiter, ConstructHUB User-Agent/contact, one helper retry after a 5-second backoff on the observed 403s, sequential API calls. Never converts a blocked portal to an empty search result.

2. Capabilities

Declared search types: address and permit. These are implemented from published storefront request/model definitions, but neither has a successful live record-response fixture. Treat them as provisional and blocked on the tested tenants. Public-search permission flags are checked separately for each type. The permit query is the portal's text search, not a guaranteed exact-number lookup.

listRecent: false. Calls return [] with an explicit unsupported log and perform no portal listing. This is the contract's unsupported sentinel, not a verified absence of recent permits. No date field is currently listed. The published record model distinguishes dateCreated (draft creation) from dateSubmitted (application submission); the parser maps only dateSubmitted to appliedAt. No issued-date or server date-filter semantics were verified, so alerts stay disabled.

Name/company/license/keyword: unsupported and throw before network I/O. Detail: false; no advertised detail method. Contractor identity, license, issue date, valuation, coordinates, parcel, and owner are null because no verified mapping is available. The candidate record parser uses the published camelCase record attributes, preserves the untouched JSON:API resource as raw, and constructs sourceUrl as the tenant public /records/<id> page. It rejects resources without a reported recordNo rather than inventing permit numbers. No positive permit parser fixture was fabricated.

3. Live tests

Date: 2026-10-10 UTC. The main run exercised five targets sequentially. The final date check used an exact seven-day cutoff, 2026-10-03T17:51:43.614Z. Numbered raw response files and requests.json preserve 22 API responses: 10 HTTP 200 settings responses and 12 HTTP 403 search responses (including helper retries). live-results.json preserves all 29 adapter invocations, including initial Watertown redirect failures and superseded recent calls. Tables below show the final invocation for each query on each tenant.

Query strings “100 Main St”, “2026”, and “Construction” are test input only; they are not assertions that such addresses, permits, or contractors exist. No sample records are available for any tenant. In particular, permitNumber, address, status, issuedAt, and contractorName cannot be populated with real sample values.

Portage County, OH

URL: https://portagecountyoh.portal.opengov.com/

| Query type | Value | Count / outcome | UTC start | Elapsed ms |
| --- | --- | --- | --- | ---: |
| address | 100 Main St | Count unknown; public search disabled (settings HTTP 200, typed status 403) | 2026-10-10T17:48:34.525Z | 347 |
| permit | 2026 | Count unknown; public search disabled (settings HTTP 200, typed status 403) | 2026-10-10T17:48:34.872Z | 968 |
| company | Construction | Not executed: unsupported; count unknown | 2026-10-10T17:48:35.840Z | 0 |
| recent | 2026-10-03T17:51:43.614Z | 0; unsupported sentinel, no network | 2026-10-10T17:51:43.614Z | 0 |

Sample record 1: unavailable. Sample record 2: unavailable. Zero records retrieved; this is not a successful zero-result search.

Cheltenham, PA

URL: https://cheltenhamtownship.portal.opengov.com/

| Query type | Value | Count / outcome | UTC start | Elapsed ms |
| --- | --- | --- | --- | ---: |
| address | 100 Main St | Count unknown; public search disabled (settings HTTP 200, typed status 403) | 2026-10-10T17:48:35.841Z | 986 |
| permit | 2026 | Count unknown; public search disabled (settings HTTP 200, typed status 403) | 2026-10-10T17:48:36.827Z | 1011 |
| company | Construction | Not executed: unsupported; count unknown | 2026-10-10T17:48:37.839Z | 0 |
| recent | 2026-10-03T17:51:43.614Z | 0; unsupported sentinel, no network | 2026-10-10T17:51:43.614Z | 0 |

Sample record 1: unavailable. Sample record 2: unavailable. Zero records retrieved; this is not a successful zero-result search.

Vestavia Hills, AL

URL: https://vestaviahillsal.portal.opengov.com/

| Query type | Value | Count / outcome | UTC start | Elapsed ms |
| --- | --- | --- | --- | ---: |
| address | 100 Main St | Count unknown; API HTTP 403 | 2026-10-10T17:48:37.839Z | 7312 |
| permit | 2026 | Count unknown; API HTTP 403 | 2026-10-10T17:48:45.151Z | 7216 |
| company | Construction | Not executed: unsupported; count unknown | 2026-10-10T17:48:52.367Z | 0 |
| recent | 2026-10-03T17:51:43.614Z | 0; unsupported sentinel, no network | 2026-10-10T17:51:43.614Z | 0 |

Sample record 1: unavailable. Sample record 2: unavailable. Zero records retrieved; this is not a successful zero-result search.

Newburyport, MA

URL: https://newburyportma.portal.opengov.com/search

| Query type | Value | Count / outcome | UTC start | Elapsed ms |
| --- | --- | --- | --- | ---: |
| address | 100 Main St | Count unknown; API HTTP 403 | 2026-10-10T17:48:52.368Z | 7194 |
| permit | 2026 | Count unknown; API HTTP 403 | 2026-10-10T17:48:59.562Z | 7199 |
| company | Construction | Not executed: unsupported; count unknown | 2026-10-10T17:49:06.761Z | 0 |
| recent | 2026-10-03T17:51:43.614Z | 0; unsupported sentinel, no network | 2026-10-10T17:51:43.614Z | 0 |

Sample record 1: unavailable. Sample record 2: unavailable. Zero records retrieved; this is not a successful zero-result search.

Watertown Town, MA

URL: https://watertownma.viewpointcloud.com/categories/1071

| Query type | Value | Count / outcome | UTC start | Elapsed ms |
| --- | --- | --- | --- | ---: |
| address | 100 Main St | Count unknown; API HTTP 403 | 2026-10-10T17:49:46.467Z | 7686 |
| permit | 2026 | Count unknown; API HTTP 403 | 2026-10-10T17:49:54.154Z | 7263 |
| company | Construction | Not executed: unsupported; count unknown | 2026-10-10T17:50:01.417Z | 0 |
| recent | 2026-10-03T17:51:43.614Z | 0; unsupported sentinel, no network | 2026-10-10T17:51:43.614Z | 0 |

Sample record 1: unavailable. Sample record 2: unavailable. Zero records retrieved; this is not a successful zero-result search.

4. Blocked / failed tenants

- Portage County, OH: general_settings HTTP 200 explicitly reports allowPublicRecordSearch=false and allowPublicLocationSearch=false. Adapter raises PortalBlockedError with status 403 to identify disabled public access; this status is local classification, not the settings HTTP status. Discovery also made one direct record-search request before the permission flags were inspected; it returned actual HTTP 403. No attempt was made to circumvent the disabled settings.
- Cheltenham, PA: same disabled public-search settings, HTTP 200. Adapter stops without a search endpoint request. Browser search page has no search inputs.
- Vestavia Hills, AL: settings permit both searches; address and permit endpoints return HTTP 403, body {"errors":["forbidden"]}, including the single backed-off retry. No records or catalog endpoint was attempted afterward.
- Newburyport, MA: same actual HTTP 403 for both API searches. Browser address search remained “Searching...” with no usable result while the challenge credential was unavailable. No challenge was solved or token replayed.
- Watertown Town, MA: initial shell HTTP 301 was rejected by the first implementation. After adding narrowly validated same-tenant redirects, settings loaded and both API searches returned HTTP 403. This redirect regression is covered offline.

These results establish a current access barrier, not that every one of the 395 matching tenants is blocked. No login wall was traversed; no alternate API was probed to get around Turnstile.

5. Coverage

395 / 399 targets have a handled URL shape: 361 portal.opengov.com and 34 viewpointcloud.com entries. This is URL/registry coverage only. Successfully scraped live tenants: 0. Matching targets use 51 distinct original labels (48 case-insensitive labels). The adapter registers OpenGov as its platform and all remaining handled labels as aliases, plus ViewPoint Cloud for compatibility. All registered labels resolve in offline registry tests.

Registered platform/alias labels:

- OpenGov Permitting & Licensing
- OpenGov
- OpenGov Permits (major building permit)
- ViewPoint Cloud e-permitting (OpenGov)
- OpenGov permitting portal
- OpenGov permit portal
- OpenGov permit center
- OpenGov ViewPoint Cloud permits
- OpenGov permit portal (ViewPoint Cloud)
- OpenGov Permits portal
- OpenGov Permitting & Licensing portal
- OpenGov ViewPoint Cloud
- OpenGov ViewPoint
- OpenGov Permitting
- OpenGov (ViewpointCloud) permits portal
- PermitSF (OpenGov)
- OpenGov Online Permits
- OpenGov (ViewPoint Cloud) Permit Portal
- OpenGov (ViewPoint Cloud)
- OpenGov permit portal (Residential & Commercial Building Permits)
- OpenGov Online Permitting
- OpenGov Online Permit Center
- OpenGov (Benicia Permit Center)
- OpenGov Permit System
- OpenGov (ViewPoint Cloud) permit portal
- OpenGov (Building / Zoning Permit Portal)
- OpenGov Permitting (independent city)
- OpenGov (ViewPoint Cloud) Online Permitting
- OpenGov (Building Permit)
- OpenGov Permits
- ViewPoint
- OpenGov Permitting & Licensing (EZ Permit Hub)
- OpenGov License & Permit Portal
- OpenGov (Building Permit Application)
- OpenGov Online Permit Applications
- ViewPoint Cloud / OpenGov (Building Permit Application)
- OpenGov Online Permitting Portal
- ViewPoint Cloud (OpenGov)
- OpenGov Permitting and Licenses Portal
- OpenGov Online Permit System
- OpenGov Permit Applications
- OpenGov Permitting & Licensing Portal
- OpenGov (Building Permit Applications)
- OpenGov ViewPoint Cloud (Building Department)
- OpenGov/ViewPoint
- OpenGov (Building Permits)
- ViewPoint Cloud / OpenGov
- OpenGov (PermitSF)
- OpenGov Permitting (Building)
- OpenGov Permits & Licensing
- OpenGov (Building permits)
- ViewPoint Cloud

Excluded targets (4):

- Ankeny, IA — https://ankenyonestop.ankenyiowa.gov/ — custom domain, observed ASP.NET WebForms/OneStop shell rather than the supported ViewPoint storefront. No tenant mapping guessed. The exclusive label OpenGov (Ankeny One Stop) is not registered.
- Brattleboro, VT — https://brattleboro.pay.opengov.com/stw_php/stwub/ubtipact.php — payment-service URL, outside the permitted portal domain shapes.
- Mebane, NC — https://stories.opengov.com/mebanenc/561c0b69-2e81-441f-89a4-09514c3d8b14/published/PBjYBRega — Stories publishing URL, not a supported permit API portal.
- Yountville, CA — https://stories.opengov.com/townofyountvilleca/fd5919a1-9501-44b4-9b3f-1e8465abdfbe/published/pWe63XJRc — Stories publishing URL, not a supported permit API portal.

The last three share the general OpenGov label; getAdapter resolves that label, but the adapter rejects their URLs. Labels alone do not make those sites scrapable.

6. Known gaps and follow-up

This does not meet the owner's goal of successful live permit coverage or hourly alerts. A permitted public API/data feed or vendor-approved access is needed before positive record fixtures, search completeness, contractor matching, or date filtering can be verified. No claims are made that the platform lacks those underlying capabilities. Do not enable alerts based on draft creation dates, unproven filter parameters, or brute-force text searches.

After authorized data access is available: record real successful address and permit responses from at least three tenants; verify cumulative search limits and links.next against actual totals; confirm recordNo/prefix behavior and catalog record types; verify contractor/applicant search indexing and any supported dedicated filters; verify issue/application date filters, ordering, inclusive boundaries and all pages; then add detail and positive record normalization fixtures. Current record parsing and hydration derive from client source and remain unverified on a successful government response. Category-scoped URLs currently search the tenant, not just that category.

Validation:

- npx vitest run server/scrapers/opengov.test.ts: runner startup failed with EROFS because the shared read-only node_modules mount prevents Vite writing .vite-temp. No repository/dependency modification was made to work around this.
- npx vitest run --configLoader runner server/scrapers/opengov.test.ts: 34 tests passed, 1 file passed. Tests are offline and cover real settings/forbidden fixtures, request encoding, tenant/redirect boundaries, typed failures, politeness, unsupported capabilities and registry aliases. They do not claim positive permit extraction coverage.
- npx tsc --noEmit -p .: passed, exit 0.

Fixture provenance: fixtures/opengov/provenance.json records source URLs, original shell/bundle hashes, and redactions. Numbered JSON response bodies are untouched. The shell fixture redacts embedded client credentials/keys; no government values were altered. targets.json remains untracked and is not committed. No app server, database, subagents, or pushes were used.
