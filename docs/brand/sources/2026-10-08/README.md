# Competitor pricing pages as read on 2026-10-08 (UTC 04:08–04:12)

The text of each company's own public pricing page, saved the day the comparison films were scripted,
so every figure on a card can be traced. Read **directly** (no summariser): Housecall Pro and Leap with
`curl`; Jobber's page sits behind a browser check, so it was opened in a headless Chromium and its
rendered text saved. These files are evidence for `docs/brand/VIDEO-SCRIPTS.md` — not for publishing.
Re-read all three pages on the day a film is released, and every 90 days while it is up.

| File | Page | How it was read | sha256 of the HTML as received |
| --- | --- | --- | --- |
| housecallpro-pricing.txt | https://www.housecallpro.com/pricing/ | curl, HTTP 200, tags stripped | edacfcae5f5b08e30b3de31efe1b0e0e691150778371e4c176e99798e28a31f1 |
| leap-pricing.txt | https://leaptodigital.com/pricing/ | curl, HTTP 200, tags stripped | f28bebd0ee26cafe94cdfdae151dff09b4b9c7d80c2fd0527a33ec2d577a33a8 |
| jobber-pricing.txt | https://www.getjobber.com/pricing/ | headless Chromium (curl is refused, HTTP 403), page text, team size "Just me" | d6762077ae1a30c7f188a1228f7cc1c2a24c799ab887b361d3ae25d2308c8bfc |

## Jobber, by team size (the page's "Team size" control, clicked in the same session)

Monthly list price ("$N/mo"), then the price shown under "Billed annually".

| Team size | Connect | Grow | Plus | Core |
| --- | --- | --- | --- | --- |
| Just me (1 user) | $139 / $99 | $199 / $149 | not shown | $49 / $29 |
| 2-5 people ("Includes 5 users") | $199 / $149 | $299 / $229 | $499 / $399 | not offered |
| 6-10 people ("Includes 10 users") | $299 / $229 | $399 / $299 | $599 / $449 | not offered |
| 11-15 people ("Includes 15 users") | $399 / $299 | $499 / $399 | $699 / $529 | not offered |

Add-ons on the same page: Marketing Suite $99/mo · Receptionist $29/mo · (Sales) Pipeline $49/mo.

## What was read off each page

- **Housecall Pro:** Basic $79/mo (or $59/mo billed annually), "1 user included" · Essentials $189/mo
  ($149), "5 users included" · Max $329/mo ($299), "8 users included", "*$35/mo per additional user".
  An introductory offer was showing ("$26 /mo for 1 month"; Max "$99 /mo for 3 months") — not used.
- **Leap:** Leap CRM Essential "$79 /month", "Single-User Only", "Limit 1 User Per Account" · Team "$298
  /month", "Includes First User and $99 per/mo per add. user" · SalesPro Premium "$750 /month",
  "Includes 6 Users".
- **None of the three pricing pages contains the word "permit"** (`grep -ci permit` = 0 on each file).
  That is a statement about these pages on this day, not about the products.
