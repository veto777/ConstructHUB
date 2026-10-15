# Deep dives — Google Business Profile (gbp), producer notes (slot 1, branch video/deep-gbp, 2026-10-13)

Feature page `shared/feature-pages/gbp.ts`, parent entry `locations` (group "Google Business", route /locations).
Sample data: Summit Roofing Co. (Denver, location 910001; Aurora 910002, Lakewood 910003) plus the seven agency
client listings of "Rivera Growth Partners" (20-reviews.sql). Two Google accounts in the slot:
`sam@summitroofing.example` (Connected) and `sam@riveragrowth.example` (Reconnect needed).

Done (10): `locations` (page tour), `google-profile`, and the eight card sections of `locations`:
`locations.google-performance-kept`, `locations.profile-details-at-a-glance`, `locations.services-and-categories`,
`locations.photos-and-videos`, `locations.citation-checklist`, `locations.profile-guard-built-in`,
`locations.several-google-accounts`, `locations.bulk-tools-on-agency`.
Entries: `shared/help/entries/google-business/<key>.ts` (one file each, `parent: "locations"`).

Skipped: none.

Where a video opens: a `goto` with `?location=910001&tab=<tab>` opens a location straight on its tab (the tab is a URL
param); the intro's `link-nav-locations` no longer exists — the Google Business tool shell has its own rail, the
menu entry is `[data-testid="tool-rail-locations"]` (`tool-rail-agency` for Agency). The Google Profile sidebar
entry only exists on the home page (`/`): `link-nav-group-google-business` opens the group, then
`link-nav-google-profile`; with several locations it lands on /locations (the list).

What the product does that a video had to work around (not narrated):
- Insights (`table-performance`) does not fit a 1024-px window even with the sub-menu collapsed: the Date column
  wraps "2026-10-09" one piece per line, the "not final yet" pill wraps one letter per line, and the Directions
  column is clipped at the right edge ("Dir"). The table is not a scroll container, so nothing can bring the
  column in. The video collapses the sub-menu (`button-subnav-toggle`, a real click) and rings the Total row and
  the whole "not final yet" row rather than the pill; the narration names website clicks and call clicks only.
- Citations table has the same width problem with the sub-menu open (the Site column stacks letters vertically);
  with the sub-menu collapsed it is readable, but "Search" still wraps as "Sear ch". The video collapses the
  sub-menu first.
- Photos & Videos on 910001: the two count tiles read "0" and "0" while the grid shows "Showing 4 of 4 business
  photos and videos from Google" (seed: `business_photo_count` 0 in 10-gbp.sql, four `gbp_media` rows from
  20-reviews.sql). The narration never says a count. Customer photos: "No customer photos synced yet".
- Citation row ids are global (`row-citation-N` continues across campaigns), so the script selects rows by
  prefix + site text, never by number.
- The sub-menu toggle state persists inside one browser context (a dry run that collapses it hides
  `subnav-agency-*` for the rest of that run); a fresh produce starts expanded.
- Profile Watch's "Owner-approved snapshot" and change cards print raw JSON for Categories
  (`{"primaryCategory": {"name": "categories/gcid:roofing_contractor"}}`). In frame on the guard video; not read out.
- The Agency bulk action filmed is "Assign client" (local, no Google call: `UPDATE business_locations`), assigning
  the two Summit listings to the client they already belong to; the worker runs every 15 s so Jobs shows
  "assign · queued" then "done". Sync now / Link & sync / Check now / Reconnect / Connect another Google account /
  Open in Google / Search (citations) are never clicked.
- The Insights tab also carries a Google Search Console summary card and the Google connection section above the
  performance table; both are in frame at the top of the tab.

Pipeline notes:
- `vid.sh dry` requires the script file to be named `<helpKey>.json` and the key to be in the registry: a scout
  script has to borrow a real key.
- `server/help-registry.test.ts:81` ("Every section in the registry is mounted somewhere") only accepts section
  keys mounted in `pages/site-connections.tsx`, so every `locations.*` section entry fails that assertion on this
  branch (same test on origin/main). Not fixed here (server/ is off limits for producers) — the integrator must
  relax that rule for sections that have a manifest, or it stays red.
- Pre-existing on this branch: "claims no video without a manifest file …" fails because `client/src/pages/tutorials.tsx`
  no longer contains `if (!entry.video) return null;` (unrelated to these videos).
