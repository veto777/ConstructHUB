Recorded 2026-10-10 UTC, anonymous public requests using the ConstructHUB User-Agent.

- milan-permit.json: GET https://milanil.govbuilt.com/PublicReport/GetAllContentToolModels?searchText=BP-2026-0119&filter=ReferenceNumber&contentType=case&type=&days=0&subType=&isHideClosedStatus=false&Start=1&Length=100&SortBy=Created%20Date&SortType=desc&draw=1
- milan-recent-grid.json: browser-observed GET same endpoint, empty searchText, filter=ReferenceNumber, contentType=All, days=30, Start=1, Length=25, SortBy=Created Date, SortType=desc, draw=1. This is a creation-date grid, not an issued/application-date fixture.
- westwood-search.html: GET https://westwood.govbuilt.com/activitysearchtool. Only hiddenToken value stripped.

JSON response bytes are unchanged. Error/pagination variants in tests are test inputs, not claimed government fixtures.
