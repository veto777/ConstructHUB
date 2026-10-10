# Long tail B survey — 2026-10-10

Survey written before adapter implementation. 418 input entries; counts are entries, not unique hosts. Vendor grouping combines spelling variants and vendor-bearing URLs. Sample findings do not establish access for every tenant.

| Vendor | Entries | Tenants opened | Public search | Date listing | Mechanism / access |
|---|---:|---|---|---|---|
| Cityworks | 33 | Baltimore County MD; Bonneville County ID; Jefferson County ID | No anonymous search in sampled portals; Baltimore is a Timmons login page; hosted PublicAccess login has allowGuest=false. Also opened Alpharetta GA, Beaumont TX and Carmel IN: allowGuest=false. | Not available anonymously | ASP.NET login / Angular PublicAccess. No login attempted. |
| CommunityCore | 27 | Northglenn CO; Minneola FL; Superior CO | Northglenn and Minneola settings enable address, permit, parcel and owner search; Superior settings disable search. Search service requires RecaptchaToken header. | No date search in public search component | Angular /api/v1/public-portal/{registrationId}/settings; CAPTCHA-gated search excluded, no bypass attempted. |
| GovBuilt | 22 | Milan IL; Westwood KS; Sunset Valley TX | Milan and Westwood expose Activity Search Tool: reference number, address and name. Business-name search is license-only. Sunset Valley landing exposes application forms, no search link. | Created Date/Last Activity window; issue/application-date listing not verified | Anonymous GET /PublicReport/GetAllContentToolModels; tenant is host; paginated JSON. |
| CitySquared | 21 | Bethel CT; Charlestown RI; Fairfield CT | Public property lookup and property-linked records; permit-number and contractor filters under investigation. | Not yet verified | Angular hash tenant; public Municity5 tenant directory selects service host. Read-only WCF JSON endpoints. |
| Evolve | 20 | Chester County SC; York SC; Bryan County GA | Permit Search linked in all three. Chester/York search forms verified: address, permit number, contractor and parcel; York also subdivision. | Yes, Date Range option in Chester and York | ASP.NET WebForms __doPostBack; session/viewstate. |
| GovOutreach | 18 | Freeland PA; Brightwaters NY; Rancho Viejo TX | HTTP 200 app shell for all three. Freeland and Brightwaters browser attempts remained Loading; no usable search established. | Not established | React app with api.govoutreach.com core endpoints. Do not classify loading failure as zero records. |
| CityInspect | 18 | Carbon County UT; Iron County UT; Sanpete County UT | Carbon and Sanpete login walls; Iron registration form includes CAPTCHA. No public records search linked. | Not available anonymously | Login/registration/inspection-request workflows; no account created. |
| FastTrackGov | 16 | Douglas County MN; Barnegat NJ; Denville NJ | Public /Permits/Search.aspx links. Barnegat search has permit number, contractor/agent, street number/name; Douglas links Public Works search. | Yes, Application Date within Any/30 days/3 months/1 year in Barnegat form | ASP.NET WebForms; microapp comes from published tenant links. |

Selection: GovBuilt and CitySquared are the two largest groups with observed anonymous public record interfaces and no required CAPTCHA. Larger Cityworks samples require login; CommunityCore search explicitly invokes reCAPTCHA v3 and supplies its token with every search. These are excluded from this implementation rather than bypassed.

Initial HTTP survey: all 24 sampled stored URLs returned HTTP 200; HTML alone was insufficient for the JavaScript applications. No 403/429 was bypassed. Additional details and final verified capabilities are recorded below and in the vendor reports.

## Complete grouping

