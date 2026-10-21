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

### Coverage (loaded 2026-10-21)

| state | source | file / page | effective (period) | rows |
|---|---|---|---|---|
| AR | SST AR rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/ARR2026Q4AUG28.csv | 2026-10-01 (Q4 2026) | 597 |
| CA | CA CDTFA | https://www.cdtfa.ca.gov/taxes-and-fees/SalesTaxRates10-1-26.xlsx | 2026-10-01 (Oct 2026) | 541 |
| CT | CT DRS | https://portal.ct.gov/drs/sales-tax/tax-information | 2026-09-25 (per DRS page of 2026-09-25) | 1 |
| DE | DE Division of Revenue | https://revenue.delaware.gov/business-tax-forms/exemption-certificates/ | 2018-08-22 (per agency page of 2018-08-22) | 1 |
| FL | FL DOR | https://pointmatch.floridarevenue.com/General/DiscretionarySalesSurtaxRates.aspx | 2026-10-21 (as of 2026-10-21) | 67 |
| GA | SST GA rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/GAR2026Q4OCT01.csv | 2026-10-01 (Q4 2026) | 166 |
| HI | HI Dept. of Taxation | https://tax.hawaii.gov/geninfo/countysurcharge/ | 2024-01-01 (effective 2024-01-01) | 4 |
| IA | SST IA rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/IAR2025Q3MAY30.zip | 2026-10-01 (Q4 2026) | 518 |
| IL | IL DOR | https://tax.illinois.gov/content/dam/soi/en/web/tax/research/taxrates/documents/salestaxrates/ordmache-current.txt | 2026-08-01 (Aug 2026) | 1958 |
| IN | SST IN rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/INR2008Q4MAY7.csv | 2026-10-01 (Q4 2026) | 1 |
| KS | SST KS rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/KSR2026Q4AUG19.zip | 2026-10-01 (Q4 2026) | 855 |
| KY | SST KY rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/KYR2012Q4Aug13.csv | 2026-10-01 (Q4 2026) | 1 |
| MA | MA DOR | https://www.mass.gov/guides/sales-and-use-tax | 2026-05-07 (per DOR guide of 2026-05-07) | 1 |
| ME | Maine Revenue Services | https://www.maine.gov/revenue/taxes/sales-use-service-provider-tax/rates-due-dates | 2026-01-01 (effective 2026-01-01) | 1 |
| MI | SST MI rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/MIR2023Q1DEC22.csv | 2026-10-01 (Q4 2026) | 1 |
| MN | SST MN rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/MNR2026Q4AUG18.zip | 2026-10-01 (Q4 2026) | 154 |
| MO | MO DOR | https://dor.mo.gov/pdf/rates/2026/october2026.xlsx | 2026-10-01 (Q4 2026) | 2597 |
| MT | MT Department of Revenue | https://revenue.mt.gov/taxes/general-sales-tax | 2026-06-03 (per agency page of 2026-06-03) | 1 |
| NC | SST NC rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/NCR2026Q3APR23.csv | 2026-10-01 (Q4 2026) | 101 |
| ND | SST ND rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/NDR2026Q4AUG14.zip | 2026-10-01 (Q4 2026) | 418 |
| NE | SST NE rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/NER2026Q4AUG21.zip | 2026-10-01 (Q4 2026) | 272 |
| NJ | SST NJ rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/NJR2018Q1OCT16.zip | 2026-10-01 (Q4 2026) | 1 |
| NM | NM TRD | https://klvg4oyd4j.execute-api.us-west-2.amazonaws.com/prod/PublicFiles/34821a9573ca43e7b06dfad20f5183fd/43c5ec78-eeed-4153-997a-1d8c921b276c/Rate%20Schedule%20July1,2026%20-%20June%2030,%202027.xlsx | 2026-07-01 (Jul 2026–Jun 2027) | 286 |
| NV | SST NV rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/NVR2025Q4NOV05.zip | 2026-10-01 (Q4 2026) | 24 |
| OH | SST OH rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/OHR2026Q4SEP17.csv | 2026-10-01 (Q4 2026) | 93 |
| OK | SST OK rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/OKR2026Q4AUG17.zip | 2026-10-01 (Q4 2026) | 720 |
| OR | OR Department of Revenue | https://www.oregon.gov/dor/programs/businesses/pages/sales-tax.aspx | 2025-09-05 (per agency page of 2025-09-05) | 1 |
| PA | PA DOR | https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/sales-use-and-hotel-occupancy-tax | 2026-08-12 (per DOR page of 2026-08-12) | 3 |
| RI | SST RI rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/RIR2019Q2MAR27.csv | 2026-10-01 (Q4 2026) | 1 |
| SD | SST SD rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/SDR2026Q3JUN02.zip | 2026-10-01 (Q4 2026) | 398 |
| TN | SST TN rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/TNR2026Q4AUG21.csv | 2026-10-01 (Q4 2026) | 480 |
| TX | TX Comptroller | https://comptroller.texas.gov/taxes/sales/docs/city-rates.xlsx | 2026-10-01 (Q4 2026) | 2996 |
| UT | SST UT rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/UTR2026Q4AUG11.csv | 2026-10-01 (Q4 2026) | 196 |
| VA | Virginia Tax | https://www.tax.virginia.gov/sites/default/files/inline-files/sales-and-use-tax-rates-by-locality-by-date.xlsx | 2026-01-01 (Jan 2026 – present) | 133 |
| VT | SST VT rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/VTR2026Q4AUG20.zip | 2026-10-01 (Q4 2026) | 38 |
| WA | WA DOR | https://dor.wa.gov/taxes-rates/sales-use-tax-rates/lsu-quarterly-tax-rates.csv | 2026-10-01 (Q4 2026) | 403 |
| WI | SST WI rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/WIR2026Q4AUG17.csv | 2026-10-01 (Q4 2026) | 1995 |
| WV | SST WV rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/WVR2026Q3FEB25.csv | 2026-10-01 (Q4 2026) | 102 |
| WY | SST WY rate/boundary files | https://www.streamlinedsalestax.org/ratesandboundry/Rates/WYR2026Q4AUG20.CSV | 2026-10-01 (Q4 2026) | 25 |

