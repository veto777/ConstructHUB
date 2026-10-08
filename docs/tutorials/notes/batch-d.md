# Batch D — producer notes (slot 4, branch video-batch-d)

Done: crm-team-profile, crm-report-issue, crm-team-roles, crm-api-keys, crm-billing (retitled "Seats on your CRM plan"), crm-notifications, crm-document-defaults, crm-company-settings (no upload on camera), crm-reports, crm-client-portal (Florida client, see below), crm-search (retitled "Getting around the CRM"), crm-sales-tax (extra: company default rate and its effect on a new estimate).

Skipped, with the exact need:
- crm-team-invite (D2): after Invite the page shows the join link (`<code>` under the form, the CRM host and port in it) until reload; `redact` only blurs after a step has scrolled to the element. Revoke asks `window.confirm`, which the recorder dismisses. Need: script-level "blur these selectors from page load" + a dialog-accept option.
- crm-team-divisions (D4): Settings → Divisions lists "Aspire Interiors — Washington · WA · HQ · 2211 Meridian St, Bellingham, WA · License DEMO-WA-1001 (WA)" and "Aspire Interiors — Florida · FL · 1847 Main Street, Sarasota, FL · License DEMO-FL-1001 (FL)". A new division is added to that same list, so the Bellingham row is in frame. Need: a fictional address on the Washington division in the seed.
- crm-integrations (D8), crm-lead-capture (D9): /crm/integrations opens on "HOVER isn't configured — This deployment has no HOVER OAuth app credentials". D9 also shows the lead-form link and embed code with the CRM host (same blur-from-load need), and the public form's address holds a generated token (no on-page link to it). 
- crm-hover (D10): blocked (no HOVER keys). crm-migrate (D13): needs a file-upload action. crm-client-portal-message (D15): the contractor preview is read-only and the client sign-in needs the one-time link.

Pipeline / app gaps hit:
- check.ts "only N-1 of N frames could be read": its last-frame grab seeks to duration − 60 ms; when the total length ends more than ~27 ms past a frame boundary the seek lands after the last picture frame (the sound is a few ms longer). About one run in five. Worked around by re-running mux.ts with `--end` shortened by ≤ 30 ms.
- "See what the client sees" works only for clients with UUID ids: `verifyPortalPreviewGrant` (server/crm/client-auth.ts) requires a 36-character id, so the NY/TX demo clients (`demo-client-…`) land on the client sign-in page. crm-client-portal therefore uses Joe & Mary Kane.
- A text-fragment address (`/crm/settings#:~:text=…`) is how a script opens a long page at a card without scrolling past other cards; a hyphen in the text must be written `%2D`.
- server/help-registry.test.ts treats any `type` step whose selector contains "key" as a secret (crm-api-keys names a key: selector written by placeholder instead).
- Logo upload needs R2 and a file-upload action: crm-company-settings points at Upload logo, it does not upload.
- Slot 4 was also used from the ConstructHUB-seo checkout (app.ts up 4; produce.ts brand-what-is-constructhub --slot 4) while Batch D was producing.