| Group | Entries |
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
| RTVision | 12 |
| Simplicity | 6 |
| LAMA | 5 |
| Geocivix | 5 |
| SagesGov | 4 |
| CivicPlus | 4 |
| CivicReview | 4 |
| Edmunds | 4 |
| IDT Plans | 3 |
| MaintStar | 3 |
| PeopleGIS SimpliCity | 3 |
| CTS city permit center | 3 |
| ePlanSoft GoPost electronic plan submittal | 3 |
| GeoCivix | 3 |
| TRAISR | 3 |
| Camino | 3 |
| County building permit information | 2 |
| SagesGov permitting portal | 2 |
| MaintStar permit portal | 2 |
| City building permit information | 2 |
| AccessGov online building permit application | 2 |
| OnLAMA (Online LAMA) | 2 |
| LAMA Online Permitting Portal | 2 |
| SAGES permitting portal | 2 |
| Jotform online application | 2 |
| Avolve ProjectDox | 2 |
| iMS (Intuitive Municipal Services) | 2 |
| EdgeSoft Online Permit Counter | 2 |
| CivicReview building permit application portal | 2 |
| Innoprise Citizen Access | 2 |
| ACC Community Portal (Salesforce) | 2 |
| Oracle Permitting and Licensing (OPAL) | 2 |
| Laserfiche | 2 |
| EdgeSoft Citizen Access Portal | 2 |
| ePlanSoft GoPost | 2 |
| Clariti permit portal | 2 |
| SAGES online permitting | 1 |
| Intuitive Municipal Solutions (iMS) permitting portal | 1 |
| City permit forms and development information | 1 |
| SimplePermit (commercial permits) | 1 |
| ArcGIS Survey123 permit application | 1 |
| Village building permit information | 1 |
| City Permitting Information | 1 |
| City online building permit form (CivicPlus Form Center) | 1 |
| CivicPlus online permit application | 1 |
| City online building permit application (CivicPlus Form Center) | 1 |
| Edmunds construction permit self-service | 1 |
| Permit Information | 1 |
| Jotform building permit application | 1 |
| Public Information Request / Public Use Permit Application | 1 |
| City building permit form and zoning information | 1 |
| AccessGOV | 1 |
| AccessGov property improvement permit form | 1 |
| Edmunds permit portal | 1 |
| Town building permits information | 1 |
| eProcess360 building permit portal | 1 |
| CityReporter permit portal | 1 |
| POSSE (county system) | 1 |
| Avolve ProjectDox (ePlans) | 1 |
| MaintStar Planning & Development Citizen Portal (via county link) | 1 |
| OnlineGovt Citizen Portal | 1 |
| eProcess360 online building permit application | 1 |
| IDT Plans (ePlan Review) | 1 |
| LAMA (independent city) | 1 |
| SeamlessDocs online building permit application | 1 |
| CivicPlus FormCenter (online ILP application) | 1 |
| LAMA online services portal | 1 |
| CivicPlus Form Center online permit application | 1 |
| CivicPlus FormCenter online permit application | 1 |
| City online building permit application (FormCenter) | 1 |
| Geocivix permit portal | 1 |
| City online Building & Remodel Permit application (CivicPlus Form Center) | 1 |
| City online applications (CivicReview) | 1 |
| City online forms (CivicPlus Form Center) | 1 |
| LAMA Permit Web Portal | 1 |
| City-specific (ePlans Review plan review portal) | 1 |
| ProjectDox (electronic plan submittal) | 1 |
| CentralSquare Citizen Self Service | 1 |
| Revize online forms | 1 |
| CentralSquare PublicAccess | 1 |
| ProjectDox/Avolve ePlan portal | 1 |
| OnlineGovt contractor permit portal | 1 |
| eProcess360 online permitting portal | 1 |
| JotForm | 1 |
| SAGES citizen portal | 1 |
| CentralSquare (city portal) | 1 |
| Jotform online building permit application | 1 |
| Online Permit Center (RelayView) | 1 |
| Oracle Permitting and Licensing (public self-service) | 1 |
| Laserfiche Forms online building permit application | 1 |
| POSSE online permit portal | 1 |
| MaintStar Customer Portal | 1 |
| Citizen self-service (cts.city) | 1 |
| Government Window online building permit | 1 |
| Yolo County Online Permits (Clariti) | 1 |
| CTS permit portal | 1 |
| Salesforce applicant permit portal | 1 |
| Clariti | 1 |
| Laserfiche Forms (online permit application) | 1 |
| PIPER online permitting portal | 1 |
| Salesforce Permits & Inspections Portal (independent city) | 1 |
| Salesforce E-Permitting Portal (independent city) | 1 |
| Infor Dynamic Portal | 1 |
| Laserfiche Forms (city) | 1 |
| Online building permit application (Laserfiche Forms) | 1 |
| Oracle Public Sector Permitting | 1 |
| iMS (Intuitive Municipal Solutions) | 1 |
| City of Evanston permit hub (ArcGIS Hub) | 1 |
| CTS ePlan and Permit Center | 1 |
| BFSbox online permit application | 1 |
| ePlanSoft GoPost plan submittal portal | 1 |
| Simplicity (MapsOnline) | 1 |
| Salesforce Permits & Inspections Portal | 1 |
| TRAISR Online Permit | 1 |
| Camino permitting portal | 1 |
| Aktivov citizen portal | 1 |
| MaintStar Citizen Portal | 1 |
| ePlanSoft GO-POST (ePlan review portal) | 1 |
| Edmunds GovTech Online Permit Application | 1 |
| CivicReview building permit application (via city link) | 1 |
| City-built Knack Building & Codes Portal | 1 |
| Oracle Permitting and Licensing (self-service) | 1 |
| Centricity Permit Portal | 1 |
| CMRpay customer permit portal | 1 |
| Salesforce E-Permitting Portal | 1 |
| MaintStar (Novato Permits) | 1 |
| UES CitizenPortal | 1 |
| MaintStar Civic Portal | 1 |
| Revize | 1 |
| e-PlanSoft goPost online submittal portal | 1 |
| Edmunds GovTech | 1 |
| POSSE LMS Public Permit Portal | 1 |
| Infor Rhythm (Online Permitting System) | 1 |
| Clariti (Camino/OnCamino) | 1 |
| Computronix POSSE | 1 |
| NovoTX (Permitting Portal) | 1 |
| Camino (Permitting & Registration Portal) | 1 |
| ePlanSoft GoPost (ePlan Review) | 1 |
| CTS city plan check / permit center | 1 |
| Clariti (Camino) | 1 |
| Camino (Online Application Portal) | 1 |
| Maintstar Permit Public | 1 |
