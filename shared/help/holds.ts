/**
 * Walkthroughs that are NOT to be posted to YouTube or social as they are — each with the reason and
 * what releases it. `youtube-schedule.ts` and `social-post.ts` list them as "held for owner approval"
 * and plan them only with `--release <key>` (the same switch as the overview films, whose hold is on
 * their own help entries). A hold here does not take the video out of the app: a cut that must not be
 * SHOWN has its manifest moved to docs/tutorials/held-manifests/ instead.
 *
 * To release one: re-record (or re-check) it, then delete its line. Keep this list short and dated.
 */
export const YOUTUBE_HOLDS: Readonly<Record<string, string>> = {
  // 2026-10-08, batch G
  "crm-payments": "shows the recording stand-in's account id (acct_tutfx…) and a \"test mode\" pill — re-record once the fixture presents a normal connected account",
  "crm-team-crew-view": "describes what a field member sees; the role gates changed on main (fix-crm-role-gates) — re-check against the new behaviour, re-record if it differs",
  "crm-team-cost-rate": "the narration mentions a save confirmation that is not on screen — fix the line and re-record",
  // 2026-10-08, batch F
  "crm-hover": "\"Sync now … 0 matched\": nothing happens on screen — re-record once the HOVER stand-in returns a match",
  "crm-client-portal-documents": "an empty \"Contract PDF\" cell — re-record once the demo workspace has a signed contract PDF",
  "crm-price-floor": "its scroll down Settings passes the SMS card's \"Texting via SignalWire from …\" line, legible for a moment — re-record opening the page AT the card (a goto with a selector)",
  "crm-scheduled-exports": "its scroll down Settings passes the SMS card's carrier line — re-record opening the page AT the card",
  "crm-payment-methods": "its scroll down Settings passes the SMS card's carrier line — re-record opening the page AT the card",
  "crm-financing": "its scroll down Settings passes the SMS card's carrier line — re-record opening the page AT the card",
  "crm-estimate-send-text": "rests on the SMS card, whose first line names the carrier (\"Texting via SignalWire from …\") — owner to decide whether that product copy may be on camera; else re-record after the copy changes",
  // 2026-10-08, batch E / G re-checks after the product fixes on main
  "crm-estimate-client-options": "recorded before fix-crm-defects changed the \"Your new total\" maths on the client's estimate page — re-check the figures on screen, re-record if they differ",
};
