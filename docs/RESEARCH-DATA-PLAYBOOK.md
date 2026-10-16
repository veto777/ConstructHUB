# Research data playbook

How the research reports find and acquire their data, source by source, so anyone can repeat it for a new user,
refresh it, or add a state. The per-state tables at the end are generated from the code
(`npx tsx script/research-acceptance.ts --playbook`); the rest is written by hand. Last full pass: 2026-10-15.

The rule above all (CLAUDE.md): **never fabricate government data.** Every URL, dataset id, field name and status
code comes from the publisher, checked live. An unknown value is `null`. A code with no published meaning shows as
"code X". No URL is ever guessed.

## 1. How a report gets its data

A paid order (`POST /orders/:id/run`) runs `withRun(() => runResearch(order))` in `server/research/runner.ts`. For each
name and each chosen state:

1. **License records**: every license source of the state (`registry.ts`: the original WA/TX/FL/CA tables, the state's
   pack in `server/research/states/<st>.ts`, and the city/county sources in `states/local.ts`).
2. **Permit portals**: the Search feature's live portal adapters for every active portal in the state.
3. **Companies only** (FCRA): AG consumer complaints, state enforcement and standing records (live searches and
   indexed enforcement files), SAM.gov federal exclusions, federal OSHA inspections (with `DOL_API_KEY`), and federal
   dockets (CourtListener, switched off, see section 5).
4. **Cross-reference** (`xref.ts`): the customer's license numbers, phones and addresses, then one hop out from the
   subject's own records to related licenses and businesses, each marked with its tie.

Every source appears in the report as *searched* (with a count) or *not searched* (with the reason). A source that
could not be searched never reads as "0 found".

## 2. The four ways data is acquired

| Method | Where in code | How it works | When to use it |
|---|---|---|---|
| **Bulk file** | `BulkSource` in `bulk-sources.ts`, a pack's `bulk`, `local.ts`, `sam.ts` | The official download (CSV, ZIP, PDF list, XLSX) is fetched on a schedule (`everyHours`, 24 or 24×7), parsed into hits and indexed in `research_bulk_rows` by name words and identifier keys (`l:` license, `t:` phone, `a:` address). Reports search the index, not the publisher. | The publisher offers a full download, or the live search is slow, capped, CAPTCHA'd or bans automation while the download is allowed. |
| **Socrata (SODA) API** | `LicenseSource` (licenses.ts), `SodaEnforcement` (state-records.ts), `ComplaintSource` (records.ts) | `GET https://<portal>/resource/<id>.json?$where=…`, live per report. Field names come from `/api/views/<id>.json`. An app token (`SOCRATA_APP_TOKEN`) is sent if set. | A state open-data portal publishes the register. |
| **Agency lookup, live** | `LiveLicenseSearch` / `LiveEnforcementSearch` in a pack | The agency's own search page or JSON API, one polite request per report (about 1/s per host). | No download exists, the lookup is public, and robots.txt and the terms allow it. |
| **Headless browser** | `guardBrowser` (http.ts), e.g. VT Fire Safety | A real page that only answers to a browser, driven by playwright-core (`CHROMIUM_PATH`). Never used to get past a CAPTCHA, login, 403 or challenge. | Only when the page is public and robots-allowed but builds its results with scripts. |

All network access goes through `server/research/http.ts` (`politeFetch`, `guard`). It checks robots.txt (fail-closed: an
unreadable robots.txt means no), queues about one request per second per host, honors Retry-After, and blocks a host
for the rest of the run after a 401/403 or a challenge page. Nothing in the research code works around any of these.

## 3. Bulk file rules (what keeps a bad download out)

- **Row floor** (`minRows`): about 70% of the count on the day the source was added. A load below it is an error and
  the previous load stays.
- **The 70% rule** (`MIN_SHARE_OF_PREVIOUS`, `shortfall` in bulk.ts): a new load must have more than 70% of the last
  good load's rows, overall and per component (e.g. each of CSLB's three files). Otherwise it isn't swapped in. The
  baseline never walks down through a run of small cuts.
- **`rowShape`**: raise it when a source's rows change on purpose (CSLB went from one row per person to one per
  license). The first load under the new shape is not measured against the old baseline.
- **`KEY_VERSION`** (3): the format of identifier keys. A load made under an older version is still searched by name
  and license number, but its phone and address keys are not searched until it reloads (they might be an
  individual's). `refreshDueSources` reloads stale sources first.
- **`utcHours`**: a publisher that asks for off-hours downloads (CSLB: 09–13 UTC) is fetched only then.
- **Size**: under about 1.5M rows and about 1 GB a day per state. A file too big for the disk is streamed (Sunbiz is read
  by SFTP byte range through `funzip`, never written to disk).
- **Production** (vb11): the server's worker refreshes due sources hourly in production (`RESEARCH_BULK`).
  `--prod-health` checks every source's load, key version, error, floor and age, read-only.

## 4. Privacy (holder rules, FCRA)

From `server/research/privacy.ts` (audit rounds 2–5), applied centrally whatever a source publishes:

- **Holder from the publisher only.** `holder` is "business" only when the publisher's entity type or license class is
  on the source's documented business list. A name that reads like a company never makes a holder a business.
  Unknown is treated as an individual.
- **Contact details follow the holder.** Only a business holder keeps its street address and phone (shown and indexed).
  An individual's or unknown holder's record keeps city, state and ZIP only, and no `a:`/`t:` key is indexed.
- **No disciplinary text on a license.** A business's license discipline becomes an enforcement record (companies
  only). An individual's is dropped.
- **Standing words only** for an individual's license status and for every status in a person's report (active,
  expired, revoked, suspended…). Probation, citations and the like are moved off.
- **Companies only** for enforcement, complaints, court records and OSHA. Bulk enforcement sources set
  `companiesOnly: true` with `person: null`. A person report says these are "searched for companies only".

The acceptance run checks all of this on the final report (section 7).

## 5. Accounts, keys and terms (B2 findings, 2026-10-15)

Keys live on vb11 in `~/ConstructHUB-live/.env` (written with `/tmp/store-env.py`, which backs the file up) or
`~/.constructhub-research-keys/<ENV_NAME>`. The code reads `process.env.<NAME>`. Never print a key. Forms may carry only
real facts: support@constructhub.us, "ConstructHUB", https://constructhub.us, +1 832-399-0560. Never an invented
address, EIN, name or title.

| Env name | Source | Status | What it unlocks / terms |
|---|---|---|---|
| `DOL_API_KEY` | U.S. Department of Labor API (OSHA inspections) | **Held** in production (Login.gov account for support@, 2026-10-14) | Federal OSHA inspections for every company report. |
| `SAM_API_KEY` (not used by code yet) | SAM.gov Exclusions API | **Needs one human sign-in**: Login.gov answered "Security check failed" (reCAPTCHA) to a headless browser | Personal key: "Non-federal user with no role — 10 requests/day"; `format=CSV` returns the whole list. Terms: "Do not use your SAM.gov login for data mining, bots…"; "If you want to share data publicly, only share data from public versions of APIs." **Not needed today**: the code already loads the public extract (`us-sam-exclusions`), which SAM describes as "No additional access is required to download these files." |
| `COURTLISTENER_TOKEN` | CourtListener REST API | **Switched off** (`COURTLISTENER_ALLOWED = false`) | courtlistener.com's robots.txt disallows automated access. Free Law Project's director wrote that API access for us "will need … a commercial agreement"; our partnerships contact asked to be connected (2026-10-15). Terms: "If you need access for a product or a team, talk to us about a commercial agreement." Free-user limits in their code: 5/min, 50/hour, 125/day. |
| `SOCRATA_APP_TOKEN` | Every Socrata portal (data.*.gov) | **Needs a human**: reCAPTCHA checkbox on the Tyler sign-up form | Per-app throttling instead of per-IP; the code already sends it when set (http.ts `socrataAppToken`). Socrata docs: "Currently we do not throttle API requests that are using an application token, unless those requests are determined to be abusive or malicious." Tyler's site terms bar bots and commercial reuse "of the Services". The owner should weigh that against the API docs. |
| `TX_COMPTROLLER_API_KEY` (not used yet) | Texas Comptroller public API (franchise tax) | **Needs the owner**: SIFT registration requires a person's first/last name and a street address | `GET /public-data/v1/public/franchise-tax-list?name=` and `/franchise-tax/{id}`: registered agent, registered office, mailing address, SOS file number and **officers**. That is free TX officer data (TX SOS officer data is paid). |
| `CHROMIUM_PATH` | headless browser (VT Fire Safety lookup) | Set on the server | A public page that needs a browser. |

Login-gated sources checked in B2: **DC DLCP OPLA** (Access DC/Okta): sign-up needs a first and last name, plus a
reCAPTCHA. **VT bizfilings**: the account is for filing; the public search raises a reCAPTCHA on each search.
**AL HACR**: the public lookup exists (`hacr.igovsolution.net/online/Lookups/Individual_Lookup.aspx`) but needs a
verification code (CAPTCHA) per search; the profile login is for licensees only (asks for an SSN).
Paid: OpenCorporates from £2,250/yr (free only for journalists, NGOs and universities, by request), and the paid SOS and
licensing lists in the `blocked` notes below (IN INBiz $9,500, NC SOS, ND SOS, UT DOPL, WI DSPS, WV SOS).

**Terms clauses that decided a source** (beyond the per-state `blocked` notes):
- SAM.gov: "SAM.gov makes certain data available via APIs and extracts with URLs 'https://open.gsa.gov/api/' and
  'https://sam.gov/data-services.' Automated data gathering, web scraping tools are prohibited…". So we use the
  extract, never the site.
- CSLB (California): downloads only 09–13 UTC (`utcHours`), as the data portal asks.
- Sunbiz (Florida): `search.sunbiz.org` sits behind a Cloudflare challenge, so it is never linked or searched. The
  quarterly SFTP file is the source.
- CourtListener: see above. The robots.txt disallow is why it is off, whatever the token status.

## 6. How to add a new state source

A source goes in the state's pack (`server/research/states/<st>.ts`), or `local.ts` for a city or county. It must pass,
in order:

1. **Find it at the publisher.** Search the agency's site and the state's open-data catalog. Prefer, in order: a bulk
   download, a Socrata dataset, a JSON API, a lookup page. Record the exact URL, dataset id and field names from the
   publisher (`/api/views/<id>.json` for Socrata), and the date checked (`checked`).
2. **robots.txt** for every URL the code will request (page, API, download, each redirect hop). A Disallow means no.
   Don't look for another path to the same data.
3. **Terms.** Read them. No source whose terms bar automated access or commercial use. Quote the clause in the pack's
   `blocked` note when you leave a source out.
4. **No walls.** A CAPTCHA, login, 403, WAF or bot challenge means the source goes in `blocked` with the reason. Never
   work around one.
5. **Map the publisher's own values.** Status codes and license classes from the publisher's published table. An
   unknown code shows as "code X". `holder` comes only from a documented business/individual list (`entityHolder`).
   Enforcement rows set `companiesOnly: true` and `person: null`.
6. **Size and schedule**: under about 1.5M rows and about 1 GB/day. `everyHours` 24 or 24×7. `minRows` about 70% of
   today's count. `utcHours` if the publisher asks for off-hours. Raise `rowShape` when you change the row layout on
   purpose.
7. **Tests**: a parser test on a real saved sample (`<st>.test.ts`), including the privacy cases: an individual's
   record shows no street or phone, a business's discipline becomes an enforcement record. `npx tsc --noEmit -p .`
   clean, and `npx vitest run server/research shared server/scrapers` green (the coverage test checks the source
   appears in the manifest).
8. **Load it for real** into a scratch database (`script/research-state-check.ts <ST> --bulk --only <id>`) and search
   it back by name, license number, phone and address.
9. **The acceptance subject**: `npx tsx script/research-acceptance.ts --state <ST> --repick`. It picks golden subjects from
   the new data and runs them through a paid order. The state must pass recall, coverage (every source searched or
   not searched with a reason), privacy, the "not searched never reads as 0" rule, URLs and timing.
10. Regenerate the tables below (`--playbook`) and commit them with the source.

## 7. The acceptance run (repeatable proof)

```
. ~/research-briefs/allstates.env        # a scratch database, never production
npx tsx script/research-acceptance.ts                    # all 50 states + DC
npx tsx script/research-acceptance.ts --state OH,WA      # some states
npx tsx script/research-acceptance.ts --only-failed      # re-run the last run's failures
npx tsx script/research-acceptance.ts --use-loaded       # search loaded files only, download nothing
npx tsx script/research-acceptance.ts --prod-health      # read-only production checks over ssh vb11
npx tsx script/research-acceptance.ts --playbook         # regenerate the tables below
```

Golden subjects are in `script/research-acceptance/subjects.json`: per state, a company with an active license, a
company with an enforcement or discipline record, and an individual license holder. Each is taken from the state's
own data, with the source, record id and date picked, or `null` with the reason. Results are in
`script/research-acceptance/results/` (JSON, and a Markdown state × source matrix). The exit code is 1 on any failure.
Permit portals are left out unless `--portals` (a full sweep takes hours per state).

## 8. Every source, state by state (generated)

<!-- GENERATED: script/research-acceptance.ts --playbook (do not edit by hand between these markers) -->

Generated 2026-10-15 from the registry (207 state sources, 2 nationwide). robots.txt was read live on that date for each source's page and API URL (fails closed: an unreadable robots.txt counts as no). Bulk-file floors: a new load needs more than 70% of the last good load and at least the row floor; key format version 3.

