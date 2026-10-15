Recorded 2026-10-10 from public.mygov.us with the ConstructHUB user agent. JSON bodies are byte-for-byte saved responses, not invented fixtures.

- crowley-lookup.html: GET /crowley_tx/lookup. Only the Google API key and Mapbox token were replaced with REDACTED. No cookies are included.
- crowley-412-locations.json: POST /crowley_tx/getLookupResults, address_search=412 E Main.
- crowley-main-locations.json: same endpoint, address_search=Main.
- crowley-modules.json: POST /oac/home/getLocationModules, location_id=8378, anonymous Crowley session.
- crowley-projects.json: POST /oac/home/getLocationModuleProjects, location_id=8378, module=pi, same session.
- barling-main-locations.json: POST /barling_ar/getLookupResults, address_search=Main. The placeholder-looking location is in the real server response; it is not a permit.
- barling-modules.json: POST /oac/home/getLocationModules, location_id=1, anonymous Barling session. Zero projects.
- russell-empty-projects.json: POST /oac/home/getLocationModuleProjects, location_id=4454, module=pi, anonymous Russell session.

The adapter does not infer issue/application dates from project creation/completion dates. Tests use these bodies without contacting the network.

## Public tenant reports (recorded 2026-10-14)

Each `*-report-<id>.xlsx` is a trimmed copy of a real anonymous download, GET `/<tenant>/downloadReport?moduleName=pi&id=<id>`
(the "Download" button on `/<tenant>/templates?module=reports`). Trimming keeps the original workbook parts and the
header row, keeps only the rows of the listed permits, and rebuilds the shared-string table for those rows. Values in
phone, mobile, e-mail, physical/mailing address columns were replaced with `[redacted]`; in Paris's Applicant cell the
phone digits became `0000000000` and the e-mail `redacted@example.invalid`. No other value was changed.

- crowley-report-313.xlsx: crowley_tx report 313 "Yearly Report of ALL Issued Permits (posted monthly) (Excel)", permits 24-001057 (5 contact rows) and 25-001689.
- texarkana-report-280.xlsx: tx_texarkana report 280 "Permits Issued in the last year - YTD", permits 25-000001 and 25-000002 — each number is used by two unrelated projects in the real report.
- little-elm-report-15.xlsx: little_elm_tx report 15 "All Issued Permits - Commercial, Residential, and Pools (Within One Month) (LOCATIONS)", permits 26-000527 and 26-002763.
- paris-report-372.xlsx: paris_texas report 372 "All Permits Media w/ Solar", permit 26-001306.
