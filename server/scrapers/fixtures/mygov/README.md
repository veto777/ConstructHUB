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