### Nationwide (every report)

| Source | Access | Holds | Searched by | Needs | robots.txt |
|---|---|---|---|---|---|
| Federal OSHA inspections (U.S. Department of Labor) | live API per report | other (companies only) | name | DOL_API_KEY | checked at run time (its URL lives in the search code, not the registry) |
| SAM.gov federal exclusions and debarments (Public V2 extract) ([page](https://sam.gov/data-services)) | bulk file `us-sam-exclusions`, every 24h, floor 6000 | debarment (companies only) | name, license, address | the file loaded | allowed |

### AL

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Alabama Electrical Contractors Board disciplinary actions ([page](https://aecb.alabama.gov/public-records/disciplinary-actions/)) | aecb.alabama.gov | bulk file `al-aecb-discipline` (official download, indexed) | discipline (companies only) | name | every 168h, floor 87 | none | allowed |
| Alabama Licensing Board for General Contractors ([page](https://licensesearch.alabama.gov/genconbd)) | licensesearch.alabama.gov | the agency's own lookup (page or API), live per report | licenses | name, license, phone | live | none | unreadable: robots.txt answered HTTP 500 |
| Alabama Onsite Wastewater Board installers ([page](https://licensesearch.alabama.gov/AOWB)) | licensesearch.alabama.gov | the agency's own lookup (page or API), live per report | licenses | owner | live | none | unreadable: robots.txt answered HTTP 500 |

Looked at and not used (from the pack's `blocked` notes):

- Home Builders Licensure Board license search (alhobv7prod.glsuite.us, GL Suite): robots.txt disallows every path and the page answers 403
- Home Builders Licensure Board disciplinary actions (hblb.alabama.gov/disciplinary-actions/): scanned-image PDFs kept 90 days (rechecked 2026-10-15: September-2026-Disciplinary-Actions.pdf is an image with no text layer); the unlicensed-builder prosecution PDFs name individuals (FCRA: companies only)
- Electrical Contractors Board license search (alecb-search.kalmservices.net): every search needs a Cloudflare Turnstile token
- Electrical Contractors Board disciplinary actions for FY2025 to today and the signed settlement agreements (aecb.alabama.gov): scanned-image PDFs with no text layer (FY2021-FY2024 and the 2010-2020 lists are read above)
- Plumbers and Gas Fitters Examining Board lookup (alpgfb.igovsolution.net): a verification-code (CAPTCHA) field on every search
- Board of Heating, Air Conditioning and Refrigeration Contractors (hacr.alabama.gov): no public license lookup, only the iGovSolution licensee login

### AK

Checked live: 2026-10-15.

No source is searched for this state yet.

Looked at and not used (from the pack's `blocked` notes):

- CBPL professional-license search, business-license search and download files (www.commerce.alaska.gov/cbp and commerce.alaska.gov), which hold construction contractor registrations, electrical/mechanical administrator licenses and business licenses: HTTP 403 with a DataDome CAPTCHA page (geo.captcha-delivery.com) on robots.txt and on every page (rechecked 2026-10-15)
- DCCED map server business-license layer (maps.commerce.alaska.gov/server/rest/services/Economics_Related/Business_Licenses/MapServer/2), used until 2026-10-15: robots.txt now answers HTTP 403 with the DataDome CAPTCHA page, so the research code refuses the host; the same data's ArcGIS Online item (owner DCRAOpenData) points at that host
- DOLWD Mechanical Inspection certificates of fitness (electricians, plumbers; labor.alaska.gov/lss/mihome.htm, plumbing_electrical.htm, mi-faq.html): no public lookup or list published (rechecked 2026-10-15)
- DOLWD Wage and Hour public-construction debarment list (labor.alaska.gov/lss/debarments.htm, 'last updated: November 6, 2025'): live and readable, but its table lists no company today, so nothing to search or verify
- DOT&PF 'Suspended Contractors' link (dot.alaska.gov/procurement/warrant_manual/): points to the federal EPLS (now SAM.gov), not a state list
- ArcGIS Online 'The Alaska General Contractors 2023 Layer' (AKDOT, services.arcgis.com/r4A0V7UzH9fcLVvv): one polyline layer 'AGC_FIGURES Events', no description and no license fields; not a license register

### AZ

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Tucson business licenses (construction) (city/county) ([page](https://www.arcgis.com/home/item.html?id=b0e8f873aaeb4375b481979be334fbf2)) | www.arcgis.com | bulk file `az-tucson-contractors` (official download, indexed) | licenses | name | every 168h, floor 4900 | none | allowed |
| Arizona Registrar of Contractors licenses ([page](https://azroc.my.site.com/AZRoc/s/contractor-search)) | azroc.my.site.com | the agency's own lookup (page or API), live per report | licenses | name, owner, license | live | none | allowed |
| Arizona Registrar of Contractors complaints | - | live search per report | complaints (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

Looked at and not used (from the pack's `blocked` notes):

- roc.az.gov / azroc.gov posting lists (active contractor lists, new licenses, discipline CSVs): every path, robots.txt included, answers a Cloudflare JS challenge (HTTP 403)
- Arizona Corporation Commission eCorp (ecorp.azcc.gov): robots.txt disallows every path

### AR

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Arkansas Board of Electrical Examiners roster ([page](https://labor.arkansas.gov/licensing/board-of-electrical-examiners/state-board-of-electrical-examiners-roster/)) | labor.arkansas.gov | bulk file `ar-electrical-roster` (official download, indexed) | licenses | name | every 168h, floor 67000 | none | allowed |
| Arkansas HVAC/R Licensing Board roster ([page](https://labor.arkansas.gov/licensing/hvac-licensing-board/hvac-roster/)) | labor.arkansas.gov | bulk file `ar-hvacr-roster` (official download, indexed) | licenses | name | every 168h, floor 23000 | none | allowed |
| Arkansas Fire Protection Licensing Board: licensed sprinkler companies ([page](https://labor.arkansas.gov/licensing/fire-protection-licensing-board/roster-search/)) | labor.arkansas.gov | bulk file `ar-fire-sprinkler` (official download, indexed) | licenses | name | every 168h, floor 75 | none | allowed |
| Arkansas Fire Protection Licensing Board: portable and fixed fire-extinguishing systems companies ([page](https://labor.arkansas.gov/licensing/fire-protection-licensing-board/roster-search/)) | labor.arkansas.gov | bulk file `ar-fire-portable` (official download, indexed) | licenses | name | every 168h, floor 65 | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- Contractors Licensing Board search (aclb2.arkansas.gov/clbsearch.php, linked from the board's 'Find a Licensed Contractor' page): the server never answered on 2026-10-15 (connection timed out from tower1 and vb11); retried 2026-10-15 06:46 and 06:47 UTC from tower1 and vb11, robots.txt and the search page both timed out after 30 s. The board publishes no downloadable roster
- Contractors Licensing Board hearings / findings of fact (labor.arkansas.gov hearings-finding-of-fact): scanned-image PDFs with no text layer
- Electrical and HVAC/R rosters: business rows carry no business name, so only people are searchable there

### CA

Checked live: never (no pack).

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| California CSLB contractor licenses ([page](https://www.cslb.ca.gov/onlineservices/dataportal/ContractorList)) | www.cslb.ca.gov | bulk file `ca-cslb` (official download, indexed, downloads only at UTC 9–11) | licenses | name | every 20h, floor 185000, row_shape 1 | none | allowed |
| California CSLB revoked licenses (monthly lists) ([page](https://www.cslb.ca.gov/About_us/Library/Revoked/Default.aspx)) | www.cslb.ca.gov | bulk file `ca-cslb-revoked` (official download, indexed, downloads only at UTC 9–13) | discipline (companies only) | name | every 168h, floor 2250 | none | allowed |
| California DCA licensees (engineers, architects, pest control) ([page](https://www.dca.ca.gov/consumers/public_info/index.html)) | www.dca.ca.gov | bulk file `ca-dca` (official download, indexed) | licenses | name | every 168h, floor 100000 | none | allowed |
| California DIR electrician certification ([page](https://data.ca.gov/dataset/dir-electrician-certification-unit-ecu)) | data.ca.gov | bulk file `ca-electricians` (official download, indexed) | licenses | name | every 168h, floor 40000 | none | allowed |
| California Labor Commissioner public-works debarments ([page](https://www.dir.ca.gov/dlse/debar.html)) | www.dir.ca.gov | bulk file `ca-debarments` (official download, indexed) | debarment (companies only) | name | every 24h, floor 20 | none | allowed |
| Long Beach business licenses (contracting) (city/county) ([page](https://www.arcgis.com/home/item.html?id=54d45ca9c4554062a02df49ec1ea2b2a)) | www.arcgis.com | bulk file `ca-long-beach-contractors` (official download, indexed) | licenses | name | every 24h, floor 25000 | none | allowed |
| Los Angeles business tax registrations (construction) (city/county) ([page](https://data.lacity.org/d/6rrh-rzua)) | data.lacity.org | bulk file `ca-la-construction-businesses` (official download, indexed) | licenses | name | every 168h, floor 38000 | SOCRATA_APP_TOKEN (optional) | allowed |
| San Francisco registered businesses (construction) (city/county) ([page](https://data.sfgov.org/d/g8m3-pdis)) | data.sfgov.org | bulk file `ca-sf-construction-businesses` (official download, indexed) | licenses | name | every 24h, floor 8700 | SOCRATA_APP_TOKEN (optional) | allowed |
| Sacramento County business licenses (construction work) (city/county) ([page](https://www.arcgis.com/home/item.html?id=31a6cfbc26b9434093bc59b01b454b87)) | www.arcgis.com | bulk file `ca-sacramento-county-contractors` (official download, indexed) | licenses | name | every 168h, floor 2000 | none | allowed |

### CO

Checked live: 2026-10-15. No statewide GC license: Colorado does not license general contractors or roofers statewide (cities and counties may); the state-licensed trades are searched above

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Boulder licensed contractors (city/county) ([page](https://www.arcgis.com/home/item.html?id=ef02bbe733464632aa0d2628177d6c9e)) | www.arcgis.com | bulk file `co-boulder-contractors` (official download, indexed) | licenses | name | every 24h, floor 2100 | none | allowed |
| Colorado DORA licenses (electrical, plumbing, water well) ([page](https://data.colorado.gov/d/7s5z-vewr)) | data.colorado.gov | Socrata SODA API, live per report | licenses | name, owner, license | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Colorado DORA licenses (architects, engineers, surveyors, landscape architects, radon; trade work permits) ([page](https://data.colorado.gov/d/7s5z-vewr)) | data.colorado.gov | Socrata SODA API, live per report | licenses | name, owner, license | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Colorado DORA discipline of electrical, plumbing and water well contractors ([page](https://data.colorado.gov/d/7s5z-vewr)) | data.colorado.gov | Socrata SODA API, live per report | discipline (companies only) | name | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Colorado Secretary of State business entities ([page](https://data.colorado.gov/d/4ykn-tg5h)) | data.colorado.gov | Socrata SODA API, live per report | business_status (companies only) | name | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |

Looked at and not used (from the pack's `blocked` notes):

- DORA license lookup with discipline (apps2.colorado.gov/dora/licensing/Lookup): the search form requires a CAPTCHA

### CT

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Connecticut Department of Labor debarment list ([page](https://portal.ct.gov/dol/knowledge-base/articles/wage-and-workplace-standards/debarment-lists)) | portal.ct.gov | bulk file `ct-dol-debarment` (official download, indexed) | debarment (companies only) | name | every 168h, floor 6 | none | allowed |
| Connecticut DCP licenses and credentials (home improvement and trades) ([page](https://data.ct.gov/d/ngch-56tr)) | data.ct.gov | Socrata SODA API, live per report | licenses | name, owner, license, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Connecticut business registry (Secretary of the State) ([page](https://data.ct.gov/d/n7gp-d28j)) | data.ct.gov | Socrata SODA API, live per report | business_status (companies only) | name | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Connecticut DEEP enforcement orders (2021 to today) ([page](https://data.ct.gov/d/t2bf-45ba)) | data.ct.gov | Socrata SODA API, live per report | environmental (companies only) | name | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Connecticut DEEP enforcement case summaries (1999 to 2021) ([page](https://data.ct.gov/d/tvbr-6b6t)) | data.ct.gov | Socrata SODA API, live per report | environmental (companies only) | name | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |

Looked at and not used (from the pack's `blocked` notes):

- CT DOL stop-work orders (CGS 31-76a): the DOL describes them but publishes no list
- CT DCP disciplinary actions: published only as individual press releases, no list or dataset
- CT Judicial Branch case look-up: no public API or bulk file

### DE

Checked live: 2026-10-15. No statewide GC license: Delaware does not license general contractors; contractors hold a Division of Revenue contractor business license (searched above), and electricians, plumbers and HVACR contractors are licensed by the Division of Professional Regulation (searched above)

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Delaware Department of Labor Workplace Fraud Act violators ([page](https://industrialaffairs.delaware.gov/construction-enforcement)) | industrialaffairs.delaware.gov | bulk file `de-dol-wpfa-violators` (official download, indexed) | wage (companies only) | name | every 168h, floor 20 | none | allowed |
| Delaware Department of Labor prevailing wage debarment list ([page](https://industrialaffairs.delaware.gov/construction-enforcement)) | industrialaffairs.delaware.gov | bulk file `de-dol-pw-debarment` (official download, indexed) | debarment (companies only) | name | every 168h, floor 4 | none | allowed |
| Delaware Division of Professional Regulation (electrical, plumbing/HVACR) ([page](https://data.delaware.gov/d/pjnv-eaih)) | data.delaware.gov | Socrata SODA API, live per report | licenses | owner, license | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Delaware Division of Revenue contractor business licenses ([page](https://data.delaware.gov/d/5zy2-grhr)) | data.delaware.gov | Socrata SODA API, live per report | licenses | name, license, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Delaware Division of Professional Regulation (architects, surveyors, geologists, home inspectors) ([page](https://data.delaware.gov/d/pjnv-eaih)) | data.delaware.gov | Socrata SODA API, live per report | licenses | owner, license | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Delaware DNREC water well and pump installer contractors ([page](https://data.delaware.gov/d/2dnk-irgr)) | data.delaware.gov | Socrata SODA API, live per report | licenses | name, license, phone, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Delaware DNREC on-site wastewater system licensees ([page](https://data.delaware.gov/d/56uc-mvju)) | data.delaware.gov | Socrata SODA API, live per report | licenses | name, owner, license, phone, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Delaware DNREC certified asbestos firms ([page](https://data.delaware.gov/d/f677-ahd9)) | data.delaware.gov | Socrata SODA API, live per report | licenses | name, license, phone, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |

Looked at and not used (from the pack's `blocked` notes):

- Delaware Division of Corporations entity search (icis.corp.delaware.gov): CAPTCHA on the search
- Delaware DPR disciplinary actions (data.delaware.gov dz6p-akeq): names individual licensees only (no business), so it can't be searched for companies
- Delaware court records: no court dataset on data.delaware.gov

### DC

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| DC DLCP basic business licenses (construction) ([page](https://opendata.dc.gov/datasets/DCGIS::basic-business-licenses)) | opendata.dc.gov | bulk file `dc-bbl` (official download, indexed) | licenses | name | every 24h, floor 25000 | none | allowed |
| DC OCP excluded parties list ([page](https://ocp.dc.gov/page/excluded-parties-list)) | ocp.dc.gov | bulk file `dc-ocp-excluded` (official download, indexed) | debarment (companies only) | name | every 168h, floor 35 | none | allowed |
| DC basic business licenses (contractors and construction) (city/county) ([page](https://www.arcgis.com/home/item.html?id=85bf98d3915f412c8a4de706f2d13513)) | www.arcgis.com | bulk file `dc-dlcp-contractors` (official download, indexed) | licenses | name | every 24h, floor 14000 | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- DC DLCP occupational and professional license search (govservices.dcra.dc.gov/oplaportal; electricians, plumbers, HVAC and other Board of Industrial Trades licenses): requires an Okta login
- DC DLCP corporations registry (corponline.dlcp.dc.gov / boss.dc.gov): reCAPTCHA in the app
- DC Superior Court eAccess (eaccess.dccourts.gov): did not answer from our network (connection timed out, 2026-10-15; retried 2026-10-15 06:51 UTC from tower1 and vb11, still timing out after 30 s, robots.txt included); no bulk data or API
- DC DGS excluded parties list (construction): its page has no list or file in the HTML; the OCP excluded parties list (used) is the District-wide one

### FL

Checked live: never (no pack).

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Florida DBPR construction licenses (CILB) ([page](https://www2.myfloridalicense.com/construction-industry/public-records/)) | www2.myfloridalicense.com | bulk file `fl-cilb` (official download, indexed) | licenses | name | every 24h, floor 200000 | none | allowed |
| Florida DBPR electrical licenses (ECLB) ([page](https://www2.myfloridalicense.com/electrical-contractors/public-records/)) | www2.myfloridalicense.com | bulk file `fl-eclb` (official download, indexed) | licenses | name | every 24h, floor 15000 | none | allowed |
| Florida DBPR license applicants (construction and electrical) ([page](https://www2.myfloridalicense.com/construction-industry/public-records/)) | www2.myfloridalicense.com | bulk file `fl-dbpr-applicants` (official download, indexed) | licenses | name | every 168h, floor 80000 | none | allowed |
| Florida Division of Corporations (Sunbiz) filings of licensed contractors ([page](https://dos.fl.gov/sunbiz/other-services/data-downloads/quarterly-data/)) | dos.fl.gov | bulk file `fl-sunbiz-officers` (official download, indexed) | licenses | name | every 720h, floor 105000 | none | allowed |
| Florida DBPR complaints and discipline (construction and electrical) ([page](https://www2.myfloridalicense.com/unlicensed-activity-public-records/)) | www2.myfloridalicense.com | bulk file `fl-dbpr-complaints` (official download, indexed) | complaints (companies only) | name | every 24h, floor 16500, row_shape 1 | none | allowed |
| Florida stop-work orders (Division of Workers' Compensation) ([page](https://dwcdataportal.fldfs.com/SWOquery.aspx)) | dwcdataportal.fldfs.com | bulk file `fl-stop-work` (official download, indexed) | stop_work (companies only) | name | every 24h, floor 40000 | none | allowed |
| Florida federal tax liens on businesses (Sunbiz) ([page](https://dos.fl.gov/sunbiz/other-services/data-downloads/)) | dos.fl.gov | bulk file `fl-tax-liens` (official download, indexed) | tax_lien (companies only) | name | every 168h, floor 15000 | none | allowed |
| Miami-Dade County contractor licenses (city/county) ([page](https://www.arcgis.com/home/item.html?id=1a2cb89e4c134eae80074395fd90d5b0)) | www.arcgis.com | bulk file `fl-miami-dade-contractors` (official download, indexed) | licenses | name | every 168h, floor 15000 | none | allowed |

### GA

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Georgia EPD licensed asbestos abatement firms ([page](https://epd.georgia.gov/about-us/land-protection-branch/recovered-materials-and-abatement/asbestos/asbestos-contractors-and)) | epd.georgia.gov | bulk file `ga-epd-asbestos-firms` (official download, indexed) | licenses | name | every 168h, floor 120 | none | allowed |
| Georgia Soil and Water Conservation Commission erosion and sedimentation control certifications ([page](https://www.gaswcc.org/esc-search.php)) | www.gaswcc.org | the agency's own lookup (page or API), live per report | licenses | name, owner | live | none | allowed |
| Georgia EPD enforcement orders | - | live search per report | environmental (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

Looked at and not used (from the pack's `blocked` notes):

- Georgia Secretary of State licensing boards (verify.sos.ga.gov/verification/Search.aspx: Residential and General Contractors, Construction Industry Licensing Board electrical, plumbing, conditioned air, low voltage, utility; engineers) and their board orders and roster request pages (sos.ga.gov): HTTP 403 with cf-mitigated: challenge (Cloudflare) on every page, robots.txt included (verify.sos.ga.gov/robots.txt redirects to Search.aspx, which is challenged); rechecked 2026-10-15
- Georgia Secretary of State license rosters (bulk): ordered with a paper Roster Request Form and payment by check or money order (sos.ga.gov/page/licensing-roster-requests, behind the Cloudflare challenge); the store link a 2023 records response gave (georgiasecretaryofstate.net/collections/license-roster) returns HTTP 404 on 2026-10-15; needs the owner
- Georgia DPH certified septic tank installer companies (dph.georgia.gov/media/92731/download, EnvHealthInstallers.pdf dated 10/9/2026): free and robots-allowed, but only a company name and phone in three columns per county, no license number or city; 'Companies and individuals are certified', so the holder is unknown. Not loaded
- Georgia Secretary of State corporations (ecorp.sos.ga.gov): Cloudflare challenge; bulk corporations data is sold ($1,000 one-time or $500/month)
- Georgia Insurance and Safety Fire Commissioner licensed professionals (sprinkler, elevator, boiler; Citizenserve portal): "I am human" check before results
- Georgia DOAS suspended and debarred suppliers (doas.ga.gov, purchasing law page): the current FY27 list (a .docx posted 2026-08) says NONE, as did FY23 and FY24; rechecked 2026-10-15
- GSFIC debarred, suspended or ineligible firms (gsfic.georgia.gov): still one PDF last updated 2020-01-10, with no firms listed; rechecked 2026-10-15

### HI

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Hawaii PVL current licenses (contractors, electricians and plumbers, engineers and architects) ([page](https://cca.hawaii.gov/pvl/hire-a-licensed-contractor/)) | cca.hawaii.gov | bulk file `hi-pvl-licenses` (official download, indexed) | licenses | name | every 168h, floor 14000 | none | allowed |
| Hawaii DCCA disciplinary actions (construction boards) ([page](https://cca.hawaii.gov/oah/disciplinary-actions/)) | cca.hawaii.gov | bulk file `hi-dcca-discipline` (official download, indexed) | discipline (companies only) | name | every 168h, floor 105 | none | allowed |
| Hawaii RICO complaints history | - | live search per report | complaints (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

Looked at and not used (from the pack's `blocked` notes):

- PVL license search (mypvl.dcca.hawaii.gov): robots.txt disallows every path and Cloudflare answers 403
- PVL List Builder (full licensee lists with every status): paid ($5 plus $0.05 a record)
- Business Registration Division (hbe.dcca.hawaii.gov): robots.txt disallows every path
- BusinessCheck (businesscheck.hawaii.gov): Cloudflare error 1016, no response
- Office of Consumer Protection complaints history (same API, division OCP): returned no records for test names today; not used

### ID

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Idaho Secretary of State business entities | - | live search per report | business_status (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

Looked at and not used (from the pack's `blocked` notes):

- DOPL eDOPL license search and Public License List Search (edopl.idaho.gov/OnlineServices/?link=PubSearch): robots.txt is 'User-agent: *' / 'Disallow: /' (rechecked 2026-10-15); this covers contractor registration, electrical, plumbing, HVAC and public works contractor licenses and their discipline
- DOPL website (dopl.idaho.gov; robots.txt 'Disallow:' empty): the Contractors (/con/), Electrical (/ele/), Plumbing (/plb/), HVAC (/hvac/) and Public Works (/pwc/) board pages link only to eDOPL; the site's only discipline pages are for other boards (Accountancy /boa/boa-discipline/, Shorthand Reporters /sre/sre-disciplinary-actions/) (checked 2026-10-15)
- data.idaho.gov: a data-governance site (AI readiness, data literacy, policies), not a dataset catalog; an ArcGIS Online search for Idaho contractor/licensee/electrician/plumber items found no license register (checked 2026-10-15)
- Idaho Attorney General consumer protection (ag.idaho.gov): contractor settlements (assurances of voluntary compliance) are announced as newsroom press releases only, with no list or dataset (checked 2026-10-15)

### IL

Checked live: 2026-10-15. No statewide GC license: Illinois does not license general contractors statewide; roofing contractors are licensed by IDFPR and plumbers by IDPH, and general contractors are licensed, where at all, by their city or county

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Chicago home-repair business licenses (city/county) ([page](https://data.cityofchicago.org/d/r5kz-chrr)) | data.cityofchicago.org | bulk file `il-chicago-home-repair` (official download, indexed) | licenses | name | every 24h, floor 7500 | SOCRATA_APP_TOKEN (optional) | allowed |
| Illinois IDFPR roofing contractor licenses ([page](https://data.illinois.gov/d/pzzh-kp68)) | data.illinois.gov | Socrata SODA API, live per report | licenses | name, owner, license | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Illinois IDPH licensed asbestos workers ([page](https://data.illinois.gov/d/437c-unzu)) | data.illinois.gov | Socrata SODA API, live per report | licenses | owner, license | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Illinois IDFPR design professionals and home inspectors ([page](https://data.illinois.gov/d/pzzh-kp68)) | data.illinois.gov | Socrata SODA API, live per report | licenses | name, owner, license | live | SOCRATA_APP_TOKEN (optional) | allowed |
| Illinois IDPH licensed asbestos abatement contractors ([page](https://data.illinois.gov/d/kt5u-9dcu)) | data.illinois.gov | Socrata SODA API, live per report | licenses | name, owner, phone, address | live | SOCRATA_APP_TOKEN (optional) | allowed |
| Illinois IDPH licensed asbestos professionals (supervisors, inspectors, project designers) ([page](https://data.illinois.gov/d/duif-eqac)) | data.illinois.gov | Socrata SODA API, live per report | licenses | name, owner, license, phone, address | live | SOCRATA_APP_TOKEN (optional) | allowed |
| Illinois IDFPR discipline (roofing contractors, design firms, home inspectors) | - | live search per report | discipline (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |
| Illinois Department of Labor public-works debarments (Prevailing Wage Act) | - | live search per report | debarment (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

Looked at and not used (from the pack's `blocked` notes):

- IDPH plumber and plumbing-contractor lookup (plumblicv5pub.dph.illinois.gov, linked from dph.illinois.gov/envhealth/plumbing.htm): the host does not resolve in public DNS; no plumber download exists
- IDPH lead contractor registration (data.illinois.gov vpwp-h7xr) and lead inspectors (4dci-czfi): last updated 2025-07, expiration dates already past; left out as stale
- IDPH manufactured-home installers (yjck-9suj): last updated 2024-02; left out as stale
- City of Chicago Home Repair licenses (data.cityofchicago.org r5kz-chrr): the license ended in 2016; chicago.gov's building-department pages answer 403
- Illinois Workers' Compensation Commission stop-work orders: no published list found

### IN

Checked live: 2026-10-15. No statewide GC license: Indiana does not license general contractors statewide; the Plumbing Commission licenses plumbers, and cities and counties such as Indianapolis license contractors (Indianapolis is searched above)

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Indianapolis contractor licenses (Business and Neighborhood Services) ([page](https://aca-prod.accela.com/INDY/GeneralProperty/PropertyLookUp.aspx?isLicensee=Y)) | aca-prod.accela.com | bulk file `in-indy` (official download, indexed) | licenses | name | every 168h, floor 38000 | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- Professional Licensing Agency Search and Verify (mylicense.in.gov/EVerification), re-checked 2026-10-15: robots.txt has content-signal comments only (no rules), the search form's Recaptcha1 field is an empty hidden input and a Plumbing Commission search answers (Plumbing Contractor, Journeyman Plumber, Plumbing Corporation with its related plumbing contractor, asbestos and lead contractors); not used because the site carries the IN.gov portal header and the IN.gov Terms of Use (in.gov/core/terms_of_use.html) say: "the viewing, printing, or downloading of any content ... from the Portal grants you only a limited, nonexclusive license for use solely by you for your own personal use, and not for republication, distribution, ... sale, preparation of derivative works or other use. No part of any content ... may be reproduced in any form or incorporated into any information retrieval system, electronic or mechanical, other than for your personal use (not for resale or redistribution)" and bar using the Portal to "exploit any information ... for advertising or commercial purposes"
- PLA licensee list download (in.gov/pla/license/download-license-files), re-checked 2026-10-15: sold through the IN.gov portal, "$150 for the first record ... $10 for each additional 1,000 records"
- PLA Discipline Search (in.gov/ai/appfiles/pla-litigation → in.gov/apps/pla/litigation/advancedsearch.aspx): "disciplinary actions taken against individual licensees", searched by first and last name or license number only (no business name), so no company search (FCRA: companies only); IN.gov Terms of Use as above
- PLA Indiana Active Licenses Map (in.gov/pla/data/indiana-active-licenses-map): counts per county only, no names
- Secretary of State INBiz bulk business data: paid ($9,500) and needs an INBiz account
- Indiana Data Hub (hub.mph.in.gov), re-checked 2026-10-15: its search finds no dataset for "plumbing" or "contractor" (robots.txt disallows /api/)

### IA

Checked live: 2026-10-15. No statewide GC license: Iowa does not license general contractors statewide; contractors earning $2,000 a year or more register with the Division of Inspections, Appeals and Licensing (searched above), and electricians, plumbers and mechanical trades are licensed separately

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Iowa DIAL construction contractor registrations ([page](https://data.iowa.gov/catalog/dataset/1052)) | data.iowa.gov | bulk file `ia-contractors` (official download, indexed) | licenses | name | every 168h, floor 12500 | none | allowed |
| Iowa DIAL asbestos licenses ([page](https://data.iowa.gov/catalog/dataset/560)) | data.iowa.gov | bulk file `ia-asbestos` (official download, indexed) | licenses | name | every 168h, floor 950 | none | allowed |
| Iowa DIAL asbestos abatement permits (businesses) ([page](https://data.iowa.gov/catalog/dataset/561)) | data.iowa.gov | bulk file `ia-asbestos-permits` (official download, indexed) | licenses | name | every 168h, floor 95 | none | allowed |
| Iowa Secretary of State active business entities ([page](https://data.iowa.gov/catalog/dataset/554)) | data.iowa.gov | bulk file `ia-sos-active` (official download, indexed) | business_status (companies only) | name | every 168h, floor 240000 | none | allowed |
| Iowa electrical licenses ([page](https://dps-eeb.my.site.com/LicenseSearchPage)) | dps-eeb.my.site.com | the agency's own lookup (page or API), live per report | licenses | name, owner, license | live | none | allowed |
| Iowa DIAL fire protection and alarm system contractors ([page](https://iowa.imagetrendlicense.com/lms/public/portal#/lookup/service)) | iowa.imagetrendlicense.com | the agency's own lookup (page or API), live per report | licenses | name, license | live | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- Iowa Plumbing & Mechanical Systems Board (amanda-portal.idph.state.ia.us/adpereh): AWS WAF challenge and reCAPTCHA on the public search
- Iowa Workforce Development labor portal contractor search (laborportal.iwd.iowa.gov): a JavaScript app with no documented public endpoint; the Data Hub file above carries the same registrations
- Iowa electrical license detail pages show a 'Disciplines' section that reads 'No Discipline or Board Actions' even on revoked licenses, so it is not used as discipline data
- Iowa Secretary of State inactive/dissolved entities: no free bulk file (dataset 554 lists active entities only)

### KS

Checked live: 2026-10-15. No statewide GC license: Kansas does not license general contractors statewide (cities and counties license contractors and most trades); elevator contractors are licensed by the State Fire Marshal (searched above), engineers, architects and surveyors by the Board of Technical Professions (not searched: the board prohibits commercial use of its records), and roofers register with the Attorney General

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Kansas State Fire Marshal licensed elevator contractors ([page](https://firemarshal.ks.gov/342/Elevator-Safety-Program)) | firemarshal.ks.gov | bulk file `ks-elevator-contractors` (official download, indexed) | licenses | name | every 168h, floor 23 | none | allowed |
| Kansas State Fire Marshal licensed elevator mechanics ([page](https://firemarshal.ks.gov/342/Elevator-Safety-Program)) | firemarshal.ks.gov | bulk file `ks-elevator-mechanics` (official download, indexed) | licenses | name | every 168h, floor 180 | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- Kansas Board of Technical Professions verification (licensing.ks.gov): searchable, but the site prohibits any commercial use of its lists (K.S.A. 45-220(c)); not used in paid reports
- Kansas Attorney General roofing contractor registration directory (ag.ks.gov): HTTP 403 (Akamai) to our declared crawler
- KDHE licensed asbestos abatement contractors and lead activity firms (kdhe.ks.gov DocumentCenter PDFs): HTTP 403 to our declared crawler
- Kansas Secretary of State business entity search: robots.txt disallows /eforms/BusinessEntity/Search.aspx and the page serves an AWS WAF CAPTCHA

### KY

Checked live: 2026-10-15. No statewide GC license: Kentucky does not license general contractors statewide; the Department of Housing, Buildings and Construction licenses electrical, plumbing, HVAC, fire-protection and other trades, which are searched above

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Louisville Metro contractor licenses (as of 2022-06-19) (city/county) ([page](https://www.arcgis.com/home/item.html?id=267c8cf7a9254e5aaf6c22cfa43f4122)) | www.arcgis.com | bulk file `ky-louisville-contractors` (official download, indexed) | licenses | name | every 168h, floor 2200 | none | allowed |
| Kentucky Department of Housing, Buildings and Construction ([page](https://dhbc.ky.gov/Search/HBC_List_Licensees.aspx)) | dhbc.ky.gov | the agency's own lookup (page or API), live per report | licenses | name, owner, license | live | none | allowed |

### LA

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Louisiana State Licensing Board for Contractors violations ([page](https://lslbc.gov/contractor-violations/)) | lslbc.gov | bulk file `la-lslbc-violations` (official download, indexed) | discipline (companies only) | name | every 168h, floor 2800 | none | allowed |
| New Orleans occupational business licenses (contractors) (city/county) ([page](https://data.nola.gov/d/hjcd-grvu)) | data.nola.gov | bulk file `la-new-orleans-contractors` (official download, indexed) | licenses | name | every 24h, floor 1000 | SOCRATA_APP_TOKEN (optional) | allowed |
| East Baton Rouge Parish business registrations (construction) (city/county) ([page](https://data.brla.gov/d/xw6s-bcqm)) | data.brla.gov | bulk file `la-ebr-construction-businesses` (official download, indexed) | licenses | name | every 168h, floor 4300 | SOCRATA_APP_TOKEN (optional) | allowed |
| Louisiana State Licensing Board for Contractors ([page](https://arlspublic.lslbc.louisiana.gov/Public/DetailedSearch/ByName)) | arlspublic.lslbc.louisiana.gov | the agency's own lookup (page or API), live per report | licenses | name, owner, license | live | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- LSLBC roster download (arlspublic _DetailedLookupRoster): a paid download (online fee per roster)
- Louisiana State Plumbing Board roster (public.spbla.com): robots.txt disallows every path
- LSLBC Act 204 civil action reports (lslbc.gov/act-204-civil-action-report/): quarterly PDF reports only, not a name search

### ME

Checked live: 2026-10-15. No statewide GC license: Maine does not license general contractors or trades such as roofing and framing (Maine Attorney General); electricians, plumbers and oil and solid fuel technicians are licensed by the Office of Professional and Occupational Regulation, whose license search could not be used. Maine DEP's asbestos abatement licenses and underground tank installer certifications are searched above

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Maine DEP licensed asbestos abatement contractors and consultants ([page](https://www.maine.gov/dep/waste/asbestos/asbestoscontractors.html)) | www.maine.gov | the agency's own lookup (page or API), live per report | licenses | name, phone | live | none | allowed |
| Maine DEP certified underground storage tank installers and inspectors ([page](https://www.maine.gov/dep/waste/busti/certifiedlist.html)) | www.maine.gov | the agency's own lookup (page or API), live per report | licenses | name, owner | live | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- OPOR license search, licensee list download and licensee discipline search (www.pfr.maine.gov/ALMSOnline/ALMSQuery; the electricians', plumbers' and fuel boards' "Find a Licensee", "Download a List of Licensees" and "Search Licensee Discipline" links all open it): robots.txt (checked 2026-10-15) has "Disallow: /ALMSOnline/ALMSQuery/SearchResults.aspx", "Disallow: /ALMSOnline/ALMSQuery/ExportToCSV.aspx", "Disallow: /ALMSOnline/ALMSQuery/ShowDetail.aspx" and "Disallow: /ALMSOnline/ALMSQuery/ShowCaseDetail.aspx", so neither the search, the CSV export nor the case details can be used
- www.maine.gov/cgi-bin/online/licensing (InforME license lookups): robots.txt on www.maine.gov has "Disallow: /cgi-bin/"
- Secretary of State corporate search (icrs.informe.org): did not answer (no response within 25 s, 2026-10-15)
- Electricians' Examining Board, Plumbers' Examining Board and Maine Fuel Board pages (www.maine.gov/pfr/professionallicensing/professions/…): publish no licensee lists or disciplinary action lists of their own; every list link goes to ALMSQuery (above)
- data.maine.gov: redirects to www.socrata.com (HTTP 404); no Maine open-data catalog to search

### MD

Checked live: 2026-10-15. No statewide GC license: Maryland does not license general contractors statewide; home improvement contractors and the electrical, plumbing and HVACR trades are licensed by Maryland Department of Labor boards (whose search we can't run automatically), and Montgomery County's contractor and electrical licenses are searched above

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Maryland Board of Public Works debarments ([page](https://bpw.prod.maryland.gov/bpw-programs/procurement/debarments)) | bpw.prod.maryland.gov | bulk file `md-bpw-debarments` (official download, indexed) | debarment (companies only) | name | every 168h, floor 13 | none | allowed |
| Montgomery County building contractor licenses ([page](https://data.montgomerycountymd.gov/d/c7hs-c9qq)) | data.montgomerycountymd.gov | Socrata SODA API, live per report | licenses | name, owner, license, phone, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Montgomery County electrical business licenses ([page](https://data.montgomerycountymd.gov/d/ydri-y5u9)) | data.montgomerycountymd.gov | Socrata SODA API, live per report | licenses | name, license, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Montgomery County limited electrical business licenses ([page](https://data.montgomerycountymd.gov/d/rmjr-4zb9)) | data.montgomerycountymd.gov | Socrata SODA API, live per report | licenses | name, license, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Montgomery County master electrician licenses ([page](https://data.montgomerycountymd.gov/d/v8mn-6i2r)) | data.montgomerycountymd.gov | Socrata SODA API, live per report | licenses | owner, license, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Montgomery County limited master electrician licenses ([page](https://data.montgomerycountymd.gov/d/f637-ajic)) | data.montgomerycountymd.gov | Socrata SODA API, live per report | licenses | owner, license, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Montgomery County journeyman electrician licenses ([page](https://data.montgomerycountymd.gov/d/vajy-hwge)) | data.montgomerycountymd.gov | Socrata SODA API, live per report | licenses | owner, license, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Montgomery County fire system licenses ([page](https://data.montgomerycountymd.gov/d/yjd7-guhd)) | data.montgomerycountymd.gov | Socrata SODA API, live per report | licenses | name, owner, license, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Montgomery County Office of Consumer Protection investigations ([page](https://data.montgomerycountymd.gov/d/ey5a-vyri)) | data.montgomerycountymd.gov | Socrata SODA API, live per report | complaints (companies only) | name | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |

Looked at and not used (from the pack's `blocked` notes):

- Maryland Department of Labor license search (MHIC home improvement, master electricians, plumbers, HVACR, engineers, architects; dllr.state.md.us OP_search): Google reCAPTCHA on every search form, no download
- Maryland SDAT Business Express entity search (egov.maryland.gov/BusinessExpress): Cloudflare Turnstile CAPTCHA
- Maryland Judiciary Case Search (casesearch.courts.state.md.us): HTTP 403 and a CAPTCHA
- Maryland Commissioner of Labor prevailing-wage violator list: filed with the Secretary of State, not published as a list or dataset that we found

### MA

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Massachusetts OPSI licenses (construction supervisors, pipefitters, refrigeration, sprinkler, elevator, hoisting) ([page](https://madpl.mylicense.com/verification/)) | madpl.mylicense.com | bulk file `ma-opsi` (official download, indexed) | licenses | name | every 168h, floor 120000 | none | allowed |
| Massachusetts Home Improvement Contractor registry (OCABR) ([page](https://contractorhub.mass.gov/s/hic-contractor-search)) | contractorhub.mass.gov | the agency's own lookup (page or API), live per report | licenses | name, owner | live | none | allowed |
| Massachusetts Department of Fire Services certificates (oil burner, fire suppression, blasting) ([page](https://madfs.mylicense.com/verification/)) | madfs.mylicense.com | the agency's own lookup (page or API), live per report | licenses | owner, license | live | none | allowed |
| Massachusetts HIC hearing decisions, Guaranty Fund claims and arbitration awards (OCABR) | - | live search per report | discipline (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

Looked at and not used (from the pack's `blocked` notes):

- www.mass.gov (every page, including the Division of Occupational Licensure 'Check a license' page that names the electrician and plumber lookups) answers HTTP 403 to our bot, so those lookups' addresses could not be confirmed: electricians, plumbers and gas fitters are not searched
- Secretary of the Commonwealth corporations search (corp.sec.state.ma.us): robots.txt disallows everything and the site sits behind an Incapsula challenge
- elicensing21.mass.gov (ePLACE) licensee search lists only the Alcoholic Beverages Control Commission
- madfs.mylicense.com 'Download' button answers HTTP 500, so Fire Services certificates are searched live instead of downloaded
- OCABR Contractor Hub has no phone or street-address search (only business name, person, HIC number, city and ZIP)
- Attorney General Fair Labor Division citations and DIA stop-work orders are published only on www.mass.gov (HTTP 403 to our bot)

### MI

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Michigan LARA licenses (builders and trades) ([page](https://aca-prod.accela.com/LARA/GeneralProperty/PropertyLookUp.aspx?isLicensee=Y)) | aca-prod.accela.com | bulk file `mi-lara` (official download, indexed) | licenses | name | every 168h, floor 158000 | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- michigan.gov (LARA BCC pages, final orders, Corporations Division): Akamai returns 403 Access Denied to our bot, not used
- data.michigan.gov: no license, enforcement or business-entity dataset (only performance measures)
- LARA Architect and Engineer licensee exports (aca-prod.accela.com/LARA): the search answers with a server error page for these two types, left out
- LARA disciplinary actions: published only on michigan.gov (blocked above); the Accela export carries no discipline

### MN

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Minnesota DLI licenses and registrations ([page](https://www.dli.mn.gov/license-and-registration-lookup)) | www.dli.mn.gov | bulk file `mn-dli` (official download, indexed) | licenses | name | every 24h, floor 170000 | none | allowed |
| Minnesota DLI licenses flagged with an enforcement action ([page](https://www.dli.mn.gov/license-and-registration-lookup)) | www.dli.mn.gov | bulk file `mn-dli-flagged` (official download, indexed) | discipline (companies only) | name | every 24h, floor 1900 | none | allowed |
| Minnesota DLI enforcement actions (residential building, electrical, plumbing) ([page](https://www.dli.mn.gov/workers/homeowners/file-complaint-and-view-enforcement-actions)) | www.dli.mn.gov | bulk file `mn-dli-orders` (official download, indexed) | discipline (companies only) | name | every 168h, floor 480 | none | allowed |
| Minnesota suspended and debarred vendors (Office of State Procurement) ([page](https://mn.gov/admin/osp/government/suspended-debarred/)) | mn.gov | bulk file `mn-debarred` (official download, indexed, downloads only at UTC 6–11) | debarment (companies only) | name | every 24h, floor 15 | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- DLI license lookup (ims.dli.mn.gov): not needed, the same data is the nightly export loaded above
- DLI workers' compensation stop-work orders: no published list found on dli.mn.gov

### MS

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Mississippi State Board of Contractors revoked and suspended licenses ([page](http://search.msboc.us/ConsolidatedSearch.cfm)) | search.msboc.us | bulk file `ms-msboc-revoked-suspended` (official download, indexed) | discipline (companies only) | name | every 24h, floor 64 | none | allowed |
| Mississippi State Board of Contractors ([page](http://search.msboc.us/ConsolidatedSearch.cfm)) | search.msboc.us | the agency's own lookup (page or API), live per report | licenses | name, owner, license, address | live | none | allowed |
| Mississippi State Board of Contractors complaints and violations | - | live search per report | complaints (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

Looked at and not used (from the pack's `blocked` notes):

- MSBOC Excel export of every license (search.msboc.us ViewExcel): works, but carries no classification, expiration or qualifying party, so the live search with detail pages is used instead

### MO

Checked live: 2026-10-15. No statewide GC license: Missouri does not license general contractors statewide; cities and counties license contractors and trades, and the optional statewide electrical contractor license is searched above

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Kansas City business license holders (construction) (city/county) ([page](https://data.kcmo.org/d/pnm4-68wg)) | data.kcmo.org | bulk file `mo-kansas-city-contractors` (official download, indexed) | licenses | name | every 168h, floor 3300 | SOCRATA_APP_TOKEN (optional) | allowed |
| Missouri registered onsite wastewater treatment system installers ([page](https://data.mo.gov/d/nfxa-cq5r)) | data.mo.gov | Socrata SODA API, live per report | licenses | name, owner, license, phone | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Missouri MO PRO licensee search ([page](https://mopro.mo.gov/license/s/license-search)) | mopro.mo.gov | the agency's own lookup (page or API), live per report | licenses | name, owner, license | live | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- Missouri Division of Labor Standards contractor debarment list (labor.mo.gov/contractor-debarment-list): reads 'No contractors debarred at this time' on 2026-10-15, nothing to search
- Missouri Secretary of State business entities: no free bulk file or open API (the online search is per entity)
- MO PRO downloadable listings (electrical contractors; architects, engineers, land surveyors, landscape architects): the files are served from modpr.file.force.com, whose robots.txt disallows all paths for every agent but Googlebot (checked 2026-10-15), so they are not downloaded; the live licensee search covers these licenses
- MO PRO downloadable listings hold active licenses only; non-active licenses and discipline status come from the live licensee search

### MT

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Montana DEQ asbestos accreditations ([page](https://svc.mt.gov/deq/asbestosaccred/)) | svc.mt.gov | bulk file `mt-deq-asbestos` (official download, indexed) | licenses | name | every 168h, floor 375 | none | allowed |
| Montana DEQ licensed septic tank pumpers ([page](https://deq.mt.gov/twr/Programs/septic-tank)) | deq.mt.gov | bulk file `mt-deq-septic-pumpers` (official download, indexed) | licenses | name | every 168h, floor 105 | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- DLI Employment Standards licensee lookup and licensee list download (ebizws.mt.gov/PUBLICPORTAL and ERD_PUBLICPORTAL; construction contractor, electrical, plumbing and other trade licenses, and the Electrical and Plumbers boards' 'Licensee Mailing Lists'): re-checked 2026-10-15, the F5 firewall answers 'Request Rejected' ('The requested URL was rejected. Please consult with your administrator.') to every request, robots.txt included
- DLI construction contractor registration lookup (erdcontractors.mt.gov/ICCROnlineSearch/registrationlookup.jsp, linked from erd.dli.mt.gov): 2026-10-15 the server resets the connection after the request (robots.txt included)
- DLI professional licensing and Building Codes on Accela (ebiz.mt.gov/pol and /bcb → aca-prod.accela.com): the license search links go to the rejected ebizws portal; Accela's own licensee lookup was not used, being a side door to the same refused data
- DLI data dashboards (erd.dli.mt.gov/data-dashboards/professional-licensing, IndependentContractors; Tableau on tableau-ext.mt.gov): application and certificate counts, no licensee names
- Montana Data Portal (data.mt.gov) 'License Information' (Tableau DS-LicenseInformation): descriptions of license types and requirements, not licensees
- DEQ 'List of Montana Asbestos Companies' (deq.mt.gov/cleanupandrec/Programs/asbestos): a voluntary directory of companies that employ accredited people and asked to be listed, not a license; not used as one
- Electrical and Plumbers boards (boards.bsd.dli.mt.gov): discipline only through the rejected licensee lookup; board meeting documents (boardmeetings.dli.mt.gov) are agendas and minutes, not a discipline list
- Secretary of State business search (biz.sosmt.gov): Cloudflare security check (HTTP 403)
- DLI prevailing-wage debarment list (erd.dli.mt.gov/labor-standards/public-contracts-prevailing-wage-law/debarment): live 2026-10-15, lists 'None'
- State Procurement (doa.mt.gov/SPSD) debarred vendors: no state list today; the agency resources page points to SAM.gov and the DLI list above
- DEQ enforcement: annual summary reports only, no case-level list

### NE

Checked live: 2026-10-15. No statewide GC license: Nebraska does not license general contractors statewide; contractors register with the Department of Labor (searched above), and electricians are licensed by the State Electrical Division

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Nebraska DOL contractors with unpaid Employee Classification Act fines ([page](https://dol.nebraska.gov/LaborStandards/Contractors/Overview)) | dol.nebraska.gov | bulk file `ne-eca-unpaid` (official download, indexed) | wage (companies only) | name | every 168h, floor 25 | none | allowed |
| Nebraska DOL contractor registrations ([page](https://dol.nebraska.gov/conreg/Search)) | dol.nebraska.gov | the agency's own lookup (page or API), live per report | licenses | name, owner, license, phone | live | none | allowed |
| Nebraska State Electrical Division licenses ([page](https://nesedprod-search.state-reg-central.tylerapp.com)) | nesedprod-search.state-reg-central.tylerapp.com | the agency's own lookup (page or API), live per report | licenses | owner, license, address | live | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- Nebraska State Electrical Division 'Licensee List Orders' (nebraska.gov/sed/lists): paid lists
- Nebraska Secretary of State corporation search (nebraska.gov/sos/corp/corpsearch.cgi): reCAPTCHA

### NV

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Nevada State Contractors Board disciplinary and board actions (2001 to today) ([page](https://www.nvcontractorsboard.com/investigations/disciplinary-and-board-actions/)) | www.nvcontractorsboard.com | bulk file `nv-nscb-discipline` (official download, indexed) | discipline (companies only) | name | every 168h, floor 4700 | none | allowed |
| City of Las Vegas contractor business licenses (city/county) ([page](https://www.arcgis.com/home/item.html?id=f6b923ee5eb9450baf6adebaf0f307ed)) | www.arcgis.com | bulk file `nv-las-vegas-contractors` (official download, indexed) | licenses | name | every 24h, floor 9800 | none | allowed |
| Nevada State Contractors Board licenses ([page](https://app.nvcontractorsboard.com/Clients/NVSCB/Public/ContractorLicenseSearch/ContractorLicenseSearch.aspx)) | app.nvcontractorsboard.com | the agency's own lookup (page or API), live per report | licenses | name, owner, license | live | none | allowed |
| Nevada Labor Commissioner disqualified contractors | - | live search per report | debarment (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

Looked at and not used (from the pack's `blocked` notes):

- NSCB contractor listing (ListingSearch.aspx, active licensees with expiry and monetary limit): usable, but it repeats the live license search for active licenses only and has no principals, so it is not loaded
- Nevada Secretary of State business search (esos.nv.gov): every page answers an Incapsula bot challenge

### NH

Checked live: 2026-10-15. No statewide GC license: New Hampshire does not license general or home-improvement contractors statewide; electricians and plumbers are licensed by the Office of Professional Licensure and Certification, whose license lookup could not be searched

No source is searched for this state yet.

Looked at and not used (from the pack's `blocked` notes):

- OPLC license lookup and board pages (www.oplc.nh.gov/license-lookup, www.oplc.nh.gov/electricians-board, forms.nh.gov/licenseverification): HTTP 403 "Access Denied" (Akamai, "You don't have permission to access … on this server") to our bot on 2026-10-15, robots.txt included, so no lookup, roster or board disciplinary decisions can be read
- NH open data (data.nh.gov): HTTP 403 to our bot on 2026-10-15; its datasets were not looked for through another host
- Every other nh.gov host tried on 2026-10-15 (www.nh.gov, www.des.nh.gov, www.doj.nh.gov, www.courts.nh.gov, www.dol.nh.gov, www.nhes.nh.gov, www.revenue.nh.gov, www.sos.nh.gov, quickstart.sos.nh.gov business search): HTTP 403 to our bot; sos.nh.gov answered HTTP 503

### NJ

Checked live: 2026-10-15. No statewide GC license: New Jersey does not license general contractors statewide; home improvement contractors register with the Division of Consumer Affairs, and electricians, plumbers and HVACR contractors are licensed by their boards (all searched above)

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| New Jersey home improvement contractor registrations (Division of Consumer Affairs) ([page](https://newjersey.mylicense.com/Verification/)) | newjersey.mylicense.com | bulk file `nj-hic` (official download, indexed) | licenses | name | every 24h, floor 100000 | none | allowed |
| New Jersey electrical, plumbing, HVACR and elevator licenses (Division of Consumer Affairs) ([page](https://newjersey.mylicense.com/Verification/)) | newjersey.mylicense.com | bulk file `nj-trades` (official download, indexed) | licenses | name | every 24h, floor 60000 | none | allowed |
| New Jersey architects, engineers, land surveyors and home inspectors (Division of Consumer Affairs) ([page](https://newjersey.mylicense.com/Verification/)) | newjersey.mylicense.com | bulk file `nj-design` (official download, indexed) | licenses | name | every 168h, floor 60000 | none | allowed |
| New Jersey DOL prevailing-wage debarments ([page](https://nj.gov/labor/wageandhour/registration-permits/register/debarmentlist.shtml)) | nj.gov | bulk file `nj-debarments` (official download, indexed) | debarment (companies only) | name | every 24h, floor 100 | none | allowed |
| New Jersey DOL Workplace Accountability in Labor List (The WALL) ([page](https://www.nj.gov/labor/ea/osec/wall.shtml)) | www.nj.gov | bulk file `nj-wall` (official download, indexed) | wage (companies only) | name | every 168h, floor 280 | none | allowed |
| New Jersey DOL Wage Violation Watchlist ([page](https://nj.gov/labor/ea/osec/wageviolationlist.shtml)) | nj.gov | bulk file `nj-watchlist` (official download, indexed) | wage (companies only) | name | every 168h, floor 750 | none | allowed |
| New Jersey Division of Revenue business entity records | - | live search per report | business_status (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

Looked at and not used (from the pack's `blocked` notes):

- NJ Division of Revenue entity status and standing: only the paid NJ Business Records Service shows it; the free name search (used) has no status
- NJ Courts public access (portal.njcourts.gov): behind an Incapsula bot wall, no bulk data or API
- NJ Division of Consumer Affairs board actions and consumer complaints: published only as individual PDFs and press releases
- NJDOL stop-work orders: announced only in press releases, no list

### NM

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| New Mexico RLD home inspector and landscape architect licenses ([page](https://nmrldlpi.my.site.com/bcd/s/rld-public-search?language=en_US)) | nmrldlpi.my.site.com | the agency's own lookup (page or API), live per report | licenses | owner | live | none | allowed |
| New Mexico Secretary of State business entities | - | live search per report | business_status (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

Looked at and not used (from the pack's `blocked` notes):

- Construction Industries Division contractor / journeyman license search (public.psiexams.com/search.jsp, PSI, linked from rld.nm.gov's Verify a License page): the search form requires a CAPTCHA ("Enter Captcha", simplecaptcha.jpg; re-checked 2026-10-15). The results pages it posts to are not called directly (that would get around the CAPTCHA)
- Workforce Solutions public works contractor registry (dws.state.nm.us): the site's firewall answers every request, robots.txt included, with "Request Rejected" (re-checked 2026-10-15)
- CID disciplinary actions: rld.nm.gov's Enforcement Actions page lists every board's actions but links CID only to its home page; CID's Investigation and Enforcement and Unlicensed Violations pages publish no list (only the Recycled Metals program has a Disciplinary Actions page). Checked 2026-10-15
- CID/MHD permit portal (nmrld.my.site.com/MHD/s/public-permit-search, /public-violation-search "Search Notice"): permit and notice searches, not a license lookup; not used
- NM General Services Department debarment and suspension notices (generalservices.state.nm.us/state-purchasing/debarment-notices): "THERE ARE NO SUSPENDED OR DEBARRED FIRMS AT THIS TIME" (2026-10-15)
- NM state open-data portal: none found (data.nm.gov and opendata.nm.gov do not resolve, 2026-10-15)

### NY

Checked live: 2026-10-15. No statewide GC license: New York does not license general or home-improvement contractors statewide; cities and counties do (New York City's DOB and DCWP licenses are searched above), and the state licenses only some trades (elevator, mold, asbestos, crane and blasting), which are searched above

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| New York DOL contractor registry (public work) ([page](https://data.ny.gov/d/i4jv-zkey)) | data.ny.gov | Socrata SODA API, live per report | licenses | name, owner, license, phone, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| New York DOL elevator contractor licenses ([page](https://data.ny.gov/d/jrac-r9vc)) | data.ny.gov | Socrata SODA API, live per report | licenses | name, license, phone, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| New York DOL elevator mechanic and inspector licenses ([page](https://data.ny.gov/d/cxfs-ya8e)) | data.ny.gov | Socrata SODA API, live per report | licenses | owner, license | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| New York DOL mold contractor licenses ([page](https://data.ny.gov/d/ikqx-ispy)) | data.ny.gov | Socrata SODA API, live per report | licenses | name, license, phone, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| New York DOL mold individual licenses ([page](https://data.ny.gov/d/h6jr-vxqt)) | data.ny.gov | Socrata SODA API, live per report | licenses | owner, license | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| New York DOL asbestos certificates ([page](https://data.ny.gov/d/95bk-87hc)) | data.ny.gov | Socrata SODA API, live per report | licenses | owner, license | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| New York DOL crane operator certificates ([page](https://data.ny.gov/d/bu6a-ty84)) | data.ny.gov | Socrata SODA API, live per report | licenses | owner, license | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| New York DOL blaster certificates ([page](https://data.ny.gov/d/65tz-hymq)) | data.ny.gov | Socrata SODA API, live per report | licenses | owner, license | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| New York DOS licensed home inspectors ([page](https://data.ny.gov/d/r9fr-48vu)) | data.ny.gov | Socrata SODA API, live per report | licenses | name, owner, license, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| New York City DOB licenses (contractors and trades) ([page](https://data.cityofnewyork.us/d/t8hj-ruu2)) | data.cityofnewyork.us | Socrata SODA API, live per report | licenses | name, owner, license, phone, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| New York City DCWP home improvement contractor licenses ([page](https://data.cityofnewyork.us/d/w7w3-xahh)) | data.cityofnewyork.us | Socrata SODA API, live per report | licenses | name, license, phone, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| New York State non-responsible entities (Executive Order 192) ([page](https://data.ny.gov/d/jhxt-dfv6)) | data.ny.gov | Socrata SODA API, live per report | debarment (companies only) | name | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| New York Department of State active corporations ([page](https://data.ny.gov/d/n9v6-gdp6)) | data.ny.gov | Socrata SODA API, live per report | business_status (companies only) | name | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| New York City DOB disciplinary actions ([page](https://data.cityofnewyork.us/d/ndq3-kuef)) | data.cityofnewyork.us | Socrata SODA API, live per report | discipline (companies only) | name | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| New York City DCWP charges ([page](https://data.cityofnewyork.us/d/5fn4-dr26)) | data.cityofnewyork.us | Socrata SODA API, live per report | discipline (companies only) | name | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| New York DOL / Workers' Compensation Board public-work debarments | - | live search per report | debarment (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |
| New York City DCWP consumer complaints ([page](https://data.cityofnewyork.us/d/nre2-6m2s)) | data.cityofnewyork.us | Socrata SODA API, live per report | complaints (companies only) | name | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |

Looked at and not used (from the pack's `blocked` notes):

- NY DOL debarment list PDF (dol.ny.gov/debarred-list): same data as the EDList search form, which is used instead
- NY Unified Court System WebCivil (iapps.courts.state.ny.us): Cloudflare challenge page (HTTP 403), no bulk data or API
- NYS Attorney General consumer complaints: no dataset on data.ny.gov
- NY Workers' Compensation Board stop-work orders: no dataset on data.ny.gov; WCB 141-b debarments are in the EDList search above

### NC

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| NC Licensing Board for General Contractors ([page](https://portal.nclbgc.org/Public/Search)) | portal.nclbgc.org | the agency's own lookup (page or API), live per report | licenses | name, owner, phone, address | live | none | allowed |
| NC Board of Examiners of Electrical Contractors ([page](https://arls-public.ncbeec.org/Public/Search)) | arls-public.ncbeec.org | the agency's own lookup (page or API), live per report | licenses | name, owner, phone, address | live | none | allowed |
| NC Board of Examiners of Plumbing, Heating & Fire Sprinkler Contractors ([page](https://public.nclicensing.org/Public/Search)) | public.nclicensing.org | the agency's own lookup (page or API), live per report | licenses | name, owner, phone, address | live | none | allowed |
| NC Licensing Board for General Contractors: disciplinary actions | - | live search per report | discipline (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

Looked at and not used (from the pack's `blocked` notes):

- NC Division of Purchase and Contract debarred vendors (ncadmin.nc.gov/government-agencies/procurement/contracts/debarred-vendors, CSV and PDF, revised 6/1/2021): not used, because the page's terms (www.nc.gov/disclaimer-terms-use, read 2026-10-15) grant "permission to copy and distribute non-image files, documents, and information for non-commercial use" only (coordinator's decision, 2026-10-15)
- nclbgc.org (the board's main site, including its disciplinary news): Cloudflare challenge on every page; the portal.nclbgc.org search is used instead
- NCBEEC public matters (/Public/_ShowAccountPublicMatters/): endpoint exists but no populated example was found to verify its layout, so it isn't searched
- NC Secretary of State business registration: bulk data is a paid subscription and the SOS bars automated searching of its online tools
- NC Industrial Commission (workers' comp penalties, stop-work): no published list of penalized or noncompliant employers

### ND

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| North Dakota Secretary of State contractor licenses ([page](https://firststop.sos.nd.gov/search/contractor)) | firststop.sos.nd.gov | the agency's own lookup (page or API), live per report | licenses | name | live | none | allowed |
| North Dakota State Electrical Board ([page](https://www.ndseb.com/search-1/lookup-a-licensedorregistered-electrician/)) | www.ndseb.com | the agency's own lookup (page or API), live per report | licenses | name, owner | live | none | allowed |
| North Dakota State Plumbing Board licenses ([page](https://www.ndplumbingboard.gov/licensing-license-lookup)) | www.ndplumbingboard.gov | the agency's own lookup (page or API), live per report | licenses | owner, license | live | none | allowed |
| North Dakota Secretary of State business entity status | - | live search per report | business_status (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

Looked at and not used (from the pack's `blocked` notes):

- ND Secretary of State bulk lists: contractor and business lists are sold through 'Data List Requests'; only registered agents and lobbyists are free
- ND Secretary of State contractor search takes a name or SOS control number only, so contractor licenses can't be searched by license number
- ND State Electrical Board contractor search returns name, business and city only (no license number or dates)

### OH

Checked live: 2026-10-15. No statewide GC license: Ohio does not license general or residential contractors statewide; the Construction Industry Licensing Board licenses commercial electrical, HVAC, plumbing, hydronics and refrigeration contractors (searched above), and local building departments regulate residential contractors

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Ohio Construction Industry Licensing Board contractor licenses ([page](https://elicense4.com.ohio.gov/Lookup/LicenseLookup.aspx)) | elicense4.com.ohio.gov | bulk file `oh-ocilb` (official download, indexed) | licenses | name | every 24h, floor 8600 | none | allowed |
| Ohio State Fire Marshal fire protection and UST licenses ([page](https://elicense7.com.ohio.gov/Lookup/LicenseLookup.aspx)) | elicense7.com.ohio.gov | bulk file `oh-sfm` (official download, indexed) | licenses | name | every 168h, floor 16000 | none | allowed |
| Cleveland contractor registrations (city/county) ([page](https://www.arcgis.com/home/item.html?id=92e169a99d7b42ae97f6c28a7f7e9a19)) | www.arcgis.com | bulk file `oh-cleveland-contractors` (official download, indexed) | licenses | name | every 24h, floor 2300 | none | allowed |
| Ohio Attorney General Public Inspection File (consumer-law court rulings) | - | live search per report | courts (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

Looked at and not used (from the pack's `blocked` notes):

- elicense.ohio.gov (Salesforce license lookup for the other Commerce boards and OCILB board actions): the page carries a CAPTCHA
- Ohio Secretary of State business reports (ohiosos.gov): HTTP 403 with a "Website Maintenance" page on 2026-10-15, and again on the retry at 06:52 UTC from tower1 and vb11 (robots.txt and businesssearch.ohiosos.gov too); recheck later
- OCILB disciplinary actions: no published list or download found on com.ohio.gov
- Ohio Facilities Construction Commission debarment list (R.C. 153.02): no published list found

### OK

Checked live: 2026-10-15. No statewide GC license: Oklahoma does not license general contractors statewide; the Construction Industries Board licenses electrical, plumbing and mechanical trades and registers roofing contractors

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Oklahoma Construction Industries Board roofing contractor registrations ([page](https://verifyroofing.cib.ok.gov/roofing/search)) | verifyroofing.cib.ok.gov | bulk file `ok-cib-roofing` (official download, indexed) | licenses | name | every 24h, floor 4200 | none | allowed |
| Oklahoma Department of Labor alarm, locksmith and fire sprinkler licenses (companies) ([page](https://oklahoma.gov/labor/safety-and-health/safety-standards/alarm-locksmith-fire-sprinkler-service/licensing-requirements.html)) | oklahoma.gov | bulk file `ok-odol-alarm-companies` (official download, indexed) | licenses | name | every 168h, floor 520 | none | allowed |
| Oklahoma Department of Labor alarm, locksmith and fire sprinkler licenses (individuals) ([page](https://oklahoma.gov/labor/safety-and-health/safety-standards/alarm-locksmith-fire-sprinkler-service/licensing-requirements.html)) | oklahoma.gov | bulk file `ok-odol-alarm-individuals` (official download, indexed) | licenses | name | every 168h, floor 3300 | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- CIB electrical, plumbing and mechanical license search (cibverify.ok.gov GL Suite licensee search, still the link on oklahoma.gov/cib 'Are they licensed?'): answered HTTP 503 with Retry-After 3600 for over an hour early on 2026-10-15 (tower1 and vb11); retried 2026-10-15 06:47Z and 06:53Z: port 443 refused the connection from tower1 and vb11, and plain http answered HTTP 503. The board's newer verify.cib.hbesystems.com app searches roofing and CEUs only
- CIB disciplinary actions: the board's site (oklahoma.gov/cib) publishes no list or file of orders
- data.ok.gov: no CIB, contractor, debarment or business-entity dataset newer than 2019

### OR

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Oregon BOLI prevailing wage: ineligible contractors and case closure letters ([page](https://www.oregon.gov/boli/employers/Pages/pwr-ineligible-contractors.aspx)) | www.oregon.gov | bulk file `or-boli-pwr` (official download, indexed) | debarment (companies only) | name | every 24h, floor 30 | none | allowed |
| Oregon Construction Contractors Board (active licenses) ([page](https://data.oregon.gov/d/g77e-6bhs)) | data.oregon.gov | Socrata SODA API, live per report | licenses | name, owner, license, phone, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Oregon Building Codes Division trade licenses ([page](https://data.oregon.gov/d/vhbr-cuaq)) | data.oregon.gov | Socrata SODA API, live per report | licenses | name, owner, license, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Oregon Secretary of State business registry (active businesses) | - | live search per report | business_status (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |
| Oregon DCBS workers' compensation coverage (active employers) | - | live search per report | wage (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |
| Oregon DOJ consumer complaints ([page](https://data.oregon.gov/d/2ix7-8hwk)) | data.oregon.gov | Socrata SODA API, live per report | complaints (companies only) | name | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |

Looked at and not used (from the pack's `blocked` notes):

- CCB contractor search, complaint and disciplinary history (search.ccb.state.or.us): robots.txt disallows every path; CCB publishes no disciplinary list elsewhere
- Building Codes Division enforcement actions: no published list (the enforcement page describes the process only)

### PA

Checked live: 2026-10-15. No statewide GC license: Pennsylvania does not license general contractors statewide; home improvement contractors register with the Attorney General, and trades are licensed by municipalities (Philadelphia's are searched above)

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Philadelphia L&I trade licenses ([page](https://opendataphilly.org/datasets/licenses-and-inspections-trade-licenses/)) | opendataphilly.org | bulk file `pa-philadelphia` (official download, indexed) | licenses | name | every 24h, floor 35000 | none | allowed |
| Pennsylvania L&I Prevailing Wage Act debarments ([page](https://www.pa.gov/agencies/dli/resources/compliance-laws-and-regulations/labor-management-relations/labor-law/prevailing-wage/debarments-and-settlements)) | www.pa.gov | bulk file `pa-dli-debarments` (official download, indexed) | debarment (companies only) | name | every 168h, floor 3 | none | allowed |
| Philadelphia L&I trade and contractor licenses (city/county) ([page](https://opendataphilly.org/datasets/licenses-and-inspections-trade-licenses/)) | opendataphilly.org | bulk file `pa-phl-trade-licenses` (official download, indexed) | licenses | name | every 168h, floor 28000 | none | allowed |
| Philadelphia L&I contractor violations (city/county) ([page](https://www.arcgis.com/home/item.html?id=dbc8c4b06d3c40aab87d48a5fcdafc58)) | www.arcgis.com | bulk file `pa-phl-contractor-violations` (official download, indexed) | discipline (companies only) | name | every 168h, floor 16000 | none | allowed |
| Pennsylvania Department of State active business registrations ([page](https://data.pa.gov/d/3urc-uaba)) | data.pa.gov | Socrata SODA API, live per report | business_status (companies only) | name | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Pennsylvania DGS debarment and suspension list | - | live search per report | debarment (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |
| Pennsylvania UJS court cases (web portal) | - | live search per report | courts (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

Looked at and not used (from the pack's `blocked` notes):

- PA Attorney General home improvement contractor registry (hicsearch.attorneygeneral.gov): Cloudflare Turnstile CAPTCHA on the search and its .xlsx download
- PA Department of State PALS license verification (pals.pa.gov; architects, engineers, crane operators and other state boards): the search loads Google reCAPTCHA v3
- PA Attorney General consumer complaints: no open dataset on data.pa.gov
- Pittsburgh PLI contractor and trade licenses (data.wprdc.org): robots.txt disallows /api/ and /datastore/dump/ for every agent (checked 2026-10-15); the loader is kept (pittsburghLoader) but not registered
- PA Common Pleas civil cases: not on the UJS web portal (county systems only)

### RI

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Rhode Island DBR rosters (architects, engineers, land surveyors, landscape architects, solar retailers) ([page](https://ridbrprod.state-reg-eastern.tylerapp.com/portal/public/online-reports)) | ridbrprod.state-reg-eastern.tylerapp.com | bulk file `ri-dbr-rosters` (official download, indexed) | licenses | name | every 168h, floor 12000 | none | allowed |
| Rhode Island DLT trade licenses (Professional Regulation) ([page](https://dltweb.dlt.ri.gov/profregsonline/LicenseSearch)) | dltweb.dlt.ri.gov | the agency's own lookup (page or API), live per report | licenses | name, owner, license | live | none | allowed |
| Rhode Island DLT Professional Regulation violations | - | live search per report | discipline (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

Looked at and not used (from the pack's `blocked` notes):

- Contractors' Registration and Licensing Board (crb.ri.gov), the statewide residential and commercial contractor registry: Cloudflare challenge page (HTTP 403) to our bot
- data.ri.gov and dlt.ri.gov (including DLT's paid bulk licensee lists page): Cloudflare challenge (HTTP 403)
- Secretary of State business search (business.sos.ri.gov): Cloudflare Turnstile CAPTCHA on the search form
- DBR online rosters list active credentials only; the DBR lookup has no contractor boards

### SC

Checked live: 2026-10-15.

No source is searched for this state yet.

Looked at and not used (from the pack's `blocked` notes):

- SC DES environmental enforcement action reports (the monthly PDFs linked from des.sc.gov "Environmental Enforcement Actions"; was sc-des-enforcement): not used, because des.sc.gov's Website Accessibility and Policies page says "You may not: (1) reproduce, adapt, modify, distribute, publicly perform or display, transmit, or otherwise copy or use any part of this site except as specifically permitted by SCDES in writing" (coordinator's decision, 2026-10-15)
- SC LLR licensee lookup (verify.llronline.com/LicLookup/Contractors/Contractor.aspx?div=69 for the Contractor's Licensing Board's general and mechanical contractors, Resbu/Resbu.aspx?div=46 for the Residential Builders Commission, BurgFire for burglar/fire/sprinkler): a g-recaptcha widget on every search form, the Find button hidden until it is solved; rechecked 2026-10-15
- SC LLR board orders and bulk verification (eservice.llr.sc.gov/PublicOrdersWeb/?divisionId=69 and 46, /OnlineVerificationBulk): eservice.llr.sc.gov/robots.txt is "User-agent: * / Disallow: /"; rechecked 2026-10-15
- SC Contractor's Licensing Board meeting minutes (llr.sc.gov/clb/minutes, robots-allowed PDFs): disciplinary hearings are listed by case number only ("In accordance with Board confidentiality statutes, the hearing was closed"), no respondent named; checked the 2026-07-30 minutes
- SC LLR license rosters: sold by mailed request ($10 check per roster with a signed Family Privacy Protection Act statement, llr.sc.gov/AboutUs/MediaCenter/pidocs/Statement_Compliance.pdf, linked as 'Licensee List Request' from llr.sc.gov/clb); needs the owner
- SC DES Asbestos Contractors and Consultants Search (apps.des.sc.gov/AsbestosContractorsAndConsultants, with free CSV exports /CSV and /CSV/<type>: ~200 contractors, ~870 consultants and air samplers on 2026-10-15) and the UST Class I/II certified contractors PDF (des.sc.gov List_of_Certified_Contractors_August2026.pdf): not used, because des.sc.gov's Website Accessibility and Policies page says "You may not: (1) reproduce, adapt, modify, distribute, publicly perform or display, transmit, or otherwise copy or use any part of this site except as specifically permitted by SCDES in writing"
- SCDOT prequalified prime contractors (apps.scdot.org/powerbiexport, a free CSV export refreshed daily, ~425 firms on 2026-10-15): not used, because scdot.org/disclaimer.html says "You may not modify, publish, transmit, display, participate in the transfer or sale, create derivative works or in any way exploit, any of the content, in whole or in part, without the express written permission of SCDOT"
- SC Secretary of State business entities (businessfilings.sc.gov/BusinessFiling/Entity/Search): g-recaptcha on the search form; rechecked 2026-10-15
- SC DES ArcGIS hub: private (and on a des.sc.gov service, under the same terms)
- SC Workers' Compensation Commission and SC Materials Management Office: no published list of penalized employers or debarred vendors (decisions are single PDFs)

### SD

Checked live: 2026-10-15. No statewide GC license: South Dakota does not license general contractors statewide; plumbers and electricians are licensed by state commissions (the plumbing lists are searched above)

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| South Dakota Plumbing Commission licensed plumbers ([page](https://dlr.sd.gov/plumbing/consumer_info.aspx)) | dlr.sd.gov | bulk file `sd-plumbers` (official download, indexed) | licenses | name | every 168h, floor 1950 | none | allowed |
| South Dakota Plumbing Commission specialty licensees ([page](https://dlr.sd.gov/plumbing/consumer_info.aspx)) | dlr.sd.gov | bulk file `sd-specialty` (official download, indexed) | licenses | name | every 168h, floor 640 | none | allowed |
| South Dakota small onsite wastewater (septic) installers ([page](https://dlr.sd.gov/plumbing/consumer_info.aspx)) | dlr.sd.gov | bulk file `sd-septic` (official download, indexed) | licenses | name | every 168h, floor 390 | none | allowed |
| South Dakota Department of Revenue business tax delinquent report ([page](https://dor.sd.gov/businesses/taxes/)) | dor.sd.gov | bulk file `sd-dor-tax-delinquent` (official download, indexed) | tax_lien (companies only) | name | every 168h, floor 133 | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- South Dakota Electrical Commission license portal (sdec.portalus.thentiacloud.net, Thentia; electrical contractors and electricians): re-checked 2026-10-15, robots.txt 'User-agent: * / Disallow: /'. dlr.sd.gov/electrical publishes no licensee or contractor list
- SD Plumbing Commission: no company list; its PLUMBING CONTRACTOR and SEWER AND WATER CONTRACTOR licenses are issued to people and are in the lists above (dlr.sd.gov/plumbing/consumer_info.aspx, re-checked 2026-10-15)
- Department of Revenue contractor's excise tax licenses: no public list or lookup (dor.sd.gov/businesses/taxes/contractors-excise-tax; the tax license application at apps.sd.gov/rv23cedar is an account system)
- Electrical and Plumbing commission discipline: only meeting documents on boardsandcommissions.sd.gov (BoardID=35, 77), no discipline list
- South Dakota Secretary of State business search (sosenterprise.sd.gov): reCAPTCHA
- SD Plumbing Commission lists carry no license numbers, addresses or phones, so they can't be searched by those

### TN

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| TDEC enforcement cases ([page](https://dataviewers.tdec.tn.gov/dataviewers/r/tdec_reports/tdec-enforcementdataviewer999001/home)) | dataviewers.tdec.tn.gov | bulk file `tn-tdec-enforcement` (official download, indexed) | environmental (companies only) | name | every 168h, floor 3700 | none | allowed |
| TN Board for Licensing Contractors and Alarm Systems Contractors Board disciplinary actions ([page](https://www.tn.gov/commerce/dar/rb.html)) | www.tn.gov | bulk file `tn-blc-discipline` (official download, indexed) | discipline (companies only) | name | every 168h, floor 380 | none | allowed |
| Nashville registered professional contractors (city/county) ([page](https://www.arcgis.com/home/item.html?id=ac877684ad8b45e8b539af65ce475fe2)) | www.arcgis.com | bulk file `tn-nashville-contractors` (official download, indexed) | licenses | name | every 24h, floor 4900 | none | allowed |
| TN Commerce & Insurance licenses (contractors, home improvement, limited licensed electricians and plumbers) ([page](https://search.cloud.commerce.tn.gov/)) | search.cloud.commerce.tn.gov | the agency's own lookup (page or API), live per report | licenses | name, owner | live | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- TN Commerce & Insurance Verify (search.cloud.commerce.tn.gov), re-checked 2026-10-15: the search runs without a CAPTCHA (its search configuration's reCaptcha is null) and is used above; it publishes no qualifying agents or owners on an organization's license, and no disciplinary history
- TN Secretary of State business search (tnbear.tn.gov): connection timed out from our server on 2026-10-15; retried 2026-10-15 06:56 and 06:58 UTC from tower1 and vb11: TCP connect still times out (robots.txt unreachable too)
- TN Secretary of State business entity search (tncab.tnsos.gov, the newer TNCaB system): the search page runs reCAPTCHA and Cloudflare Turnstile
- TDEC asbestos and lead-based paint accreditations (dataviewers app 35001): searchable only through form posts, no list download found

### TX

Checked live: never (no pack). No statewide GC license: Texas does not license general contractors statewide; trades (electrical, A/C, plumbing and others) are licensed separately and are searched above

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Texas State Board of Plumbing Examiners licensees ([page](https://tsbpe.texas.gov/free-licensee-list/)) | tsbpe.texas.gov | bulk file `tx-tsbpe` (official download, indexed) | licenses | name | every 24h, floor 60000 | none | allowed |
| Arlington (TX) registered contractors (city/county) ([page](https://www.arcgis.com/home/item.html?id=5fd231ff8afa49b9809552337697ded3)) | www.arcgis.com | bulk file `tx-arlington-contractors` (official download, indexed) | licenses | name | every 168h, floor 2700 | none | allowed |
| Texas TDLR licenses (electrical, A/C, appliance, elevator, well) ([page](https://data.texas.gov/d/7358-krk7)) | data.texas.gov | Socrata SODA API, live per report | licenses | name, owner, license, phone, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Austin right-of-way contractor licenses ([page](https://data.austintexas.gov/d/8d92-wsiw)) | data.austintexas.gov | Socrata SODA API, live per report | licenses | name, license | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Texas Comptroller franchise-tax status | - | live search per report | business_status (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |
| TCEQ administrative orders | - | live search per report | environmental (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |
| TCEQ civil judgments | - | live search per report | environmental (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |
| TCEQ notices of enforcement | - | live search per report | environmental (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |
| TCEQ notices of violation | - | live search per report | environmental (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |
| TCEQ environmental complaints | - | live search per report | environmental (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |
| Texas TDLR administrative orders | - | live search per report | discipline (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

### UT

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Utah DOPL Construction Business Registry (active, opted-in licensees only) ([page](https://services.commerce.utah.gov/cbr/)) | services.commerce.utah.gov | the agency's own lookup (page or API), live per report | licenses | name, owner, license | live | none | allowed |
| Utah DOPL agency and disciplinary actions | - | live search per report | discipline (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |

Looked at and not used (from the pack's `blocked` notes):

- DOPL license verification (secure.utah.gov/llv): the search form requires a Google reCAPTCHA
- DOPL licensee lists (secure.utah.gov/datarequest): paid subscription service
- Utah Division of Corporations business search (businessregistration.utah.gov): Cloudflare JS challenge on every path

### VT

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Vermont Office of Professional Regulation rosters (residential contractors, architects, engineers, surveyors, well drillers) ([page](https://sos.vermont.gov/opr/find-a-professional/)) | sos.vermont.gov | bulk file `vt-opr-rosters` (official download, indexed) | licenses | name | every 168h, floor 14000 | none | allowed |
| Vermont Division of Fire Safety trade licenses ([page](https://data.vermont.gov/d/cy8e-89cz)) | data.vermont.gov | Socrata SODA API, live per report | licenses | owner, license, address | live | SOCRATA_APP_TOKEN (optional), CHROMIUM_PATH (headless browser) | allowed; allowed |

Looked at and not used (from the pack's `blocked` notes):

- Secretary of State business search (bizfilings.vermont.gov): an Angular app over api.bizfilings.vermont.gov; not built yet (the path tried led to the account login)
- OPR conduct decisions (Zoho Creator search) and monthly discipline reports (PDF): almost all are against individual licensees, which reports don't search for enforcement (companies only)

### VA

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Virginia DPOR Board for Contractors licenses (contractors and tradesmen) ([page](https://www.dpor.virginia.gov/RegulantLists)) | www.dpor.virginia.gov | bulk file `va-dpor-contractors` (official download, indexed) | licenses | name | every 24h, floor 60000 | none | allowed |
| Virginia DPOR architects, engineers, land surveyors and landscape architects ([page](https://www.dpor.virginia.gov/RegulantLists)) | www.dpor.virginia.gov | bulk file `va-dpor-apelscidla` (official download, indexed) | licenses | name | every 168h, floor 32000 | none | allowed |
| Virginia DPOR asbestos and lead abatement contractors, home inspectors ([page](https://www.dpor.virginia.gov/RegulantLists)) | www.dpor.virginia.gov | bulk file `va-dpor-alhi` (official download, indexed) | licenses | name | every 168h, floor 800 | none | allowed |
| Norfolk business licenses (construction) (city/county) ([page](https://data.norfolk.gov/d/dpi6-sct5)) | data.norfolk.gov | bulk file `va-norfolk-contractors` (official download, indexed) | licenses | name | every 168h, floor 1100 | SOCRATA_APP_TOKEN (optional) | allowed |

Looked at and not used (from the pack's `blocked` notes):

- DPOR License Lookup (dporweb.dpor.virginia.gov/LicenseLookup), which also carries board orders: reCAPTCHA on the search
- DPOR disciplinary orders: no list or download; published only per licensee in the CAPTCHA lookup and in board minutes on Town Hall (PDF)
- eVA Inactive Vendor List (DGS debarred/enjoined contractors, logi.cgieva.com Report9020): robots.txt Disallow: /
- SCC business entities on data.virginia.gov (corporation, llc-limited-liability-company): robots.txt disallows /api/ and /datastore/* (checked 2026-10-15), so the datastore search is not used; the datasets' .xlsx downloads are allowed but not loaded yet
- SCC Clerk's Information System bulk data: paid subscription ($1,000/month per the SCC page); only the dated open-data copies are used
- data.virginia.gov SCC Lien Details: no debtor names, only filing numbers

### WA

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Washington L&I debarred contractors (public works) ([page](https://secure.lni.wa.gov/debarandstrike/ContractorDebarList.aspx)) | secure.lni.wa.gov | bulk file `wa-lni-debarred` (official download, indexed) | debarment (companies only) | name | every 24h, floor 450 | none | allowed |
| Washington L&I contractor strikes ([page](https://secure.lni.wa.gov/debarandstrike/ContractorStrikeList.aspx)) | secure.lni.wa.gov | bulk file `wa-lni-strikes` (official download, indexed) | other (companies only) | name | every 24h, floor 13500 | none | allowed |
| Seattle business license tax certificates (construction) (city/county) ([page](https://cos-data.seattle.gov/d/wnbq-64tb)) | cos-data.seattle.gov | bulk file `wa-seattle-construction-businesses` (official download, indexed) | licenses | name | every 24h, floor 6400 | SOCRATA_APP_TOKEN (optional) | allowed |
| Washington L&I contractor licenses ([page](https://data.wa.gov/d/m8qx-ubtq)) | data.wa.gov | Socrata SODA API, live per report | licenses | name, owner, license, phone, address | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |
| Washington L&I tradesperson certificates (Verify) ([page](https://secure.lni.wa.gov/verify/)) | secure.lni.wa.gov | the agency's own lookup (page or API), live per report | licenses | owner, license | live | none | allowed |
| Washington L&I Verify (infractions, bond lawsuits, tax warrants, suspensions) | - | live search per report | courts (companies only) | name | live | none | checked at run time (its URL lives in the search code, not the registry) |
| Washington Attorney General consumer complaints ([page](https://data.wa.gov/d/gpri-47xz)) | data.wa.gov | Socrata SODA API, live per report | complaints (companies only) | name | live | SOCRATA_APP_TOKEN (optional) | allowed; allowed |

Looked at and not used (from the pack's `blocked` notes):

- L&I Verify 'Download all debarment data' (DownloadData.aspx) answers HTTP 500 to a plain request; the same list is read page by page from the list's own JSON endpoint instead

### WV

Checked live: 2026-10-15.

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| WV Employer Violator System (workers' comp default) ([page](https://www.wvinsurance.gov/EVS)) | www.wvinsurance.gov | bulk file `wv-oic-evs` (official download, indexed) | debarment (companies only) | name | every 168h, floor 1500, row_shape 1 | none | allowed |
| WV State Fire Marshal electrician licenses ([page](https://sfm-permit-public.wvoasis.gov/publicdata/LicenseeSearch)) | sfm-permit-public.wvoasis.gov | the agency's own lookup (page or API), live per report | licenses | owner, license | live | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- WV Contractor Licensing Board license search and board actions (wvclboard.wv.gov/verify, linked as "Contractor License Search" from labor.wv.gov/database-search; /about/actions.asp): robots.txt "User-agent: * / Disallow: /" (re-checked 2026-10-15; http:// and www. redirect to the same file)
- WV Division of Labor certified plumbers, HVAC technicians, manufactured-housing licensees, elevator and amusement-ride inspectors and registered service companies (www.wvlabor.com/new_searches/*.cfm, linked from labor.wv.gov/database-search): robots.txt answers HTTP 500 (2026-10-15), read as a refusal of the host (RFC 9309); https:// does not connect
- WV Purchasing Division debarred vendors (purchasing.wv.gov, and the same list on the Division's legacy host www.state.wv.us/admin/purchase/debar.html; was wv-purchasing-debarred): purchasing.wv.gov's robots.txt is "User-Agent: * / Disallow: /", and reading the same list from the legacy host would be a side door around that refusal (coordinator's decision, 2026-10-15)
- WV Secretary of State business search (apps.sos.wv.gov/business/corporations): the form carries bot-trap fields, treated as an anti-bot measure; bulk data is a paid subscription

### WI

Checked live: 2026-10-15.

No source is searched for this state yet.

Looked at and not used (from the pack's `blocked` notes):

- Wisconsin DNR drilling and pump-installing service directories (dnr.wisconsin.gov/topic/Wells/Contacts.html, .xlsx; was wi-dnr-wells): not used, because DNR's Acceptable Use Policy (dnr.wisconsin.gov/legal/acceptableuse, read 2026-10-15) says "The material is for the noncommercial use of the general public. The fair use guidelines of the U.S. copyright statutes apply to all material on the Department of Natural Resources webpages and linked agency webpages. ... For copy or use of information on the department website that is outside of the fair use provisions of copyright law, please seek permission from the individual listed as responsible for the page"
- Wisconsin DHS certified lead and asbestos companies (www.dhs.wisconsin.gov/lead/hire-a-contractor.htm and /asbestos/contractors.htm, .xlsx; was wi-dhs-abatement): not used, because those pages' Policies link is the Wisconsin.gov Legal/Acceptable Use page (www.wisconsin.gov/Pages/Policies.aspx, read 2026-10-15), which says "The material is for the noncommercial use of the general public. The fair use guidelines of the U.S. copyright statutes apply to all material on the Wisconsin.gov and linked agency Webpages. ... For copy or use of information on the State of Wisconsin website that is outside of the fair use provisions of copyright law, please seek permission from the individual listed as responsible for the page"
- WisDOT debarred, suspended and ineligible contractors (wisconsindot.gov/hccidocs/debar.pdf) and the WI DOA debarment list: not used, because WisDOT's Acceptable Use Policy (wisconsindot.gov/Pages/global-footer/Acceptable-use-policy.aspx, read 2026-10-15) says "This website, and the pages and material available on it, are for the noncommercial use of the general public", and DOA's pages carry the Wisconsin.gov terms quoted above
- DSPS credential lookup (license.wi.gov, the LicensE platform): Cloudflare blocks our bot ("Sorry, you have been blocked"); dwelling contractors, qualifiers, plumbers, electricians and HVAC are not searchable
- DSPS old lookup and Reports of Decisions (online.drl.wi.gov): 403 with a CAPTCHA page
- DSPS Credential/License List Purchasing (dspslicenselist.wi.gov): a paid list service, and the host does not resolve from here
- Department of Revenue delinquent taxpayer list: its data service (ww2.revenue.wi.gov) has robots.txt Disallow: /
- DWD worker-misclassification stop-work orders: no published list found

### WY

Checked live: 2026-10-15. No statewide GC license: Wyoming does not license general contractors statewide (cities and counties license them, where they do); the state licenses electrical work, which is searched above

| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |
|---|---|---|---|---|---|---|---|
| Wyoming Fire Prevention & Electrical Safety licenses ([page](https://wyelectrician.imagetrendlicense.com/lms/public/portal#/lookup)) | wyelectrician.imagetrendlicense.com | the agency's own lookup (page or API), live per report | licenses | name, owner, license | live | none | allowed |

Looked at and not used (from the pack's `blocked` notes):

- Secretary of State business search (wyobiz.wyo.gov): a JavaScript bot challenge on every page
- Electrical licensing complaints: hidden by the portal (hide_complaints)

### City and county sources looked at and not used

- Pittsburgh PLI licensed contractors and trade licenses, Allegheny County registered master plumbers (data.wprdc.org): robots.txt disallows /datastore/dump/ and /api/ for every agent
- Henderson NV business licenses (maps.cityofhenderson.com OpenDataGovernment/0): a 2022 snapshot, every contractor license expired in 2023
- Howard County MD electric and utility trade licenses (opendata.howardcountymd.gov qa5k-m2n2): license numbers only, no names
- Dallas active contractors (dallasopendata.com jhgk-eg9m): last updated 2017-03-31
- Denver business licenses (data.colorado.gov s9wt-dsfz, ArcGIS ODC_active_business_licenses): no contractor license types; Denver's contractor licenses are not published
- Detroit BSEED business licenses (current): no contractor license types
- Cincinnati business licenses (data.cincinnati-oh.gov 7dk3-gngs): no contractor license types
- St. Louis business licenses 2024 (ArcGIS Business_License_2024): no business type to keep construction to
- Atlanta business licenses (ArcGIS GBL_WFL1): last updated 2023-04-24; the 2026 layer covers Main Street districts only
- San Diego County building permits - contractors (data.sandiegocounty.gov 76h4-nnmj): contractors on permits, not a license list (CSLB numbers already searched statewide)
- New York City stop-work orders: DOB publishes them only on complaint dispositions by property, never naming the contractor
- Chicago contractor violations: no dataset names contractors (Building Violations are by property); Chicago general-contractor and trade licenses are not on the portal

<!-- END GENERATED -->
