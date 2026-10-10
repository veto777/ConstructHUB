# Long tail B survey — 2026-10-10

Survey written before adapter implementation. 418 input entries; counts are entries, not unique hosts. Vendor grouping combines spelling variants and vendor-bearing URLs. Sample findings do not establish access for every tenant.

| Vendor | Entries | Tenants opened | Public search | Date listing | Mechanism / access |
|---|---:|---|---|---|---|
| Cityworks | 33 | Baltimore County MD; Bonneville County ID; Jefferson County ID | No anonymous search in sampled portals; Baltimore is a Timmons login page; hosted PublicAccess login has allowGuest=false. Also opened Alpharetta GA, Beaumont TX and Carmel IN: allowGuest=false. | Not available anonymously | ASP.NET login / Angular PublicAccess. No login attempted. |
| CommunityCore | 27 | Northglenn CO; Minneola FL; Superior CO | Northglenn and Minneola settings enable address, permit, parcel and owner search; Superior settings disable search. Search service requires RecaptchaToken header. | No date search in public search component | Angular /api/v1/public-portal/{registrationId}/settings; CAPTCHA-gated search excluded, no bypass attempted. |
| GovBuilt | 22 | Milan IL; Westwood KS; Sunset Valley TX | Milan and Westwood expose Activity Search Tool: reference number, address and name. Business-name search is license-only. Sunset Valley landing exposes application forms, no search link. | Created Date/Last Activity window; issue/application-date listing not verified | Anonymous GET /PublicReport/GetAllContentToolModels; tenant is host; paginated JSON. |
| CitySquared | 21 | Bethel CT; Charlestown RI; Fairfield CT | Public property lookup and permit API verified; address/permit search, tenant-dependent applicant-name search; no contractor search. | Yes, PermitDate and optional ApplicaDate1; server-side date filters | Angular hash tenant; public Municity5 tenant directory selects service host. Read-only WCF JSON endpoints. |
| Evolve | 20 | Chester County SC; York SC; Bryan County GA | Permit Search linked in all three. Chester/York search forms verified: address, permit number, contractor and parcel; York also subdivision. | Yes, Date Range option in Chester and York | ASP.NET WebForms __doPostBack; session/viewstate. |
| GovOutreach | 18 | Freeland PA; Brightwaters NY; Rancho Viejo TX | HTTP 200 app shell for all three. Freeland and Brightwaters browser attempts remained Loading; no usable search established. | Not established | React app with api.govoutreach.com core endpoints. Do not classify loading failure as zero records. |
| CityInspect | 18 | Carbon County UT; Iron County UT; Sanpete County UT | Carbon and Sanpete login walls; Iron registration form includes CAPTCHA. No public records search linked. | Not available anonymously | Login/registration/inspection-request workflows; no account created. |
| FastTrackGov | 16 | Douglas County MN; Barnegat NJ; Denville NJ | Public /Permits/Search.aspx links. Barnegat search has permit number, contractor/agent, street number/name; Douglas links Public Works search. | Yes, Application Date within Any/30 days/3 months/1 year in Barnegat form | ASP.NET WebForms; microapp comes from published tenant links. |

Selection: GovBuilt and CitySquared are the two largest groups with observed anonymous public record interfaces and no required CAPTCHA. Larger Cityworks samples require login; CommunityCore search explicitly invokes reCAPTCHA v3 and supplies its token with every search. These are excluded from this implementation rather than bypassed.

Initial HTTP survey: all 24 sampled stored URLs returned HTTP 200; HTML alone was insufficient for the JavaScript applications. No 403/429 was bypassed. Additional details and final verified capabilities are recorded below and in the vendor reports.

## Complete grouping

All 418 entries are counted once. Spelling variants are consolidated. Host identity takes precedence for migrated vendor brands (for example, some IDT Plans labels now point to GeoCivix hosts). Groups marked Other have no established common vendor mechanism. Only the 8 largest groups above were surveyed for search capability; all smaller groups remain unimplemented here.

| Vendor / group | Entries |
|---|---:|
| Cityworks | 33 |
| CommunityCore | 27 |
| GovBuilt | 22 |
| CitySquared | 21 |
| Evolve | 20 |
| GovOutreach | 18 |
| CityInspect | 18 |
| FastTrackGov | 16 |
| PermitTrax | 15 |
| LOGIS | 14 |
| CivicPlus | 13 |
| LAMA | 12 |
| RTVision | 12 |
| GeoCivix | 12 |
| Camino / Clariti | 12 |
| MaintStar | 11 |
| SagesGov | 10 |
| Simplicity | 10 |
| ePlanSoft | 9 |
| Edmunds | 8 |
| CivicReview | 8 |
| Salesforce | 7 |
| CTS | 7 |
| Laserfiche | 6 |
| Jotform | 5 |
| Avolve / ProjectDox | 5 |
| CentralSquare | 5 |
| Oracle | 5 |
| iMS | 4 |
| AccessGov | 4 |
| POSSE | 4 |
| EdgeSoft | 4 |
| TRAISR | 4 |
| eProcess360 | 3 |
| Other: County building permit information | 2 |
| Other: City building permit information | 2 |
| OnlineGovt | 2 |
| Revize | 2 |
| Other: City permit forms and development information | 1 |
| Other: SimplePermit (commercial permits) | 1 |
| Other: ArcGIS Survey123 permit application | 1 |
| Other: Village building permit information | 1 |
| Other: City Permitting Information | 1 |
| Other: Permit Information | 1 |
| Other: Public Information Request / Public Use Permit Application | 1 |
| Other: City building permit form and zoning information | 1 |
| Other: Town building permits information | 1 |
| Other: CityReporter permit portal | 1 |
| Other: SeamlessDocs online building permit application | 1 |
| IDT Plans | 1 |
| Other: City-specific (ePlans Review plan review portal) | 1 |
| Other: Online Permit Center (RelayView) | 1 |
| Other: Government Window online building permit | 1 |
| Other: PIPER online permitting portal | 1 |
| Other: Infor Dynamic Portal | 1 |
| Other: City of Evanston permit hub (ArcGIS Hub) | 1 |
| Other: BFSbox online permit application | 1 |
| Other: Aktivov citizen portal | 1 |
| Other: City-built Knack Building & Codes Portal | 1 |
| Other: Centricity Permit Portal | 1 |
| Other: CMRpay customer permit portal | 1 |
| Other: UES CitizenPortal | 1 |
| Other: Infor Rhythm (Online Permitting System) | 1 |
| Other: NovoTX (Permitting Portal) | 1 |

