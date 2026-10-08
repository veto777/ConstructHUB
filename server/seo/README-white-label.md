# SEO white-label rule

**Owner rule:** a customer never sees who the SEO data comes from ("DataForSEO", its hosts, env names) or what it
costs us (wholesale dollars, the monthly cap) — in a page, an error, a tooltip, an export, an email, or a note saved
now and shown later. Platform admins may (the `admin` block, `GET /api/seo/admin/usage`).

**The one boundary is `server/seo/public-errors.ts`.** Internal errors keep their exact wording for the log.

- **Adding a route:** register it with `route(...)` in `routes.ts` (its catch calls `seoErrorResponse`), never
  `res.json({ message: e.message })` and never `next(e)`. Then add a request for it to `SPECS` in
  `white-label.test.ts`, and to `ASKS_PROVIDER` if it calls the source while the request waits. Update the route count.
- **An error the customer should read as written** (a limit, "not found"): throw a class that extends
  `SeoCustomerError`. A plain `Error`'s text is never shown.
- **Something that could not be done just now and can simply be asked for again** (a one-at-a-time section held in
  another process past its wait — `server/seo/locks.ts` — or the newest crawl replaced while it was read): throw
  `new SeoRetryableError(code)`; its copy and status (503 / 409) live in `SEO_RETRY`, and the body carries
  `code` and `retryable: true`. Add any new case to `SEO_RETRY`, which also makes it a known note.
- **Background work that saves a note** (rank run, grid scan): save `publicFailure(e, "neutral fallback")` or a fixed
  sentence, and add every new fixed sentence to `KNOWN_NOTES`. Return saved notes through `publicNote(...)`.
- **Never return to a customer:** `e.message`, an upstream `status_message`, any `...Usd` / `cost_usd` /
  `estimate_usd` field, `SeoBudgetError.detail`, `PRICE_SHEET`, or an `admin` / `vendor` / `env` key. Prices shown
  are `retailCents(...)`; say "credits were not charged" only when the call ran inside `withBudget`.
- **Client and `shared/`:** no file may name the vendor (the guard scans them; allowed files: none).

Run: `DATABASE_URL= npx vitest run server/seo/white-label.test.ts` (nothing in it opens a connection).
