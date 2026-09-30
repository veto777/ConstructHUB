# Google Ads + LSA protection & optimization playbook (generalized from the owner's own accounts, 2026-09-30)

Source: a read-only review of how the owner set up and optimized their own contractor accounts (Search Ads +
Local Services Ads under a manager/MCC). Account IDs, credentials and project paths are intentionally omitted;
this is the reusable method ConstructHUB applies to client accounts.

## 1. Access (manager / MCC)
- Manager sends the link invite: `customerClientLinks:mutate` status PENDING, `login-customer-id` = manager.
  If the connected login already administers the client, auto-accept with `customerManagerLinks:mutate` → ACTIVE
  (`login-customer-id` = client). Otherwise the client accepts in Google Ads (Admin → Access and security →
  Managers). Manager links are always admin-equivalent — tell the client that.
- LSA accounts are often NOT under the MCC: discover with `listAccessibleCustomers` and query each LSA account
  with itself as `login-customer-id`. A wrong `login-customer-id` = 403 everywhere.
- Fail-closed allowlist of account IDs per client, so one login seeing many businesses can never cross-post
  leads, exclusions or disputes between clients.
- OAuth consent must be "In production" (testing tokens expire); refresh token stored encrypted per agency.

## 2. Click-fraud protection ("blockers")
Ads-only landing door per client (noindex, canonical → home):
1. Edge (Cloudflare): require a click ID (gclid/gbraid/wbraid) + non-empty UA on the ads path; block non-Google
   verified bots, bot UAs, non-GET/HEAD; rate-limit 10 req/10 s; security level High; pass ASN + verified-bot
   headers to origin; exempt office IPs.
2. Origin decision order: Google crawlers only after reverse+forward DNS; require click ID + campaign key `k=`
   (carried in the final-URL suffix); refuse bot UAs; refuse non-US (or outside service country); refuse
   datacenter/VPN (range lists refreshed 12 h, hosting ASNs, IP intel, optional fraud score ≥ 85); one click per
   IP per 90 days (second distinct click ID = repeat).
3. Push every served visitor and every refused bot/proxy/foreign IP as a campaign IP exclusion (IPv4 /32,
   IPv6 /64) on every enabled Search campaign. Google cap 500 per campaign → rotate oldest one-time VISITOR
   entries FIFO; never rotate bot/proxy entries. Single push queue; retry on concurrent modification; parse
   partial-failure bodies (a 2xx can hide failed operations); retry failed pushes every 15 min.
4. Range escalation: 2 distinct IPs in one /24 (IPv6 /48) → exclude the whole block, free the singles.
5. Human verification on the door: invisible Turnstile, browser probe (timezone/language/webdriver), input
   counters; zero input ≥ 10 s or foreign timezone → bot → excluded.
6. Site-wide bot guard: bad UAs and floods (> 120 req/10 s) auto-blocked and pushed as exclusions; manual
   block/unblock; production-only; crawlers and private IPs always allowed. Office IPs never excluded.
7. Country exclusion suggestion when ≥ 5 blocked IPs come from one country → negative LOCATION criterion on all
   Search campaigns; the service country can never be blocked.

## 3. Keywords
- Exact-match keyword sets per service × service-area geo variants; remove PHRASE/BROAD positives (paced
  batches). Campaign-level phrase negatives in groups: repairs (if not offered), DIY, suppliers, other brands,
  jobs/careers, wrong property type, research, low value, out of area. Build from the 90-day search-terms report:
  ADD (exact, tiered) / NEGATIVES / PAUSE-REMOVE. Dry-run by default, apply with confirmation.

## 4. Campaign hygiene (re-enforced 4×/day)
- Search partners OFF, Display OFF; Dynamic Search Ads ad groups paused (second way onto the site).
- Every ad's final URL = the ads door; mobile URLs and tracking templates cleared; final-URL suffix carries the
  key + ValueTrack params.
- Remove URL-bearing assets at account/campaign/ad-group level (sitelinks, promotions, prices, lead forms, apps,
  locations) so every click goes through the door; keep only the one allowed call asset.

## 5. Conversion tracking
- Capture gclid/gbraid/wbraid into lead records; flag ad leads in notifications.
- Webpage conversions: "door visit (verified browser)" secondary (fires only after verification + real input),
  "door lead (form submitted)" primary. Offline click upload only where Google still permits it.
- Phone-first sticky call bar + 3-field form on the door.

## 6. LSA
- Pull leads every 2 min; per-lead cost = LSA daily spend spread over that day's charged leads
  (`cost_micros` is not allowed on local_services_lead).
- Disputes via `provideLeadFeedback` with the 6 valid reasons only, charged leads only, reason always chosen by
  the owner; batches spaced 30–60 s; schedulable; atomic duplicate guard.
- Offered services list maintained per client (API doesn't expose toggles) → leads for other services flagged
  "disputable" (JOB_TYPE_MISMATCH).
- New-lead alert (Telegram/email) with a one-tap "Report bad lead".

## 7. Reporting
- Ads dashboard: hits, verdicts, exclusions, last audit, edge refusals; leads per day; clicks/impressions/cost.

## 8. Not captured in the source (must be set per client, manually or via new tooling)
Positive geo targeting/radius, ad schedule, device modifiers, budgets, bid strategy, LSA budget/service areas/
hours.

## 9. Schedules
Hygiene + exclusion reconcile 4×/day; offline upload hourly (where allowed); LSA sync 2 min; dispute promoter
60 s; IP lists 12 h; ban refresh 5 min; failed-exclusion retry 15 min.
