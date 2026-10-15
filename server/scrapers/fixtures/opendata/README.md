These are public responses fetched from official publishers on 2026-10-10.

- City/county JSON files contain complete two-row API responses, including response envelopes and geometry. Responses were only JSON-formatted; no record fields were removed or invented.
- `rbx6-tga4.json`, `ydr8-5enu.json`, and `3syk-w9eu.json` are initial Socrata probes. The NYC initial probe includes the source's literal unissued-permit placeholder; production queries exclude it.
- `metadata/` contains complete fetched publisher metadata. The Charlotte jurisdiction and Los Angeles County module files contain actual distinct-value responses used to scope those feeds.
- `latest-*.json` contains complete native maximum-date query responses, collected to investigate empty seven-day results.
- `provenance.json` is a generated index of metadata files and their field names, not a permit-response fixture. It supports offline validation of every field map.

Exact dataset titles, IDs, endpoints, native queries, counts, times, sample records, failures, and scope limitations are in `../../opendata.REPORT.md`. Baseline fixtures from earlier successful probes remain valid when a subsequent broad fixture query returned 403; the report records that distinction. Tests make no network requests.

2026-10-14 additions (contractor/applicant names; see report section 7): `metadata/*_contacts.json` are complete publisher metadata for the Los Angeles Certificate of Occupancy, San Francisco Building Permits Contacts and Harris County Projects datasets; `*_contacts.json` are complete contact responses for one permit/project, and `*_contact_permits.json` the matching main-dataset responses. `provenance.json` indexes the contacts schemas under each jurisdiction's `contacts` key.
