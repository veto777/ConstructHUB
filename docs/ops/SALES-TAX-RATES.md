# Sales tax on estimates: official rates and construction treatment

Owner, 2026-10-21: "every customer has an address and the address attached should indicate the city and you can
assess the tax based on that city", "makes sure the CRM is aware of all tax rates", and "like florida doesnt have
tax but WA does".

## What the user sees

When the **New estimate** dialog opens (client page), the server works out the rate for the job-site address and
pre-fills **Tax %**. A line under the field says where the rate came from:

- `Bellingham, WA · 9.2% (WA DOR, Q4 2026)`: official city rate.
- `Florida: contractors don't charge sales tax on real-property jobs (they pay it on materials) — FL DOR GT-800067 …`:
  0%, because of the state's construction treatment.
- `Austin, TX · 8.25% (TX Comptroller, Q4 2026) — TX: commercial repair taxed; new/residential mostly not — check`:
  a state where it depends on the job. The rate is pre-filled, and the user decides.
- `City rate not loaded yet for HI — using your default (4.5%)`, `No rate found for <city>, WA — using your default`,
  `No city on the address — …`: the fallback, always shown and never silent. With no default at all, the line says
  "no default rate set — enter the rate".

Tax % always stays editable. The quick builder (`/crm/estimates/new`) shows the same line on its review step.

## Resolution order (`server/crm/tax.ts`)

The job-site address is the project's site address when the estimate has a project. Otherwise it is the client's
service address. In WA, construction sales tax is due at the job site. The state comes from the address's state field,
then its ZIP, then the division's state, then the org's state. The first match below wins:

0. An explicit `taxRateBps` on the create call (the dialog's Tax %). The hook never overrides it.
1. The division's per-city override (`crm_divisions.custom_fields->taxRates.cities`). The org's own configuration wins
   over the official table.
2. The state's construction treatment is `not_taxable` (`shared/construction-tax-treatment.ts`). The rate is 0.
3. The official rate for the job site. For a WA address with a street line, WA DOR's own free address lookup
   (`webgis.dor.wa.gov/webapi/AddressRates.aspx`, `server/sales-tax/wa-address.ts`, cached for a day, 4 s timeout)
   gives the exact location code. A mailing city is not the tax jurisdiction: 4783 Bayshore Dr, Blaine 98230 is
   unincorporated Whatcom PTBA (3737, 8.9%), not the City of Blaine (3702, 9.1%). Otherwise, or when DOR doesn't
   answer, the city in `sales_tax_rates` is used, with a ZIP narrowing the match when a city has several rates.
   Set `WA_DOR_ADDRESS_LOOKUP=off` to disable the address lookup.
4. The division default (`taxRates.default`).
5. The org default (`crm_orgs.default_tax_rate_bps`).
6. 0, with source `none`.

Endpoints:

- `GET /api/crm/tax/estimate-rate?customerId=…[&projectId=…]` is what the dialog pre-fills. It requires the
  `manageEstimates` permission.
- The `POST /api/crm/estimates` hook fills an omitted rate.
- Every estimate records `custom_fields->taxSource`, which holds: source, bps, city, state, treatment, official
  source/period/location code and the label. When the user changed the suggested rate, the source is `manual` and
  the suggestion is kept.

## Data

| table | what |
|---|---|
| `sales_tax_rates` | One row per published location: state, city (+ `city_key`), county, location code, zip, kind (city / unincorporated / county / state / special), `rate_pct` exactly as published, `rate_bps` (rounded, as estimates store it), effective date, source, source URL, period label |
| `sales_tax_rate_loads` | One row per loaded state: source, file URL, effective date, period, row count, content hash, origin (bundled / refresh), loaded_at |

The DDL is in `server/sales-tax/schema.ts`. It is idempotent and runs at boot from `ensureCrmSchema`; the drizzle
definitions are in `shared/schema.ts`. A state's rows are always replaced as a whole, in one transaction, and only by
a newer table (by effective date) or a correction of the same period.

The bundled copy is `server/data/sales-tax-rates.json`, with one state per line. Boot (`seedReferenceData`) loads
every bundled state that is newer than the database's copy, so a fresh database has rates immediately. It never rolls
back a quarter that the refresh timer has already loaded.

Rates come only from each state's own revenue agency file. Nothing is estimated or summed by us; when an official file
has no combined rate, the state is not loaded and the dialog falls back to the default with the "not loaded yet"
line. Per-state sources and coverage are listed in `server/sales-tax/sources/*.ts` (header comment of each adapter)
and in the coverage table below.

### Coverage

| state | source | file | notes |
|---|---|---|---|
| WA | WA DOR | `lsu-quarterly-tax-rates.csv`, linked from the Local sales & use tax rate table page | Every location code: 297 cities and towns, every county's unincorporated area, PTBA and tribal-area codes. The quarter is read from the page ("Quarter 4 - Effective October 1 through December 31, 2026"). |

States that are not listed have no table loaded yet. Their estimates use the treatment line plus the division/org
default.

## Construction treatment (`shared/construction-tax-treatment.ts`)

All 50 states + DC: `taxable`, `not_taxable` or `depends` (residential_vs_commercial / new_vs_repair / contract_type),
with a one-line note, the agency, an official citation URL and the date it was checked. Review calls are noted in the
file header. For example, FL is `not_taxable` for lump-sum contracts per the owner; CA, CO, IN, ME, NE and RI have the
same contract-type split and stay `depends`. Re-check a state when its agency publishes new guidance.

## Refresh (rates change quarterly)

Adapters live in `server/sales-tax/sources/<state>.ts` and are registered in `sources/index.ts`. Each one finds the
current file on the agency page, parses it, reads the effective date from the source and throws on a partial file.
`server/sales-tax/refresh-cli.ts` runs them. A state that fails keeps its previous rows, and the run exits 1.

- **Production timer (vb11).** `constructhub-sales-tax-refresh.timer` (systemd --user) runs
  `node --env-file=.env dist/refresh-sales-tax.cjs --apply` on the 1st, 8th, 15th and 22nd of each month. An unchanged
  table is a no-op. Install or update it:

  ```bash
  scp ops/sales-tax/constructhub-sales-tax-refresh.{service,timer} vb11:.config/systemd/user/
  ssh vb11 'systemctl --user daemon-reload && systemctl --user enable --now constructhub-sales-tax-refresh.timer'
  ssh vb11 'systemctl --user start constructhub-sales-tax-refresh.service; journalctl --user -u constructhub-sales-tax-refresh -n 30 --no-pager'
  ```

- **Refreshing the bundled copy (tower).** Do this when adding a state or when a fresh database should start current:

  ```bash
  npx tsx server/sales-tax/refresh-cli.ts --out server/data/sales-tax-rates.json   # all states
  npx tsx server/sales-tax/refresh-cli.ts --out server/data/sales-tax-rates.json --states WA
  npx vitest run server/sales-tax server/crm/tax.test.ts && git add server/data/sales-tax-rates.json
  ```

- **Checking what is loaded:**

  ```sql
  SELECT state, source, period_label, effective_date, row_count, origin, loaded_at FROM sales_tax_rate_loads ORDER BY state;
  ```

- **Adding a state.** Write `sources/<xx>.ts` in the style of `wa.ts`, with a pure parse function and offline tests.
  Register it in `sources/index.ts`, regenerate the bundled file and add a row to the coverage table above.
