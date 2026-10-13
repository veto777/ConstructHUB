# Deep dives — gbp-content (Posts & Photos), slot 2, branch video/deep-gbp-content, 2026-10-13

Done (9): posts-photos (page tour, 74 s), posts-photos.updates-events-and-offers (96 s),
posts-photos.photos-by-category (65 s), posts-photos.ai-drafts-in-your-voice (99 s),
posts-photos.cadence-and-business-hours (93 s), posts-photos.approval-first (77 s),
posts-photos.calendar-queue-and-history (56 s), posts-photos.filenames-and-photo-details (72 s),
posts-photos.batches-on-agency (74 s, filmed on /agency; the entry's route is /gbp-content because
help-registry.test.ts requires a section's route to equal its parent's).

Skipped: none. Every card has a video; three are filmed without the click that the slot cannot answer (below).

What the slot cannot do, and how each video stays truthful (not narrated as done):
- The seeded media_photos rows (ids 92001–92022) are data: URLs with no r2_key. Any post or photo item that
  attaches one is refused by POST /queue with 400 "Invalid media key", and POST /prepare answers "Photo must be
  in the R2 media library"; Upload photos and "Apply filename and EXIF to selected copies" call uploadToR2 and the
  slot has no R2 credentials. So photos-by-category ticks photos, captions one, picks the category and HIGHLIGHTS
  "Approve & queue photos" (the seeded queued photo item is what is shown in the queue); filenames-and-photo-details
  types the pattern, title and GPS and highlights "Apply filename and EXIF to selected copies" and the upload input.
  The page tour and every post video approve posts WITHOUT a ticked photo. A seed with r2_key on the sample photos
  (or an R2 stand-in in the fixtures) would let both buttons be clicked on camera.
- The slot's AI points at 127.0.0.1:9 (no provider): "Generate caption drafts" / "Generate post draft" / "Learn from
  past updates" are highlighted and described, never clicked. The saved style guidance (seeded) is edited and saved
  (PATCH /style is local).
- "Refresh Google status" (reads each published post from Google) is highlighted, not clicked. Retry is not in any
  frame because the seed has no failed / uncertain item, so no video says "Retry".
- Cancel (calendar video) and "Approve & queue batch" on /agency (enqueue only, no Google call) are clicked.

Product observations (not narrated):
- The datetime-local fields (Starts, Ends, First publish, Batch start time): in a DRY run Chromium's native date
  picker pops open over the page when the recorder clicks the field; in the real recording it did not appear.
  updates-events-and-offers keeps a `press Escape` after Ends as a guard.
- `select` on "Call to action" needs the visible label ("Call"); the intro script's value "call" (lower case) no
  longer matches — intro-gbp-content.json step 8 fails a dry run today.
- The Agency locations list is taller than the viewport; a highlight on `agency-locations-list` rings the whole
  screen (warned "in the caption area"). Ring one row instead.
- Posts & Photos: the "Publishing worker is disabled" notice (GBP_CONTENT_WORKER_ENABLED unset in a slot) is removed
  with `removeSelectors: div[role="alert"].rounded-xl` as the intro does.

Tests: server/help-registry.test.ts "Cloudflare and Search Console have an 'i' … every section in the registry is
mounted somewhere" fails for every new `posts-photos.*` section: that assertion only accepts sections mounted in
pages/site-connections.tsx, and the brief forbids client changes. The second failure in that file ("claims no video
without a manifest … expected tutorials.tsx to match /if \(!entry\.video\) return null;/") is pre-existing on main.
The integrator needs to relax the mount rule (sections listed inside the parent's card) or mount the keys.
