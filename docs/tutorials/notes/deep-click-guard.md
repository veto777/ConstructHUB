# Deep dives — Click Guard (slot 5, branch video/deep-click-guard, 2026-10-13)

Done (7): `click-guard` (page tour, 78 s), `click-guard.flags-with-a-reason` (75 s), `click-guard.one-device-many-ips` (70 s),
`click-guard.automatic-and-manual-blocks` (75 s), `click-guard.your-exclusion-rules` (87 s),
`click-guard.a-script-for-your-ads-account` (82 s), `click-guard.traffic-at-a-glance` (66 s). One video per card; no card was
merged with another. Every production passed on its first run (no drift, no re-record).

Skipped, with the exact reason:
- `ad-fraud` (/google-ad-fraud): a public opinion article, not a tool. Its "What This Page Is Based On" card names three other
  click-fraud companies and a research firm on screen, its stat tiles print "$172B", "~80%", "33-50%" and "10-25%" as claims,
  the headline calls Google's click handling a scam, and the page carries a Google Ads logo. There is no way to film it without
  other companies' names and unverifiable figures in frame, so no video.

What the product does that a video had to work around (not narrated):
- The page runs inside the Google Ads tool shell (rail + section menu). The intro script's `tab-*` triggers no longer exist;
  sections are `subnav-click-guard-<tab>` links, and `goto /google-ads/<signals|traffic|tools|settings|script>` opens a section.
- The Clicks report table is wider than the content column at 1024 px: its Status column is cut and the per-row Block button
  (Action) sits in the horizontal overflow, where a highlight gets no ring. `automatic-and-manual-blocks` clicks
  `button-subnav-toggle` first (collapses the section menu); the Action column then fits.
- Dashboard "Cost illustration" tile prints a dollar figure from an assumed cost per click ("$4.50 per click; no actual ad-cost
  data is connected"). Taken out with `removeSelectors` in the two Dashboard videos; the Threat level card then sits beside a gap.
- Dashboard "Blocked IPs" counts 5 for the 7-day range while the Blocked IPs table has 9 rows (the stat is range-bound). Not narrated.
- The Google Ads script tab prints the exclusion URL with its private key and the tracking snippet with the tracking id
  (and, in a slot, `localhost:8185`). Every script that visits the tab blurs `card-step1-tracking pre`, `card-step3-google-ads pre`
  and `text-exclusion-url` from page load; Tools blurs `card-tracking-script pre`.
- "Copy Script" / "Copy Code" raise a red "Couldn't copy … Your browser blocked clipboard access" toast in the recorder's
  browser. Those buttons are highlighted, never clicked.
- The exclusion-URL paragraph on the script tab says "You can also use this with Microsoft Ads or any other platform" — a
  product name in the product's own copy; it is in frame for one step of `a-script-for-your-ads-account` and is not narrated.
  Traffic sources lists referrer domains (google.com, m.facebook.com, bing.com, nextdoor.com, duckduckgo.com) as data; not narrated.
- The three "More about exclusions and limits" tip cards and all Domain settings beyond the threshold card live inside collapsed
  `<details>`; a `scroll-to` on a card inside one lands on whatever is above it. Click the `summary` first.
- A blocked-IP row's reason "Competitor office range (manual review)" is seed text, in frame on the Blocked IPs list; not narrated.
- Domain settings: most switches say "Saved preference only" and do not change detection; the videos only use the three
  settings that build the list (Manually exclude IPs, Whitelist IPs, Exclusion list refresh rate).

Pipeline notes:
- `server/help-registry.test.ts` ("Cloudflare and Search Console have an 'i' …") requires every entry with `parent` to be
  mounted in `client/src/pages/site-connections.tsx`. New section entries under another feature cannot satisfy it without a
  client change, which producers must not make. See the report.
- A section entry's `route` must equal its parent's (`/google-ads`), not the tab path the video opens on (test "a section
  belongs to a feature on the same page").