Notes:
- WA covers every DOR location code: cities, each county's unincorporated area, and PTBA/tribal codes. For a WA street
  address, the WA DOR address lookup gives the exact code (see Resolution order).
- SST states use the Streamlined Sales Tax rate and boundary files that each member state publishes
  (streamlinedsalestax.org/ratesandboundry), with place names from the U.S. Census reference files. IA, OH, NC, GA and
  NV publish no city codes there, so they load as county rows plus districts. Some flat-rate members (IN, KY, MI, NJ, RI)
  are a single statewide row.
- PA, CT, MA, DE, MT and OR: the agency page states the rate but no start date. The date used is the page's own
  "updated" date, which is a date the rate was in force, not when it began. FL: the DOR surtax table's "current as of"
  date. HI: the county surcharge's effective date.
- A city with several published rates (multi-county cities, special districts: Kansas City MO, Wichita KS) is narrowed by
  ZIP or county when the address has them. Otherwise the line says "rate varies within <city>; check the address".

**Not covered: no official machine-readable file.** Estimates there fall back to the division/org default, and the
line says "City rate not loaded yet for <ST>".

| state | why |
|---|---|
| AL | ALDOR's CSV lists each city/county tax separately with no combined rate; combining them would mean judging overlaps (police jurisdictions, "except 4 cities") ourselves. |
| AZ | ADOR publishes rate tables only as monthly PDFs with no combined city rate; the lookup is behind a bot check. |
| CO | The DR 1002 / jurisdiction XLSX exists but tax.colorado.gov blocks automated downloads (Cloudflare); the rates API needs registration. |
| LA | The only downloadable file (Remote Sellers Commission) is dated 7/1/2025 and out of date; current rates exist only in lookup tools. |
| NY | Publication 718 is a PDF with fractional rates; data.ny.gov has no rate dataset. |
| MD | The Comptroller's rate page is a login-backed portal; MD has one statewide 6% rate (not loaded without a machine-readable source). |
| SC | Local rates are PDFs only (ST-575, ST-500). |
| MS | Local taxes are narrative legislative entries, not a table. |
| ID | The Tax Commission lists resort-city taxes without rates. |
| DC | OTR states 6% but no effective or updated date anywhere. |
| NH | No general sales tax; nh.gov refuses automated requests, so the statement can't be checked by the refresh. Treatment table makes NH 0% anyway. |
| AK | No state sales tax. Local rates are published by the Alaska Remote Seller Sales Tax Commission (municipalities, not a state DOR), so they are not loaded (`sources/ak.ts` exists, unregistered). The treatment table makes AK jobs 0%. |

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
