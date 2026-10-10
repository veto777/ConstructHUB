# GovBuilt — initial shipping checkpoint

Mechanism: anonymous Activity Search Tool HTML plus paginated GET `/PublicReport/GetAllContentToolModels`. Tenant host comes from the stored URL. GovBuilt subdomains only. All 22 GovBuilt entries match the host shape, but tenant public-search availability must be checked separately.

Capabilities: address, permit and generic name search. No contractor/company/license search: Business Name is a license-only filter. No listRecent: grid date is Created Date/Last Activity, not a verified issued/applied date. No detail yet. Record dates and contractor names remain null. Unmodified JSON rows retained as raw.

2026-10-10 initial live checks: Milan IL, https://milanil.govbuilt.com/, permit BP-2026-0119 returned 1 in 1 second; address 205 1st returned 1 in 2 seconds. Both returned BP-2026-0119, 205 1st Ave W, Milan, IL 61264, status Permit Issued, issuedAt null, contractorName null. A second sample does not exist for these one-record queries.

Sunset Valley TX `/activitysearchtool` returned HTTP 404 despite a working application landing. Not a zero-results search.

Final multi-tenant verification and coverage details will replace this checkpoint report.
