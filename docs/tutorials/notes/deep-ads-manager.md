# Deep dives — Agency Ads & LSA (slot 4, branch video/deep-ads-manager, 2026-10-13)

Done (7): `ads-manager` (page tour, 79 s), `ads-manager.every-client-in-one-list` (69 s), `ads-manager.access-requests-in-bulk` (76 s),
`ads-manager.health-audit` (71 s), `ads-manager.local-services-checks` (69 s), `ads-manager.protections-previewed` (91 s),
`ads-manager.careful-with-every-write` (74 s). One video per card; the six card entries are sections of `ads-manager`
(`shared/help/entries/google-ads/`). Nothing that writes to Google was clicked: Queue health audit, Queue protection previews,
Confirm invitations and emails, Confirm selected previews and Preview reversal are highlighted only; the IP / negative-keyword
previews opened with Review preview are the seeded ones.

Skipped: none.

What the product does that a video had to work around (not narrated):
- The page now lives inside the Google Ads tool shell: the sections are `[data-testid="subnav-ads-manager-<tab>"]` links on the left
  and each has its own route (`/ads-manager/accounts`, `/invitations`, `/previews`, `/queue`, `/audit`). The intro script's
  `button:has-text("Client accounts")` / `link-nav-agency-ads-&-lsa` selectors no longer match (intro-ads-manager.json is stale).
- The customer-ID field of "Add a Google Ads account" and the manager-ID field show `123-456-7890` / `000-000-0000` placeholders;
  the test's phone rule forbids typing a 10-digit customer ID that is not `555-01xx`-shaped, so the typed invitation lines use
  `123-555-0113` / `124-555-0114` (valid 10-digit IDs that satisfy the rule).
- Access invitations: the seeded rows carry `.example` emails (owner@mountainviewhvac.example etc.) and the raw invitation uuid is
  printed in grey under each row; both are in frame.
- Health audit "Review in Google Ads" fixes are outside links to ads.google.com (not clicked; no status bubble since
  `showLinkAddress` is off). The Queue list prints each job's uuid.
- Typing in the Health audit search box re-fetches the list; the frame right after the type shows "Loading…" unless the step holds
  (`holdMs: 1500` on the search step of local-services-checks).
- The Recommendations tab (default landing) carries the owner playbook (five Section cards) — not covered by a feature card, so
  not filmed beyond the page tour's opening frame.
- The every-client-in-one-list "Four results" highlight rings the "Page 1 · 4 results" pager text (no test id on it).

Pipeline notes:
- `vid.sh test` fails two tests that are pre-existing on this branch (reproduced with all my files removed): "Cloudflare and Search
  Console have an 'i' …" (it asserts every section with a `parent` is mounted with a HelpButton in `pages/site-connections.tsx`, which
  is only true for Cloudflare/Search Console — the Google Business sections on other branches hit this too) and "claims no video
  without a manifest …" (looks for `if (!entry.video) return null;` in `client/src/pages/tutorials.tsx`, which commit 76877166 rewrote).
  No `/listing-editor` failure here. Never touched client/ or server/.
- `vid.sh dry` only accepts a script whose file name is its helpKey, so a throwaway survey script must be named after a real key.
- Produce took 7–8 min with four producers on the box; mux waits on the encode lock.
