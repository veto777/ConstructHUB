# Research acceptance run, 2026-10-16

Commit f92e897a. Options: {"states":["ND","NC"],"onlyFailed":false,"useLoaded":true,"portals":false}.

**1 failure(s)**: missed 0, privacy 0, silent 0, error 0, slow 1.

## Summary by state

| State | Golden subjects | Found | Missed | Privacy | Silent | Source errors | Slow | Slowest report |
|---|---|---|---|---|---|---|---|---|
| IN | 1 (2 null) | 1/1 | 0 | 0 | 0 | 0 | 0 | 0s |
| NC | 4 (1 null) | 4/4 | 0 | 0 | 0 | 0 | 1 | 335s |
| ND | 3 (1 null) | 3/3 | 0 | 0 | 0 | 0 | 0 | 15s |

## Failures, ranked (missed record > privacy > silent failure > source error > slow)

| # | Severity | State | Source | Subject | Detail |
|---|---|---|---|---|---|
| 1 | slow | NC | report | person "John B. Smith" | report took 335s (limit 300s) |

## Links from publisher data (host not named in the code: check they are the publisher's own)

None.

## Matrix: state × source

Cells per golden subject: `found N`, `searched, 0`, `not searched (reason)`, `failed (error)`, `n/a (companies only)` or `MISSING` (a silent failure).

### IN

- **company**: "CREATIVE SIGN RESOURCES" (Indianapolis contractor licenses (Business and Neighborhood Services), record C6558900, bulk file in-indy, loaded 2026-10-15 (the publisher lists no status: a list of current licenses)): found in licenses: Indianapolis contractor licenses (Business and Neighborhood Services), 0s. Summary: Found 5 license record(s) and 0 state enforcement or standing record(s). Not searched: permit portals, consumer complaints, federal court cases and OSHA inspections.
- **enforcement**: none (No usable record of a company with an enforcement or discipline record found in: in-indy (discipline); IN original enforcement)
- **person**: none (No usable record of an individual license holder found in: in-indy)

| Source | company |
|---|---|
| Indianapolis contractor licenses (Business and Neighborhood Services) | found 5 |
| SAM.gov federal exclusions and debarments (Public V2 extract) | searched, 0 |

### NC

- **company**: "M.B. Haynes Corporation, T/A" (NC Licensing Board for General Contractors, record L.01245, live lookup, search "Construction"): found in licenses: NC Licensing Board for General Contractors, 140s. Summary: Found 1 license record(s) and 0 state enforcement or standing record(s). Not searched: permit portals, consumer complaints, federal court cases and OSHA inspections.
- **person**: "John B. Smith" (NC Board of Examiners of Electrical Contractors, record I.08556, live lookup, search "John Smith"): found in licenses: NC Board of Examiners of Electrical Contractors, 335s. Summary: Found 2 license record(s). Not searched: permit portals, consumer complaints, state enforcement records, federal court cases and OSHA inspections.
- **enforcement**: "Hi-Tech Irrigation Service, Inc." (NC Irrigation Contractors' Licensing Board disciplinary actions, record U13-032, bulk file nc-iclb-discipline, loaded 2026-10-16): found in enforcement: NC Irrigation Contractors' Licensing Board disciplinary actions, 3s. Summary: Found 0 license record(s) and 1 state enforcement or standing record(s). Not searched: permit portals, consumer complaints, federal court cases and OSHA inspections.
- **enforcement**: "Cox Lawn, LLC" (NC Landscape Contractors' Licensing Board enforcement actions, record 22.158.U, bulk file nc-lclb-enforcement, loaded 2026-10-16): found in enforcement: NC Landscape Contractors' Licensing Board enforcement actions, 3s. Summary: Found 0 license record(s) and 1 state enforcement or standing record(s). Not searched: permit portals, consumer complaints, federal court cases and OSHA inspections.
- **enforcement**: none (No usable record of a company with an enforcement or discipline record found in: NC Licensing Board for General Contractors: disciplinary actions; NC original enforcement)

| Source | company | person | enforcement | enforcement |
|---|---|---|---|---|
| NC Irrigation Contractors' Licensing Board disciplinary actions | searched, 0 | n/a (companies only) | found 1 | searched, 0 |
| NC Landscape Contractors' Licensing Board enforcement actions | searched, 0 | n/a (companies only) | searched, 0 | found 1 |
| NC Licensing Board for General Contractors | found 1 | searched, 0 | searched, 0 | searched, 0 |
| NC Board of Examiners of Electrical Contractors | searched, 0 | found 1 | searched, 0 | searched, 0 |
| NC Board of Examiners of Plumbing, Heating & Fire Sprinkler Contractors | searched, 0 | found 1 | searched, 0 | searched, 0 |
| NC Licensing Board for General Contractors: disciplinary actions | searched, 0 | n/a (companies only) | searched, 0 | searched, 0 |
| SAM.gov federal exclusions and debarments (Public V2 extract) | searched, 0 | - | searched, 0 | searched, 0 |

### ND

- **company**: "2 NUTZ CONSTRUCTION" (North Dakota Secretary of State contractor licenses, record 35011, live lookup, search "Construction"): found in licenses: North Dakota Secretary of State contractor licenses, 15s. Summary: Found 1 license record(s) and 2 state enforcement or standing record(s). Not searched: permit portals, consumer complaints, federal court cases and OSHA inspections.
- **person**: "AUSTIN SMITH" (North Dakota State Electrical Board, record A 16547, live lookup, search "Smith"): found in licenses: North Dakota State Electrical Board electricians, 6s. Summary: Found 3 license record(s). Not searched: permit portals, consumer complaints, state enforcement records, federal court cases and OSHA inspections.
- **enforcement**: "Tri City Building Services" (North Dakota Attorney General cease and desist orders (unlicensed contractors), record -, bulk file nd-ag-cease-desist, loaded 2026-10-16): found in enforcement: North Dakota Attorney General cease and desist orders (unlicensed contractors), 2s. Summary: Found 0 license record(s) and 1 state enforcement or standing record(s). Not searched: permit portals, consumer complaints, federal court cases and OSHA inspections.
- **enforcement**: none (No usable record of a company with an enforcement or discipline record found in: North Dakota Secretary of State business entity status; ND original enforcement)

| Source | company | person | enforcement |
|---|---|---|---|
| North Dakota Attorney General cease and desist orders (unlicensed contractors) | searched, 0 | n/a (companies only) | found 1 |
| North Dakota Secretary of State contractor licenses | found 1 | not searched (Not searched: this lookup has no person name search) | searched, 0 |
| North Dakota State Electrical Board | searched, 0 | found 3 | searched, 0 |
| North Dakota State Plumbing Board licenses | not searched (Not searched: this lookup has no business name search) | searched, 0 | not searched (Not searched: this lookup has no business name search) |
| North Dakota Secretary of State business entity status | found 2 | n/a (companies only) | searched, 0 |
| SAM.gov federal exclusions and debarments (Public V2 extract) | searched, 0 | - | searched, 0 |

