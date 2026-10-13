# NAP Sync — one profile, pushed to 500–1,000 directories (plan, 2026-10-13)

Owner: "the NAP update … is important for SEO: when you change it on Google you can sync with all other directories.
We need at least 500–1,000 directories and charge clients for the amount we list. We can submit photos, NAP and
anything else that will help ranking." — "review the way Semrush does it!"

## 1. How Semrush does it (reviewed 2026-10-13)
| | Semrush Local |
|---|---|
| Plans | **Local Base $30/location/month** (GBP AI agent, audit, Map Rank Tracker 375 credits) · **Local Pro $60/location/month** adds Listing Management, Review Management, GBP optimisation, 1,225 rank-tracker credits · custom plan for 20+ locations ([pricing KB](https://www.semrush.com/kb/1611-local-toolkit-pricing-and-plans)) |
| Directories | "70+" in Local Pro; "100+ unique (global and local)" overall. US list (~70): Google, Bing, Apple, Facebook, Yelp, Foursquare, BBB, Nextdoor, YP.com, MapQuest, Citysearch, CitySquares, Dun & Bradstreet, Brownbook, Hotfrog, Insider Pages, MerchantCircle, ShowMeLocal, EZlocal, n49, Cylex, Yahoo, Brave, TomTom, HERE, Mapbox, Uber, DoorDash, TikTok, Snapchat, Alexa, Siri, **OpenAI**, … ([directory KB](https://www.semrush.com/kb/874-listing-management-citation-websites)) |
| Who delivers | Not stated by Semrush. The US list is the Yext publisher network almost name for name, and a 2023 review says it runs on Yext's Knowledge Network — **inference, unconfirmed** |
| Setup | Connect GBP (imports NAP, website, primary + secondary categories, description, hours, logo, photos) or type it in → "it will take some time to verify your information and distribute it" ([listing KB](https://www.semrush.com/kb/847-listing-management)) |
| Ongoing | One-click push of any change to every directory · Duplicates tab (find + suppress "with one click") · User-suggestions tab (approve/reject public edits) · free pre-purchase scan · logo/photos updated everywhere |
| Not public | Distribution time, what happens to listings on cancel |

What it means for us: Semrush sells **~70 directories as a $60/month/location subscription** and its value is
*control* (one source of truth, duplicates, suggestions), not raw count. To sell 500–1,000 honestly we need the same
control on the core 70 **plus** a long tail nobody else bothers with — contractor-specific sites.

## 2. What we already have (reuse, don't rebuild)
- **GBP Business Information API — approved 2026-09-23.** `server/gbp/listing-editor.ts` writes NAP, hours,
  categories, attributes, description with per-field verdicts; `server/gbp/guard.ts` (Profile Guard) detects every
  change on Google — the **trigger** for a sync.
- **Citation checklist** — `citation_campaigns` / `citations` tables + `/api/citations/campaigns*` (30 directories,
  manually verified, `nap_consistent` column). Becomes the listings ledger.
- **Backlinks database** — `directory` / `citation` kinds, our SSRF-safe crawler (Site Scan fetcher), grading, and the
  Codex/Kimi scouting + 15-minute import pipeline. The same machine finds and vets directories.
- **Agent lanes** (Codex/Kimi) for bulk research, a Stripe add-on catalogue (`server/catalog.ts`, `shared/plans.ts`),
  the Call Assistant (can catch phone-verification calls), R2 for photos.

## 3. Where 500–1,000 directories come from (honest count = live listings we can show)
| Tier | Sites | How we deliver | Count |
|---|---|---|---|
| **1. Direct APIs** | Google (have), Bing Places, Apple Business Connect, Facebook Pages (have OAuth), Foursquare Places, Yelp (claim only — no write API) | our own code, instant updates | ~6 |
| **2. Data aggregators** | Data Axle, Neustar Localeze (TransUnion), Foursquare data | a submitted record feeds hundreds of downstream sites (YP, Superpages, Citysearch, car nav, 411 sites…) over 2–8 weeks | 1 submission → 100–300 downstream (count only the ones our checker finds live) |
| **3. Distribution partner** | Yext publisher network (same ~70 as Semrush) or a white-label reseller (Uberall, Synup, Brandify) | partner API; wholesale per location | ~70 |
| **4. Contractor long tail — ours** | manufacturer dealer locators (GAF, Owens Corning, CertainTeed, James Hardie, Trane, Carrier, Lennox, Generac, Pella, Andersen…), trade associations (NARI, NAHB locals, NRCA, PHCC, ACCA…), state/city contractor & licence lookups, chambers, BBB, BuildZoom, Porch, Houzz, Angi, HomeAdvisor, Thumbtack, Nextdoor, local/state business directories, home-show directories | submission engine (§5): agents fill forms, a person approves, our crawler proves it live | 300–700 per trade + state |

Rule (CLAUDE.md): a directory counts toward what we bill **only when our checker has loaded the live listing page and
the NAP on it matches** — never "submitted", never a downstream site we merely expect.

## 4. The profile we push (one source of truth per location)
NAP exactly as on Google (name, address or **service-area only** — most contractors hide the address; directories
that require a street address get the owner's decision, never an invented one), phone (tracking numbers kept out of
citations), website + UTM, hours + holiday hours, primary/secondary categories mapped per directory, description
(short/long), services, service areas, logo, cover + project photos (owner's own, from R2/JobCam), year founded,
licence & insurance numbers (contractor trust signal), payment methods, social links, booking/quote link, review link.
Stored once (`listing_profiles`), filled from GBP on connect, edited in our listing editor.

## 5. Build plan
**Phase 0 — decisions + accounts (owner, week 0):** pick the distribution partner (Yext partner vs Uberall vs Synup —
I'll get quotes), open Data Axle + Localeze reseller accounts, approve pricing (§6).
**Phase 1 — ledger + checker (week 1–2):** `listing_profiles`, `listings` (location × directory: status queued /
submitted / needs-owner-action / live / mismatch / duplicate / suppressed, listing URL, last check, NAP diff,
evidence), `directories` catalogue (seeded from the citations checklist + the backlinks DB directory kind). NAP checker
= our crawler + normalised compare (Suite/Ste, St/Street, phone formats). Free scan for prospects: "you're on 23 of
our directories, 9 with the wrong phone" — the sales hook Semrush uses.
**Phase 2 — direct APIs (week 2–4):** Google (exists) → Bing, Apple Business Connect, Facebook, Foursquare. Profile
Guard change → sync job → each API → per-directory verdict, like the listing editor's.
**Phase 3 — partner + aggregators (week 3–6):** partner API for the ~70 network; aggregator submissions; weekly
downstream scan that discovers and counts new live listings.
**Phase 4 — submission engine for the long tail (week 4–8):** directory catalogue built by the Codex/Kimi scouts
(by trade × state), each with its form recipe; agents fill forms in a real browser; email/phone verifications go to a
per-client verification inbox / the Call Assistant; postcard ones become owner tasks; every listing ends "live" only
after the checker proves it. Re-runs push NAP changes; directories with no edit path get a documented change request.
**Phase 5 — duplicates + suggestions + reporting (week 6–8):** duplicate finder (same phone / name at another
address), suppression requests, public-edit alerts, a client report (live count, consistency score, map-rank change
via our ranking grid).

## 6. Pricing (proposal — owner to confirm)
Charge by **live, verified listings**, matching the owner's "charge clients for the amount we list":
| Package | Live listings | Setup (one-time) | Sync & monitoring |
|---|---|---|---|
| Core | Tier 1–3 (~75) | $99 | $39/location/month |
| Pro | up to 250 | $299 | $59/location/month |
| Max | up to 500 | $499 | $89/location/month |
| Max+ | 1,000 (trade + state long tail) | $899 | $129/location/month |
Undelivered listings are credited, never billed. Semrush's comparable offer is $60/location/month for ~70; our
contractor long tail is the difference. Sold on the website only — the iPhone apps sell nothing (App Store 3.1.3(f)).

## 7. Risks
Yelp/Angi/HomeAdvisor have no write APIs and fight automation (claim + owner action); aggregator latency (weeks);
phone/postcard verifications need the client; directories that demand a street address for service-area businesses;
some directories charge for listings (exclude or pass through at cost); never create a listing without the client's
signed authorisation; partner lock-in (Yext-style networks can revert listings on cancel — check terms before signing).

## 8. Next actions
1. Owner: approve §6 and pick the partner shortlist. 2. Me: get partner/aggregator quotes and terms (incl. cancel
behaviour). 3. Start Phase 1 + point two Codex scout lanes at "contractor directories by trade × state" now (feeds §3
tier 4).
