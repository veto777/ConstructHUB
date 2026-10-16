# Backlinks database — prototype (2026-10-13)

Owner plan: build a database of places a contractor's site can earn a link from, automatically; once it holds
**5,000 quality sources (goal 10,000)**, sell link packages as an add-on. Admin-only today: `/admin/backlinks`.

## Pipeline (server/backlinks)

| Step | What happens | Cost |
| --- | --- | --- |
| Search (`discover.ts`) | 440 Google searches from a bank of footprints ("roofing \"write for us\"", "Texas business directory \"add your business\"", …) × 22 trades × 50 states. One result per domain; platforms and .gov excluded. | ~$0.02 per search (DataForSEO live, 100 results) — about $9 for the whole bank |
| Import | An admin pastes domains/URLs (vendor lists, own finds). Same vetting — nothing is trusted unread. | free |
| Vet (`vet.ts`) | Our crawler (Site Scan's SSRF-safe fetcher) reads the found page + home page: content, language, topic fit, "write for us"/"submit press release"/"add your business" signs, published emails, link attributes, spam and PBN footprints, parked domains. Grade 0–100 → tier A/B/C/X with every reason saved. A site that blocks robots is *unconfirmed* (C), not rejected. | free |
| Measure (`metrics.ts`) | Domain rank, spam score, referring domains in bulk (1,000 per batch) → re-grade. Without it the tier is capped at B. | ~$0.18 per 1,000 |
| Draft (`outreach.ts`) | A fixed-template pitch per quality guest-post / resource / editorial / press-release source that publishes an email. | free |
| Send | Only after an admin approves, only from a separate outreach mailbox (never @constructhub.us), with a postal address + opt-out (CAN-SPAM), a daily cap and a suppression list. | — |

Quality = tier A or B and not a PBN. PBNs are detected and **blocked**: they are never counted or sold (Google spam
policy — they put the customer's site at risk). Paid placements are pitched as `rel="sponsored"`.

## Switches (server env)

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | — | search + authority data (already used by the SEO toolset) |
| `BACKLINKS_WORKER_ENABLED` | off | run the pipeline every minute |
| `BACKLINKS_MONTHLY_BUDGET_USD` | 25 | spend cap for searches + authority |
| `BACKLINKS_QUERIES_PER_DAY` | 40 | searches per day |
| `BACKLINKS_OUTREACH_SEND` | off | allow sending approved pitches |
| `BACKLINKS_SMTP_USER` / `_PASS` / `_HOST` | — / — / smtp.gmail.com | outreach mailbox on a separate domain |
| `BACKLINKS_SENDER_NAME` / `BACKLINKS_SENDER_ADDRESS` | ConstructHUB Partnerships / — | signature and the CAN-SPAM postal address |
| `BACKLINKS_OUTREACH_DAILY` | 30 | emails per day |

## Search families (2026-10-16)

Every query carries its template (`backlink_queries.template`). A family gets 5 trial searches; after that families
run best-first by quality sources found per search, and a family under 0.5 per search is paused
(`FAMILY_TRIAL` / `FAMILY_MIN_YIELD` in `server/backlinks/store.ts`). `GET /api/admin/backlinks/families` lists them.
Measured before the change: chamber/association member directories 3.7 quality per search (368 in 100), "add your
business" 2.8, "write for us" 2.0; "useful links" 0.14, news tips 0.2, "contribute an article" 0.1. City chamber,
city HBA, state builders-exchange, NARI and HBA families were added (+807 queries) because those families lead.

A chamber or association that arrives on its home page (expansion, imports) is graded on its own Business/Member
Directory link, read and confirmed as a directory page (third request). Before this, expansion's 2,943 candidates
graded 1% quality; 4,687 directory/citation rejections were re-queued. `.us` locality government hosts
(`*.state.XX.us`, `ci.`, `co.`, `k12.`…) are excluded like `.gov` (catalogue licence lookups keep their place).

## Not built yet

1. Reply handling (read the outreach inbox, mark replied/opted-out, capture price and terms).
2. Form submissions for directories and citations (they have no email; each needs the business's NAP).
3. Journalist requests (parse source-request digests, match to customers, customer approves the quote).
4. More discovery: competitors' backlinks (who links to the top-ranked contractors in each market), expanding from
   each quality site's neighbours.
5. Customer side: packages, checkout, order → placement → live-link check and report.
