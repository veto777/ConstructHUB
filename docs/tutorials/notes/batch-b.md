# Batch B — producer notes (slot 2, 2026-10-08)

- B6 `crm-estimate-client-view` skipped: needs the client host and the one-time code read from the email outbox (no recorder support).
- B8 `crm-quick-bid` skipped: no demo client has a measurement report (`GET /api/crm/customers/:id/measurements` is empty for all 16) and no price book item is priced per sq ft, so Quick Bid is disabled on every client.
- B14 `crm-payments`, B15 `crm-payment-link` skipped: /crm/payments opens on "Not configured on this server" (no Stripe keys in a slot).
- B9: "Mark sent & copy link" is shown but not clicked — the recorder's browser has no clipboard, so the fallback toast prints the client link with the CRM host name in it.
- B10: an invoice number in the Invoices list opens the client's page (there is no invoice detail page); the video says so.
- B13 is recorded from the client's page (route /crm/clients): /crm/payments starts with the Stripe "Not configured" banner.
- produce.ts: the intro/end-card or thumbnail screenshot fails now and then under load ("Page.captureScreenshot: Unable to capture screenshot"); re-running mux.ts / thumbnail.ts / check.ts on the kept output works, but produce.ts deletes raw.mkv first when mux is the stage that failed.
