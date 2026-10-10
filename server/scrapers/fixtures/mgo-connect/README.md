Recorded 2026-10-10 using the honest ConstructHUB user agent; bodies are unchanged server responses.

- east-lyme-menu.json: HTTP 200 GET https://api.mgoconnect.org/cp/GetJurisdictionMenu/489.
- live-oak-menu.json: HTTP 200 GET https://api.mgoconnect.org/cp/GetJurisdictionMenu/418, recorded from the guest browser network log.
- bay-saint-louis-menu.json: HTTP 200 GET https://api.mgoconnect.org/cp/GetJurisdictionMenu/491.
- unauthorized-search.json: HTTP 401 POST https://api.mgoconnect.org/api/v3/cp/project/search-projects at 2026-10-10 17:45:52 UTC (server Date header). Request body: {"filters":{"JURISDICTIONID":489,"PROJECTTYPEID":3,"ADDRESS":"Main","ISADDRESSEXACTMATCH":false,"EXPANDED":true},"Rows":10,"OffSet":0,"SortField":"dateCreated","SortOrder":-1}.

All three menus require login for Search Permits. No login was attempted and no permit rows were available. The shipped adapter uses only public menu metadata to report the wall.