## Survey sources opened

Each of these 24 stored URLs returned HTTP 200 in the initial HTML survey. Dynamic-app results and login/registration limitations are in the table above. No permit-count claim is made from HTTP status alone.

- Cityworks: Baltimore County, MD — https://cityworkspro.baltimorecountymd.gov/PLLPortal/
- Cityworks: Bonneville County, ID — https://app06.cityworksonline.com/CLIENT_BonnevilleCoID-public/login
- Cityworks: Jefferson County, ID — https://app04.cityworksonline.com/CLIENT_JeffersonCoID-public/login
- CommunityCore: Northglenn, CO — https://app.communitycore.com/app/public-portal/662c19d4-af95-4582-b1b8-67bf05daea70
- CommunityCore: Minneola, FL — https://app.communitycore.com/app/public-portal/0f0dbbfa-460b-4494-b2db-08ad7caeb902
- CommunityCore: Superior, CO — https://app.communitycore.com/app/public-portal/59de19d7-ed3b-4b27-8dce-18f77664872a
- GovBuilt: Milan, IL — https://milanil.govbuilt.com/
- GovBuilt: Westwood, KS — https://westwood.govbuilt.com/#page-top
- GovBuilt: Sunset Valley, TX — https://sunsetvalleytx.govbuilt.com/
- CitySquared: Bethel, CT — https://www.citysquared.com/#/app/BethelTownCT/landing
- CitySquared: Charlestown, RI — https://citysquared.com/#/app/CharlestownTownRI/landing
- CitySquared: Fairfield, CT — https://citysquared.com/#/app/FairfieldTownCT/landing
- Evolve: Chester County, SC — https://evolvepublic.infovisionsoftware.com/chester/
- Evolve: York, SC — https://evolve-public.infovisionsoftware.com/YorkCity/
- Evolve: Bryan County, GA — https://evolvepublic.infovisionsoftware.com/BryanCounty/
- GovOutreach: Freeland, PA — https://app.govoutreach.com/freelandboroughpa/public/permits
- GovOutreach: Brightwaters, NY — https://app.govoutreach.com/brightwatersny/public/permits
- GovOutreach: Rancho Viejo, TX — https://app.govoutreach.com/ranchoviejotowntx/public/permits
- CityInspect: Carbon County, UT — https://carboncounty.cityinspect.com/login
- CityInspect: Iron County, UT — https://ironcounty.cityinspect.com/register?registration_id=15ccc64ec1d01c
- CityInspect: Sanpete County, UT — https://sanpete.cityinspect.com/login
- FastTrackGov: Douglas County, MN — https://douglasctmn.portal.fasttrackgov.com/Common/ApplicationLinks.aspx
- FastTrackGov: Barnegat, NJ — https://barnegatnj.portal.fasttrackgov.com/Common/ApplicationLinks.aspx
- FastTrackGov: Denville, NJ — https://denvillenj.portal.fasttrackgov.com/Common/ApplicationLinks.aspx

## Final implementation and verification

Two adapters: govbuilt.ts and citysquared.ts, each registered under its own labels. Combined URL-shape coverage: 43/418 entries (22 GovBuilt + 21 CitySquared). This is not 43 verified working tenants. Six tenants passed live adapter searches; a seventh (Sunset Valley) failed with HTTP 404. Exact queries, timestamps, counts, samples and failures are in govbuilt.REPORT.md and citysquared.REPORT.md.

CitySquared recent listings for 2026-10-03 through 2026-10-10: Bethel 31; Charlestown 50; Fairfield 157. GovBuilt listRecent=false because creation/activity dates cannot honestly be relabeled issued/applied dates. Neither adapter supports verified contractor/company/license search yet. No government records or fixtures were fabricated.

Recorded fixtures and offline tests cover the two implemented adapters. The normal Vitest command hits EROFS in the container's read-only node_modules/.vite-temp; `--configLoader runner` uses the existing repository config without that temporary bundle. `npx tsc --noEmit -p .` passed both baseline and final checks. No server or database was started. No push was performed.

Follow-up priorities: validate more Cityworks tenants for genuine guest/public search; seek approved machine-readable access for CAPTCHA-gated CommunityCore; implement Evolve (20 entries) and FastTrackGov (16 entries), whose public forms already expose real date filters; investigate GovOutreach's loading failures. Do not infer that every portal in a login-only sample is globally incapable of public search.

Final verification (2026-10-10): `npx vitest run server/scrapers/govbuilt.test.ts server/scrapers/citysquared.test.ts --configLoader runner` — 2 files passed, 26 tests passed. `npx tsc --noEmit -p .` — exit 0. Code diff whitespace checks passed. The staged raw clearcreek-detail.html fixture has the server’s original trailing blank line; git flags it as a whitespace warning, and it is retained to preserve the fetched response. Initial shipping commit: f4ceee65; final commit contains CitySquared, GovBuilt detail, fixtures and completed reports.
