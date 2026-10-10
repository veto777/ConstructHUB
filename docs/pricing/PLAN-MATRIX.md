# Plan matrix

_generated from `shared/plan-matrix.ts` on 2026-10-10 — do not edit by hand. Regenerate with `npm run pricing:matrix` after any price-book change (shared/plans.ts, shared/crm-plans.ts). See docs/pricing/README.md._

Money is in US dollars. Yearly platform billing is 11× the monthly price (1 month free); CRM yearly prices are their own. "🕒 Coming" marks a row or module that is promised on the plan but not live yet (shared/plans.ts `COMING_MODULES`). ⭐ = the hero plan. There is no per-location pricing and no extra-location add-on: outgrow a plan and you move up.

## Business Tools (the ConstructHUB platform)

| Feature | **Solo**<br>$29/mo · $319/yr<br><sup>One Google profile, managed and protected.</sup> | **Team**<br>$49/mo · $539/yr<br><sup>Up to 10 locations and a small crew.</sup> | **Pro**<br>$99/mo · $1,089/yr<br><sup>Every premium tool, for up to 25 locations.</sup> | **Agency**<br>$199/mo · $2,189/yr<br><sup>Client workspaces for up to 100 locations.</sup> | **Unlimited** ⭐<br>$449/mo · $4,939/yr<br><sup>No caps. The only unlimited plan on the market.</sup> |
| --- | --- | --- | --- | --- | --- |
| **Locations & people** |  |  |  |  |  |
| Google Business Profile locations | 1 | 10 | 25 | 100 | 🟣 Unlimited |
| Team seats | 1 | 3 | 5 | 10 | 🟣 Unlimited |
| Client workspaces, roles, bulk actions, email onboarding | ❌ | ❌ | ❌ | 10 | 🟣 Unlimited |
| **Google Business Profile & reviews** |  |  |  |  |  |
| Profile Guard check cadence | Every 60 min | Every 30 min | Every 15 min | Every 15 min | Every 5 min |
| Review alerts + AI reply drafts | ✅ | ✅ | ✅ | ✅ | ✅ |
| AI review replies publish automatically | ❌ | ❌ | ✅ | ✅ | ✅ |
| AI posts and photo captions on a schedule | ❌ | ❌ | ✅ | ✅ | ✅ |
| Review reply templates | 5 | 20 | 20 | 50 | 🟣 Unlimited |
| Review reminders to customers (email; text coming soon) | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Permits & property** |  |  |  |  |  |
| Permit searches / month | 10 | 50 | 100 | 200 | 🟣 Unlimited |
| Permit alerts for new filings in a territory | ❌ | ❌ | ❌ | 🕒 Coming | 🕒 Coming |
| Property records lookup | ❌ | ❌ | ✅ | ✅ | ✅ |
| **Websites & scans** |  |  |  |  |  |
| Click Guard + IP Tracker + VPN Shield sites | 1 | 3 | 10 | 25 | 🟣 Unlimited |
| Site Scans / month | 2 | 5 | 15 | 50 | 🟣 Unlimited |
| Grid scans / month<br><sup>Grid scans are metered in credits — larger grids use more than one credit (7x7 = 2, 9x9 = 4).</sup> | 3 | 10 | 20 | 40 | 150 |
| Competitor Intel scans / month | 1 | 5 | 10 | 20 | 50 |
| **Texting** |  |  |  |  |  |
| Team text alert segments / month | 200 | 500 | 1,000 | 2,000 | 5,000 |
| Client-texting number on our carrier | Add-on $29 | Add-on $29 | Add-on $29 | 1 included | 2 included |
| **Growth tools** |  |  |  |  |  |
| Google Ads and LSA manager, IP exclusions | ❌ | ❌ | ✅ | ✅ | ✅ |
| Cloudflare, Search Console, Domains, Gmail forwarding | ❌ | ❌ | ✅ | ✅ | ✅ |
| YouTube & social publishing | ❌ | ❌ | ✅ | ✅ | ✅ |
| Public API (units / month) | ❌ | ❌ | 50,000 | 250,000 | 🟣 Unlimited |
| CSV export of every report | ❌ | ❌ | 🕒 Coming | 🕒 Coming | 🕒 Coming |
| Scan & ranking history 🕒<br><sup>Retention is not enforced yet — nothing is deleted today.</sup> | 90 days | 90 days | 12 months | 🟣 Unlimited | 🟣 Unlimited |
| Scheduled client email reports | ❌ | ❌ | ❌ | ✅ | ✅ |
| SEO suite: rank tracker, explorer, keywords, backlinks | Add-on from $29 | Add-on from $29 | Add-on from $29 | 250 keywords + $10 data/mo | 5,000 keywords + $60 data/mo |
| Weekly scheduled grid watches | ❌ | ❌ | ❌ | ✅ | ✅ |
| White-label reports | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Hub & extras** |  |  |  |  |  |
| Gabe questions / month | 100 | 300 | 1,000 | 3,000 | 🟣 Unlimited |
| Master Class course ($2,499) | ❌ | ❌ | ❌ | ❌ | ✅ |
| GBP reinstatement help / project | $599 | $599 | $599 | $599 | $299.50 — half price |
| Two seats on every new product we launch | ❌ | ❌ | ❌ | ❌ | 2 seats (Call Assistant minutes excluded) |
| Support | Email support | Email support | Priority email support | Priority support with a phone callback | Named support contact, onboarding call, first access to new features |

