# Batch G — producer notes (slot 2, branch video-batch-g, 2026-10-08)

Done (12): crm-payments, crm-estimate-client-view, crm-client-quick-actions (re-record: Take a payment is opened; client changed to Rafael Quintanilla, who has an open invoice), crm-team-crew-view, crm-team-activity, crm-client-photos, crm-client-contact-shortcuts, crm-brand-color, crm-estimate-draft, crm-team-cost-rate, crm-estimate-options (re-record with three options).

Re-records: crm-client-quick-actions and crm-estimate-options have a script, help entry and manifest on video-batch-a / video-batch-b too. The files on this branch are the newer ones (new R2 objects, new manifest); the integrator takes this branch's version of those three files per key.

Skipped, with the exact reason:
- crm-invoice-client-view: already produced on video-batch-e (b4722f8).
- crm-client-export (G2): already produced on video-batch-a.
- crm-webhooks (G10): its condition is "only if D11 is narrowed to API keys"; crm-api-keys on video-batch-d covers API keys and webhooks in one video.
- crm-mobile-ribbon (G1): the ribbon is fixed to the bottom of the screen, which is the caption strip of every frame, and a master is 16:9 (a phone-width layout is 640×360 at zoom 3, not a phone shape). Need: a portrait capture placed on a 1920×1080 canvas, or captions drawn outside the picture.

What the product does that a video had to work around (not narrated):
- Payments page: no filters and no search; the list is the newest 50. The account card prints the connected account id and a "test mode" pill (fixture account `acct_tutfx…`); both are in frame in crm-payments.
- A member with the field role still has Estimates, Price book and Payments in the menu, and the "New estimate" and Create buttons; Payments shows the payment-account card above "You don't have permission to see payments." His Home also lists a follow-up for a client that is not on his jobs (Rosa & Stefan Ferrante). crm-team-crew-view does not open Payments and keeps that part of Home out of the narration.
- Member activity: sending an estimate is not logged (only created / updated / deleted); a change to a member is logged with the raw field name, e.g. "updated Priya Shah's account (hourlyCostCents)". crm-team-activity uses a recorded payment, which reads well.
- Cost rate / hr on a member is stored and shown on the Team tab only; nothing in job costing reads it. crm-team-cost-rate says what the field is and who can see it, not that it feeds costing.
- The emailed estimate link opens the estimate directly in a slot (no email check on the way in), so crm-estimate-client-view does not mention a one-time code.
- Hadley's client page: the JobCam tiles are broken images, and the activity timeline prints a fixture file name ("HOVER photo imported — hover-tutfx-1003-…jpg"). Not filmed.
- The address link on a client opens a Google Maps search; while the pointer is on it the recorder's status bar prints that address (crm-client-contact-shortcuts, bottom-left of two frames).

Pipeline notes:
- mux.ts drops a chapter that starts less than 10 s after the previous one and then fails check.ts with "fewer than three chapters" — after the whole run. A dry-run warning from the narration lengths would save a re-record (hit twice).
- "The capture drifted ±300 ms — record again" happened twice with the machine at load 12–15; a second run passed unchanged.
- A toast is gone about five seconds after it appears: a `highlight` on it in the next step times out. Say it in the step that causes it.
- thumbnail.step: the crop is centred on the ring. A ring on a small element at the right edge of a wide row gives a thumbnail of empty card; pick a step whose ring has text beside it.
- A `goto` inside a `member:` session timed out once (30 s, /crm/clients); clicking the menu item instead works.
- produce.ts takes 4–10 minutes when other slots are encoding (mux and check wait for the encode lock).
