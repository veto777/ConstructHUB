# Directory city names vs. the U.S. Census (2026-10-05)

Found while taking App Store screenshots: the first page of the Database Directory listed "AARP, CA" and
"ABAC, GA". `server/data/all-cities.json` (the source of every "City" row) came from a USPS ZIP / postal-name list,
which includes ZIP aliases for agencies, companies, campuses and mail facilities. CLAUDE.md's hard rule (no
fabricated government data) applies: a name that is not a place must not be presented as a jurisdiction.

## Sources
- Census 2025 Gazetteer — places: https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_place_national.zip
- Census 2025 Gazetteer — county subdivisions (towns/townships): https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_cousubs_national.zip
- Census 2020 place-by-county codes: https://www2.census.gov/geo/docs/reference/codes2020/national_place_by_county2020.txt
- USGS GNIS populated places and domestic names (2026-09): https://prd-tnm.s3.amazonaws.com/StagedProducts/GeographicNames/

## Result (32,674 entries)
| | entries |
|---|---:|
| Incorporated place (incl. consolidated city-counties) | 19,560 |
| Census CDP only (real, unincorporated) | 5,626 |
| County subdivision only (towns/townships; 1,318 active governments) | 1,458 |
| Statistical county division name only | 236 |
| No Census match | 5,794 |

Of the 5,794: **140 are not places** (removed, below); 5,227 are real GNIS communities in the listed county
(hamlets / post-office names — real, but not permit authorities); 114 are GNIS communities in another county;
48 are real places under an older or postal name (rename candidates); 74 are military bases, federal land or
campuses; 35 are named features; 136 have no evidence either way (most look real — LA neighborhoods, hamlets).

## Removed 2026-10-05 (140 entries, 148 directory rows)
124 all-caps postal aliases with no Census or GNIS record (LA, KC, OKC, SLC, IRS, FBI, NASA, DHS, QVC, GTE, AARP,
UCF, UVM, JBER, LRAFB, …) and 16 checked by hand: Jber, Jb Phh, Dhs (MD, VA), Parcel Return Service, Suburb Maryland
Fac, Southern Md Facility, Mid Florida, North Metro, Southeastern, Lehigh Valley, Fox Valley, Shawnee Mission,
Dodgertown, Kiamichi Christian Mission, Wake Island (filed under Honolulu, HI). Kept as real: ARP, DISH, IXL,
S.N.P.J. (Census places), CID NC and UNA SC (GNIS communities).
One removed row carried a verified portal — "FDL, WI" (USPS alias of Fond du Lac); "Fond Du Lac, WI" already has the
same verified portal, so nothing was lost.

## Open (product decisions, not fabrication)
- The 5,227 GNIS hamlets are labeled "City" but are not jurisdictions; the county (or town/township) issues permits.
- 48 rename candidates (Barrow → Utqiaġvik, Dania → Dania Beach, Block Island → New Shoreham, Lake City TN → Rocky Top, …).
- 293 entries whose name matches a Census place in a different county (ZIP crossing a county line, e.g. Denver
  under Adams County); 27 entries with retired county names (Wade Hampton, Valdez-Cordova, Shannon SD).
