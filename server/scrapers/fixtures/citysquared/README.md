# Recorded public CitySquared responses

Fetched 2026-10-10 UTC from the anonymous CitySquared/Municity5 public client. All response bodies are unchanged. Authorization headers/public client identifier are not recorded here. No login, account or user credential was used.

- tenants.json: GET https://municity5.com/M5Services/M5Service.svc/Service/3018/Tenants, discovered in the browser's network log.
- bethel-public-fields.json: GET https://services4.municity5.com/M5Services/M5Service.svc/Customer/BethelTownCT/PublicFields?entity=Permit
- charlestown-public-fields.json: GET https://municity5.com/M5Services/M5Service.svc/Customer/CharlestownTownRI/PublicFields?entity=Permit
- bethel-recent.json, bethel-recent-page1.json, bethel-recent-page2.json and bethel-empty.json: read-only POST to https://services4.municity5.com/M5Services/M5Service.svc/Customer/BethelTownCT/FilteredSearch. Exact captured request bodies are in initial-provenance.json. The first discovery requests used the lower date bound only; production also sets an upper bound to exclude erroneous future dates.
- charlestown-name.json, charlestown-issued.json, charlestown-applied.json, fairfield-public-fields.json, fairfield-recent-page1.json and fairfield-recent-page2.json: final live requests recorded in live-provenance.json, with exact URL, HTTP status and read-only request body.

The initial two pagination fixtures use page size 10 to verify the vendor's ID cursor mechanism. The final Fairfield fixtures use the production page size 100 and contain 100 + 57 rows. These are actual fetched pages, not sliced or generated responses.