## CRM (Customer Relations Management) — a separate product

| Feature | **CRM Basic**<br>$49/mo · $539/yr<br><sup>One person, running jobs end to end.</sup> | **CRM Essentials**<br>$99/mo · $1,089/yr<br><sup>A crew — scheduling, texting and job costing.</sup> | **CRM Max**<br>$199/mo · $2,189/yr<br><sup>A full office — more seats, a number included.</sup> | **CRM Elite** ⭐<br>$499/mo · $5,489/yr<br><sup>A large operation — up to 35 seats, 3 numbers, 1 TB of JobCam.</sup> |
| --- | --- | --- | --- | --- |
| Team seats | 1 | 5 | 8 | 35 |
| Clients & jobs | 🟣 Unlimited | 🟣 Unlimited | 🟣 Unlimited | 🟣 Unlimited |
| Estimates & invoices / month<br><sup>Online card and ACH payments on every plan.</sup> | 🟣 Unlimited | 🟣 Unlimited | 🟣 Unlimited | 🟣 Unlimited |
| Scheduling & dispatch calendar | ✅ | ✅ | ✅ | ✅ |
| Client portal | ✅ | ✅ | ✅ | ✅ |
| Change orders + job costing | ❌ | ✅ | ✅ | ✅ |
| Team text alert segments / month | ❌ | 500 | 1,500 | 5,000 |
| Client texting | ❌ | The texting add-on | 1 number included | 3 numbers included |
| JobCam — job photos & video | Add-on $39 | Add-on $39 | ✅ | ✅ |
| CRM API units / month | ❌ | 10,000 | 50,000 | 250,000 |
| Support | Email support | Priority email support | Priority support + onboarding call | Priority support + onboarding call |
| Free trial | 7 days | 7 days | 7 days | 7 days |

## Add-ons

- **Extra team seat** — $15/mo or $165/yr — on: Team, Pro, Agency
- **Extra protected website** — $39/mo or $429/yr — on: Solo, Team, Pro, Agency
- **Client texting number** — $29/mo or $319/yr + $29 setup — on: Solo, Team, Pro, Agency, Unlimited
- **Competitor scan pack** — $19/mo or $209/yr — on: Solo, Team, Pro, Agency, Unlimited
- **Grid scan pack** — $10/mo or $110/yr — on: Solo, Team, Pro, Agency, Unlimited
- **SEO suite — 1,000 keywords** — $29/mo or $319/yr — on: Solo, Team, Pro, Agency
- **SEO suite — 5,000 keywords** — $79/mo or $869/yr — on: Solo, Team, Pro, Agency
- **Extra CRM seat** — $17/mo or $170/yr — on: CRM plans (self-serve up to 50)
- **JobCam** — $39/mo or $468/yr — on: CRM Basic, CRM Essentials
- **AI Call Assistant — 500 minutes** — $249/mo or $2,739/yr — the AI Call Assistant's own subscription (not a platform add-on)
- **AI Call Assistant — 1,000 minutes** — $349/mo or $3,839/yr — the AI Call Assistant's own subscription (not a platform add-on)
- **AI Call Assistant — 2,000 minutes** — $449/mo or $4,939/yr — the AI Call Assistant's own subscription (not a platform add-on)
- **AI Call Assistant — 5,000 minutes** — $999/mo or $10,989/yr — the AI Call Assistant's own subscription (not a platform add-on)
