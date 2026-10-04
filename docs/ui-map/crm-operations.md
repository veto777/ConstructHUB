# CRM operations — element-by-element UI map (audit lane 5)

Audit of 2026-10-04. Every visible element of every CRM (portal) page, the client portal, and the public portal/lead-form pages: what it does, where it lives, which server route and query backs it, how it was verified (read-only SQL on constructhub_dev_a6, live API on the dev server, Playwright renders), and its status.

Legend — Kind: stat / count / badge / pill / button / tab / link / input / select / menu / dialog / banner / row / empty. Status: OK / BUG / UNCLEAR / DEAD.

Time windows are stated per element; "org tz" is the org's crm_orgs.timezone, "server-local" is the dev host clock (EDT at audit time).

## CRM shell — sidebar & ribbon (mounted on every /crm/* page; client/src/components/crm-sidebar.tsx + crm-ribbon.tsx)

The shell is the frame around every CRM page: `CrmSidebar` (desktop, collapsible) + `CrmRibbon`
(mobile bottom bar, `md:hidden`). Mounted in `client/src/App.tsx:631-651` inside the signed-in portal
branch (`portal && user`). The active org for all data is resolved server-side per request
(`requireOrg`, `server/crm/tenancy.ts:109` — session pin → first membership → new personal org).
Dev session: user 1 ("Veto", platform admin, role owner) in org **SKU Dry-Run** `c5b47b8d-caa8-47e6-ae7e-6248ad5df565`.
There is **no org switcher** in the sidebar or ribbon: `/api/crm/me` returns `orgs` (4 orgs for this
user, `server/crm/tenancy.ts:87`) but no client component consumes it; the switch endpoint
`POST /api/crm/org/switch` exists server-side (used by tests) with no UI. Org name under the logo is
display-only.

### 1. Sidebar header (brand + org identity + Create) — `client/src/components/crm-sidebar.tsx:113-150`

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| ConstructHUB CRM logo → Home (`link-portal-home`) | Link | Clicking the logo takes you to the CRM dashboard | crm-sidebar.tsx:114 | route `/` → App.tsx:392 `CrmHomePage` | Playwright render: href `/`; route in App.tsx:392 | OK |
| Org logo (`img-sidebar-org-logo`) | Image | Small org logo next to the name (only if the org has one) | crm-sidebar.tsx:120-123 | `GET /api/crm/me` → `org.logoUrl` (crm_orgs.logo_url, active org only) | `GET /api/crm/me` → `logoUrl: null`, image absent in render — correct conditional | OK |
| Org name text ("SKU Dry-Run") | Text | Shows which company's workspace you're in | crm-sidebar.tsx:124-126 | `GET /api/crm/me` → `org.name` (crm_orgs.name of the active org) | API `org.name` = "SKU Dry-Run" = rendered text | OK |
| Standing gator mascot | Decoration | Cartoon mascot next to the logo; does nothing | crm-sidebar.tsx:132 | client only | render | OK |
| "Create" button (`button-create`) | Button (menu trigger) | Opens the global Create menu (Estimate / Invoice / Lead / Message / Customer) — shared component, detailed in section 3 | crm-sidebar.tsx:136-149 | client only (menu items hit the endpoints in section 3) | Playwright: menu opens, 5 items visible | OK |

### 2. Sidebar "Workspace" nav group — `client/src/components/crm-sidebar.tsx:154-188`

Each item is a `Link` that also closes the mobile sheet on click (`closeOnPhone`, line 85).
Gating: `me.permissions[perm] === true` (owner has all; role defaults `shared/schema.ts:1410-1456`;
field/subcontractor have none of the gated ones). `me` = `GET /api/crm/me` (`server/crm/routes.ts:404`).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Workspace" group label | Text | Section heading, nothing clickable | crm-sidebar.tsx:156-158 | client only | render | OK |
| Home (`link-portal-nav-home`) | Link | Goes to the CRM dashboard | crm-sidebar.tsx:43-44 | route `/` → App.tsx:392 `CrmHomePage` (also active for `/crm`, `/crm/home` — App.tsx:393-394) | route in App.tsx:392; render href `/` | OK |
| Clients (`link-portal-nav-clients`) | Link | Opens the client list | crm-sidebar.tsx:45-46 | route `/crm/clients` → App.tsx:395 `CrmClientsPage` | route in App.tsx:395; render | OK |
| Messages (`link-portal-nav-messages`) | Link | Opens the message inbox | crm-sidebar.tsx:47-48 | route `/crm/inbox` → App.tsx:398 `CrmInboxPage`; page data `GET /api/crm/inbox` requires **manageCustomers** (403 otherwise, `server/crm/inbox.ts:73`; pinned by `server/crm/inbox.test.ts:273-284`) | route exists; gating mismatch → see BUG-1 | BUG |
| Unread badge on Messages (`badge-messages-unread`) | Badge (count) | Red pill showing how many unread client messages wait in the whole company inbox; hidden when 0; shows "99+" past 99 | crm-sidebar.tsx:92-96, 176-181 | `GET /api/crm/inbox` → `unreadTotal` = `SELECT count(*) FROM crm_client_comments WHERE org_id=<active org> AND author_member_id IS NULL AND read_at IS NULL` (server/crm/inbox.ts:99-106). No time window — all-time unread; org-scoped; only client-authored rows (portal writes, server/crm/attachments.ts:631,667); member replies are excluded (author set + read_at set, inbox.ts:193-199). Whole-org count, not the 200-row cap. For division-scoped members: object-policy filter instead (inbox.ts:107-113). Refetch every 30 s | `SQL: SELECT count(*) FROM crm_client_comments WHERE org_id='c5b47b8d-…' AND author_member_id IS NULL AND read_at IS NULL` → 0; `GET /api/crm/inbox` → `"unreadTotal":0`; badge absent in render. Insert-writers audited: only client-portal endpoints write NULL-author rows | OK |
| Pipeline (`link-portal-nav-pipeline`) | Link | Opens the job pipeline board | crm-sidebar.tsx:51-52 | route `/crm/pipeline` → App.tsx:403 `CrmPipelinePage`; also active for `/crm/projects/:id` (App.tsx:409) | routes in App.tsx:403,409 | OK |
| Estimates (`link-portal-nav-estimates`) | Link | Opens the estimates list | crm-sidebar.tsx:53-54 | route `/crm/estimates` → App.tsx:406 `CrmEstimatesPage` | route in App.tsx:406 | OK |
| Invoices (`link-portal-nav-invoices`) — hidden without `seePrices` | Link (gated) | Opens the invoices list | crm-sidebar.tsx:56-58 | route `/crm/invoices` → App.tsx:407 `CrmInvoicesPage`; list API `GET /api/crm/invoices` 403s without `seePrices` (server/crm/ops.ts:203, entities.ts:1107) — nav gate matches API gate exactly | route in App.tsx:407; gate parity ops.ts:203 | OK |
| Price book (`link-portal-nav-pricebook`) | Link | Opens the price book | crm-sidebar.tsx:59-60 | route `/crm/pricebook` → App.tsx:408 `CrmPriceBookPage` | route in App.tsx:408 | OK |
| Payments (`link-portal-nav-payments`) | Link | Opens the payments page | crm-sidebar.tsx:61-62 | route `/crm/payments` → App.tsx:410 `CrmPaymentsPage` | route in App.tsx:410 | OK |
| Team & Company (`link-portal-nav-team`) | Link | Opens team/company settings | crm-sidebar.tsx:63-64 | route `/crm/team` → App.tsx:411 `CrmTeamPage` | route in App.tsx:411 | OK |
| Integrations (`link-nav-integrations`) — hidden without `manageSettings` | Link (gated) | Opens the integrations hub | crm-sidebar.tsx:66-68 | route `/crm/integrations` → App.tsx:413 `CrmIntegrationsPage` | route in App.tsx:413 | OK |
| Settings (`link-nav-settings`) — hidden without `manageSettings` | Link (gated) | Opens workspace settings; also highlighted on the Import page | crm-sidebar.tsx:71-73 | route `/crm/settings` → App.tsx:412 `CrmSettingsPage`; active also for `/crm/migrate` → App.tsx:415 `CrmMigratePage` (Import is reached from Settings, crm-settings.tsx:2142) | routes in App.tsx:412,415 | OK |
| Platform Admin (`link-portal-nav-admin`) — platform admins only | Link (gated) | Opens the cross-account admin console | crm-sidebar.tsx:75-77 | route `/admin` → App.tsx:419 `CrmAdminPage` (full-bleed shell, App.tsx:579-598; same page at `/crm/admin`, App.tsx:416); `me.isPlatformAdmin` from `GET /api/crm/me` (server/crm/routes.ts:426) | render as dev platform admin (item visible); route in App.tsx:419; `/crm/admin` renders same page | OK |

### 2b. Sidebar "ConstructHUB" group — `client/src/components/crm-sidebar.tsx:192-209`

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "All ConstructHUB tools" (`link-portal-nav-platform`) | Link (external) | Leaves the CRM and opens the main ConstructHUB platform site with all the other tools | crm-sidebar.tsx:198-205; `marketingUrl("/")` client/src/lib/site.ts:73 | External navigation. Dev host (no portal. prefix, portal forced): `/?portal=0` → same SPA with portal force off → `PublicRouter` route `/` → `LandingPage` (App.tsx:288). Production portal host `portal.constructhub.us` → `https://constructhub.us/`. Full page load (plain `<a>`, another "face" of the same app) | Playwright: rendered href `http://127.0.0.1:8305/?portal=0`; loaded it: title "ConstructHUB — Nationwide Contractor Services", marketing nav, no CRM sidebar | OK |

### 2c. Sidebar footer (user chip, theme, sign out) — `client/src/components/crm-sidebar.tsx:212-248`

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Avatar / initial circle | Image/text | Your picture, or the first letter of your name | crm-sidebar.tsx:215-221 | `GET /api/auth/me` → users.avatar_url, display_name (server/auth.ts:668-696); fallback chain member.displayName → user.displayName → user.email (line 98) | API: avatarUrl null → "V" initial rendered; name rendered "Veto" (member displayName '' → user fallback works) | OK |
| User name (`text-user-name`) | Text | Shows your name | crm-sidebar.tsx:223-225 | same sources as above | render shows "Veto" | OK |
| Role line ("Owner") | Text | Shows your role in this company | crm-sidebar.tsx:226-230 | `GET /api/crm/me` → member.role (crm_members.role, capitalized by CSS) | API member.role="owner" → rendered "Owner" | OK |
| Theme toggle (`button-theme-toggle`) | Icon button | Switches between light and dark; remembers your choice | crm-sidebar.tsx:234; theme-toggle.tsx:5-20 | client only: toggles `dark` class on `<html>`, persists localStorage["theme"] (theme-provider.tsx:18-33) | code only | OK |
| Sign out (`button-logout`) | Icon button | Logs you out and lands on the sign-in screen | crm-sidebar.tsx:235-245 | `POST /api/auth/logout` → passport req.logout + session destroy, logs auth.logout + member auth activity (server/auth.ts:924-936); then `queryClient.clear()` + `window.location.href = "/auth"` | route exists, method matches (code-verified only — pressing it would destroy the shared dev session) | OK |

Note: the collapsed rail (icon mode) shows the same items as icons with tooltips and the bare CH logo
(crm-sidebar.tsx:116-132 group-data selectors) — same targets, nothing extra.

### 3. Create menu + dialogs (shared: opened from both sidebar and ribbon) — `client/src/components/crm-create-menu.tsx`

Menu items (crm-create-menu.tsx:560-583): Estimate always; Invoice requires `manageInvoices`;
Lead requires `manageCustomers` + `manageJobs`; Message and Customer require `manageCustomers` —
each client gate matches the server-side guard on its endpoint (verified per dialog below).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Estimate (`create-item-estimate`) | Menu item | Jumps straight to the new-estimate form | crm-create-menu.tsx:560-563 | route `/crm/estimates/new` → App.tsx:404 `CrmEstimateNewPage` | route in App.tsx:404 | OK |
| Invoice (`create-item-invoice`) | Menu item | Opens a quick-invoice dialog: pick client, say what for + amount, creates a one-line draft | crm-create-menu.tsx:564-568 | `POST /api/crm/invoices` body `{customerId, title, items:[{name, quantityMilli:1000, unitPriceCents}]}` → zod at server/crm/ops.ts:219-232 (invItem ops.ts:164-173 accepts all three fields); inserts crm_invoices (number via nextDocNumber, dueAt = now+30 d) + crm_invoice_items in one transaction; requires manageInvoices (ops.ts:220) | zod schema matches dialog body field-for-field; customer/org FK checks at ops.ts:236-238 | OK |
| Lead (`create-item-lead`) | Menu item | Opens a dialog that adds a client and puts a "— lead" job in the pipeline's Lead column | crm-create-menu.tsx:569-573 | `POST /api/crm/customers` (manageCustomers, server/crm/entities.ts:547-587, dedupe 409 with `matches`) then `POST /api/crm/projects` `{customerId, name "… — lead", status:"lead", addressLine1}` (manageJobs, entities.ts:859-883; "lead" ∈ CRM_PROJECT_STATUSES, shared/schema.ts:1604-1607) | both routes + schemas verified; status value valid | OK |
| Message (`create-item-message`) | Menu item | Opens the quick-message composer (email or text a client) | crm-create-menu.tsx:574-578 | composer sends `POST /api/crm/messages {customerId, channel:"email"|"text", body}` → server/crm/messages.ts:97-156 (manageCustomers, zod matches exactly); text channel additionally requires SMS plan + own sender (402/409, messages.ts:126-139); `GET /api/crm/sms/status` (server/crm/sms.ts:736) drives the grayed-out Text button + hint | body shape matches zod (messages.ts:104-108); sms/status route exists | OK |
| Customer (`create-item-customer`) | Menu item | Opens the new-client dialog; their client portal is created automatically | crm-create-menu.tsx:579-583 | `POST /api/crm/customers` body `{displayName, email, phone, addressLine1, notes}` → customerSchema (server/crm/entities.ts:346-361 + 547-587): insert crm_customers with org_id, owner_member_id, portal_token; 409 on email/phone dupe with `matches` for the dialog's "Open …" links | pressed live: POST with the dialog's exact body → 201, row in crm_customers with org_id=active org; DELETE cleaned up (200, row gone). Dupe 409 shape matches DupeError parser | OK |
| Client picker search (`input-message-client-search`, `client-pick-list`) | Input + list | Search box in the Invoice/Message dialogs to find a client by name, email or phone | crm-create-menu.tsx:73-127 | `GET /api/crm/customers?q=…` → ilike on display_name/email/phone/address/city/postal/company + digit-normalized phone match, org-scoped, excludes archived (server/crm/entities.ts:458-482) | route exists; query param `q` handled at entities.ts:461 | OK |
| Picked client + Change (`picked-client`, `button-change-client`) | Display + button | Shows the chosen client; Change puts the search box back | crm-create-menu.tsx:87-101 | client only | code only | OK |
| Dupe error links (`link-dupe-client-<id>`) | Link | When the client/lead already exists, links open the existing client's page instead | crm-create-menu.tsx:187-207 | route `/crm/clients/:id` → App.tsx:396 `CrmClientPage`; 409 payload `matches[]` from entities.ts:568-575 | route in App.tsx:396; 409 body shape matches parser | OK |
| New-client form fields (`input-customer-name/email/phone/addr`) | Inputs | Name (required), email (format checked), phone, address for the new client | crm-create-menu.tsx:133-183 | same `POST /api/crm/customers` (email zod `.email()`, phone max 40, name max 200 — client mirrors with EMAIL_RE + maxLength) | schema parity entities.ts:346-353 | OK |
| "Create client" (`button-save-customer`) | Button | Saves the new client and opens their page | crm-create-menu.tsx:259-261 | see Customer row above; on success navigates `/crm/clients/<id>` (App.tsx:396) | live press verified (201 → row created, then deleted) | OK |
| New-lead form fields (`input-lead-name/email/phone/addr/note`) | Inputs | Same as client plus a note field | crm-create-menu.tsx:313, 133-183 | see Lead row above (notes → crm_customers.notes, max 20000) | schema parity entities.ts:360 | OK |
| "Add lead" (`button-save-lead`) | Button | Creates the client + the lead project, lands on the pipeline | crm-create-menu.tsx:319-321 | two POSTs as above; on success navigates `/crm/pipeline` (App.tsx:403) | endpoints verified; navigations exist | OK |
| Invoice fields (`input-invoice-title`, `input-invoice-amount`, `error-invoice-amount`) | Inputs + error | What the invoice is for, and the amount (dollar parsing client-side) | crm-create-menu.tsx:382-403 | `POST /api/crm/invoices` — title max 200 (ops.ts:226), amount → unitPriceCents int; server re-computes totals via recalcInvoice | zod parity ops.ts:222-232 | OK |
| "Create draft invoice" (`button-save-invoice`) | Button | Creates the one-line draft and opens the client page to send it | crm-create-menu.tsx:406-409 | see Invoice row above; disabled until client + title + valid positive amount chosen | endpoint verified; disabled logic client-side | OK |
| Channel picker (`channel-email`, `channel-text`) | Buttons | Choose email or text; Text is grayed out with instructions when texting isn't set up | crm-create-menu.tsx:463-482 | email → `POST /api/crm/messages` (works if client has email, messages.ts:117-121); text → same endpoint, server 402/409 when plan/sender missing — gray-out mirrors `GET /api/crm/sms/status` (`orgSmsStatus`, sms.ts:736-742) | endpoint + status route verified; "Settings → SMS" link target `/crm/settings#sms` resolves (id="sms" at crm-settings.tsx:1382, deep-link handled at :533) | OK |
| Texting-off hint + "Settings → SMS" (`text-texting-off-hint`, `link-enable-texting`) | Text + link | Explains why Text is off and links to the SMS settings section | crm-create-menu.tsx:483-504 | route `/crm/settings` → App.tsx:412, anchor `#sms` → crm-settings.tsx:1382 | anchor exists | OK |
| No-email / no-phone hints (`text-no-email-hint`, `text-no-phone-hint`) | Text | Tells you the chosen client is missing the address/number needed for the channel | crm-create-menu.tsx:505-514 | client only (server double-checks: 400 "no email/phone", messages.ts:118-120, 140-143) | code only | OK |
| Message body (`input-message-body`) + Send (`button-send-message`) | Textarea + button | Writes and sends the quick message; lands on the client's timeline | crm-create-menu.tsx:517-531 | `POST /api/crm/messages` → deliverQuickMessage (email via provider / SMS via org sender), timeline rows invalidated on success; on 502 shows "The message could not be sent" | endpoint verified; not pressed (sends real email/text) | OK |

### 4. Mobile ribbon (bottom bar, `md:hidden`) — `client/src/components/crm-ribbon.tsx:126-143`

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Dashboard tab (`ribbon-tab-dashboard`) | Link | Goes to the CRM dashboard | crm-ribbon.tsx:133-134 | route `/` → App.tsx:392 `CrmHomePage` | render href `/`; route in App.tsx:392 | OK |
| Schedule tab (`ribbon-tab-schedule`) | Link | Opens the schedule (calendar) page | crm-ribbon.tsx:135-136 | route `/crm/schedule` → App.tsx:397 `CrmSchedulePage` | render; route in App.tsx:397 | OK |
| Inbox tab (`ribbon-tab-inbox`) | Link | Opens the message inbox | crm-ribbon.tsx:137-138 | route `/crm/inbox` → App.tsx:398; page API requires manageCustomers → 403 for field/subcontractor roles | route exists; gating mismatch → see BUG-1 | BUG |
| Clients tab (`ribbon-tab-customers`) | Link | Opens the client list | crm-ribbon.tsx:139-140 | route `/crm/clients` → App.tsx:395 `CrmClientsPage` | render; route in App.tsx:395 | OK |
| More tab (`ribbon-tab-more`) | Button | Opens the bottom sheet with the rest of the workspace | crm-ribbon.tsx:141-142 | client only | Playwright: tapping opens `ribbon-more-sheet` | OK |

Note: the ribbon Inbox tab carries **no unread badge** (desktop sidebar does) — a mobile/desktop
inconsistency, not a wrong number.

### 4b. "More" bottom sheet — `client/src/components/crm-ribbon.tsx:145-211`

Same permission gates as the sidebar (`me.permissions`, crm-ribbon.tsx:173-176). Every row also has a
ⓘ InfoTip (crm-ribbon.tsx:188) whose key must exist in `client/src/lib/info-content.ts` — all ten
(`pipeline`, `estimates`, `estimate-new`, `invoices`, `pricebook`, `payments`, `team`,
`integrations`, `settings`, `admin`) exist (info-content.ts:130,140,159,150,199,209,258,379,438,361),
so no dead ⓘ icons. Sheet closes on any navigation (line 178, 160).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Create" row (`ribbon-button-create`) | Button | Same global Create menu as the sidebar (section 3) | crm-ribbon.tsx:159-172 | see section 3 | Playwright: present in sheet | OK |
| Pipeline (`ribbon-more-pipeline`) | Link | Opens the pipeline board | crm-ribbon.tsx:38-40 | route `/crm/pipeline` → App.tsx:403; also active for `/crm/projects/:id` (App.tsx:409) | route exists | OK |
| Estimates (`ribbon-more-estimates`) | Link | Opens the estimates list | crm-ribbon.tsx:41-43 | route `/crm/estimates` → App.tsx:406 (active excludes `/crm/estimates/new`, which is its own row) | route exists | OK |
| New estimate (`ribbon-more-new-estimate`) | Link | One-tap jump to the new-estimate form | crm-ribbon.tsx:45-47 | route `/crm/estimates/new` → App.tsx:404 | route exists | OK |
| Invoices (`ribbon-more-invoices`) — `seePrices` gated | Link | Opens the invoices list | crm-ribbon.tsx:49-51 | route `/crm/invoices` → App.tsx:407; API gate seePrices (ops.ts:203) matches | route + gate parity | OK |
| Price book (`ribbon-more-pricebook`) | Link | Opens the price book | crm-ribbon.tsx:52-54 | route `/crm/pricebook` → App.tsx:408 | route exists | OK |
| Payments (`ribbon-more-payments`) | Link | Opens the payments page | crm-ribbon.tsx:55-57 | route `/crm/payments` → App.tsx:410 | route exists | OK |
| Team & Company (`ribbon-more-team`) | Link | Opens team/company page | crm-ribbon.tsx:58-60 | route `/crm/team` → App.tsx:411 | route exists | OK |
| Integrations (`ribbon-more-integrations`) — `manageSettings` gated | Link | Opens the integrations hub | crm-ribbon.tsx:62-64 | route `/crm/integrations` → App.tsx:413 | route exists | OK |
| Settings (`ribbon-more-settings`) — `manageSettings` gated | Link | Opens workspace settings | crm-ribbon.tsx:66-68 | route `/crm/settings` → App.tsx:412 | route exists | OK |
| Platform Admin (`ribbon-more-admin`) — platform admins only | Link | Opens the admin console | crm-ribbon.tsx:70-72 | route `/crm/admin` → App.tsx:416 `CrmAdminPage` (full-bleed shell at App.tsx:579). Note: sidebar points to `/admin` (App.tsx:419) — same page, but when you arrive via `/admin` this ribbon row is not highlighted (active matches only the `/crm/admin` prefix, crm-ribbon.tsx:72) | route exists; highlight nit is cosmetic | OK |
| "All ConstructHUB tools" (`ribbon-more-platform`) | Link (external) | Leaves the CRM for the main ConstructHUB platform site | crm-ribbon.tsx:192-197 | same as sidebar 2b: `marketingUrl("/")` → `/?portal=0` on this dev host (verified renders the marketing landing page), `https://constructhub.us/` on production portal hosts | Playwright: href `/?portal=0`; landing rendered | OK |
| Dark/Light mode row (`button-ribbon-theme-toggle`) | Button | Switches dark/light theme (label flips with current mode) | crm-ribbon.tsx:198-208 | client only (theme-provider localStorage) | code only | OK |

## Findings

### BUG-1 — "Messages"/"Inbox" nav is shown to roles the inbox API hard-denies (dead link for field crews & subs)

- What the owner sees: a field-role or subcontractor member (roles exist in `shared/schema.ts:1442-1455`,
  both lack `manageCustomers`) sees "Messages" in the sidebar and "Inbox" in the mobile ribbon like
  everyone else. Clicking it opens `/crm/inbox`, which renders "Couldn't load messages — Check your
  connection and refresh the page." (`client/src/pages/crm-inbox.tsx:141-143`) because the API 403s.
  The error card blames the connection, not permissions.
- What is true: every inbox route requires `manageCustomers` (`server/crm/inbox.ts:73` plus
  thread/read/reply routes), and the test suite pins that field role → 403
  (`server/crm/inbox.test.ts:273-284`). The nav rows in both shell files have **no gate**:
  `client/src/components/crm-sidebar.tsx:47-48` and `client/src/components/crm-ribbon.tsx:137-138`.
  Every other gated nav item in the same arrays carries a `perm:` key (Invoices `seePrices`,
  Integrations/Settings `manageSettings`) — Messages is the only one missing.
- Side effect: for those same roles the sidebar badge query 403s too, so `inboxSummary` stays
  undefined and `msgUnread = … ?? 0` (crm-sidebar.tsx:96) silently hides the badge — consistent, but
  it means the badge can never appear for a role that also can't open the page.
- Fix looks local and clear: add `perm: "manageCustomers"` to the Messages nav entry in
  crm-sidebar.tsx:47 and filter the ribbon Inbox tab on the same permission in crm-ribbon.tsx:137
  (or move the tab into the gated MORE_LINKS list). One-line change in each file; the permission and
  the gating idiom already exist.

### Observations (checked, not bugs)

- **No org switcher in the shell.** `/api/crm/me` returns `orgs` (4 for the dev user) and
  `POST /api/crm/org/switch` exists server-side, but no client component uses either
  (`grep org/switch client/src` → no matches). The sidebar shows the active org name read-only
  (resolved per request by `requireOrg`, `server/crm/tenancy.ts:109-148`: session pin → first
  membership → auto-created personal org). Users in multiple orgs have no in-app way to switch.
  UNCLEAR whether that is a deliberate v1 gap.
- **Mobile ribbon Inbox tab has no unread badge** — the desktop sidebar shows the red unread pill;
  the ribbon never does. Inconsistency, not a wrong number.
- **Ribbon Platform Admin row not highlighted on `/admin`.** Sidebar links to `/admin` (App.tsx:419),
  ribbon row links to `/crm/admin` (App.tsx:416) and its `active` matches only the `/crm/admin`
  prefix (crm-ribbon.tsx:72). Same page either way; cosmetic.
- **`/crm/reports` and `/crm/migrate` have no shell nav item** but the routes exist (App.tsx:414-415)
  and both are reachable in-app (`link-reports` from Settings crm-settings.tsx:2157 and Integrations
  crm-integrations.tsx:479; Import from Settings crm-settings.tsx:2142 and Clients crm-clients.tsx:197).
  Settings lights up on `/crm/migrate` as documented (crm-sidebar.tsx:70-73).
- The unread badge for **division-scoped members** takes a different code path
  (`objectPolicy` filter, `server/crm/inbox.ts:107-113`) whose count can be lower than the whole-org
  count. Verified by code only — no division-scoped member was available on the dev org to exercise it.

### Verification performed

- Badge number: `SQL SELECT count(*) FROM crm_client_comments WHERE org_id='c5b47b8d-…' AND
  author_member_id IS NULL AND read_at IS NULL` → 0, equals `GET /api/crm/inbox` →
  `{"unreadTotal":0}`; badge correctly absent in render. Query shape audited against all writers of
  `crm_client_comments` — only client-portal endpoints create NULL-author rows
  (`server/crm/attachments.ts:631,667`); member replies set author + read_at
  (`server/crm/inbox.ts:193-199`). Org scoping (`org_id = ctx.org.id`) confirmed in SQL and code;
  no time window (all-time unread); the whole-org count is separate from the 200-row thread cap
  (inbox.ts:97-98).
- Every sidebar/ribbon link target confirmed in `client/src/App.tsx` (`PortalRouter`, App.tsx:392-420).
- "All ConstructHUB tools" (`marketingUrl("/")`, client/src/lib/site.ts:73) loaded live on the dev
  host: `http://127.0.0.1:8305/?portal=0` renders the marketing landing page (title
  "ConstructHUB — Nationwide Contractor Services", no CRM sidebar). Production math
  (portal.constructhub.us → constructhub.us) verified by code.
- Create menu: customer-create pressed live with the dialog's exact body → 201, row visible in
  `crm_customers` with the active `org_id`, then deleted via `DELETE /api/crm/customers/:id` (200,
  row gone). Invoice/lead/message endpoints verified against their zod schemas and permission guards;
  message send not pressed (delivers real email/SMS). Logout verified by code only (pressing it would
  destroy the shared dev session).
- Renders (Playwright, chromium): desktop sidebar (all 12 nav items + user chip "Veto"/"Owner"),
  Create menu (5 items), mobile ribbon (5 tabs), More sheet (Create + 10 links + platform link +
  theme toggle + 11 info-tip icons incl. the page's own dashboard tip).

## Element counts

Total rows: 61 — OK 59 · BUG 2 (one root cause, BUG-1, counted on both the sidebar Messages row and
the ribbon Inbox row) · UNCLEAR 0 · DEAD 0.

Screenshots (render evidence): `shots/shell/desktop-sidebar.png`, `desktop-create-menu.png`,
`mobile-ribbon.png`, `mobile-more-sheet.png` in the lane scratchpad.


## ConstructHub CRM gateway (route `/crm-app`)

Page: `client/src/pages/crm-gateway.tsx` — the bridge from the growth platform (constructhub.us) into the CRM (portal.constructhub.us).

Route registration: `client/src/App.tsx:204` (signed-in marketing/dashboard frame, `DashboardRouter`) and `client/src/App.tsx:308` (signed-out marketing frame, `PublicRouter`). There is **no** `/crm-app` route in `PortalRouter` — on the portal host the URL falls through to `<Route component={CrmHomePage} />` (App.tsx:435) and renders the CRM dashboard instead (verified live: no gateway card, section label "Home"). That is by design per the file's header comment ("the pathway from the growth platform … into ConstructHub CRM"), noted here so no one expects the gateway on the portal host.

The page renders one of two completely different layouts depending on `GET /api/auth/me` (`server/auth.ts:668`, session user or `null`):
- **Signed in** → compact page in the app frame (`AppPage`): header + one status card + a collapsible feature list.
- **Signed out** → full marketing page (`PublicPageHeader` + hero + action card + feature grid + `PublicPageFooter`).

Both layouts call `GET /api/crm/me` (`server/crm/routes.ts:404`) which resolves the caller's org via `requireOrg` → `resolveOrg` (`server/crm/tenancy.ts:109-148`): session-pinned org if still an active member, otherwise the **oldest active membership** (`crm_members` WHERE `user_id`=? AND `status`='active' ORDER BY `created_at` ASC — `tenancy.ts:41-46`), otherwise it **creates a brand-new org on the spot** (`ensureOrgForUser`, `tenancy.ts:37-84`). Membership on this page = `data.org.id` being present.

The page has **no time-based numbers**. The only data values are the org name and the per-plan seat counts, both verified below.

### Signed-in view (app frame) — what dev admin (user 1) sees

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Page header "ConstructHub CRM" + "Clients, jobs and payments — all in one place." (icon: Kanban, from PAGE_ICONS `/crm-app`) | static text | Titles the page; the sentence is the product one-liner. | client/src/pages/crm-gateway.tsx:55; icon default client/src/components/app-ui.tsx:68 | client only: static copy. | code only | OK |
| "Open your CRM →" button (`button-open-crm`) | button | Jumps the browser to the CRM portal at `/crm` on the portal host. | client/src/pages/crm-gateway.tsx:51,56 | client only: `window.location.href = portalUrl("/crm")` (client/src/lib/site.ts:63-69). On a marketing host that is `https://portal.constructhub.us/crm`; on the portal host it is the same-host `/crm` → `PortalRouter` route `/crm` → CrmHomePage (client/src/App.tsx:393). | route `/crm` in App.tsx:393; rendered page screenshot `shots/gateway/01-crm-app-portal0-signedin.png`; portalUrl logic read in site.ts | OK (dev-only caveat: on 127.0.0.1:8305 the computed target `http://portal.127.0.0.1:8305/crm` does not resolve — `getent hosts portal.127.0.0.1` fails. Production host math is correct.) |
| "Request access" button (`button-crm-get-access`) — header slot, non-member only | link (mailto) | Opens the user's mail app pre-addressed to support@constructhub.us with subject "ConstructHub CRM access request". | client/src/pages/crm-gateway.tsx:57,26-27 | client only: `mailto:support@constructhub.us?subject=…`. | code only | DEAD — the non-member state it appears in is unreachable in normal operation: `/api/crm/me` auto-provisions an org for every signed-in user (`ensureOrgForUser`, server/crm/tenancy.ts:37-84, called from `resolveOrg` :141-142), so `data.org.id` is always set. This button shows only if `/api/crm/me` fails with a non-401 error. |
| Section title "Checking your access…" → "Your CRM is active" (member) / "Get your CRM workspace" (non-member) (`card-crm-gateway-action`) | status text | Tells you which of the three states you're in while the membership check runs. | client/src/pages/crm-gateway.tsx:59 | driven by React Query state of `/api/auth/me` + `/api/crm/me` (see page header above for backend). | rendered live ("Your CRM is active") | OK |
| "You're in **SKU Dry-Run**." | data text | Names the CRM workspace your account currently opens into. | client/src/pages/crm-gateway.tsx:60 (`orgName \|\| "your workspace"`) | GET /api/crm/me → `requireOrg` (server/crm/tenancy.ts:109) → session-pinned org, else oldest active membership (`crm_members.user_id=1 AND status='active' ORDER BY created_at ASC`, tenancy.ts:41-46) → `crm_orgs.name` of that org (presentOrg, server/crm/routes.ts:287). | SQL: oldest active membership of user 1 = org c5b47b8d-caa8-47e6-ae7e-6248ad5df565 "SKU Dry-Run" (created_at 2020-01-01); same-session `GET /api/crm/me` 200 returned that exact org; rendered page shows "You're in SKU Dry-Run." — all three agree. | OK (note: user 1 owns 4 orgs; the page names only the *active* one — matches the API contract, but a multi-org owner sees just one name here) |
| "Your CRM is included with every ConstructHUB plan. Starter 1, Pro 3, Growth 10 and Agency 10." (`text-crm-included`) | data text (plan fact) | Says the CRM ships with every plan and how many team seats each plan includes. | client/src/pages/crm-gateway.tsx:61,22; `CRM_SEATS_LINE` = shared/plan-copy.ts:65 | client only: string built from `PLANS[k].limits.crmSeats` in shared/plans.ts (starter:100 =1, pro:123 =3, growth:146 =10, agency:169 =10). Seat enforcement server-side uses the same numbers via `getOwnerSeatUsage` (server/crm/tenancy.ts:224-288, `ent.allowances.crmSeats`). | rendered text "Starter 1, Pro 3, Growth 10 and Agency 10" == plans.ts values; "every plan" true: all 4 PLAN_KEYS (plans.ts:16) have crmSeats ≥ 1 and there is no free plan | OK |
| "See plans" button (`button-crm-plans`, non-member only) | link | Goes to the Pricing page. | client/src/pages/crm-gateway.tsx:63 | client only: wouter `Link` to `/pricing` → PricingPage (client/src/App.tsx:176 signed-in frame, App.tsx:294 public frame). | route `/pricing` in App.tsx:176,294 | DEAD — same unreachable non-member branch as "Request access" above (target route itself is fine). |
| "Visit CRM ↗" button (`button-crm-preview`, non-member only) | link (new tab) | Opens the CRM portal home in a new tab so a prospect can look at the product. | client/src/pages/crm-gateway.tsx:64 | client only: `portalUrl("/crm")` target=_blank → portal host `/crm` → CrmHomePage (client/src/App.tsx:393). | route `/crm` in App.tsx:393; portalUrl read in site.ts:63-69 | DEAD — same unreachable non-member branch (target itself fine in production). |
| "Explore CRM features" (`<details>` summary) | disclosure (collapsed by default) | Expands a short static list of what the CRM does. | client/src/pages/crm-gateway.tsx:67-68 | client only. | code only; rendered collapsed on screenshot | OK |
| "Clients, jobs and payments — all in one place." (`text-crm-bubble`, inside the details) | static text | Repeat of the one-liner inside the disclosure. | client/src/pages/crm-gateway.tsx:69 | client only: static copy. | code only | OK |
| Feature list item 1 "Clients & their own portals" | static text | Marketing bullet: every client gets a branded portal. | client/src/pages/crm-gateway.tsx:30,70 | client only: copy (client portal feature exists — /portal/:token route, client/src/App.tsx:244). | code only | OK |
| Feature list item 2 "Estimates & invoices" | static text | Marketing bullet: estimates, e-sign, deposits, ACH/card payments. | client/src/pages/crm-gateway.tsx:31,70 | client only: copy (estimates/invoices/payments modules exist under server/crm/). | code only | OK |
| Feature list item 3 "Pipeline & scheduling" | static text | Marketing bullet: drag jobs across stages, crew scheduling. | client/src/pages/crm-gateway.tsx:32,70 | client only: copy (/crm/pipeline, /crm/schedule routes in App.tsx:397,403). | code only | OK |
| Feature list item 4 "Two-way messaging" | static text | Marketing bullet: client/team messages in one inbox. | client/src/pages/crm-gateway.tsx:33,70 | client only: copy (/crm/inbox, App.tsx:398; server/crm/messages.ts:97). | code only | OK |
| Feature list item 5 "HOVER sync" | static text | Marketing bullet: measurements/photos flow onto client profiles. | client/src/pages/crm-gateway.tsx:34,70 | client only: copy (HOVER integration exists: server/crm/hover.ts; measurements routes server/crm/pricebook.ts:934-979). | code only | OK |
| Feature list item 6 "Payments & financing" | static text | Marketing bullet: deposits, progress payments, point-of-sale financing. | client/src/pages/crm-gateway.tsx:35,70 | client only: copy (financing module exists: server/crm/financing.ts). | code only | OK |

### Signed-out view (marketing page) — full layout with its own header/footer

The `PublicPageHeader`/`PublicPageFooter` render **only when signed out** (`useSignedOut()`, client/src/components/public-page-chrome.tsx:19-22,36-45,71-72). This branch could not be rendered live because the dev server auto-signs in as dev admin; it is verified by code, and every link target below was checked against `App.tsx`.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Public page header (`header-public-page`) → `SiteNavBar signedIn={false}` | nav bar (shared chrome) | The standard marketing ribbon: logo, Features ▾ and Done-For-You ▾ dropdowns (every entry from the feature/dfy catalogues), home-section anchors, Plans, sign-in / get-started (passes `next=/crm-app` so you come back here after signing in). | client/src/pages/crm-gateway.tsx:77; client/src/components/public-page-chrome.tsx:36-45; client/src/components/site-nav.tsx | client only: links to catalogue routes (`/features`, `/features/:slug`, `/done-for-you`, …) all registered in App.tsx:208-212/208-213; sign-in goes to `/auth` (App.tsx:237/289). | code only (shared chrome rendered by every public page) | OK |
| Kicker "▦ Included with every plan" | static text | Small flag above the headline. | client/src/pages/crm-gateway.tsx:83-85 | client only. | code only | OK |
| H1 "ConstructHub CRM" | static text | The page headline. | client/src/pages/crm-gateway.tsx:86-88 | client only. | code only | OK |
| Hero paragraph (`text-crm-included`) "…included with every ConstructHUB plan. Your plan sets the number of team seats: Starter 1, Pro 3, Growth 10 and Agency 10." | data text (plan fact) | Same seats statement as the signed-in card. | client/src/pages/crm-gateway.tsx:89-93,22 | client only: `CRM_SEATS_LINE` from shared/plans.ts crmSeats 1/3/10/10 (same verification as the signed-in row). | values match plans.ts:100,123,146,169 | OK |
| Mascot speech-bubble panel (`text-crm-bubble` + StandingGator, `aria-hidden`) | decorative | Gator mascot with the one-liner; nothing clickable. | client/src/pages/crm-gateway.tsx:95-106 | client only. | code only | OK |
| Action card loading state: spinner "Checking your access…" (`card-crm-gateway-action`) | status | Shown briefly while your sign-in and membership are being checked. | client/src/pages/crm-gateway.tsx:116-119 | driven by `/api/auth/me` + `/api/crm/me` query state. | code only | OK |
| Signed-out state: "Sign in to open your CRM" heading + explanation | static text | Tells a visitor to sign in so the site can check their company workspace. | client/src/pages/crm-gateway.tsx:121-130 | client only. | code only | OK |
| "Sign in →" button (`button-crm-signin`) | link | Goes to the sign-in screen; after login you are sent back to this page (`next=/crm-app`). | client/src/pages/crm-gateway.tsx:132 | client only: `/auth?next=%2Fcrm-app` → AuthPage (App.tsx:237/289); `next` validated same-origin and used for post-login redirect (client/src/pages/auth.tsx:40-48). | auth.tsx:40-48 next handling read; `/auth` route in App.tsx:237,289 | OK |
| "Create an account" button (`button-crm-signup`) | link | Goes to the sign-up screen (signup mode); after signup you return here. | client/src/pages/crm-gateway.tsx:135 | client only: `/auth?mode=signup&next=%2Fcrm-app` → AuthPage; `mode=signup` selects the signup screen (client/src/pages/auth.tsx:51-55). | auth.tsx:51-55 read; route in App.tsx:237,289 | OK |
| Member state: "✓ Your CRM is active" + "You're in **{orgName}**. It lives at your portal address." | data text | Same member message as the signed-in card, shown if a signed-in-session browser ever hits this public layout. | client/src/pages/crm-gateway.tsx:140-150 | GET /api/crm/me org name (same backend as the signed-in "You're in" row). | same SQL/API verification | OK |
| Member state: "Open your CRM →" button (`button-open-crm`) | button | Same portal jump as the signed-in header button. | client/src/pages/crm-gateway.tsx:151 | client only: `portalUrl("/crm")`; route `/crm` → CrmHomePage (App.tsx:393). | route in App.tsx:393 | OK (same dev-only dead-host caveat: `portal.127.0.0.1` doesn't resolve locally) |
| Non-member state: "Get your CRM workspace" heading + "We couldn't find a CRM workspace… email us…" copy | static text | Claims your account has no workspace and one must be requested by email. | client/src/pages/crm-gateway.tsx:156-166 | — (the claim is produced client-side; the server contradicts it, see below) | code + server logic | DEAD — unreachable in normal operation: `resolveOrg` auto-creates a personal org for any signed-in user without one (server/crm/tenancy.ts:141-142 → `ensureOrgForUser` :37-84, which INSERTs into `crm_orgs` + `crm_members`), so `/api/crm/me` always returns an org and the page always takes the member branch. This whole state renders only when `/api/crm/me` errors with something other than 401. The copy also misdescribes reality ("we couldn't find a workspace") since the server just made one. Product decision needed, not a data bug. |
| Non-member state: "✉ Request access" button (`button-crm-get-access`) | link (mailto) | Opens mail app to support@constructhub.us requesting a workspace. | client/src/pages/crm-gateway.tsx:168-170,26-27 | client only: mailto. | code only | DEAD — same unreachable branch. |
| Non-member state: "See plans →" button (`button-crm-plans`) | link | Goes to Pricing. | client/src/pages/crm-gateway.tsx:171-173 | client only: `/pricing` (App.tsx:176/294). | route exists | DEAD — same unreachable branch (target fine). |
| Non-member state: "Visit CRM ↗" button (`button-crm-preview`) | link (new tab) | Opens the CRM portal home in a new tab. | client/src/pages/crm-gateway.tsx:174-176 | client only: `portalUrl("/crm")` (App.tsx:393). | route exists | DEAD — same unreachable branch (target fine in production). |
| "What's in it" kicker (`01`) | static text | Labels the feature grid. | client/src/pages/crm-gateway.tsx:183-185 | client only. | code only | OK |
| Feature tiles 01-06: Clients & their own portals / Estimates & invoices / Pipeline & scheduling / Two-way messaging / HOVER sync / Payments & financing (hover only changes background colour) | static tiles | The six marketing claims, numbered 01–06 (enumeration, not data). Same copy as the signed-in disclosure. | client/src/pages/crm-gateway.tsx:186-199,29-36 | client only. Claims backed by real modules: client portals (/portal/:token), estimates/invoices/payments (server/crm/), pipeline/schedule (App.tsx:397,403), messaging (server/crm/messages.ts:97), HOVER (server/crm/hover.ts), financing (server/crm/financing.ts). | code only | OK |
| Footnote "One ConstructHUB plan covers both your growth tools … and the CRM. Extra CRM seats are an add-on." | static text | Explains plans cover growth + CRM together; extra seats cost extra. | client/src/pages/crm-gateway.tsx:201-204 | client only: "extra seats are an add-on" matches ADDONS.extra_seat "One more CRM or agency team seat" (shared/plans.ts:332). | plans.ts:332 | OK |
| Public page footer (`footer-public-page`): Home, Features, Done-For-You, AI Call Assistant, support@constructhub.us (mailto), Terms, Privacy + guide links (Google Ads Guide, LSA Guide, Click Fraud: What We Observed, Google Business Profile Tools) + `© 2026 ConstructHUB` | footer (shared chrome) | Standard marketing footer on every public page. | client/src/pages/crm-gateway.tsx:207; client/src/components/public-page-chrome.tsx:71-94,51-69 | client only: `/` (App.tsx:166/288), `/features` (:208/310), `/done-for-you` (:211/312), `/call-assistant` (:206/309), `/terms` (:230/326), `/privacy` (:229/325), guides `/google-ads-guide` (:198-199/303-304), `/lsa-guide` (:201/306), `/google-ad-fraud` (:200/305), `/google-business` (:192/299); copyright via client/src/lib/marketing.ts `copyrightNotice()`. | every target route present in App.tsx | OK |

### Page-level findings

1. **No fabricated or mismatched numbers.** The only live data on the page is the org name, and it was reproduced exactly from the database (oldest active membership rule) and matched the same-session API response and the rendered text.
2. **The "Get your CRM workspace" / "Request access" flow is dead in practice** (9 elements marked DEAD above). Root cause is server-side auto-provisioning (`server/crm/tenancy.ts:37-84` via `resolveOrg` at `:141-142`), not a frontend bug; the frontend copy ("We couldn't find a CRM workspace for your account") is the only thing that is factually wrong, and only in a state that essentially never renders. Fix is a product decision (remove the state, or make the server stop auto-provisioning); not a local code fix.
3. **Dev-only caveat (not a production bug):** `portalUrl("/crm")` builds `http://portal.<current-host>/crm`; on `127.0.0.1:8305` that host does not resolve (`getent hosts portal.127.0.0.1` → NXDOMAIN), so "Open your CRM"/"Visit CRM" can't be exercised locally. On production marketing hosts the target `https://portal.constructhub.us/crm` is correct and the `/crm` route exists (App.tsx:393).
4. **`/crm-app` on the portal host silently renders the CRM dashboard** (fallback route App.tsx:435), not the gateway. Verified live (no `card-crm-gateway-action`, section "Home"). By design — the gateway is the marketing→portal bridge — but worth a doc comment.
5. Signed-out branch (public layout) not rendered live: the dev server auto-authenticates, so that layout was verified by code plus route existence for every link; the AuthPage `next`/`mode` params were verified in code (client/src/pages/auth.tsx:40-55).

### Routes used that have no doc comment in App.tsx

- `client/src/App.tsx:204` — `/crm-app` → CrmGatewayPage (DashboardRouter). No comment; page itself carries a header doc block.
- `client/src/App.tsx:308` — `/crm-app` → CrmGatewayPage (PublicRouter). No comment.
- `client/src/App.tsx:393` — `/crm` → CrmHomePage (PortalRouter). No comment (neighbours `/` and `/crm/home` have none either).
- `client/src/App.tsx:176` and `:294` — `/pricing` → PricingPage. No comment.
- `client/src/App.tsx:237` and `:289` — `/auth` → AuthPage. No comment (the portal copy at App.tsx:428 is commented).


## CRM Home / Dashboard (routes `/`, `/crm`, `/crm/home` → client/src/pages/crm-home.tsx)

Audited against the dev org **SKU Dry-Run** (`c5b47b8d-caa8-47e6-ae7e-6248ad5df565`), signed in as its owner (all permissions on, incl. `seePrices`, `seeReporting`, `manageCustomers`). All SQL run on `constructhub_dev_a6` 2026-10-04 ~19:00–19:05 EDT (server timestamps UTC).

**Page-level data sources:** `GET /api/crm/me` (org name, permissions), `GET /api/crm/onboarding` (checklist), `GET /api/crm/stats` (4 headline cards + pipeline + client count), `GET /api/crm/customers` (newest 500), `GET /api/crm/projects` (newest 2,000 + uncapped stageCounts), `GET /api/crm/attention` (needs-attention lists), `GET /api/crm/follow-ups` (cadence dialog), `GET /api/crm/team-activity` (feed, refetch every 60 s).

### Page header

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Page title (org name, e.g. "SKU Dry-Run") | text | Shows the name of the workspace you're in. | client/src/pages/crm-home.tsx:209-211 | GET /api/crm/me → server/crm/routes.ts:404 → crm_orgs.name via presentOrg(ctx.org) | GET /api/crm/me 200, org.name matches page render | OK |
| ⓘ Info icon next to title (info-tip-dashboard) | button → dialog | Opens "Your dashboard" help dialog explaining the page in plain English. | client/src/pages/crm-home.tsx:212; client/src/components/info-tip.tsx:29 | client only: INFO_CONTENT["dashboard"] in client/src/lib/info-content.ts:24 | key exists in info-content.ts:24; dialog renders (InfoTip returns null for missing keys — not dead) | OK |
| Subtitle ("A couple of things left…" / "Your workspace is set up…") | text | One-line status under the title based on the setup checklist. | client/src/pages/crm-home.tsx:214-218 | client only: ob.requiredComplete from GET /api/crm/onboarding (server/crm/routes.ts:607) | render + API field | OK |

### "Finish setting up" checklist card (card-setup) — visible until dismissed & done

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Card "Finish setting up" + "N of M done" (card-setup) | card + counts | Setup to-do list; the counts are how many of the 3 steps are complete. | client/src/pages/crm-home.tsx:221-231 | GET /api/crm/onboarding → server/crm/routes.ts:555 → completedCount/totalCount (3 fixed steps: profile, company, team) | GET /api/crm/onboarding returned completedCount 1 / totalCount 3; render shows "1 of 3 done" | OK |
| Progress bar (progress-setup) | progress | Visual fill of the same completion fraction (here 33%). | client/src/pages/crm-home.tsx:163,230 | client only: Math.round(completedCount/totalCount*100) | render | OK |
| Step row "Your profile" (step-profile) | link | Goes to your profile tab on Team & Company so you can add name + mobile. Marked done when you have both. | client/src/pages/crm-home.tsx:233-264 | done = member.displayName and member.phone non-empty (server/crm/routes.ts:565); path /crm/team?tab=profile | API: done:false (dev member has blank displayName/phone) ✓; route /crm/team in App.tsx:411, ?tab= handled crm-team.tsx:308 | OK |
| Step row "Company details" (step-company) | link | Goes to the company tab to fill business name/address/phone that print on documents. Locked (non-link) if you can't manage settings. | client/src/pages/crm-home.tsx:233-264 | done = org name+address+city+state+phone present (server/crm/routes.ts:566-568); locked = !manageSettings; path /crm/team?tab=company | API: done:false (org addressLine1 null), locked:false (owner) ✓; render shows unlocked row | OK |
| Step row "Invite your crew" (step-team) | link | Goes to the team tab to invite staff. Marked done as soon as anyone besides you exists; never blocking ("optional" badge). | client/src/pages/crm-home.tsx:233-264 | done = count(crm_members where org_id) > 1 (server/crm/routes.ts:571); SQL: 4 members → done:true matches API | SQL SELECT count(*) FROM crm_members WHERE org_id=… = 4; API done:true ✓ | OK |
| "next" / "optional" badges on steps | badge | "next" marks the step the server picked as your next action; "optional" marks the non-required step. | client/src/pages/crm-home.tsx:253-254 | nextStep = first unfinished non-locked step, required first (server/crm/routes.ts:602-605) | API nextStep:"profile"; render shows "next" on Your profile | OK |
| Locked-step look (Lock icon, "Ask an admin to do this one.") | static | Shows a step you can't do because of your role; it is deliberately not a link. | client/src/pages/crm-home.tsx:245-257,263-264 | driven by step.locked from onboarding payload | code only (dev owner is never locked) | OK |
| Button "Continue: <label>" (button-continue-setup) | button | Jumps straight to the page for your next unfinished step. | client/src/pages/crm-home.tsx:268-271 | client only: navigate(nextStep.path) — no request | render shows "Continue: Your profile"; code only for the click | OK |
| Button "Skip for now" (button-skip-setup) | button | Hides the checklist (for admins only shown when required steps are done but the optional one remains). | client/src/pages/crm-home.tsx:277-281 | POST /api/crm/onboarding/dismiss {} → server/crm/routes.ts:624 → UPDATE crm_orgs.onboarding_dismissed_at (requires manageSettings) | endpoint verified by code + shape matches mutation; not pressed (would hide the shared dev org's checklist) | OK |
| Button "All done" (button-finish-setup) | button | Shown when no actionable step remains; dismisses the checklist permanently. | client/src/pages/crm-home.tsx:272-276 | POST /api/crm/onboarding/dismiss (same as above) | code only (not reachable in current dev state) | OK |

### Headline stat cards (count on top, dollars underneath; dollars hidden without seePrices)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Open estimates" 2,315 / $3,807,503 (card-stat-open-estimates) | stat + link | Counts estimates still out with a client (sent or opened, any time) and their total value; click opens the estimates list. | client/src/pages/crm-home.tsx:289-290 | GET /api/crm/stats → server/crm/stats.ts:94-100: count + sum(total_cents) FROM crm_estimates WHERE org_id AND status IN ('sent','viewed') — no time window, includes archived-none, org-scoped | SQL: SELECT count(*), coalesce(sum(total_cents),0) … status IN ('sent','viewed') = **2315 / 380750261** = API ✓; render shows same ($ rounded to whole dollars) | OK (number) — **BUG (link)** |
| ↳ its link target `/crm/estimates` | link | Opens the estimates page — **but with no status filter, so the list shows all 6,807 estimates (drafts, approved, declined…), not the 2,315 the card counted.** The sibling "Jobs won" card links `?status=approved` and matches its number; this one should be `?status=sent,viewed`. | client/src/pages/crm-home.tsx:290 | route /crm/estimates in App.tsx:406; list page honors ?status= via URL (client/src/pages/crm-documents.tsx:155-162) | live nav: /crm/estimates → "All" checkbox ticked (no filter); SQL total estimates = 6,807 vs tile 2,315. ?status=sent,viewed is a supported filter shape (comma list) | BUG |
| "Jobs won" 1,602 / $6,627,666 (card-stat-jobs-won) | stat + link | Counts estimates the client approved (signed), and their value; click opens the estimates list pre-filtered to Approved. | client/src/pages/crm-home.tsx:292-293 | server/crm/stats.ts:102-108: count + sum(coalesce(approved_total_cents, total_cents)) FROM crm_estimates WHERE org_id AND status='approved' | SQL = **1602 / 662766605** = API ✓; render ✓ | OK |
| ↳ its link target `/crm/estimates?status=approved` | link | Lands on the estimates list with the Approved box pre-ticked — list length matches the tile's number. | client/src/pages/crm-home.tsx:293 | route App.tsx:406; filter parsing crm-documents.tsx:162 | live nav: /crm/estimates?status=approved → filter-status-approved ticked ✓ | OK |
| "Unscheduled jobs" 502 / $2,630,154 (card-stat-unscheduled) | stat + link | Counts jobs sold but not yet put on the calendar — the pipeline's "Approved" column — and their contract value. | client/src/pages/crm-home.tsx:295-296 | server/crm/stats.ts:111-118: count + sum(coalesce(contract_value_cents,0)) FROM crm_projects WHERE org_id AND status='approved' AND archived_at IS NULL | SQL = **502 / 263015424** = API ✓. Semantics cross-check: 0 of 502 approved projects have start_date or a crm_appointments row, so "unscheduled" is truthful for this data | OK |
| ↳ its link target `/crm/pipeline?stage=approved` | link | Lands on the pipeline board and highlights the Approved column. | client/src/pages/crm-home.tsx:296 | route /crm/pipeline App.tsx:403; deep-link honored client/src/pages/crm-pipeline.tsx:262-268 (scrolls to + rings stage-col-approved) | route exists; param handling verified in code | OK |
| "Open invoices" 540 / $677,684 (card-stat-open-invoices) | stat + link | Counts invoices still owed (sent or partially paid) and the remaining balance. Card is not a link for teammates without seePrices. | client/src/pages/crm-home.tsx:297-298 | server/crm/stats.ts:120-128: count + sum(greatest(total_cents - paid_cents,0)) FROM crm_invoices WHERE org_id AND status IN ('sent','partial') | SQL = **540 / 67768355** = API ✓; render ✓ | OK (number) — **BUG (link)** |
| ↳ its link target `/crm/invoices` | link | Opens the invoices page — **unfiltered, so it shows all 2,168 invoices (drafts, paid, void…) instead of the 540 open ones the card counted.** Should be `/crm/invoices?status=sent,partial`. | client/src/pages/crm-home.tsx:298 | route /crm/invoices App.tsx:407; filter parsing crm-documents.tsx:162 | live nav: /crm/invoices → "All" ticked; SQL total invoices = 2,168 vs tile 540; live nav /crm/invoices?status=sent,partial pre-ticks both boxes ✓ (so the fix shape works) | BUG |

Note: when a user lacks the `seeReporting` permission, GET /api/crm/stats 403s and the cards render "—" (stat ? count : "—", crm-home.tsx:80) — an honest empty state, not a fabricated 0.

### Numbers row (MetricCards)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Clients 7,506 — in your book…" | stat + link | Total active clients in the workspace (the real count, not the 500-row list the page also loads); click opens the client list. | client/src/pages/crm-home.tsx:303-309,197-200 | GET /api/crm/stats → server/crm/stats.ts:139-141: count(*) FROM crm_customers WHERE org_id AND archived_at IS NULL | SQL = **7506** = API ✓. Fallback honesty check: the raw list GET /api/crm/customers returns exactly 500 (newest-first cap, entities.ts:540-542) and the page never shows "500" as the total — it prefers stats.clients.count | OK |
| "Pipeline value $2,971,667 — across 2,436 open projects (not cancelled or paid)" (seePrices view) | stat + link | Dollar total of contract values for every live job (excludes cancelled and paid); click opens the board. | client/src/pages/crm-home.tsx:310-319,190-194 | server/crm/stats.ts:130-137: count + sum(coalesce(contract_value_cents,0)) FROM crm_projects WHERE org_id AND archived_at IS NULL AND status NOT IN ('cancelled','paid') | SQL = **2436 / 297166674** = API ✓; render "$2,971,667 … across 2,436 open projects" ✓. Fallback if stats fails: sums only the 2,000 loaded cards and labels itself "newest 2,000 of 2,436" (crm-home.tsx:194,315-317) — honest partial | OK |
| "Open projects <n>" (no-seePrices variant) | stat + link | Same count without dollars, for teammates who can't see prices. | client/src/pages/crm-home.tsx:320-328 | same openPipeline count via stageCounts | code only (dev owner has seePrices so this branch doesn't render here); count source identical to verified pipeline count | OK |
| "Leads to follow up 1,911 — sitting in the first stage" | stat + link | Every job still sitting in the board's first stage (Lead), i.e. untouched leads; click opens the board at that column. | client/src/pages/crm-home.tsx:329-335,180-182 | GET /api/crm/projects stageCounts (entities.ts:842-847, uncapped per-stage COUNT over non-archived org projects) summed over stages whose group = first swimlane's group ("Prospect" = status 'lead' only, shared/schema.ts:1624-1637) | SQL: SELECT count(*) FROM crm_projects WHERE org_id AND archived_at IS NULL AND status='lead' = **1911** = stageCounts.lead ✓; render ✓; link /crm/pipeline?stage=lead handled by crm-pipeline.tsx:262-268 | OK |

### "Needs attention" card

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Card header "Needs attention" + description | text | Section for follow-up calls that are due, brand-new leads, and leads with no estimate yet. | client/src/pages/crm-home.tsx:340-353 | — | render | OK |
| "Follow-ups" button (button-manage-follow-ups) | button | Opens the cadence dialog (weekly/biweekly reminders per client). Only shown with manageCustomers. | client/src/pages/crm-home.tsx:346-351 | client only: setFollowUpsOpen(true) | pressed in Playwright — dialog-follow-ups opened ✓ | OK |
| Error line "Couldn't load the follow-up list…" | text | Shown if GET /api/crm/attention fails. | client/src/pages/crm-home.tsx:356-357 | — | code only | OK |
| Empty state "All caught up" | empty state | Shown when all three sub-lists are empty. | client/src/pages/crm-home.tsx:358-364 | — | code only (dev data has leads, so not shown here) | OK |
| Section "Due for follow-up" (section-follow-ups-due) | list | Clients whose weekly/biweekly call rhythm has come due; each row links to the client and has a Done button. | client/src/pages/crm-home.tsx:367-394 | GET /api/crm/attention → server/crm/follow-ups.ts:166 → followUpsForOrg (follow-ups.ts:46-84): crm_customers WHERE org_id AND archived_at IS NULL AND follow_up_cadence_days ≥ 1; due = now ≥ (last_follow_up_at ?? created_at) + cadenceDays days; overdueDays = floor((now−dueAt)/1day); list capped at 10 server-side | SQL: 0 cadenced customers in org → API followUpsDue:[] ✓ (empty state rendered). "Done" row path: PATCH {markDone:true} verified end-to-end with an AUDIT- client (cadence set → due math → stamp last_follow_up_at ✓, then cleaned up) | OK |
| Row: client name link → /crm/clients/:id | link | Opens that client's page. | client/src/pages/crm-home.tsx:376 | route /crm/clients/:id App.tsx:396 | route exists | OK |
| Row sub-line "Nd overdue / Due today · weekly|biweekly rhythm" | text | How late the call is and which rhythm the client is on. | client/src/pages/crm-home.tsx:378-381 | computed server-side from cadence fields (no time-zone tricks: epoch-ms arithmetic) | code + e2e probe ✓ | OK |
| "Done" button per row (button-followup-done-<id>) | button | Stamps the client as just followed up; the row drops out of the due list and the feed gains a "followed up with …" entry. | client/src/pages/crm-home.tsx:384-390 | PATCH /api/crm/customers/:id/follow-up {markDone:true} → server/crm/follow-ups.ts:185-219 → UPDATE crm_customers.last_follow_up_at=now (+ logTeamActivity row) | pressed against live server with AUDIT- customer: 200, last_follow_up_at stamped, appears in GET /api/crm/follow-ups, team-activity row written ✓ (test rows deleted after) | OK |
| Section "New leads" (section-new-leads) | list | Jobs created in the last 14 days that are still in the Lead stage; each row links to the job. Shows at most 10 (no total shown, so nothing false is claimed). | client/src/pages/crm-home.tsx:395-416 | server/crm/follow-ups.ts:156-160: prospect-group projects (status 'lead'), created_at ≥ now−14 days (rolling, server clock), newest first, cap 10 | SQL top-10 ids in 14-day window = API list exactly (P-3630 … P-3616) ✓; 752 such leads exist — 10 shown, no count implied | OK |
| "New" badge on lead rows | badge | Flags that the lead is fresh. | client/src/pages/crm-home.tsx:411 | — | render | OK |
| Section "Needs an estimate" (section-needs-estimate) | list | Leads that have no estimate at all yet — neither on the job nor on their client; each row links to the job with its stage pill. Shows at most 10 from the newest 200 leads. | client/src/pages/crm-home.tsx:417-435 | server/crm/follow-ups.ts:100-164: prospect projects (newest 200 by created_at, non-archived) minus any project covered by crm_estimates matching project_id OR customer_id; cap 10 | SQL reproduction (newest 200 leads, anti-join vs estimates on project or customer) = **140 total**, top-10 ids match API list exactly ✓ | OK |
| Row stage StatusPill (e.g. "Lead") | pill | Shows which pipeline stage that lead is in. | client/src/pages/crm-home.tsx:430 | CRM_PROJECT_STAGE_META label (shared/schema.ts:1624) | matches API stageLabel ✓ | OK |

### "Activity" card (card-team-activity) with tabs

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Tabs "Team Activity" / "Recent projects" (tab-team-activity / tab-recent-projects) | tabs | Switches between the live team feed and the 5 newest jobs. | client/src/pages/crm-home.tsx:450-454 | client only | render ✓ | OK |
| Team feed rows ("<actor> <text> <time ago>") | list + conditional links | Chronological mix of: things your team did (logged at the action site), estimate events (sent/opened/approved/declined/shared), and succeeded payments. Rows link to the related client or job when one exists; the page shows the newest 12 and re-checks every 60 s. | client/src/pages/crm-home.tsx:455-480 (slice(0,12), timeAgo at :59-66) | GET /api/crm/team-activity → server/crm/stats.ts:163-272: (a) crm_team_activity WHERE org_id ORDER BY created_at DESC LIMIT 40; (b) crm_estimate_events WHERE org_id AND type IN ('sent','viewed','approved','declined','shared') joined to org's estimates+customers; (c) crm_payments WHERE org_id AND status='succeeded' joined to customers; merged, sorted desc, sliced to 40 (route default limit) | SQL source counts for org: 319 activity rows / 6,377 feed-type estimate events / 1,296 succeeded payments — feed item ids in API (`a:…`, `e:…`, `p:…`) match those tables; latest rows spot-matched (e.g. "scheduled Feed fixture visit" ↔ crm_team_activity title) ✓. Links verified to be valid CRM routes (e.g. /crm/projects/:id, /crm/clients/:id, /crm/schedule App.tsx:397) | OK |
| Team feed error line / "Nothing yet" empty state | text | Error or empty state for the feed. | client/src/pages/crm-home.tsx:456-465 | — | code only | OK |
| "Recent projects" rows (5 newest) | list + links | The 5 most recently created jobs with number, date and stage pill; click opens the job. | client/src/pages/crm-home.tsx:481-513,201-203 | GET /api/crm/projects → projects = newest 2,000 non-archived by created_at (entities.ts:849-850); page re-sorts by createdAt desc and takes 5 — since the 2,000 loaded are the global newest 2,437-book's newest 2,000, the top 5 are exact | SQL newest 5 project created_at match the rendered order (P-3630…); links /crm/projects/:id App.tsx:409 ✓ | OK |
| "No projects yet" empty state + "Go to clients" button | empty state + button | Shortcut to the client list when there are no jobs. | client/src/pages/crm-home.tsx:484-495 | client only; link /crm/clients | route App.tsx:395 ✓ | OK |

### Shortcut cards

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Clients" card (card-clients) | link card | Opens the client list — create clients, build and send estimates. | client/src/pages/crm-home.tsx:521-531 | client only; /crm/clients | route App.tsx:395 ✓ | OK |
| "Team" card (card-team) | link card | Opens Team & Company on the Team tab — crew, roles, permissions. | client/src/pages/crm-home.tsx:532-542 | client only; /crm/team?tab=team | route App.tsx:411; ?tab= handled crm-team.tsx:308-321 ✓ | OK |
| "Company" card (card-company) | link card | Opens Team & Company on the Company tab — details that print on estimates and invoices. | client/src/pages/crm-home.tsx:543-553 | client only; /crm/team?tab=company | route + tab param ✓ | OK |

### "Follow-up cadences" dialog (dialog-follow-ups) — opened from the "Follow-ups" button

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Dialog "Follow-up cadences" + explainer | dialog | Sets a weekly or biweekly call rhythm per client; due calls land in "Needs attention". | client/src/pages/crm-home.tsx:556-562 | — | render ✓ (opened via Playwright) | OK |
| Per-client cadence rows + select (followup-row-<id> / select-cadence-<id>) | select | Weekly / Biweekly / Off per client; changing it saves immediately. | client/src/pages/crm-home.tsx:564-592 | PATCH /api/crm/customers/:id/follow-up {cadenceDays:7\|14\|null} → server/crm/follow-ups.ts:185-219 → UPDATE crm_customers.follow_up_cadence_days (zod allows only 7, 14, null) | e2e with AUDIT- customer: PATCH {cadenceDays:7} → DB follow_up_cadence_days=7, row appears in GET /api/crm/follow-ups; PATCH {cadenceDays:null} clears ✓ (rows deleted after) | OK |
| Row sub-line "Nd overdue / Due today / Next due <date>" | text | Same due math as the Needs-attention card. | client/src/pages/crm-home.tsx:569-573 | server/crm/follow-ups.ts:70-80 | e2e probe ✓ | OK |
| "No follow-ups set yet — add your first client below." | text | Empty state (true here: zero cadenced clients in this org). | client/src/pages/crm-home.tsx:593-595 | — | SQL: 0 cadenced customers ↔ message shown ✓ | OK |
| "Add a client (starts weekly)" picker (select-add-follow-up) | search input + picker | Searches all clients server-side and, on pick, adds them with a weekly rhythm. | client/src/pages/crm-home.tsx:597-606; client/src/components/crm-search-picker.tsx:137-172 | GET /api/crm/customers?q=<text> (entities.ts:458, server-side search over name/email/phone/address/city/zip/company); on pick: PATCH {cadenceDays:7} (same verified endpoint). Clients already on the list are excluded client-side. | picker populated live in render (lists clients with "Showing the first 25 — keep typing to narrow it down"); search endpoint shape verified; pick action = same PATCH verified e2e | OK |

### Cross-page consistency checks (things that should agree)

- "Unscheduled jobs" 502 vs pipeline stageCounts.approved 502 — **agree** (SQL + API).
- "Open projects"/pipeline 2,436 vs stageCounts sum minus cancelled (2,437 − 1 cancelled) — **agrees**.
- "Clients 7,506" vs raw list length 500 — page deliberately uses the uncapped server count; the cap is never presented as the total (crm-home.tsx:99-100,195-200) — **no cap-as-total bug**.
- "Needs attention" lead rows vs GET /api/crm/attention — ids match SQL exactly.
- New leads overlap "Needs an estimate" (same projects can appear in both sections) — by design, both statements are independently true.
- No "this month"/UTC-window claims anywhere on this page; the only windows are the 14-day rolling "new leads" and per-client cadence math, both server-epoch based and reproduced above.

### Bugs found

1. **"Open estimates" card links to an unfiltered list** — tile says 2,315 (sent+viewed, SQL-verified) but `/crm/estimates` shows all 6,807 estimates with "All" ticked. The sibling "Jobs won" card already links `?status=approved`. Fix is local: `href="/crm/estimates?status=sent,viewed"` at client/src/pages/crm-home.tsx:290.
2. **"Open invoices" card links to an unfiltered list** — tile says 540 (sent+partial, SQL-verified) but `/crm/invoices` shows all 2,168 invoices. Fix is local: `href="/crm/invoices?status=sent,partial"` at client/src/pages/crm-home.tsx:298 (verified live that this param shape pre-ticks exactly those boxes).

### Could not verify / notes

- "Skip for now"/"All done" dismiss buttons and the locked-step rendering are code-verified only — pressing dismiss would mutate shared org state (hide the checklist for other auditors); the locked variant can't render for this org's owner.
- The no-seePrices variants ("Open projects" card, dollar-free headline cards, non-link invoice card) are code-verified only; this account has all permissions. Their data sources are the same verified endpoints.
- Cap behavior: "New leads"/"Needs an estimate"/"Due for follow-up" silently cap at 10 rows server-side with no "show more" — no false totals are displayed, so logged as a note, not a bug.


## Measurement reports (/crm/reports)

Page audited: `client/src/pages/crm-reports.tsx` (route `client/src/App.tsx:414`). Backend: `server/crm/reports.ts` (all five `/api/crm/reports*` routes).

Session org for the running dev server: **SKU Dry-Run** (`c5b47b8d-caa8-47e6-ae7e-6248ad5df565`, owner user 1). All SQL below is against that org.

This page has **no financial aggregates** — no totals, sums or averages. The only numbers are (a) the per-row Squares figure and Date, and (b) the list count "Showing X of Y". Every one was recomputed from the DB.

**Key SQL spine used throughout:**
`SELECT … FROM crm_measurements WHERE org_id='c5b47b8d-…' AND raw_payload->>'importSource' IS NOT NULL ORDER BY created_at DESC LIMIT 500`
- `count(*)` = **489**; status breakdown draft 5 / ready 484 — exactly matches `GET /api/crm/reports` (489 rows, same breakdown). No org leakage (Alpine's 519 rows are not present).
- `squares` shown = `squares_milli / 1000` — compared for **all 489 rows: 0 mismatches** (e.g. draft `59396caf` → 28.74 from 28740 milli; waste 1200 bps → 12%).
- `date` shown = `COALESCE(completed_at, created_at)` (presentReport, server/crm/reports.ts:317).
- `customerName` = live `crm_customers.display_name` of the linked customer — compared for all 489 rows: 0 mismatches. 13 rows (5 NULL `customer_id` + 8 dangling/other-org ids) are correctly unlinked (API `customerId:null`); 174 rows link to **archived** customers and are still linked deliberately (server filters only missing/other-org customers, reports.ts:540-555); the archived client page renders (GET /api/crm/customers/7ab1ff3f… 200).

---

### Page header

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Title "Measurement reports" + subtitle "Import a HOVER or CladAI report — the client is matched or created from it automatically." | Static header | Names the page; tells you a report import creates or matches the client. | crm-reports.tsx:195-200 (CrmPageHeader) | client only | code only | OK |
| ⓘ info button (infoKey="reports") | Info popover | Opens a help popover explaining HOVER matching (address for synced jobs, email/phone for pasted, else a new client). | crm-reports.tsx:198 | client only: text from client/src/lib/info-content.ts:343-350 ("reports" entry exists; info-content.test.ts enforces every infoKey has an entry) | route/key present in info-content.ts:343 | OK |

### Import card (visible only with the manageCustomers permission; dev owner has it)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Report file (PDF or text, up to 25MB)" file input (input-report-file) | File picker | Choose the HOVER PDF (or a .txt) from your computer. Picking a file clears the paste box. | crm-reports.tsx:215-226 | Sent as multipart field "file" to POST /api/crm/reports/upload → server/crm/reports.ts:435 uploadHandler → multer memoryStorage, LIMIT 25MB (413 "over the 25MB limit"); PDF text extracted via extractPdfText (flate/Tj/TJ), plain text read as utf8; PDF with <40 chars of text → 422 pointing at the paste box | code only (accept ".pdf,.txt" matches server; 25MB label matches MAX_BYTES reports.ts:39) | OK |
| Helper text "Some PDFs don't give up their text — if upload says so…" | Static hint | Tells you the paste fallback exists. | crm-reports.tsx:227-229 | client only | matches real 422 response (reports.ts:367-372) | OK |
| "…or paste the report text" textarea (textarea-report-text) | Text input | Paste the report's copied text instead of a file. Typing clears the chosen file. | crm-reports.tsx:232-243 | Sent as JSON {text, fileName:"pasted-report.txt"} to POST /api/crm/reports/upload (same handler; 25MB cap on the body → 413) | verified live (below) | OK |
| "Parse report" button (button-parse-report) | Button | Uploads the file/paste, parses out name, address and roof measurements, and shows a review card. Disabled until a file or text is present. | crm-reports.tsx:247-254 | POST /api/crm/reports/upload → reports.ts:435 uploadHandler: requires manageCustomers; parses with parseMeasurementReport (regex parser, reports.ts:102); if nothing parseable → 422; else INSERT crm_measurements (org_id = session org, status='draft', address columns, *Milli columns = value×1000, rawPayload={importSource:'report-upload', fileName, sourceText ≤400k chars, parsed}) → returns {id, parsed} with 201; client stores it as the review draft and refreshes the list | pressed live: 201, draft row `7caf3140…` in DB with squares_milli=28740, waste 1200bps, file_name 'AUDIT-pasted-report.txt'; appeared at top of GET /api/crm/reports; draft deleted afterwards (see Discard) | OK |

### Review preview card (appears after Parse, only while a draft is open)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Provider pill (pill-provider) | Status pill | Shows which system the report came from ("hover" for HOVER-style text, else "other"). | crm-reports.tsx:268 | client only: parsed.provider from parser regex /hover\|prepared for/i (reports.ts:106-108) | live parse returned provider "hover" | OK |
| Warnings banner (text-parse-warnings) | Notice | Amber list of what the parser could not find (contact / address / measurements). | crm-reports.tsx:272-276 | client only: parsed.warnings (reports.ts:175-177) | code only (empty on my test parse) | OK |
| Client block (preview-contact, preview-name) | Data display | The name, email, phone and property address pulled from the report; "—"/"no email" etc. when absent. | crm-reports.tsx:278-287 | client only: parsed.contact | matched live parse output to DB columns address_line1/city/state of the draft row | OK |
| Roof block (preview-measurements) | Data display | Squares, roof SF, pitch, facet count, waste %, and ridge/hip/valley/rake/eave lineal feet from the report. | crm-reports.tsx:288-297 | client only: parsed.measurements; fmt() renders max 2 decimals (display rounding only; stored values are exact ×1000) | live parse: squares 28.74, roofAreaSf 2874, pitch 6/12, facets 14, waste 12 — all exact in DB | OK |
| "Discard" button (button-discard-report) | Button | Deletes this unconfirmed draft (nothing was created from it). | crm-reports.tsx:300-304 | DELETE /api/crm/reports/:id → reports.ts:568: requires manageCustomers; row must belong to org AND have rawPayload.importSource; status must be 'draft' else 409; DELETE FROM crm_measurements | pressed live on my AUDIT- draft: 200 {ok,deleted}; row gone from DB (count 0) and from the list (489 again); repeat DELETE → 404 | OK |
| "Confirm — create the client" button (button-confirm-report) | Button | Files the report: matches an existing client by email/phone (or creates one), links the report to them, marks it ready; toast says "Client created" or "Existing client matched". | crm-reports.tsx:305-308 | POST /api/crm/reports/:id/confirm (body {}) → reports.ts:455: org-scoped row, must be status 'draft' else 409; matchCustomer (email case-insensitive / phone digits, AND archived_at IS NULL, reports.ts:236-250) or INSERT crm_customers (notes "Created from an imported measurement report."); optional body.customerId/projectId supported (client never sends them); UPDATE crm_measurements SET customer_id, status='ready', completed_at=now; returns {created, customer, report}; client invalidates reports+customers queries | code only + server/crm/reports.test.ts:179-196 pins create-then-dedupe flow. Not pressed live (would mint a client); no AI generation involved | OK |

### Confirmed card (appears after a successful Confirm)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Client created and report filed." / "Matched the existing client — report filed." + "Open client" link (report-confirmed, link-confirmed-client) | Success banner + link | Confirms the report is on the client's record and portal, with a link straight to that client. | crm-reports.tsx:314-329 | Link → /crm/clients/:customerId (wouter) | route exists: client/src/App.tsx:396 `<Route path="/crm/clients/:id" component={CrmClientPage}/>`; archived-client detail renders (GET …/customers/7ab1ff3f… 200) | OK |

### Imported reports list (section-report-list)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Imported reports" title + "Newest first. Drafts are parsed but not yet confirmed." | Section header | Labels the history list. | crm-reports.tsx:334 | client only | see Date row for the "newest first" caveat | OK |
| Loading spinner | State | Spins while the list loads. | crm-reports.tsx:335-336 | client only (react-query on /api/crm/reports) | code only | OK |
| "Couldn't load reports" ErrorCard | Error state | Shown if the list request fails. | crm-reports.tsx:187-189 | client only | code only | OK |
| "No reports yet" EmptyState | Empty state | Shown when the org has no imports. | crm-reports.tsx:337-341 | client only (reports.length === 0) | code only — no zero-report org exists on dev to render it; both orgs with data have 489/519 rows | OK |
| Mobile stacked cards (report-card-<id>, testids prefixed `m-`) | Card list | Same rows as the table for phones (below sm breakpoint): file name, provider·address, status pill, client, date · squares, and the same three row actions. | crm-reports.tsx:346-365 | same GET /api/crm/reports data | code only (identical fields to the desktop row) | OK |
| Report cell: file name ("Pasted report" fallback) + "provider · address" line | Table cell | Shows which file the import came from and the property address captured at parse time. The address is the **report's** address, stored on the measurement row at import — not the linked client's current address. | crm-reports.tsx:381-384 (mobile 352-353) | crm_measurements.raw_payload->'fileName', provider, address_line1/city/state | spot-checked vs DB (e.g. 'pasted-report.txt', "hover · 55 QA Verify Lane, Boise, ID") | OK |
| Client cell: client name link (report-client-<id>) or muted parsed name | Link / text | If the report is filed to a client, their **current** name links to their page; otherwise the name from the report text, greyed out. | crm-reports.tsx:157-163, 385 | GET /api/crm/reports enriches: customerId nulled unless a live row in this org exists (reports.ts:540-555 — comment: a report outlives its customer); customerName = crm_customers.display_name | SQL join on all 489 rows: 0 name mismatches; 13 dangling/null correctly unlinked. Note: 174 links point at archived clients — page renders fine (200) but the client page shows no archived banner (grep "archiv" in crm-client.tsx: no match); consistent with server intent, borderline UX | OK |
| Status pill (report-status-<id>): draft / ready | Status pill | draft = parsed, not yet filed (amber); ready = filed to a client (grey). | crm-reports.tsx:387 (mobile 355) | crm_measurements.status via statusTone (crm-ui.tsx:176 — "draft"→warning, "ready"→neutral default) | DB status counts (5 draft / 484 ready) match API; pill values verbatim | OK |
| Date cell | Table cell | The report's date — for filed reports the moment it was confirmed, for drafts the moment it was imported — shown in **your browser's timezone** (toLocaleDateString), not the org timezone. | crm-reports.tsx:389 (mobile 358-360); day() at :63 | presentReport date = completed_at ?? created_at (reports.ts:317); **list ordered by created_at DESC (reports.ts:534)** | **BUG (minor, latent):** the column the owner reads is confirm-time, but the row order is import-time. Proven: 3 adjacent pairs today where an earlier-dated row sits above a later-dated one — e.g. row 202 draft `59396caf` shown 2026-09-29 sits directly above row 203 ready `2f3790ba` shown 2026-09-30 (completed_at 2026-09-30T03:36Z vs created_at 2026-09-29). In US timezones both instants land on the same local day so it is invisible there (0 visible pairs in PDT/EDT — checked); in UTC/UK-like zones it renders visibly out of order (screenshot shots/reports/ordering-bug.png). Will become visible everywhere when a report is confirmed a day+ after import. Fix looks local and clear: order by the same expression the column shows (`ORDER BY COALESCE(completed_at, created_at) DESC`) at server/crm/reports.ts:534 | BUG |
| Squares cell (right-aligned) | Table cell | How many roofing squares the report measured ("—" if none). | crm-reports.tsx:390 (mobile 358-360); fmt() at :67-68 | crm_measurements.squares_milli / 1000 | all 489 rows compared: 0 mismatches; nulls render "—" | OK |
| "Review" action (report-review-<id>, `m-…`) | Button (drafts, managers only) | Reopens the parse preview for a draft so you can confirm it later (survives a page refresh because drafts carry their parse). | crm-reports.tsx:166-171 | client only (sets draft state; scrolls preview into view :147-150). Server side: GET list attaches parsed only for drafts (reports.ts:558) | all 5 drafts in API carry `parsed`; ready rows have none (verified from API JSON) | OK |
| "Discard" action (report-discard-<id>, `m-…`) | Button (drafts, managers only) | Deletes that unconfirmed draft after a confirm() prompt. | crm-reports.tsx:172-178 | DELETE /api/crm/reports/:id → reports.ts:568 (see preview Discard) | endpoint verified live via preview Discard (same route/method); list copy is the same mutation with row id | OK |
| "Text" download action (report-download-<id>, `m-…`) | Link | Downloads the exact text that was pasted/uploaded (the stored report text), as a .txt named after the original file. | crm-reports.tsx:179-183 | GET /api/crm/reports/:id/download → reports.ts:589: org-scoped; serves rawPayload.sourceText as text/plain attachment (filename via reportTextFileName, reports.ts:304); 404 when no source stored (e.g. provider-webhook rows, whose rawPayload has no sourceText — hence no link) | pressed live on my AUDIT- draft: 200, Content-Disposition attachment filename="AUDIT-pasted-report.txt", body = the pasted text | OK |
| Count line (text-report-count): "Showing X of 489" / "of the latest 500" | Text | Says how many imports are on screen out of how many exist (or "the latest 500" once the server cap is hit, so 500 is never presented as the total). | crm-reports.tsx:397-408 | reports.length = rows returned by GET /api/crm/reports, which is `… ORDER BY created_at DESC LIMIT 500` (reports.ts:534-535) | rendered live: "Showing 275 of 489" mid-pagination (Playwright); SQL count(*) = 489 = API length. Cap branch: Alpine org has 519 import-source rows (>500) so "the latest 500" is reachable and accurate; client LIST_CAP=500 (:66) matches the server LIMIT exactly. Not rendered end-to-end there to avoid switching the shared session org | OK |
| "Show N more" button (button-more-reports) | Button | Reveals the next 25 imports (25 per page). | crm-reports.tsx:403-407 | client only (slices the already-fetched array, :379/:347) | pressed live repeatedly in Playwright until all 489 rows were on screen | OK |

---

### Notes for the owner

- The page is honest about its limits: the only aggregate is the list count, and it matches the database exactly (489 of 489; server cap 500 acknowledged in the wording).
- Confirmed reports can't be deleted from here (server returns 409 "already filed") — the Discard buttons are draft-only, and the UI hides them otherwise. Deleting a client does not delete their reports; such reports stay listed with the greyed parsed name.
- No AI-generation features on this page (parsing is pure regex heuristics, server/crm/reports.ts:102); nothing was triggered beyond a normal paste import.
- Test data created for this audit ("AUDIT-Probe Parker", draft 7caf3140) was fully deleted via the page's own Discard flow; verified absent from DB and list.

### Routes without doc comments
- `client/src/App.tsx:414` — `<Route path="/crm/reports" component={CrmReportsPage}/>` has no doc comment (the whole CRM route block 405-416 is uncommented; only `/admin` at :417-418 carries one). Candidate for a one-liner: "Measurement report imports — upload/paste a HOVER report, review the parse, confirm to match-or-create the client."


## Schedule (/crm/schedule)

Page: `client/src/pages/crm-schedule.tsx` — month/week calendar + day-grouped agenda for the org's appointments (visits). Route `client/src/App.tsx:397`. Reached in the UI only from the **mobile** bottom ribbon (`ribbon-tab-schedule`, `client/src/components/crm-ribbon.tsx:135`) — the desktop sidebar (`client/src/components/crm-sidebar.tsx:35-78`) has no Schedule entry (see BUG-1).

Audited as signed-in dev owner (user 1, member `e60240cf…`, org **SKU Dry-Run** `c5b47b8d-caa8-47e6-ae7e-6248ad5df565`, permissions all true incl. `manageJobs`/`viewAllJobs`). All queries are org-scoped via `requireOrg` (`server/crm/tenancy.ts`). Data model: `crm_appointments` with `starts_at`/`ends_at` as **timestamp without time zone**; server↔client round-trip is symmetric in UTC (verified: POST `13:00Z` → stored `13:00` → GET `13:00Z` → rendered 9:00 AM EDT in the browser). Day grouping, chip times and the month/week query windows are all computed in the **viewer's browser timezone**; only the agenda feed's "from today 00:00" uses the **server's** timezone (see note under Agenda).

---

### Page header (CrmPageHeader, crm-schedule.tsx:243-289)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Schedule" title + subtitle "Scroll the calendar, click a day to book, click a visit to move it." | Header | Names the page; subtitle explains the two click actions. | crm-schedule.tsx:243-247 | client only | screenshot 01-month.png | OK |
| ⓘ info icon next to title (infoKey="schedule") | Button → help dialog | Opens a plain-language help dialog: "Every visit, install date and appointment across all your projects, on one calendar…" | crm-schedule.tsx:246; InfoTip in client/src/components/info-tip.tsx; copy in client/src/lib/info-content.ts:238-246 | client only (static copy) | key `schedule` exists in info-content.ts; rendered in header screenshot | OK |
| Calendar scope select (`select-calendar-scope`) | Select | Chooses whose visits the page shows: Everyone's calendar, My calendar, or one team member. Remembered per browser (localStorage key `crm.schedule.scope`). | crm-schedule.tsx:77-84, 250-265 | Client-side filter over the fetched appointments (`matchesScope`, crm-schedule.tsx:146-152): a visit is "mine"/member's if that member booked it (`createdByMemberId`) or is on its crew (`dispatchedMemberIds`); "all" shows everything returned by the API. | Playwright: options listed = Everyone's / My calendar / 3 members (self excluded); DOM grouping matched | OK |
| — "Everyone's calendar" (`scope-all`) | Menu item | Shows every visit in the org (subject to server visibility). | crm-schedule.tsx:255 | GET /api/crm/appointments or /api/crm/schedule already org-scoped + visibility-filtered (server/crm/schedule.ts:97-104, 196-214) | code + rendered | OK |
| — "My calendar" (`scope-mine`) | Menu item | Shows only visits you booked or are assigned to. | crm-schedule.tsx:256 | Same endpoints; filter matches the server's own visibility rule for restricted seats (object-access.ts:81: `createdByMemberId === me or dispatchedMemberIds includes me`) | code | OK |
| — per-member options (`scope-member-<id>`) | Menu item | Shows that member's visits (booked-by or crew). Stale ids (member left) auto-fall back to "My calendar". | crm-schedule.tsx:257-263, 155-158 | Member list from GET /api/crm/members → crm_members WHERE org_id (server/crm/routes.ts:724-740) | API returned 4 org members = SQL `SELECT … FROM crm_members WHERE org_id=…` | OK |
| View switcher (`schedule-view-switch`): Month / Week / Agenda (`button-view-month/week/agenda`) | Tabs (URL-driven) | Switches the calendar view; the choice lives in the URL (`?view=week|agenda`, month = bare path) so reload/Back keeps it. | crm-schedule.tsx:62-69, 266-281 | client only | clicked all three in Playwright; URL became `?view=week` / `?view=agenda`; screenshot 01-04 | OK |
| "＋ Add" button (`button-add-appointment`) | Button → dialog | Opens the New-appointment dialog prefilled with today's date. Only shown to roles with the manage-jobs permission. | crm-schedule.tsx:282-286, 171-176 | client only (dialog); save hits POST /api/crm/appointments (see dialog table) | rendered (owner sees it); permission gate `canManage = me.permissions.manageJobs` from GET /api/crm/me (routes.ts:404-436) | OK |
| Top-bar section label "Schedule" (`text-crm-section`) | Label | Shows "Schedule" in the slim top bar while you are on this page. | client/src/App.tsx:615, 637 | client only | screenshot 01 (top bar) | OK |

### Calendar navigation row (month/week only, crm-schedule.tsx:291-306)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| ‹ prev (`button-cal-prev`) | Button | Moves the calendar back one month (month view) or one week (week view). | crm-schedule.tsx:198-203, 294-296 | client only | code | OK |
| "Today" (`button-cal-today`) | Button | Jumps the calendar back to the current month/week. | crm-schedule.tsx:297-299 | client only | code | OK |
| › next (`button-cal-next`) | Button | Moves the calendar forward one month or one week. | crm-schedule.tsx:300-302 | client only | code | OK |
| Calendar title (`calendar-title`) — "October 2026" or "Week of Oct 4" | Label | Names the month (or the Sunday the week starts on) you are looking at. | crm-schedule.tsx:205-207, 304 | client only | rendered "October 2026" / "Week of Oct 4" | OK |

### Month view (`calendar-month`, crm-schedule.tsx:313-366)

Fetches `GET /api/crm/appointments?from=<Sun before 1st, local midnight>&to=<from+42d>` — **includes canceled and completed** visits (rendered struck-through). Window verified against SQL: API returned **74** appointments for Oct-2026 grid (from `2026-09-27T04:00Z` to `2026-11-08T04:00Z` inclusive) = `SELECT count(*) FROM crm_appointments WHERE org_id='c5b47b8d…' AND starts_at >= '2026-09-27 04:00' AND starts_at <= '2026-11-08 04:00'` → 74, per-day distribution identical both sides.

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Weekday header Sun–Sat | Label | Static column headers. | crm-schedule.tsx:314-318 | client only | screenshot | OK |
| 42 day cells (`cal-day-<YYYY-MM-DD>`) | Grid cell / click target | One cell per day (6 weeks × 7). Clicking a day (manage roles only) opens the New-appointment dialog prefilled with that date. Out-of-month days are dimmed; today is highlighted. | crm-schedule.tsx:319-364 | data: GET /api/crm/appointments (server/crm/schedule.ts:185-233) → crm_appointments WHERE org_id + starts_at BETWEEN from/to, LEFT JOIN crm_projects (name, number), crm_customers (displayName); limit 1000; then per-seat visibility filter (dispatched-only techs, division scope) | SQL vs API count 74 = 74; cell click opens dialog (openCreate) | OK |
| Day number | Label | The date of the cell. | crm-schedule.tsx:339-344 | client only | screenshot | OK |
| Event chips (`event-<appt-id>`) | Button per visit | Shows the visit's start time (local) + title; complete/canceled visits are dimmed and struck through. Clicking opens the Edit-appointment dialog. | crm-schedule.tsx:221-239, 346 | data from same GET (title, startsAt, status) | DOM chip counts per day matched API per-day grouping (1/1/3/3/3/3/2/1 across visible days); click opened Edit dialog (screenshot 07) | OK |
| "+N more" (`cal-more-<day>`) | Button | A day with more than 3 visits shows 3 chips then "+N more" (N = visits that day − 3). Clicking jumps to the Week view of that week. | crm-schedule.tsx:347-360 | same GET; N computed client-side from the day's items | Oct 3 cell showed "+33 more" (= 36 visits that day per SQL − 3); click set `?view=week` and re-centered the calendar on that week (URL + screenshot 03) | OK |

### Week view (`calendar-week`, crm-schedule.tsx:367-402)

Fetches the same endpoint with a 7-day window (Sunday→Sunday, local). Same include-canceled behavior.

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| 7 day columns (`week-day-<YYYY-MM-DD>`) | Grid column | A column per day with weekday header and date; today highlighted. | crm-schedule.tsx:369-391 | same GET /api/crm/appointments, 7-day window | screenshot 02-week.png (title "Week of Oct 4"); per-day chip rendering matched | OK |
| Day body cell | Click target | Clicking empty space in a day (manage roles) opens the New-appointment dialog for that date. | crm-schedule.tsx:392-397 | client only | code | OK |
| Event chips (`event-<id>`) | Button per visit | Same chip as month view; click → Edit dialog. All of the day's visits are shown (no 3-chip cap). | crm-schedule.tsx:396 | same GET | chips listed; click opened Edit dialog | OK |

### Agenda view (crm-schedule.tsx:403-495)

Fetches `GET /api/crm/schedule?days=<7|14|30>`. Server window: **from today 00:00 in the SERVER's timezone** through +N days, **excluding canceled** (`ne status canceled`), limit 500. Verified against SQL for all three ranges (org had exactly the appointments my test rows and another auditor's AUDIT- row put in the window; counts matched 1=1 at each of 7/14/30 days, and 0=0 before any test row existed).

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Range switcher (`schedule-range`): 7d / 14d / 30d (`button-days-7/14/30`) | Tabs | Chooses how many days ahead the list covers (default 14). | crm-schedule.tsx:23, 71, 405-420 | GET /api/crm/schedule?days=N → days clamped to 1–60 (schedule.ts:81-85); window starts_at >= today-00:00 server-local, < +N days | buttons rendered; switching re-fetched (code) | OK |
| Day group headers (`schedule-day-<date>`) e.g. "Tomorrow · Mon, Oct 5" | Label | Groups visits by day, prettily labelled (Today/Tomorrow + date) in the viewer's timezone. | crm-schedule.tsx:25-32, 210-216, 436-440 | grouping client-side over the feed | rendered "TOMORROW · MON, OCT 5" for a 13:00Z visit (screenshot 04) | OK |
| Visit card (`appt-<id>`) | Card / click target | Shows title, time range ("9:00 AM – 10:00 AM" or "All day" or start-only), project · project-number or customer name, crew names, and a status pill (scheduled / on my way / started / complete / canceled — underscores turned to spaces). Click: manage roles open the Edit dialog; read-only roles with a linked project navigate to that project page; otherwise inert. | crm-schedule.tsx:442-489 | data: GET /api/crm/schedule → crm_appointments JOIN crm_projects/crm_customers + crew names resolved from crm_members (schedule.ts:87-139); canceled filtered OUT server-side | card rendered with correct time/status (screenshot 04); statuses enum from shared/schema.ts:1951; click → Edit dialog verified | OK |
| Empty state — "Nothing scheduled in the next N days" (scope = all) | Empty state | Shown when the feed has no visits in the window for the chosen scope. | crm-schedule.tsx:422-433 | feed returned `[]` (verified: GET /api/crm/schedule?days=14 → `{"appointments":[]}` when no rows in window) | API + code | OK |
| Empty state — "No visits for this filter in the next N days" (scope = mine/member) | Empty state | Same, but when a member filter hides everything. | crm-schedule.tsx:426-428 | client-side filter result | Playwright: picked a member with no visits → text "No visits for this filter in the next 14 days" (screenshot 08) | OK |

Time-window note (not a visible-number bug): the agenda feed anchors "today" at **server-local** midnight (`server/crm/schedule.ts:83-85`), while everything else on the page (month/week windows, day grouping, labels, chip times) uses the **viewer's** timezone. On this dev box the server is America/New_York and the org is America/Los_Angeles, so for a West Coast user the agenda window edges differ from their local day by up to 3 hours; a viewer far from the server could see the "next 14 days" start half a day off from their own midnight. Month/week are unaffected (windows come from the browser). Flagging as an edge-case inconsistency, not counted as a BUG because no wrong number is displayed — the grouping and labels stay internally consistent.

### Loading / error states (crm-schedule.tsx:308-311)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Loading spinner (`Loader2`) | Indicator | Spins while the active view's query loads. | crm-schedule.tsx:308-309 | — | code | OK |
| Error card "Couldn't load the schedule" (`ErrorCard`) | Error state | Shown if the feed request fails; suggests checking the connection. | crm-schedule.tsx:310-311; client/src/components/crm-ui.tsx | client only | code (not triggered; endpoint returned 200 throughout) | OK |

### Appointment dialog (`dialog-appointment`, crm-schedule.tsx:498-510 → client/src/components/crm-appointment-form.tsx)

Shared create/edit/delete form (also used on the client page). Fields verified rendered in the live dialog (screenshots 06/07).

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Title input (`input-appt-title`) | Input | The visit's name (required, ≤200 chars). | crm-appointment-form.tsx:170-174 | POST/PATCH body `title` (zod min 1 max 200, schedule.ts:28-54) | rendered in dialog | OK |
| Date input (`input-appt-date`) | Input (date) | Day of the visit (required). | crm-appointment-form.tsx:176-180 | body `startsAt` (with start time) | rendered | OK |
| Start / End time (`input-appt-start`, `input-appt-end`) | Input (time) | Visit window; end must be at/after start (server enforces). Hidden when All day. | crm-appointment-form.tsx:181-194 | body `startsAt`/`endsAt` ISO | rendered; server rejects inverted window — verified live: PATCH moving start past unchanged end → 400 "End time must be at or after the start time" (schedule.ts:308-313) | OK |
| All day (`checkbox-appt-all-day`) | Checkbox | Marks the visit all-day (no times; stored with null endsAt, local-midnight start). | crm-appointment-form.tsx:196-200 | body `allDay`, `endsAt: null` | code | OK |
| Project picker (`select-appt-project-*`) | Search picker | Optional link to one of the org's active projects (client-side search over the fetched list). | crm-appointment-form.tsx:201-209; list from GET /api/crm/projects (enabled only for manage roles, crm-schedule.tsx:130-132) | GET /api/crm/projects → crm_projects WHERE org_id AND archived_at IS NULL, newest 2000 (server/crm/entities.ts:821-857); server re-validates the id belongs to the org on save (schedule.ts:157-177) | endpoint 200, shape matches; org-link validation in code | OK |
| Customer picker (`select-appt-customer-*`) | Search picker | Optional link to a client; searches the whole org server-side as you type. | crm-appointment-form.tsx:210-222; ClientSearchPicker fetches GET /api/crm/customers?q= (crm-search-picker.tsx:156-165) | GET /api/crm/customers?q → ilike over name/email/phone/address/city/ZIP/company, newest-500 array shape (server/crm/entities.ts:458-545); org-validated on save | endpoint 200 array shape; code | OK |
| Crew checkboxes (`checkbox-crew-<member-id>`, list `appt-crew-list`) | Checkbox per member | Assigns team members to the visit (up to 50). | crm-appointment-form.tsx:224-241 | body `dispatchedMemberIds`; server checks each id belongs to the org (schedule.ts:170-176) | rendered 4 checkboxes = 4 org members; save verified via my POST | OK |
| Notes (`textarea-appt-notes`) | Textarea | Free-text note on the visit. | crm-appointment-form.tsx:242-246 | body `notes` ≤8000 | rendered | OK |
| Save — "Schedule it" / "Save changes" (`button-appt-save`) | Button | Create: POST /api/crm/appointments → insert into crm_appointments (org_id, created_by_member_id = you) + team-activity entry "scheduled …"; on success shows a toast, and if crew overlap another visit in ±1 day, a destructive toast listing the conflict count (server double-booking check). Edit: PATCH /api/crm/appointments/:id → update; moving the start time also logs "rescheduled …". Refreshes both feeds. | crm-appointment-form.tsx:106-129, 145-162, 276-280 | POST → schedule.ts:235-276; PATCH → schedule.ts:278-340 | pressed for real with an "AUDIT-schedule probe" row: 201 `{appointment, conflicts:[]}`; row appeared in SQL with correct org_id/created_by; reschedule logged `appointmentRescheduled` in crm_team_activity (SQL); invalid patch rejected 400 | OK |
| Delete (`button-appt-delete`) → confirm panel (`appt-delete-confirm`) | Button → inline confirm | First click swaps the footer for "Delete this visit? This can't be undone." with "Keep it" (`button-appt-delete-cancel`) and "Delete for good" (`button-appt-delete-confirm`). Confirmed → hard DELETE /api/crm/appointments/:id (row removed from crm_appointments, team-activity "removed … from the schedule"), toast "Appointment removed". | crm-appointment-form.tsx:96-97, 131-143, 248-265 | DELETE → schedule.ts:342-357 (manageJobs required) | executed against my own AUDIT row: 200 `{ok:true, deleted:…}`, SQL count 0 afterwards, activity row present; then feeds re-fetched and agenda emptied | OK |

### Navigation to this page

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Ribbon tab "Schedule" (`ribbon-tab-schedule`) | Bottom-bar tab (mobile only) | The Schedule entry in the phone bottom ribbon; also the **only** UI link to this page. | client/src/components/crm-ribbon.tsx:135-136 (bar visible below the md breakpoint, comment at :19-24) | client only | route /crm/schedule exists at App.tsx:397; tab renders in ribbon code | OK |
| — (absent) Desktop sidebar entry | — | **BUG-1: there is no "Schedule" item in the desktop sidebar.** The NAV list (Home, Clients, Messages, Pipeline, Estimates, Invoices, Price book, Payments, Team & Company, Integrations, Settings, Platform Admin) omits it, so on desktop the page is reachable only by typing the URL or from a phone. | missing from client/src/components/crm-sidebar.tsx:35-78; only link anywhere is the mobile ribbon (crm-ribbon.tsx:135) | — | screenshot 01 (sidebar shown, no Schedule); repo-wide grep for links to /crm/schedule finds only the ribbon + App.tsx route/title | BUG |

---

## Findings

### BUG-1 — Schedule page missing from the desktop sidebar (navigation orphan)
- What the owner sees: on a desktop, there is no way to click to the Schedule page — no sidebar entry, no link from Home. The page works fine if you type `/crm/schedule` (or use the phone app, where the bottom ribbon has a Schedule tab).
- Evidence: `client/src/components/crm-sidebar.tsx:35-78` (NAV array — no Schedule); repo-wide search for `/crm/schedule` links finds only `client/src/components/crm-ribbon.tsx:135` (mobile-only bar, "Visible only below the md breakpoint", crm-ribbon.tsx:19-24) and the route/title entries in `client/src/App.tsx:397,615`. Screenshot `shots/schedule/01-month.png` shows the full desktop sidebar without a Schedule item.
- Root cause: omission in the sidebar NAV list; the route, ribbon tab and page all exist.
- Fix: local and clear — add `{ title: "Schedule", url: "/crm/schedule", icon: CalendarDays, testid: "link-portal-nav-schedule", active: (l) => l.startsWith("/crm/schedule") }` to the NAV array in crm-sidebar.tsx (CalendarDays is already imported there? — it is not; add the import).

### Verified-correct numbers
- Month grid (Oct 2026, org SKU Dry-Run): API 74 appointments = SQL `SELECT count(*) FROM crm_appointments WHERE org_id='c5b47b8d-caa8-47e6-ae7e-6248ad5df565' AND starts_at >= '2026-09-27 04:00:00' AND starts_at <= '2026-11-08 04:00:00'` → 74; per-day split identical (Sep 30:1, Oct 1:1, Oct 3:36, Oct 4:9, Oct 5:24, Oct 6:2, Oct 7:1). The page's per-day chip counts and "+N more" labels (e.g. Oct 3 "+33 more") match the same grouping computed from the API in the browser's timezone.
- Agenda feed: `GET /api/crm/schedule?days=7|14|30` counts (0 before test rows, 1 after) = SQL with window `starts_at >= '2026-10-04 04:00:00' (server-local midnight) AND starts_at < +N days AND status <> 'canceled'`.
- Scope select member list = `SELECT FROM crm_members WHERE org_id=…` (4 rows; self excluded from options).
- Write path verified end-to-end with an AUDIT- row (create → SQL row with correct org_id/booker → reschedule PATCH + activity log → validation 400 on inverted window → hard DELETE + activity log → row gone). Test row deleted.

### Notes / non-bugs
- Month/week views show canceled visits struck-through; the agenda hides canceled ones server-side (schedule.ts:99). Deliberate asymmetry (calendar = record, agenda = what's ahead); both verified against SQL.
- Timestamps are `timestamp without time zone` handled symmetrically in UTC; verified round-trip POST→SQL→GET→display (13:00Z stored as "13:00", shown as 9:00 AM EDT). No daylight-saving or drift bug visible.
- Agenda "from today" uses the server's timezone while the rest of the page uses the viewer's — see the note under Agenda; edge-case only.
- Cosmetic code smells (no user impact): duplicated `if (!from || !to)` line at server/crm/schedule.ts:190-191; unused imports `appointmentDivisionVisible, divisionMapsForOrg` at schedule.ts:24.
- Server enforces: 400-day max range on the appointments feed (page windows are ≤42 days), 60-day max on the agenda feed (page max is 30), 1000/500-row caps far above this org's data.

### Routes with no doc comment (candidates for doc comments)
- `client/src/App.tsx:397` — `<Route path="/crm/schedule" component={CrmSchedulePage} />` has no comment; the route renders the Schedule calendar page audited here. (Neighboring routes /crm/call-assistant at :401 does have one.)
- `server/crm/schedule.ts:185` — `GET /api/crm/appointments` has a doc comment (good); `server/crm/schedule.ts:77` — `GET /api/crm/schedule` also documented. No doc-comment gaps on the backend routes this page uses.


## Messages / Inbox (/crm/inbox)

Page file: `client/src/pages/crm-inbox.tsx` — route `client/src/App.tsx:398` (`<Route path="/crm/inbox" component={CrmInboxPage} />`).
Two tabs under one header: **Messages** (per-client two-way conversation threads) and **Client activity** (feed of estimate events + payments).
Audited org: the dev user (id 1) resolves through `requireOrg` to their oldest membership → org `c5b47b8d-caa8-47e6-ae7e-6248ad5df565` ("SKU Dry-Run"), confirmed by the API returning that org's 7 threads / 0 unread. All SQL below is against that org. DB session time zone is pinned to UTC (`server/db.ts`); timestamps are stored as zone-less `timestamp` and shipped to the client as ISO-8601 with `Z` (`isoUtc`, `server/crm/inbox.ts:43`).

### Page header

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Title "Messages" + subtitle "Every client message in one place…" | static header | Names the page; no data. | client/src/pages/crm-inbox.tsx:416 | client only | Playwright render: title present | OK |
| ⓘ info button (`info-tip-inbox`) | icon button → help dialog | Opens a plain-English explainer: threads are per client, replies go to portal + email, tab counts unread, activity tab shows estimate/payment events. | client/src/pages/crm-inbox.tsx:419 (infoKey="inbox") → client/src/components/info-tip.tsx:29 → client/src/lib/info-content.ts:248 | client only (INFO_CONTENT["inbox"] exists; missing keys render nothing per info-tip.tsx:50) | `grep` key `inbox` in info-content.ts:248; Playwright: `info-tip-inbox` present, dialog opens | OK |

### Tabs bar

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Tab "Messages" (`tab-inbox-messages`) | tab + live count | Shows the client-message threads; when there are unread client messages anywhere in the org the tab label shows "(N)", e.g. "Messages (3)". Count = `unreadTotal` from GET /api/crm/inbox; hidden entirely when 0, so no fake "(0)". | client/src/pages/crm-inbox.tsx:411,424 | GET /api/crm/inbox → server/crm/inbox.ts:68 — `SELECT count(*) FROM crm_client_comments WHERE org_id=? AND author_member_id IS NULL AND read_at IS NULL` (whole org, no time window, no LIMIT) | SQL `SELECT count(*) … unread client` = **0**; API `unreadTotal` = **0**; Playwright: tab text "Messages" with no count. Count of 1 confirmed transiently during the AUDIT- reply test (see below) | OK |
| Tab "Client activity" (`tab-inbox-activity`) | tab | Switches to the feed of client actions (estimate viewed/approved/declined, payments succeeded/failed/refunded). Tab choice is stored in the URL (`?tab=activity`) so a reload keeps it. | client/src/pages/crm-inbox.tsx:427,403 | n/a — same page, no fetch until shown | Playwright: click switches panes; direct load of `/crm/inbox?tab=activity` keeps the activity tab active | OK |

### Messages pane — thread list (`inbox-thread-list`)

One row per client who has ever messaged, newest activity first. Currently 7 rows, matching SQL `SELECT customer_id … GROUP BY 1` = 7 groups from 11 comments.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Thread row (`thread-<customerId>`) | row button → deep link | Opens that client's conversation at `/crm/inbox?c=<id>` (list hidden on phones until you go back). | client/src/pages/crm-inbox.tsx:163 | GET /api/crm/inbox → server/crm/inbox.ts:77 — raw SQL over `crm_client_comments c JOIN crm_customers cust`, `WHERE c.org_id=?`, `GROUP BY c.customer_id`, `ORDER BY max(c.created_at) DESC LIMIT 200` | API returned 7 threads; SQL grouping returned the same 7 customer_ids in the same order; Playwright counted 7 rows | OK |
| Client name + initial avatar in row | text | Shows the client's display name. | client/src/pages/crm-inbox.tsx:172,175 | `cust.display_name` from crm_customers | API `customerName` matches SQL `display_name` per customer | OK |
| Relative time in row (e.g. "4d ago") | text | How long since the newest message in that thread. Computed in the browser from `lastAt` (UTC), so it reflects your local clock. | client/src/pages/crm-inbox.tsx:178 (relTime:32, apiDate:27) | `max(c.created_at)` per thread, returned as ISO-UTC (`isoUtc`) | API `lastAt` "2026-09-30T05:11:05.020Z" matches SQL `max(created_at)` 2026-09-30 05:11:05.020865 exactly | OK |
| Last-message preview ("You: …") | text | Shows the most recent message's text; prefixed "You:" when the last message was a team reply (`lastAuthorMemberId` set). | client/src/pages/crm-inbox.tsx:180 | `(array_agg(c.body ORDER BY c.created_at DESC))[1]` + same for author_member_id (inbox.ts:82-83) | Spot-checked 3 threads against SQL bodies — identical | OK |
| "waiting 2h for a reply" badge (`Clock` icon) | status pill, conditional | On threads with unread client messages, shows how long the oldest unread message has waited; amber under 24h, red at 2h+ / 1d+. | client/src/pages/crm-inbox.tsx:42,161,183 | `min(c.created_at) FILTER (WHERE author_member_id IS NULL AND read_at IS NULL)` as `oldestUnreadAt` (inbox.ts:84); urgency thresholds client-side | Code + SQL shape (org currently has 0 unread, so pill cannot render — verified the field arrives as `null` for all 7 threads) | OK |
| Unread count badge (`thread-unread-<customerId>`) | count badge, conditional | Per-thread number of unread client messages; hidden when 0. | client/src/pages/crm-inbox.tsx:189 | `count(*) FILTER (WHERE c.author_member_id IS NULL AND c.read_at IS NULL)` per customer (inbox.ts:81) | All 7 threads show unread=0; matches SQL per-customer counts | OK |
| Empty state "No messages yet" | empty state | Shown only when the org has zero threads. | client/src/pages/crm-inbox.tsx:145 | same endpoint, `threads.length === 0` | Code only (org has 7 threads, state not reachable here) | OK |

### Messages pane — conversation (`inbox-conversation`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Back arrow (`button-back-to-threads`) | icon button (mobile only) | Returns from a conversation to the thread list on small screens. | client/src/pages/crm-inbox.tsx:205 | client only | Code + class `md:hidden` | OK |
| Client name link in conversation header | link | Goes to that client's CRM page (`/crm/clients/<id>`). | client/src/pages/crm-inbox.tsx:213 | route /crm/clients/:id → App.tsx:396 | Route exists in App.tsx; Playwright confirmed rendered href `/crm/clients/bf0d5391-…` | OK |
| Client email line under the name | text | Shows the client's email on file (hidden if none — which also means replies won't be emailed). | client/src/pages/crm-inbox.tsx:215 | `cust.email` from GET /api/crm/inbox/:customerId (inbox.ts:136) | API `customer.email` matches SQL `email` for the 2 threads checked (one null = "NoEmail" client, line correctly absent) | OK |
| Message bubbles (`message-<id>`) | read-only text | The two-way history, oldest→newest, client messages left / your replies right. Each shows "About estimate E-xxxx" when the client asked from an estimate page, "To <team member>" when the client addressed a specific person, a relative timestamp, and "· <author>" on team messages. | client/src/pages/crm-inbox.tsx:232 | GET /api/crm/inbox/:customerId → server/crm/inbox.ts:118 — `crm_client_comments WHERE org_id=? AND customer_id=? ORDER BY created_at DESC LIMIT 500` (then reversed), estimate number resolved from crm_estimates.number via estimateRefs (inbox.ts:56), member names from crm_members | Thread for customer afc2b53c… returned `estimateNumber:"E-3723"`; SQL `SELECT number FROM crm_estimates WHERE id='26a79123-…'` = E-3723. 500-message cap and org/customer scoping confirmed in code | OK |
| Thread error panel ("This conversation isn't available") | error state | Shown if the thread fetch fails, e.g. the client was deleted; disables the reply box. | client/src/pages/crm-inbox.tsx:222 | GET returns 404 `{"message":"Record not found"}` for unknown id (verified live, HTTP 404) | Live API call with a random UUID → 404; UI state code-verified | OK |
| Auto mark-read on open | invisible side effect | Opening a thread immediately marks its unread client messages read (like a text app), so the tab count and badges drop. No latch: a new client message arriving during the 15s auto-refresh gets read too. | client/src/pages/crm-inbox.tsx:97,104 | POST /api/crm/inbox/:customerId/read → server/crm/inbox.ts:155 — `UPDATE crm_client_comments SET read_at=now() WHERE org_id=? AND customer_id=? AND author_member_id IS NULL AND read_at IS NULL` | Live: POST on the AUDIT- thread → 200 `{ok:true}`; UPDATE filters verified in code (member-authored rows never touched) | OK |
| Reply textarea (`input-inbox-reply`) | input | Where you type the reply. Placeholder tells you the truth: "…lands in their portal and their email…" when the client has an email, "…(no email on file)…" when they don't. Enter sends, Shift+Enter makes a new line. | client/src/pages/crm-inbox.tsx:257 | client only | Playwright: present, disabled until a thread loads; placeholder switches on `customer.email` (code) | OK |
| Send button (`button-inbox-send`) | button | Sends the reply: it is saved into the client's portal thread, any unread flags on the thread are cleared, and an email copy goes to the client's address when one is on file. Toast afterwards says exactly which of those happened ("Reply sent" / "Reply saved to their portal, the email copy didn't go through"). | client/src/pages/crm-inbox.tsx:274 | POST /api/crm/inbox/:customerId/reply `{body}` → server/crm/inbox.ts:176 — zod body 1–4000 chars; rate limit 60/member/hr (`crmreply:<org>:<member>`); INSERT crm_client_comments (author_member_id = you, read_at = now); UPDATE clears unread; if cust.email: sendWithFallback email "💬 New message from <org>" with reply-to your address; responds 201 `{id, createdAt, emailed, emailError}` | Live end-to-end against an AUDIT- test client I created and deleted: 201, comment appeared in GET thread as `fromClient:false` with my member name and `readAt` set, `emailed:false` + matching toast branch (no email on file). Empty body → 400 "Write a message first". Unknown customer → 404. Email-copy path (customer with email) verified by code + existing server tests (server/crm/inbox-reply-status.test.ts); not fired live to avoid sending real email | OK |
| Send-disabled state | button state | Button stays disabled while the box is empty/whitespace, while a thread isn't loaded, or while sending. | client/src/pages/crm-inbox.tsx:276 | client only | Playwright: `isDisabled() === true` with empty input | OK |
| "Pick a conversation — a fast reply wins the job." | placeholder | Shown on desktop when no thread is selected (list visible, conversation empty). | client/src/pages/crm-inbox.tsx:285 | client only | Code only | OK |
| 20s / 15s auto-refresh | behavior | Thread list re-fetches every 20s, open conversation every 15s, so new client messages appear without reload. | client/src/pages/crm-inbox.tsx:80,91 | client only | Code only | OK |

### Client activity pane (`activity-feed`)

Feed of the newest 80 client actions: estimate viewed/approved/declined and payments succeeded/failed/refunded, merged newest-first. Each row is one icon + a sentence ("Kane viewed estimate E-2001") + optional note + relative time.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Feed rows (`activity-<id>`) | read-only list | One sentence per client action with a colored icon; payment rows show the amount formatted from cents ("$250.00") plus method · purpose, and the note field when present. | client/src/pages/crm-inbox.tsx:315,373 | GET /api/crm/activity → server/crm/schedule.ts:364 — (a) crm_estimate_events JOIN crm_estimates JOIN crm_customers, `org_id=? AND type IN ('viewed','approved','declined') ORDER BY created_at DESC LIMIT 60`; (b) crm_payments JOIN crm_customers, `org_id=? AND status IN ('succeeded','failed','refunded') ORDER BY created_at DESC LIMIT 60` (only when the member has seePrices); merged, sorted by `at` = payments `paid_at ?? created_at`, sliced to 80 | **Full ID-for-ID match**: SQL reconstruction of the 60+60 merge → top-80 diffed against the API response → identical (80/80, same order). Playwright: 80 rows rendered (81 `[data-testid^="activity-…"]` nodes minus the `activity-feed` container itself) | OK |
| "viewed / approved / declined" wording | text | Maps each estimate event type to a verb with a fixed icon+tint (blue eye / green check / red cross; unknown types fall back to a grey eye line). | client/src/pages/crm-inbox.tsx:317 | crm_estimate_events.type | API types in feed: viewed 31, approved 23, declined 3 — all three have explicit wording | OK |
| "paid / payment failed / was refunded" wording | text | Maps each payment status to a sentence; amount from `amountCents/100` formatted US-style, method = `method ?? provider`. | client/src/pages/crm-inbox.tsx:332 | crm_payments.status, amount_cents, method, provider, purpose, note; `at` = paid_at ?? created_at | Spot-checked amounts/methods against SQL (e.g. pay-6555abab… $250.00 cash · progress matches crm_payments row) | OK |
| Row timestamps ("2h ago") | text | Relative time of the event, browser-local, from the UTC `at` value. | client/src/pages/crm-inbox.tsx:385 | event created_at / payment paid_at??created_at | covered by the ID diff (ordering) above | OK |
| "No activity yet" empty state | empty state | Shown when the merged feed is empty. | client/src/pages/crm-inbox.tsx:361 | same endpoint | Code only (feed has 80 items here) | OK |
| Payments hidden without seePrices | permission gate | Team members without the see-prices permission see only estimate events — no payment amounts. Dev user is owner, so the full feed shows. | client/src/pages/crm-inbox.tsx:395 (schedule.ts:394) | `ctx.permissions.seePrices` branch in schedule.ts:394 | Code only (cannot impersonate a no-prices seat in this session) | OK |

### Related element outside the page: sidebar unread badge

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Red "Messages" badge in the CRM sidebar (`badge-messages-unread`) | count badge | Same org-wide unread count as the tab, shown as a red pill on the sidebar "Messages" item on every CRM page; capped at "99+", refreshes every 30s. Hidden when 0. | client/src/components/crm-sidebar.tsx:93,176 | GET /api/crm/inbox `unreadTotal` (same query as the tab) | Same SQL (0) as API; badge absent in Playwright render when count is 0; cap logic code-verified | OK |

### Numbers reconciliation summary (all verified)

| Number shown | Value on page/API | Independent SQL | Match |
|---|---|---|---|
| Messages tab count `(N)` | 0 (hidden) | `SELECT count(*) FROM crm_client_comments WHERE org_id='c5b47b8d…' AND author_member_id IS NULL AND read_at IS NULL` → 0 | ✅ |
| Thread rows | 7 | `GROUP BY customer_id` on same table → 7 groups | ✅ |
| Per-thread unread badges | all 0 | per-customer `FILTER` counts → all 0 | ✅ |
| Activity feed rows | 80 | 60+60 merged pool (120) sliced to 80; top-80 IDs diffed identical | ✅ |

### Notes / latent edge cases (not bugs — no owner-visible wrongness today)

- **Activity feed pre-limit vs merge sort**: the payment half is selected as `ORDER BY created_at DESC LIMIT 60` but merged/sorted by `paid_at ?? created_at` (schedule.ts:398,417). A payment whose `paid_at` is much newer than its `created_at` could in theory be cut by the 60-row pre-limit yet rank in the top 80. Checked against live data: 0 rows would be wrongly excluded at current volumes; only bites when >60 payments sit in the feed window.
- **Thread list cap**: threads are `LIMIT 200`, but the tab/sidebar unread count is deliberately counted over the whole org (inbox.ts:97-105 comment) so the badge can't undercount when the list is full — intentional, consistent.
- **Time windows**: nothing on this page uses a calendar month/30-day window; every number is a cumulative org-scoped count or a newest-first list, so the classic "this month vs last 30 days" bug class does not apply here. Timestamps: DB session UTC, serialized with explicit `Z`, rendered browser-local.
- **Fallbacks**: the only `?? 0` is the tab/sidebar count, and a 0 renders as no badge at all rather than a fabricated "(0)".

### Test-data cleanup

Created one client "AUDIT-inbox-check" via the app API to exercise reply/read safely (no email on file → no external email sent), verified the effects, then `DELETE /api/crm/customers/<id>` which also removed its comment rows (entities.ts:793). Confirmed afterwards: customer 0 rows, comments 0 rows, inbox back to 7 threads / 0 unread.

### Routes without doc comments (candidates for later)

- `client/src/App.tsx:398` — `/crm/inbox` → CrmInboxPage (this page). Only the blanket `PortalRouter` comment at App.tsx:386 covers it; no per-route note saying it is the Messages/activity center.
- `client/src/App.tsx:396` — `/crm/clients/:id` → CrmClientPage (target of the conversation-header client link).


## Documents Center — Estimates & Invoices (/crm/estimates, /crm/invoices)

Shared component `client/src/pages/crm-documents.tsx`, rendered as `/crm/estimates` (`client/src/pages/crm-estimates.tsx`, adds a "New estimate" button) and `/crm/invoices` (`client/src/pages/crm-invoices.tsx`, no extra actions). There are no upload / AI-generate / sign actions on these two pages — AI generation lives on the estimate-new/detail pages (out of this section's scope, code-only per instructions). Sign (approve/decline) happens on the public portal page, not here.

Audited as dev user 1 (Veto), active org **SKU Dry-Run** `c5b47b8d-caa8-47e6-ae7e-6248ad5df565`, role **owner**, all permissions true, no division scope — so the audited code path is the unscoped SQL branch of both list endpoints. The division-scoped / no-viewAllJobs branch (in-memory filter + JS-side counts, `server/crm/entities.ts:1064-1073` and `1165-1174`) is code-verified only; it fetches all matching rows, applies `objectPolicy(ctx).filter`, then slices and counts — counts there are post-filter, consistent by construction.

Both pages always send `sort`, `dateField`, `limit`, `offset` → the server always runs "Documents Center mode" (`parseDocQuery` returns non-null), never the legacy bare-array branch.

**All time windows are the browser's LOCAL calendar days converted to exact UTC instants** (`crm-documents.tsx:118-151`); the server compares them against `timestamptz` columns in UTC. Verified: the dev host browser is EDT (UTC-4), and counts match SQL only when the window is computed in EDT — the code is correct, the browser timezone (not the org timezone America/Los_Angeles) is what matters.

### Page header

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Estimates" title + ⓘ info icon / `info-tip-estimates` | Header + info dialog | Titles the page; the ⓘ opens a help dialog explaining the estimate statuses | crm-documents.tsx:315; info-tip.tsx:29; content at client/src/lib/info-content.ts:140-148 | client only (INFO_CONTENT key "estimates") | key exists; dialog opens in browser; body read | BUG (copy) — see findings |
| "Invoices" title + ⓘ info icon / `info-tip-invoices` | Header + info dialog | Titles the page; the ⓘ opens a help dialog about accounts receivable | crm-documents.tsx:315; info-content.ts:150-157 | client only | key exists; body read | OK |
| Subtitle ("Every estimate across the company — filter by status, date or client.") | Text | Static description of the list | crm-documents.tsx:81,94 (CONFIG) | client only | code only | OK |
| "New estimate" button / `button-new-estimate` (estimates page only) | Button → link | Opens the wizard for creating a new estimate | crm-estimates.tsx:11-15 | route GET /crm/estimates/new → App.tsx:404 `CrmEstimateNewPage` | route exists in App.tsx:404 | OK |

### Filter card

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Status group / `filter-statuses` | Checkbox group | Filters the list by document status; boxes combine (OR); none ticked = no status filter ("All") | crm-documents.tsx:322-352 | GET /api/crm/estimates or /api/crm/invoices, `status=a,b` param → server/crm/entities.ts:985/1104, status SQL at 1005-1041 (estimates, derived "expired") and 1131-1137 (invoices, derived "overdue") | per-status API counts matched SQL below | OK (with gaps noted) |
| "All" checkbox / `filter-status-all` | Checkbox | Ticks when nothing is selected; clicking clears all status filters | crm-documents.tsx:327-336 | same as above (no `status` param sent when set empty, crm-documents.tsx:255) | UI: checked on fresh load; unchecking others re-checks All | OK |
| Draft checkbox / `filter-status-draft` | Checkbox | Shows only drafts | crm-documents.tsx:337-351 | `status=draft` → `inArray(status,['draft'])`, org_id = caller's active org | API `status=draft` filtered=1765 = SQL `count(*) WHERE status='draft'` | OK |
| Sent checkbox / `filter-status-sent` | Checkbox | Shows sent estimates **minus the ones that silently expired** (unless Expired is ticked too); for invoices, stored sent only | crm-documents.tsx:337-351 | entities.ts:1018-1029 (estimates: sent/viewed answered-or-unexpired only); invoices: `inArray(status,['sent'])` | estimates API `status=sent` filtered=974 = SQL sent 1452 − 478 derived-expired sent; invoices `status=sent` filtered=3 = SQL | OK (documented semantics) |
| Viewed checkbox / `filter-status-viewed` | Checkbox | Shows viewed (same expired exclusion as Sent on estimates) | crm-documents.tsx:337-351 | entities.ts:1018-1029 | API `status=viewed` filtered=629 = SQL viewed 863 − 234 derived-expired viewed | OK |
| Approved checkbox / `filter-status-approved` (estimates) | Checkbox | Shows approved/signed estimates | crm-documents.tsx:337-351 | `inArray(status,['approved'])` | API filtered=1602 = SQL | OK |
| Declined checkbox / `filter-status-declined` (estimates) | Checkbox | Shows declined estimates | crm-documents.tsx:337-351 | `inArray(status,['declined'])` | API filtered=4 = SQL | OK |
| Expired checkbox / `filter-status-expired` (estimates) | Checkbox | Shows estimates that went out (sent/viewed), were never answered and passed their 7-day expiry — derived, never stored | crm-documents.tsx:337-351 | entities.ts:1031-1038: `status IN ('sent','viewed') AND expires_at < now() AND approved_at IS NULL AND declined_at IS NULL` (same predicate as `estimateIsExpired`, entities.ts:94-102) | API filtered=712 = SQL count of derived-expired; row pill shows "expired" for a `sent` row (screenshot) | OK |
| Partial checkbox / `filter-status-partial` (invoices) | Checkbox | Shows partly-paid invoices | crm-documents.tsx:337-351 | `inArray(status,['partial'])` | API filtered=537 = SQL | OK |
| Paid checkbox / `filter-status-paid` (invoices) | Checkbox | Shows paid invoices | crm-documents.tsx:337-351 | `inArray(status,['paid'])` | API filtered=314 = SQL | OK |
| Void checkbox / `filter-status-void` (invoices) | Checkbox | Shows voided invoices | crm-documents.tsx:337-351 | `inArray(status,['void'])` | API filtered=349 = SQL | OK |
| Overdue checkbox / `filter-status-overdue` (invoices) | Checkbox | Shows open (sent/partial) invoices past their due date with a balance still due — derived, never stored | crm-documents.tsx:337-351 | entities.ts:1126: `status IN ('sent','partial') AND due_at IS NOT NULL AND due_at < now() AND paid_cents < total_cents` | API filtered=295 = SQL same predicate; UI row shows "Overdue" danger pill (screenshot) | OK |
| (missing) Cancelled status checkbox | — | **There is no "Cancelled" filter for estimates even though `CRM_ESTIMATE_STATUSES` includes `cancelled` and this org has 121 cancelled estimates** — they only appear when no status box is ticked, and a `?status=cancelled` URL param is silently dropped by `initialFilters` | crm-documents.tsx:82-89 (config omits it), 155-170 (URL param filtered against config keys) | server would accept it (`allowedStatuses` = full CRM_ESTIMATE_STATUSES, entities.ts:988) | SQL: 121 rows `status='cancelled'` in org; no checkbox; `?status=cancelled` → treated as no filter | UNCLEAR — product gap or intentional; no server-side inconsistency |
| Date field select (Created/Sent) / `select-date-field` | Select | Chooses which date the range filters on | crm-documents.tsx:360-369 | `dateField=created|sent` → `dateCol = created_at | sent_at` (entities.ts:1002, 1127) | with range=30d sent: API 10 = SQL `sent_at` window count 10; with Any time it applies no date bound (count unchanged 2168) | OK |
| Date range select / `select-date-range` | Select | Preset window: Any time / Today / Last 7 days / Last 30 days / Custom | crm-documents.tsx:370-382 | `from`,`to` ISO instants → `gte/lte` on dateCol (entities.ts:1042-1043, 1138-1139); bare YMD treated as whole UTC day server-side (entities.ts:188-194) | today: API 39 = SQL; 30d+sent: 10 = SQL; custom Oct 1–10: 1440 = SQL (EDT-window) | OK (label nuance in findings) |
| Custom from input / `input-date-from` | Date input | Start of a custom date range (only when range=Custom) | crm-documents.tsx:385-393 | as above | UI: filled + mirrored to URL `?range=custom&from=…` | OK |
| Custom "to" input / `input-date-to` | Date input | End of a custom date range | crm-documents.tsx:395-403 | as above | as above | OK |
| Swapped-range warning / `text-date-swapped` | Text | If From is after To, says it's showing the range reversed instead | crm-documents.tsx:407-411 | client only (server gets the corrected window) | UI: typing 10/10→10/1 shows "showing 10/1/2026 to 10/10/2026 instead", count 1440 = SQL reversed window | OK |
| Sort select / `select-sort` | Select | Newest/Oldest by created_at, or Largest by totalCents | crm-documents.tsx:418-428 | `sort` → `order by created_at desc|asc, total_cents desc` (+ `id asc` tiebreak) entities.ts:1052-1054, 1148-1150 | largest: API top-5 (E-3723 11410000, E-1034 4296000, E-4152/E-5847/E-7020 3245000) = SQL same order | OK |
| Search input / `input-search` | Text input | Debounced (300 ms) contains-search on document number, title and client name; max 200 chars | crm-documents.tsx:437-443, 216-219 | `q` → `ilike %q%` (escaped) on `number`, `title`, `customers.display_name` (entities.ts:1044-1051, 1140-1147) | API `q=E-9110` filtered=1, row E-9110 = SQL ilike count 1 | OK |

### Count summary + pager

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "X of Y" / `text-count-summary` | Text | **X = rows matching the current filters, Y = ALL documents of that kind in the company** (Y ignores filters) | crm-documents.tsx:451-453 | `filtered` = `count(*)` with status/date/search WHERE; `total` = `count(*)` org-only (entities.ts:1080-1085, 1179-1184) | estimates "5807 of 5807" then "712 of 5808" and invoices "2168 of 2168" vs SQL `count(*)` for org — exact, live DB drift included (shared dev DB, other lanes writing) | OK |
| "Showing A–B of X" / `text-page-range` | Text | Which slice of the filtered list is on screen (100 rows per page) | crm-documents.tsx:305-306, 456 | computed client-side from `rows.length`, `page`, `filtered` | UI: "Showing 1–100 of 2168" → Next → "Showing 101–200 of 2168" | OK |
| Previous / `button-page-prev` | Button | Goes back one page; disabled on page 1 | crm-documents.tsx:457-460 | client only (offset in query) | UI: disabled on p1; returns to 1–100 after Next | OK |
| Next / `button-page-next` | Button | Goes forward one page (hidden entirely when everything fits on one page) | crm-documents.tsx:461-464 | client only | UI: works, URL becomes `?page=2` | OK |

### Documents table (per row; columns verified against the live org)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Row click / `doc-row-<id>` | Row → navigation | **Estimates:** opens that estimate's detail/edit page. **Invoices:** opens the client's page (invoices have no detail page) | crm-documents.tsx:311, 538-542 | routes /crm/estimates/:id (App.tsx:405), /crm/clients/:id (App.tsx:396) | routes exist in App.tsx | OK |
| Number link / `doc-link-<id>` | Link | Same destination as the row click | crm-documents.tsx:545-552 | as above | route check | OK |
| Client cell / `doc-client-link-<id>` (estimates; plain text on invoices) | Link / text | Estimate rows link to the client; invoice rows just show the name | crm-documents.tsx:558-569 | `customerName` from `left join crm_customers on id=customer_id and customers.org_id=org` | join verified via SQL spot checks (names match `display_name`) | OK |
| Title cell | Text | Estimate/invoice title | crm-documents.tsx:570-572 | `title` column | first-row values match DB (e.g. "Intel fixture") | OK |
| Status pill | Pill | Stored status; **overrides:** an invoice past due shows red "Overdue" instead of its status; an expired-but-unanswered estimate shows "expired" | crm-documents.tsx:530-536 | `overdue` derived server-side (entities.ts:1156-1159, same predicate as filter); `expired` derived (entities.ts:250) | UI screenshot: `sent` row E-3590 shows "expired" pill; invoice INV-2188 shows "Overdue" pill | OK |
| Total cell | Money | Estimate: the **signed** total (after the client's optional discounts) once approved — with a "signed · quoted $X" sub-line when it differs from the quote; otherwise the quoted/invoice total. Invoices: invoice total. Refunded invoices get a "$X refunded" line | crm-documents.tsx:574-582 | `total_cents`, `approved_total_cents` (present only with seePrices, entities.ts:229-253); `refunded_cents` from `crm_payment_refunds` summed per invoice (server/crm/refund-summary.ts:4-10) | E-2790: API totalCents=740000 approvedTotalCents=733400 = DB columns; 123 approved rows differ; refund totals code+query verified (0 refund rows in this org → line never rendered here, query shape verified) | OK |
| Created/Sent date cell | Date | The chosen date field, in the browser's locale | crm-documents.tsx:509-511, 583-585 | `created_at` / `sent_at` | matches DB timestamps | OK |
| Due date cell (invoices) | Date | Invoice due date, "—" when none | crm-documents.tsx:512-515, 586-590 | `due_at` | screenshot column populated (11/3/2026 = DB due_at +1d EDT↔UTC rendering, consistent) | OK |
| "Receipt" button / `button-receipt-<id>` (invoices, when `manageInvoices` and money moved) | Button → dialog | Opens the receipt-to-date preview (items, payments, total paid, balance, PAID IN FULL stamp) | crm-receipt.tsx:54-62, 64-154 | GET /api/crm/invoices/:id/receipt → server/crm/receipts.ts:229 `buildReceiptData` (receipts.ts:61-110): payments = `crm_payments` status IN (succeeded, partially_refunded, refunded) + negative refund rows from `crm_payment_refunds`; `totalPaid = paid_cents`; `balance = max(0, total − retainage − paid)` | INV-1106: API totalPaid=200000, balance=0, paidInFull=true, 3 payments = SQL payments rows (check 40000/20000/140000); UI dialog shows $250.00/$0.00/PAID IN FULL | OK |
| "Send receipt" / `button-send-receipt` (inside dialog) | Button | Emails the receipt HTML to the client's email; toasts the outcome. Refused (409) if the invoice is void or has no payments | crm-receipt.tsx:156-164 | POST /api/crm/invoices/:id/receipt/send → receipts.ts:245-285: rebuilds receipt, `sendWithFallback` email, then records the attempt in `custom_fields->receipt` (`noteReceiptEmail`, receipts.ts:174-191) | **code only, not pressed** — it writes to the DB and SMTP is down on dev (expected "couldn't email" toast path is handled); endpoint exists, method/body match | OK (code) |
| "Open" button / `button-open-doc-<id>` (estimates, ≥sm screens) | Button → link | Opens the estimate detail/edit page | crm-documents.tsx:604-615 | route /crm/estimates/:id | exists in App.tsx:405 | OK |
| Trash icon / `button-delete-doc-<id>` (owner only; hidden for signed estimates and any invoice with money) | Button → confirm dialog | Starts the permanent delete | crm-documents.tsx:620-632 | DELETE /api/crm/estimates/:id (entities.ts:1452-1476) or /api/crm/invoices/:id (server/crm/ops.ts:550-586); both `requireOwnerRole`; estimates refuse approved (409, entities.ts:304-309), invoices refuse paid/any-payment rows (ops.ts:64-78) | full flow pressed on an AUDIT- draft estimate: dialog named E-9113 correctly, confirm → row gone, list went "1 of 5809" → "0 of 5808", SQL row gone; test customer deleted after | OK |
| "Open"-column visibility for non-owners | Layout | Invoices hide the whole Actions column for non-owners; estimates keep Open but hide the trash | crm-documents.tsx:516-518, 598-635 | server enforces owner-only independently (`requireOwnerRole`) | code only | OK |

### Delete confirm dialog / `dialog-delete-doc`

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Title "Delete estimate/invoice <number>?" + ⓘ | Text | Names the exact document; ⓘ explains owner-only delete | crm-documents.tsx:648-653; info-content.ts:620-627 | client only | dialog rendered with correct number/title/client in UI test (screenshot) | OK |
| Description | Text | States exactly what gets deleted (line items, options, discounts, history for estimates; line items for invoices) and that it can't be undone | crm-documents.tsx:654-662 | matches server behavior: `deleteEstimateChildren` deletes options/discounts/items/events/engagement (entities.ts:312-325); `deleteInvoiceChildren` deletes items/engagement (ops.ts:564-568) | code + live delete test | OK |
| Cancel / `button-cancel-delete-doc` | Button | Closes the dialog, deletes nothing | crm-documents.tsx:665 | client only | code only | OK |
| "Delete permanently" / `button-confirm-delete-doc` | Button | Sends the DELETE; on success closes, refreshes the list, toasts "Estimate/Invoice deleted"; on failure toasts the server's reason | crm-documents.tsx:666-671, 189-202 | as above; server also leaves a deletion note on the client's activity (`crm_customer_notes`) and logs `estimate.deleted`/`invoice.deleted` | live test (see trash row) | OK |

### Empty / loading / error states

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Loading spinner | Indicator | Spins while a list request is in flight; keeps the old table during page turns | crm-documents.tsx:469-472, 268-269 | client only | code only | OK |
| `empty-docs` "No estimates/invoices yet" | Empty state | Shown when the org has none at all | crm-documents.tsx:473-487 | client only (driven by `total===0`) | code only — org has thousands, state not reachable without creating/deleting data | OK (code) |
| `empty-docs` "No matches" | Empty state | Filters exclude everything (or the page is past the end) with guidance text | crm-documents.tsx:478-485 | client only | UI: after deleting the AUDIT- estimate with `?q=AUDIT-Docs` — "No matches / Nothing matches those filters" shown | OK |
| Past-end page text + "Back to page 1" / `button-page-first` | Text + button | When a saved ?page= is beyond the filtered list, explains and offers a jump to page 1 | crm-documents.tsx:482-494 | client only | UI at `?page=999`: "That page is past the end of the list — go back a page." + button rendered | OK |
| ErrorCard "Couldn't load …" | Error state | Shown if the list request errors | crm-documents.tsx:294-301 | client only | code only | OK (code) |
| Invoices permission card ("You don't have permission to see invoices…") | Gate | Shown instead of the whole page when the seat lacks `seePrices` | crm-documents.tsx:281-292 | enforced server-side too: GET /api/crm/invoices returns 403 without seePrices (entities.ts:1107) | code only (owner has the permission) | OK (code) |

## Findings

1. **BUG (low, user-facing copy)** — Estimates page ⓘ help says *"Click any row to open the client it belongs to and see the full picture."* (`client/src/lib/info-content.ts:145`). That is only true for **invoice** rows. Estimate rows (and the number link, and "Open") go to the estimate's own detail/edit page (`crm-documents.tsx:311`). The help text describes the wrong navigation on the page it appears. Fix is a one-line copy change in info-content.ts.
2. **UNCLEAR (label vs window, borderline)** — "Last 7 days" / "Last 30 days" presets (`crm-documents.tsx:137-141`) run from **start of (today − N) through end of today**, i.e. 8 and 31 calendar days respectively (verified: the request window for "7d" on Oct 4 spans Sep 27 00:00 → Oct 4 23:59 local). The server faithfully counts that window; it's the label that under-promises. If "last 7 days" should mean 7 calendar days, the client offset is off by one — a one-line change; if "N days back plus today" is intended, no fix needed.
3. **UNCLEAR (filter gap)** — Cancelled estimates cannot be filtered to: the config (`crm-documents.tsx:82-89`) omits `cancelled` from the status checkboxes even though `CRM_ESTIMATE_STATUSES` includes it and the server accepts it (121 cancelled rows in SKU Dry-Run, visible only under "All"). A `?status=cancelled` URL param is silently discarded by `initialFilters` (`crm-documents.tsx:162`). Product call whether cancelled estimates deserve a checkbox; no number is wrong because of it.

## Numbers cross-check table (org c5b47b8d, audited 2026-10-04 ~23:00–23:10 UTC)

| Number on page | API | Independent SQL | Match |
|---|---|---|---|
| Estimates total | 5807→5808→5809 (live drift) | `count(*) crm_estimates WHERE org_id=…` identical at each read | ✓ |
| Invoices total | 2168 | `count(*) crm_invoices WHERE org_id=…` | ✓ |
| Expired filter | 712 | derived-expired predicate, same columns | ✓ |
| Sent only | 974 | `status='sent'` minus derived-expired | ✓ |
| Sent+Expired | 1686 | 974 + 478 expired-sent + 234 expired-viewed | ✓ |
| Overdue filter | 295 | `status IN (sent,partial) AND due_at<now() AND paid_cents<total_cents` | ✓ |
| Void filter | 349 | `status='void'` | ✓ |
| Draft / Approved / Viewed / Declined / Partial / Paid | 1765/1602/863→629/4/537/314 | same-status SQL counts (viewed/minus-expired where applicable) | ✓ |
| Today (created) | 39 | `created_at` in local Oct 4 window | ✓ |
| Last 30 days (sent) | 10 | `sent_at` in window | ✓ |
| Custom Oct 1–10 (swapped inputs) | 1440 | reversed-window `created_at` count | ✓ |
| Search "E-9110" | 1 | `ilike` on number/title/display_name | ✓ |
| Largest-first top 5 | E-3723, E-1034, E-4152/5847/7020 | `ORDER BY total_cents DESC, id ASC` | ✓ |
| Receipt totals (INV-1106) | paid 200000, balance 0, 3 payments | `crm_payments` rows 40000+20000+140000 | ✓ |

No fabricated or fallback numbers found. The only `?? 0`-style fallbacks (`filtered ?? 0`, `paidCents ?? 0`) render as "—" or hide elements rather than inventing data.


# Audit section 08 — Price book

## Price book (/crm/pricebook)

Page component: `client/src/pages/crm-pricebook.tsx` (route `client/src/App.tsx:408`, nav label "Price book" at `client/src/App.tsx:619`).
Audited as signed-in dev platform admin (user id 1), session org **SKU Dry-Run** (`c5b47b8d-caa8-47e6-ae7e-6248ad5df565`, role owner, all permissions true — `GET /api/crm/me`). All price-book queries are org-scoped via `requireOrg` → `ctx.org.id` (`server/crm/tenancy.ts:109`).
Data volumes on this org: **376 active SKUs** (530 incl. inactive), **117 active materials** (183 incl. inactive), **1 active labor rate** (68 incl. inactive), **7 categories**.
No time windows or time zones are involved anywhere on this page — every number is a current price/count, so "this month"-style bugs do not apply.
Every price read path was verified row-by-row against the DB: all 376 items and all 117 materials matched on every displayed field (name, code, unit, pricing mode, flat price/cost, per-sq-ft rate, waste bps, cost/price cents) with **0 mismatches**.

---

### Page header (`crm-pricebook.tsx:443-455`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Price book" title | heading | Names the page; sidebar highlights "Price book". | client/src/pages/crm-pricebook.tsx:446 | client only: render. | Playwright: h1 = "Price book"; route /crm/pricebook in App.tsx:408 | OK |
| Subtitle "Price each SKU once, then estimate by quantity. Waste factors are a real field, not a formula trick." | text | Static explanation under the title. | crm-pricebook.tsx:448 | client only: static string. | code only | OK |
| ⓘ button beside title | button | Opens a help dialog explaining the price book (4 paragraphs: master price list, per-sq-ft hookup, waste factors, price-once example). | crm-pricebook.tsx:447 `infoKey="pricebook"` → client/src/components/crm-ui.tsx:64 InfoTip → client/src/lib/info-content.ts:199-207 | client only: help text registry. | Playwright: button next to h1 opens dialog titled "Price book" | OK |
| "Add starter roofing set" (`button-seed-pb`) | button | Seeds a starter set: new "Roofing" category + "Roofing crew" labor rate + 4 materials + 1 assembly. Only appears while the org has zero SKUs and nothing is being searched/filtered. | crm-pricebook.tsx:449-454 | POST /api/crm/pricebook/seed → server/crm/pricebook.ts:840 → INSERT crm_pb_categories ("Roofing"), crm_pb_labor_rates (4500/9500 cents, is_default), 4× crm_pb_materials, 1× crm_pb_items (code 'RR-ARCH-1L', mode computed) + 3 crm_pb_item_parts. No dedup guard on the server. | Playwright: button count 0 on this org (376 SKUs → hidden by design); endpoint shape verified by code (write not pressed) | OK |

### Tab bar (`crm-pricebook.tsx:457-463`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Price Chart" tab | tab | Shows the SKU list (default tab). Remembers choice in ?tab= so reloads/shared links land on it. | crm-pricebook.tsx:459,175-179 | client only: navigate `/crm/pricebook?tab=items` replace:true | Playwright: renders; URL param logic code-verified; route exists App.tsx:408 | OK |
| "Materials" tab | tab | Shows the materials table and add form. | crm-pricebook.tsx:460 | client only: `?tab=materials` | Playwright: tab switch renders 117 rows | OK |
| "Labor" tab | tab | Shows labor rates. | crm-pricebook.tsx:461 | client only: `?tab=labor` | Playwright: 1 row rendered | OK |
| "Formulas" tab | tab | Shows the formula tester. | crm-pricebook.tsx:462 | client only: `?tab=formula` | Playwright: tester rendered, result "= 36" | OK |

### Price Chart tab — search, filters, actions (`crm-pricebook.tsx:465-513`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Search SKUs by name or code" (`input-search-items`) | input | Filters the SKU list as you type (250 ms debounce); matches name or code, case-insensitive substring. | crm-pricebook.tsx:190-195,467-471 | GET /api/crm/pricebook/items?q=… → server/crm/pricebook.ts:450-466 → SELECT * FROM crm_pb_items WHERE org_id=… AND active=true AND (name ILIKE '%q%' OR code ILIKE '%q%') ORDER BY name LIMIT 500 | API q=roof → 3 = SQL `count(*) … ILIKE '%roof%'` → 3; browser showed "3 SKUs found"; q=gutter → 0 both sides | OK |
| Category select (`select-item-category`) | select | Narrows the list to one category. Only shown when categories exist. | crm-pricebook.tsx:196,472-480 | same GET with `categoryId=` → adds `AND category_id = '…'` (pricebook.ts:456) | API categoryId=Gutters (4bf9e23d) → 0 = SQL 0; select rendered 7 options "All categories, Roofing, Siding, Windows, Gutters, Decks, Paint, Other" = SQL crm_pb_categories sort_order 0-6 | OK |
| "From template" (`button-from-template`) | button | Opens the template picker dialog (10 prewritten scope texts). | crm-pricebook.tsx:483-486 | client only: opens dialog (state tmplOpen) | Playwright: dialog opens with 10 template buttons | OK |
| "Add SKU" (`button-add-item`) | button | Opens the Add/Edit SKU dialog, blank. | crm-pricebook.tsx:487-490 | client only: opens dialog (dlg id:null) | Playwright: dialog opens, Save disabled until name entered | OK |
| Count line (`text-item-count`) | stat | "376 SKUs"; "3 SKUs found" while filtering; "Showing the first 500 SKUs — search to narrow the list." at the server's 500-row cap. | crm-pricebook.tsx:494-500 | GET /api/crm/pricebook/items … LIMIT 500 (pricebook.ts:458) — length capped at 500, so `>= 500` exactly tracks the cap | SQL `count(*) FROM crm_pb_items WHERE org_id='c5b47b8d…' AND active` = 376 = browser "376 SKUs"; cap branch code-verified (matches LIMIT 500) | OK |
| "No SKUs yet" empty state | empty state | Shown when the org has no SKUs (and not filtering) with hints to add one, use a template, or seed the starter set. | crm-pricebook.tsx:501-510 | client only | code only (org has 376 SKUs — not reachable here) | OK |
| Loading spinner / "Couldn't load" error | status | Shown while items load or if the request fails. | crm-pricebook.tsx:217-225 | client only | code only | OK |

### Price Chart tab — SKU cards (376 rendered; testids carry each SKU id) (`crm-pricebook.tsx:514-621`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Card (`pb-item-<id>`) with SKU name | card / text | Shows the SKU's name. | crm-pricebook.tsx:515,519 | GET /api/crm/pricebook/items → crm_pb_items.name | Row-by-row diff of all 376 API rows vs SQL: 0 mismatches | OK |
| Code line (`SKU #123` or raw code) | text | Numeric codes render as "SKU #123", text codes as typed. | crm-pricebook.tsx:521 | crm_pb_items.code | Diff vs SQL: 348 numeric / 28 text codes, all matched | OK |
| Price label (`pb-item-price-<id>`) | stat | The price: "$18,850.00 per job" for flat SKUs, "$18.00/sq ft" for per-sq-ft, "no rate set"/"no price set · per …" when the price column is null, "per …" when your role hides prices. | crm-pricebook.tsx:522,431-440 | Same GET; server hides flatPriceCents/rateCentsPerSqft when the user lacks seePrices (pricebook.ts:461-463); money = cents/100 | All 376 rows: flat price/rate fields match SQL cents exactly (e.g. afe665b7 = 1885000¢ → "$18,850.00 per job"; 03eb585e = 1800¢ → "$18.00/sq ft"); seePrices-stripping code-verified | OK |
| pricingMode badge (`flat` / `per_sqft` / …) | badge | Small pill showing how the SKU prices. | crm-pricebook.tsx:523 | crm_pb_items.pricing_mode | Diff vs SQL: 374 flat + 2 per_sqft, matched | OK |
| "placeholder rate — set yours" badge | badge | Amber warning that this per-sq-ft rate is a Quick Bid placeholder, not your real price. | crm-pricebook.tsx:524-528 | Same GET; crm_pb_items.custom_fields->'quickBidRate'->>'placeholder' | SQL count = 2 (03eb585e, 4c91ac34, both per_sqft) = browser badge count 2 | OK |
| qty input (`input-qty-<id>`) | input | Type how many you want to price, then Preview. Blank = 1. | crm-pricebook.tsx:532-535,414-418 | client only (sent to preview endpoint) | Playwright: filled 2.5 → preview used it | OK |
| "Preview" (`button-preview-<id>`) | button | Expands the SKU into lines and prices them for your qty — the table a real estimate would get. | crm-pricebook.tsx:536-539,419-428 | POST /api/crm/pricebook/items/:id/preview → pricebook.ts:625-647 → expandItem (pricebook.ts:55-152) reading crm_pb_items (+ crm_pb_item_parts/crm_pb_materials/crm_pb_labor_rates for computed SKUs). Requires seePrices (403 otherwise). | flat afe665b7 qty 2.5 → 1 line $18,850.00, total 4712500¢ = 1885000×2.5 ✓; per-sq-ft 03eb585e qty 1500 sf → total 2700000¢ = 1800×1500 ✓; AUDIT- item 9999¢ × 3 = 29997 ✓ | OK |
| Edit (`button-edit-item-<id>`, pencil) | button | Opens the SKU dialog prefilled with this SKU's saved values. | crm-pricebook.tsx:542-545,318-330 | client only (prefill) | Playwright: dialog opens; PATCH path verified below | OK |
| Delete (`button-delete-item-<id>`, trash) | button | After a confirm, removes the SKU from the list (soft delete — it stays on estimates already using it). | crm-pricebook.tsx:546-555,367-371 | DELETE /api/crm/pricebook/items/:id → pricebook.ts:566-578 → UPDATE crm_pb_items SET active=false WHERE org+id+active=true; logs activity | Pressed via API for AUDIT-PB-Item: {ok:true}, SQL active flips to f, GET list no longer returns it | OK |
| Description (`pb-item-desc-<id>`) | text | The scope text that rides onto every estimate line built from this SKU (clamped to 3 lines). | crm-pricebook.tsx:560-565 | crm_pb_items.description | Field present in row diff | OK |
| "formula uses: [X] …" line | text | Lists the formula symbols this SKU's quantity formula consumes. | crm-pricebook.tsx:566-570 | formulaSymbols(qtyFormula) computed server-side (pricebook.ts:464) | 0 SKUs with qty_formula in this org → not reachable; code only | OK |
| Preview table — "Expands to / Qty / Price / Line" rows | table | One row per priced line: what it expands to, quantity in its unit, unit price, and line total. | crm-pricebook.tsx:571-586 | preview endpoint lines[]; line total = round(unitPriceCents × quantityMilli/1000) — same rounding the server uses for the total | Playwright: "Builder Grade Package - Re Roof · 2.50 job · $18,850.00 · $47,125.00" matches API + hand math | OK |
| Preview "Total" row | stat | Sum of the line totals for the qty you typed. | crm-pricebook.tsx:587-590 | preview.totalPriceCents = Σ lines (pricebook.ts:130) | 4712500¢ shown = API value = hand-computed | OK |
| Preview margin row (`preview-margin-<id>`) | stat | "cost $X · margin Y%" when every line has a cost; otherwise the honest "No cost on file for this SKU, so no margin is shown." | crm-pricebook.tsx:591-601 | preview.totalCostCents / marginBps (pricebook.ts:640-641) — server counts a null cost as $0, which would read as 100%, so the page suppresses the margin if any line's unitCostCents is null | All 374 flat SKUs have flat_cost_cents NULL (SQL) → browser showed the no-margin note; server marginBps was 10000 (100%) and the page correctly refused to show it | OK |
| Preview warnings box | status | Server warnings, e.g. "Minimum charge of $X applied", "has no materials or labor yet". | crm-pricebook.tsx:604-609 | preview.warnings[] | [] in tests; code path verified | OK |
| Preview error (`preview-error-<id>`) | status | "Quantity must be a number, 0 or more." for bad qty, or the server's error text if the preview fails. | crm-pricebook.tsx:612-618 | client only (server 400/403/500 message surfaced) | code only | OK |

### Materials tab (`crm-pricebook.tsx:624-716`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Section title "Materials — Waste % is applied to quantity when a SKU expands." | text | Header for the tab. | crm-pricebook.tsx:626-629 | client only | Playwright | OK |
| Name input (`input-mat-name`) | input | Name of the material (required to enable Add). | crm-pricebook.tsx:633-635 | POST /api/crm/pricebook/materials body.name → pricebook.ts:311-319 → INSERT crm_pb_materials | Created AUDIT-Mat via the exact button body: SQL row matched (name/sku/unit/cost/price/waste) | OK |
| SKU input | input | Optional supplier SKU code shown under the material name. | crm-pricebook.tsx:636-637 | same body.sku (null when blank) | AUDIT-SKU stored and returned | OK |
| Unit select (`select-mat-unit`) | select | Unit the material is counted in (ea, sq, sf, lf, cy, hr, day, gal, lb, ton, roll, bundle, sheet, job). | crm-pricebook.tsx:638-642,187 | GET /api/crm/pricebook/meta → shared/schema.ts:2274 CRM_PB_UNITS (14 units) | API meta.units = 14 units matching schema constant | OK |
| Cost $ input | input | What you pay per unit (only shown if your role can see costs). | crm-pricebook.tsx:643-646,259-263 | same body.costCents (cents = dollars×100; sent only when seeCosts so a hidden field can't blank a real number) | 500¢ in → SQL cost_cents 500 | OK |
| Price $ input | input | What you charge per unit (only shown if your role can see prices). | crm-pricebook.tsx:647-650 | same body.priceCents | 1000¢ in → SQL price_cents 1000 | OK |
| Waste% input | input | Extra quantity to allow for cuts/mistakes, as a percent. Stored in basis points. | crm-pricebook.tsx:651-653,263 | body.wasteFactorBps = round(percent × 100), schema 0..10000 (pricebook.ts:305) | 10 → SQL 1000 bps; table shows (bps/100) = "10%" | OK |
| Add button (`button-add-material`) | button | Saves the new material; requires a name. | crm-pricebook.tsx:654-655 | POST /api/crm/pricebook/materials → INSERT crm_pb_materials (active=true, taxable default true) | 201 + SQL row; then cleaned up with the Delete button path | OK |
| Materials table | table | Lists all active materials alphabetically (117 on this org), up to 500. | crm-pricebook.tsx:662-712 | GET /api/crm/pricebook/materials → pricebook.ts:285-295 → SELECT crm_pb_materials WHERE org_id AND active ORDER BY name LIMIT 500; cost/price stripped per permission (pricebook.ts:32-35) | 117 API rows = SQL 117; every displayed field diffed 0 mismatches; browser rendered 117 rows | OK |
| Material cell (name + sku) | text | Material name, SKU code underneath. | crm-pricebook.tsx:677-680 | crm_pb_materials.name / sku | row diff | OK |
| Unit cell | text | The unit. | crm-pricebook.tsx:681 | .unit | row diff | OK |
| Cost cell | stat | Your cost (column hidden entirely if you can't see costs). | crm-pricebook.tsx:682,666 | .cost_cents | row diff (e.g. $30.00) | OK |
| Price cell | stat | Your price. | crm-pricebook.tsx:683,667 | .price_cents | row diff | OK |
| Waste cell | stat | Waste percent. All 117 rows in this org are whole percents so the integer display is exact. | crm-pricebook.tsx:684 | .waste_factor_bps / 100 | SQL `waste_factor_bps % 100` → all 0 remainders | OK |
| Margin cell | stat | (price−cost)/price as a whole percent, computed in the browser; "—" when price is $0. | crm-pricebook.tsx:673-674,685 | client only: (priceCents − costCents)/priceCents × 100 | Browser "33%" for QA-g15 Shingles (3000¢/4500¢) = recomputed 33.3% → 33; no price-0 rows in this org | OK |
| Edit (`button-edit-mat-<id>`, pencil) | button | Opens the Edit material dialog prefilled. | crm-pricebook.tsx:688-695 | client only | Playwright + PATCH verified | OK |
| Delete (`button-delete-mat-<id>`, trash) | button | After a confirm, removes the material from the list (soft delete — SKUs built on it keep pricing it). | crm-pricebook.tsx:696-703,278-282 | DELETE /api/crm/pricebook/materials/:id → pricebook.ts:335-343 → SET active=false | AUDIT-Mat deleted: {ok:true}, active=f in SQL | OK |
| "No materials yet" empty state | empty state | Shown when there are no materials. | crm-pricebook.tsx:658-661 | client only | code only | OK |

### Labor tab (`crm-pricebook.tsx:718-776`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Section title "Labor rates — Cost is what you pay; price is what you charge." | text | Header for the tab. | crm-pricebook.tsx:720-723 | client only | Playwright | OK |
| Name input (`input-lab-name`) | input | Name of the crew/rate (required). | crm-pricebook.tsx:727-729 | POST /api/crm/pricebook/labor-rates body.name → pricebook.ts:239-249 → INSERT crm_pb_labor_rates | Created AUDIT-Crew: SQL row matched | OK |
| Cost/hr $ input | input | What you pay per hour (only if you can see costs). | crm-pricebook.tsx:730-733 | body.hourlyCostCents | 2000¢ in → SQL 2000 | OK |
| Price/hr $ input | input | What you charge per hour (only if you can see prices). | crm-pricebook.tsx:734-737 | body.hourlyPriceCents | 4000¢ in → SQL 4000 | OK |
| Add button (`button-add-labor`) | button | Saves the new labor rate; requires a name. | crm-pricebook.tsx:738-739 | POST /api/crm/pricebook/labor-rates | 201 + SQL row; cleaned up | OK |
| Labor rate rows (1 on this org) | list | One row per active rate: name, optional "default" badge, cost/hr, price/hr, edit/delete. Default sorts first. | crm-pricebook.tsx:746-773 | GET /api/crm/pricebook/labor-rates → pricebook.ts:223-230 → SELECT crm_pb_labor_rates WHERE org_id AND active ORDER BY is_default DESC, name; cost/price stripped per permission (pricebook.ts:36-39) | 1 API row = SQL 1 (QA-g15-crm-ops Crew 4000¢/8500¢, is_default f); browser "cost $40.00/hr $85.00/hr"; 67 inactive hidden correctly | OK |
| "default" badge | badge | Marks the org's default labor rate. | crm-pricebook.tsx:750 | crm_pb_labor_rates.is_default | This org's only rate has is_default=f → badge correctly absent; code path verified | OK |
| Edit (`button-edit-lab-<id>`) | button | Opens the Edit labor rate dialog prefilled. | crm-pricebook.tsx:757-762 | client only | Playwright + PATCH verified | OK |
| Delete (`button-delete-lab-<id>`) | button | After a confirm, soft-deletes the rate (SKUs using it keep pricing it). | crm-pricebook.tsx:763-768,304-308 | DELETE /api/crm/pricebook/labor-rates/:id → pricebook.ts:273-281 → SET active=false, is_default=false | AUDIT-Crew deleted: {ok:true}, active=f | OK |
| "No labor rates yet" empty state | empty state | Shown when there are no rates. | crm-pricebook.tsx:742-745 | client only | code only | OK |

### Formulas tab (`crm-pricebook.tsx:778-821`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Section title (description = meta.formulaHelp) | text | Explains the formula syntax with an example. | crm-pricebook.tsx:780-782 | GET /api/crm/pricebook/meta → pricebook.ts:193-200 (static string) | API formulaHelp present; rendered (Playwright found text) | OK |
| Formula input (`input-formula`) | input | The formula to test, e.g. `ceil([SQUARES] * (1 + [WASTE]/100))`. | crm-pricebook.tsx:784-789,388 | POST /api/crm/pricebook/formula/test body.formula → pricebook.ts:650-673 → validateFormula/evalFormula (server/crm/formula.ts) | Playwright default value matches; tested live | OK |
| [SQUARES] input | input | Value substituted for [SQUARES]. | crm-pricebook.tsx:791-793 | body.symbols.SQUARES (parseFloat \|\| 0) | default 32 | OK |
| [WASTE] input | input | Value substituted for [WASTE]. | crm-pricebook.tsx:794-796 | body.symbols.WASTE | default 10 | OK |
| "Test" (`button-test-formula`) | button | Runs the formula and shows the numeric result plus which symbols it used. | crm-pricebook.tsx:797-799,391-411 | POST /api/crm/pricebook/formula/test → 200 {ok,result,symbols,warnings} or 400 {ok:false,error} | Live: default → "= 36 (symbols: SQUARES, WASTE)"; `10/[X]` with X=0 → 0 (matches "dividing by zero gives 0" hint); `[FOO]+1` → 1 with unknown-symbol warning (matches "unknown symbols count as 0" hint); `1 ++` → 400 "Malformed formula." shown as ✕ | OK |
| Result box (`text-formula-result`) | stat | Green "= 36 (symbols: …)" or red "✕ <server's error>". | crm-pricebook.tsx:801-804 | same endpoint | live above | OK |
| Warning line (`text-formula-warning`) | status | Amber note listing unknown symbols. | crm-pricebook.tsx:805-809 | same endpoint warnings[] | live above | OK |
| "Available symbols: [QTY] [SQUARES] [LF] [SF] [EA] [PITCH] [STORIES] [WASTE] [COST] [PRICE] [HOURS]" | text | The built-in symbols formulas may use. | crm-pricebook.tsx:811-812 | meta.symbols = shared/schema.ts:2279 CRM_PB_SYMBOLS | API symbols = the 11 shown | OK |
| Evaluator note ("parsed by our own evaluator, not eval — only numbers, + - * / %, parentheses and min/max/ceil/floor/round… Dividing by zero gives 0.") | text | Accurately describes the real evaluator. | crm-pricebook.tsx:813-817 | server/crm/formula.ts:9-13 shunting-yard, FUNCS = min/max/ceil/floor/round (line 18), div-by-zero → 0 (line 107) | Every claim exercised live above | OK |

### Template picker dialog (`crm-pricebook.tsx:825-853`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Dialog (`dialog-templates`) + intro text | dialog | "Start from a template" — 10 prewritten scope texts (HardiePlank, HardiePanel, HardieTrim, re-roof, standing-seam, repaint, gutters, windows, soffit/fascia, deck). | crm-pricebook.tsx:825-833,56-170 | client only: static content | Playwright: 10 buttons rendered | OK |
| Template buttons (`template-<slug>`, 10) | button | Clicking one closes the picker and opens the Add SKU dialog prefilled with that template's name, unit, pricing mode and description (price left blank for you to set). | crm-pricebook.tsx:834-851,375-385 | client only (prefill); saving then goes through POST /api/crm/pricebook/items | Playwright: click opens SKU dialog; save path verified | OK |

### SKU dialog — Add/Edit (`crm-pricebook.tsx:855-976`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Dialog (`dialog-item`), title "Add SKU"/"Edit SKU" | dialog | Creates or edits a SKU. | crm-pricebook.tsx:855-858 | POST or PATCH /api/crm/pricebook/items[/:id] | Playwright opens; live create/edit below | OK |
| Name (`input-item-name`) | input | The SKU's name (required). | crm-pricebook.tsx:863-868 | body.name → itemSchema name 1..200 (pricebook.ts:377) | Save disabled until name typed; AUDIT-PB-Item created | OK |
| Code (`input-item-code`) | input | SKU number/code. Blank = server assigns the next sequential number; typed codes must be unique (case-insensitive). | crm-pricebook.tsx:869-874 | body.code (null if blank) → pricebook.ts:480-489: typed → 409 if taken; blank → max(code::int)+1 over the org's numeric codes (includes inactive) | "AUDIT-CODE-1" stored verbatim; blank code → "431" = SQL max 430 + 1; duplicate "AUDIT-CODE-1" → 409 "That code is already used by…" | OK |
| Unit select (`select-item-unit`) | select | Unit the SKU is sold in (14 from meta). | crm-pricebook.tsx:875-886 | body.unit enum CRM_PB_UNITS | "ea" stored | OK |
| Pricing mode select (`select-item-pricing`) | select | "Flat price" or "Per sq ft (measured)" for new SKUs; a SKU saved in another mode keeps that mode selectable (labelled "(current setup)") because this dialog can't edit those setups. | crm-pricebook.tsx:887-898,331-334,41 | body.pricingMode enum (pricebook.ts:382) | This org has only flat/per_sqft → both editable; exotic-mode branch code only | OK |
| Mode note (`text-item-mode-note`) | text | Explains the current mode's setup is left untouched. | crm-pricebook.tsx:899-904 | client only | code only (no exotic-mode SKUs here) | OK |
| Price $ (`input-item-flat-price`) | input | Flat price (flat mode, seePrices only). Blank blocked: "Enter a price — a blank one would price this SKU at $0." | crm-pricebook.tsx:905-914,337-339,960-964 | body.flatPriceCents (null if blank, but the dialog blocks blank when seePrices) | priceMissing blocks Save (code); cents math verified | OK |
| Cost $ (optional) (`input-item-flat-cost`) | input | Your flat cost (seeCosts only). | crm-pricebook.tsx:915-923 | body.flatCostCents null if blank | sent only when seeCosts; null stored | OK |
| Rate $/sq ft (`input-item-rate-sqft`) | input | Price per square foot (per_sqft mode, seePrices only). Blank blocked like Price. | crm-pricebook.tsx:925-934 | body.rateCentsPerSqft | live per-sq-ft preview math used stored rate | OK |
| Measured area (`select-item-sqft-metric`) | select | Which measurement (roof vs siding sq ft, or auto-detect from the name) supplies the area at bid time. | crm-pricebook.tsx:935-946 | body.sqftMetric: "auto" → null (pricebook.ts:355,389) | code + schema enum CRM_PB_SQFT_METRICS (schema.ts:2273) | OK |
| Scope / description (`input-item-description`) | input | Multi-line scope text the client reads on estimates. 4000 chars. | crm-pricebook.tsx:950-959 | body.description (null if blank) | "audit test" stored verbatim | OK |
| "Multi-line bullets are preserved" hint | text | Static reassurance about the textarea. | crm-pricebook.tsx:956-958 | client only | code only | OK |
| Price-missing warning (`text-item-price-missing`) | status | Red reminder when price/rate is blank. | crm-pricebook.tsx:960-964 | client only | code only | OK |
| Cancel (`button-cancel-item`) | button | Closes without saving. | crm-pricebook.tsx:968 | client only | Playwright | OK |
| Save / "Add SKU" (`button-save-item`) | button | Saves. Create → POST (assigns code if blank); Edit → PATCH. Body sends name/code/unit/pricingMode/description always, plus flat price/cost or rate only for the active mode and only when your role can see that field — so a hidden field never overwrites a real number with a blank. | crm-pricebook.tsx:969-973,340-366 | POST pricebook.ts:468-501 / PATCH pricebook.ts:520-559 → crm_pb_items (+ crm_pb_item_parts wholesale-replaced when parts sent — this dialog never sends parts); formulas validated before write (itemFormulaError, pricebook.ts:422-437) | Live: POST created row matching body (SQL check); PATCH flatPriceCents 12345→9999 reflected in SQL and preview; duplicate code 409; activity logged (logActivity pricebook.updated, pricebook.ts:496-499,554-557) | OK |

### Edit material dialog (`crm-pricebook.tsx:978-1017`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Dialog (`dialog-material`) | dialog | Edits a material's name, SKU, unit, cost, price, waste. | crm-pricebook.tsx:978-980 | PATCH /api/crm/pricebook/materials/:id → pricebook.ts:321-332 → UPDATE crm_pb_materials (touches costUpdatedAt when cost changes) | Live: waste 1000→2500 persisted (SQL) | OK |
| Name (`input-edit-mat-name`) | input | Material name (required). | crm-pricebook.tsx:983-985 | body.name | code | OK |
| SKU input | input | Supplier SKU. | crm-pricebook.tsx:986-988 | body.sku | code | OK |
| Unit select | select | Unit. | crm-pricebook.tsx:989-993 | body.unit | code | OK |
| Cost $ input | input | Cost (seeCosts only). | crm-pricebook.tsx:994-998 | body.costCents | code (shape identical to add form) | OK |
| Price $ (`input-edit-mat-price`) | input | Price (seePrices only). | crm-pricebook.tsx:999-1003 | body.priceCents | code | OK |
| Waste % input | input | Waste percent. | crm-pricebook.tsx:1004-1006 | body.wasteFactorBps | live (2500) | OK |
| Cancel | button | Closes without saving. | crm-pricebook.tsx:1010 | client only | code | OK |
| Save changes (`button-save-mat`) | button | Saves the material. | crm-pricebook.tsx:1011-1015 | PATCH …/materials/:id | live | OK |

### Edit labor dialog (`crm-pricebook.tsx:1019-1047`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Dialog (`dialog-labor`) | dialog | Edits a labor rate's name, cost/hr, price/hr. | crm-pricebook.tsx:1019-1021 | PATCH /api/crm/pricebook/labor-rates/:id → pricebook.ts:251-267 → UPDATE crm_pb_labor_rates | Endpoint verified (same schema as POST, which was exercised live) | OK |
| Name (`input-edit-lab-name`) | input | Rate name (required). | crm-pricebook.tsx:1024-1026 | body.name | code | OK |
| Cost/hr $ input | input | Cost per hour (seeCosts only). | crm-pricebook.tsx:1027-1031 | body.hourlyCostCents | code | OK |
| Price/hr $ (`input-edit-lab-price`) | input | Price per hour (seePrices only). | crm-pricebook.tsx:1032-1036 | body.hourlyPriceCents | code | OK |
| Cancel | button | Closes without saving. | crm-pricebook.tsx:1040 | client only | code | OK |
| Save changes (`button-save-lab`) | button | Saves the rate. | crm-pricebook.tsx:1041-1045 | PATCH …/labor-rates/:id | code (add path live-verified) | OK |

---

## Notes and observations (no fabricated or mismatched numbers found)

- **Zero data discrepancies.** Every count, price, rate, waste %, margin, preview line, and formula result on the page reproduced exactly from `crm_pb_items` / `crm_pb_materials` / `crm_pb_labor_rates` / `crm_pb_categories` for org c5b47b8d. The 500-row cap message on the items tab exactly matches the server's `LIMIT 500`.
- **Preview button vs seePrices:** the button renders for every user, but the server refuses with 403 "Requires permission: seePrices" (`pricebook.ts:628`); the page then shows "Couldn't preview this SKU: Requires permission: seePrices". Honest error, no fake data — noted as UX only.
- **Seed has no server-side dedup** (`pricebook.ts:840`): two presses (e.g. two tabs on an org with zero SKUs) would create two "Roofing" categories and duplicate starter rows. The button hides itself as soon as any SKU exists, so this is latent, not reachable in the normal flow.
- **Materials tab has no "first 500" hint** even though the route caps at 500 (`pricebook.ts:293`) — unlike the items tab. Latent: this org has 117 materials.
- **Auto SKU numbering counts soft-deleted SKUs** (`pricebook.ts:485-487` has no `active` filter), so deleted numbers leave gaps. Cosmetic by design.
- Waste % and Margin display as whole numbers (`.toFixed(0)`); in this org every waste factor is an exact whole percent (verified `waste_factor_bps % 100 = 0` for all 117 rows), so no live rounding discrepancy. Margins are browser-computed display values (e.g. 33.3% → "33%").
- All AUDIT- test rows created during verification (2 items, 1 material, 1 labor rate) were removed with the app's own Delete endpoints (soft-delete, `active=false`); 0 active AUDIT- rows remain.


## Team & Company (/crm/team)

Page: `client/src/pages/crm-team.tsx` — route declared at `client/src/App.tsx:411` (`<Route path="/crm/team" component={CrmTeamPage} />`).
Audited account: dev platform admin (user id 1) → active org `c5b47b8d-caa8-47e6-ae7e-6248ad5df565` ("SKU Dry-Run", `owner_user_id=1`, timezone America/Los_Angeles).
Three tabs (Profile / Company / Team), deep-linkable via `?tab=profile|company|team` (`crm-team.tsx:310-314`).

Data sources: `GET /api/crm/me` (boot), `GET /api/crm/members` (members+seats), `GET /api/crm/invitations`, `GET /api/crm/divisions`, `GET /api/crm/onboarding`, `GET /api/crm/sms/status`, `GET /api/crm/calendar/google/status`, `GET /api/crm/members/:id/activity`.

Verification highlights:
- Member list API = `SELECT ... FROM crm_members WHERE org_id='c5b47b8d...'` (ids, emails, roles, statuses, user_ids match 1:1; order = `created_at DESC` matches server).
- Seats `used=5` reproduced with the exact seatHolders query (`server/crm/tenancy.ts:191-206`): distinct holders across ALL orgs owned by user 1 (`u:1`, `e:dee@aspireinteriors.co`, 2 vitest owners, 1 invited audit-join placeholder) = 5. Limit -1 (unlimited) because user 1 is a platform admin → `platformAdminAllowances()` (`server/entitlements.ts:282`), plan name "Agency" = TOP_PLAN.
- Onboarding "1 of 3" reproduced from DB: member `display_name=''` → profile not done; org `address_line1/city/state/phone` null → company not done; 4 members > 1 → team done.
- Activity feed: API returned exactly 200 rows; top 3 rows identical to `SELECT ... ORDER BY created_at DESC LIMIT 3` (ids `act-<uuid>`, timestamps, text).
- Invite flow pressed end-to-end with an AUDIT- email: POST created `crm_invitations` row + `crm_members` placeholder (status `invited`); resend rotated token; DELETE set `revoked_at` and deleted the placeholder; seats returned to baseline. All rows cleaned up (verified 0 leftover rows of mine).
- Playwright render of `/crm/team?tab=team` confirmed: pill "5 of unlimited used", 4 member cards, 1 pending invite row (created by a parallel audit run, not by me), Invite button enabled, no mobile input (SMS not configured), 1 cost-rate input + 15 permission switches on the non-owner invited member only, Activity button on all 4 rows (owner view).

---

### Page header + onboarding banner + tabs

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Title "Team & Company" + subtitle + ⓘ (infoKey `team`) | Header + help popover | Names the page; the ⓘ opens a plain-English help dialog about the team page. | crm-team.tsx:538-543; InfoTip client/src/components/info-tip.tsx:29 | client only: content from INFO_CONTENT[`team`] (client/src/lib/info-content.ts:258) | SSR load of info-content.ts shows `team` entry present; render shows dialog content | OK |
| Onboarding banner "Next: {label} — {n} of {m} set-up steps done" (`banner-next-step`) | Banner (conditional) | Shows the next recommended set-up step and how many of the 3 steps (profile, company, team) are done. Disappears when nothing is next. | crm-team.tsx:545-576 | GET /api/crm/onboarding → server/crm/routes.ts:555 → crm_members (display_name/phone of caller), crm_orgs (name/address/city/state/phone), members count; computedCount = done steps | API `{completedCount:1,totalCount:3,nextStep:"profile"}` vs SQL: member display_name='' ⇒ profile not done; org address fields NULL ⇒ company not done; 4 members ⇒ team done. Matches | OK |
| "Go" button (`button-next-step`) | Button (conditional) | Jumps to the tab of the next unfinished step (or another page if the step lives there). | crm-team.tsx:569-572 | client only: navigates to onboarding.nextPath (`/crm/team?tab=…`) | route /crm/team in App.tsx:411; code | OK |
| "Fill in the fields below and save." (`text-next-step-here`) | Text (conditional) | Shown instead of the Go button when the banner's step IS the tab you're already looking at. | crm-team.tsx:561-566 | client only | code | OK |
| Tab "My profile" (`tab-profile`) | Tab | Shows your own name/title/mobile/role and the Google Calendar hookup. | crm-team.tsx:580 | client only (renders the tab panel below) | render | OK |
| Tab "Company" (`tab-company`) | Tab | Shows the company details form that prints on estimates/invoices. | crm-team.tsx:583 | client only | render | OK |
| Tab "Team" (`tab-team`) | Tab | Shows seats, invite form, pending invitations and the member list. | crm-team.tsx:586 | client only | render | OK |

### My profile tab

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "My profile" card + "Signed in as {email}" | Card + text | Shows how you appear to the crew; the email is your login. | crm-team.tsx:593-599 | GET /api/crm/me → routes.ts:404 → users.email for user 1 | API email dev@constructhub.local = SQL users row | OK |
| Name input (`input-profile-name`) | Input | Your display name on the schedule and crew views. | crm-team.tsx:603-606 | seeded from crm_members.display_name | rendered value '' = SQL display_name '' | OK |
| Title input (`input-profile-title`) | Input | Your job title (e.g. Project Manager). | crm-team.tsx:608-611 | seeded from crm_members.title (NULL → '') | code + schema | OK |
| Mobile input (`input-profile-phone`) + error text (`text-profile-phone-error`) | Input + validation | Your cell number, stored as +1…; blocks save until it looks like a real number (7–15 digits). | crm-team.tsx:613-621 | PATCH /api/crm/profile → routes.ts:439 → memberPhoneSchema normalizes via normalizePhone (server/crm/sms.ts) → crm_members.phone | rendered value +5550100 = SQL crm_members.phone; server rule identical (routes.ts:92-110); server test profile-org-validation.test.ts:80-100 | OK |
| Role pill (`badge-my-role`) | Status pill | Shows your role; can't be changed here. | crm-team.tsx:624-627 | from /api/crm/me member.role | rendered "owner" = SQL role | OK |
| "Save profile" (`button-save-profile`) | Button | Saves name/title/mobile, then advances the set-up checklist if this was the pending step. | crm-team.tsx:630-632 | PATCH /api/crm/profile {displayName,title,phone} → routes.ts:439-476 → UPDATE crm_members (own row) + activity row `member.updated` + owner notice; returns saved member | route exists, body shape matches profilePatchSchema (routes.ts:245-251); verified by server tests; not pressed (mutates the shared dev profile) | OK |
| "My Google Calendar" card (`card-my-google-calendar`) | Card (conditional) | Lets you sync YOUR appointments to YOUR own Google account. Whole card hidden when the server has no Google OAuth app. | crm-team.tsx:204-302, mounted at 636 | GET /api/crm/calendar/google/status → server/crm/calendar.ts:358 → reads org custom_fields googleCalendar / googleCalendarMembers (secrets stripped) + googleCalendarConfigured() | API `{configured:true, connection:null, myConnection:null}` → card visible with connect button; render confirms | OK |
| "Connected since … · last synced …" (`text-my-gcal-status`) | Text (when connected) | Shows when you connected and when the last sync ran (or "not synced yet"). | crm-team.tsx:264-267 | from status.myConnection.connectedAt / lastSyncAt (calendar.ts:366-374) | code (myConnection null on this account → not shown) | OK |
| "Last sync failed: …" (`text-my-gcal-error`) | Text (when lastSyncError) | Shows the error from the last sync attempt. | crm-team.tsx:268-271 | status.myConnection.lastSyncError | code | OK |
| "Sync now" (`button-my-gcal-sync`) | Button (when connected) | Pushes/updates your appointments in your Google calendar; toast reports "N updated · M removed". | crm-team.tsx:274-278 | POST /api/crm/calendar/google/sync?scope=me → calendar.ts:490 → full replace of crmManaged events via Google Calendar API; counts from live vs existing event sets; stamps lastSyncAt/lastSyncError in org custom_fields | route + query param exist; response {upserted, deleted} matches toast fields; not pressed (would call Google) | OK |
| "Disconnect" (`button-my-gcal-disconnect`) | Button (when connected) | Removes your Google connection (revokes at Google too). | crm-team.tsx:279-283 | POST /api/crm/calendar/google/disconnect?scope=me → calendar.ts:588 → clears member connection in custom_fields | route exists; not pressed (nothing connected) | OK |
| "Connect my Google Calendar" (`button-my-gcal-connect`) | Button (when not connected) | Starts the Google approval flow and comes back here. | crm-team.tsx:288-292 | GET /api/crm/calendar/google/connect?scope=me → calendar.ts:386 → returns Google OAuth URL; callback (calendar.ts:425) redirects back to /crm/team?calendar=connected=1 or error=… | route + scope handling verified; callback lands on /crm/team (exists, App.tsx:411); toast handling of ?calendar= param at crm-team.tsx:210-226 | OK |
| OAuth-return toast (?calendar= / ?error=) | Toast | After the Google round-trip, says "connected" or why it failed, and cleans the URL. | crm-team.tsx:210-226 | client only | code | OK |

### Company tab

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Read-only notice (AlertTriangle) | Notice (when no manageSettings) | Tells you that you can see but not change these details. | crm-team.tsx:649-654 | driven by /api/crm/me permissions.manageSettings | code | OK |
| Business name (`input-org-name`), Legal entity (`input-org-legal`), License # (`input-org-license`), License state (`input-org-license-state`), Phone (`input-org-phone`), Website (`input-org-website`), Address (`input-org-address`), City, State, ZIP, Terms (`input-org-terms`), Warranty (`input-org-warranty`) | Inputs (12) | Edits the company details that print on estimates, invoices and contracts. Only these 12 fields are sent — footers, tax/deposit defaults, theme etc. are NOT touched by this form. | crm-team.tsx:655-719 (COMPANY_FORM_FIELDS at 118-121) | seeded from /api/crm/me org (presentOrg strips secret custom_fields, routes.ts:287-297); PATCH /api/crm/org → routes.ts:649 → orgPatchSchema → UPDATE crm_orgs columns | rendered "SKU Dry-Run" + terms text = SQL crm_orgs row; PATCH body shape matches schema (routes.ts:169-243); verified by server test profile-org-validation.test.ts:105-132; not pressed (mutates shared org) | OK |
| "Save company profile" (`button-save-org`) | Button | Saves the company form, then advances the set-up checklist. Disabled without manageSettings. | crm-team.tsx:721-724 | PATCH /api/crm/org (same as above) + activity log | route exists; render shows enabled (owner); server test covers | OK |

### Team tab — Seats card

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Seats description (`{seats.message}` + "Deactivated members don't use a seat.") | Text | One sentence from the server about what your plan includes, then a note that deactivated people don't take a seat. | crm-team.tsx:733-736, seatsSummary at 68-72 | GET /api/crm/members → seats = getSeatUsage → server/crm/tenancy.ts:176-288: raw SQL over crm_members JOIN crm_orgs WHERE owner_user_id=1 AND status IN ('active','invited'), deduped by account-id-else-email; PLUS agency team when the plan has the agency module; disabled members excluded | Rendered "Your Agency plan includes unlimited seats for the CRM and agency team together and 5 are in use." = API message; SQL reproduction of the exact query returns the same 5 holders | OK |
| Seats pill (`badge-seats`) "N of {limit\|unlimited} used" | Status pill | How many of your plan's seats are taken, green when you can still add someone, red when full. | crm-team.tsx:737-739 | same as above: used=holders.size, limit = allowances.crmSeats (-1 = unlimited) | Rendered "5 of unlimited used" = API used:5, limit:-1; holders SQL = 5 distinct people | OK |

Note: `used` counts people across **every org the owner owns plus the agency team** (one shared pool), so it can be higher than the member count of this one company. The server sentence says so explicitly.

### Team tab — Invite card (only with manageTeam)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Invite someone" title + description "They'll get an email with a link that expires in 14 days" (+ "— add a mobile to text it too" when texting configured) | Card header | Explains the invite; the mobile hint only appears when the server can actually text. | crm-team.tsx:745-752 | GET /api/crm/sms/status → server/crm/sms.ts:736 → orgSmsStatus: env vars present? + plan gate | API `{configured:false,...}` → hint absent, phone input hidden; render confirms | OK |
| Email input (`input-invite-email`) | Input | The address the invite email goes to. | crm-team.tsx:756-758 | sent as `email`; zod .email() → 400 if malformed | pressed flow below | OK |
| Mobile input (`input-invite-phone`) | Input (conditional) | Optional — also texts the invite link to this number. | crm-team.tsx:759-763 | sent as `phone` + `sms:true`; server normalizePhone, texts via sendSms if valid | hidden (SMS not configured) — code + inviteSchema (routes.ts:265-274) | OK |
| Role select (`select-invite-role`, default "field") | Select | The role the new person gets; "owner" only appears in the list for the actual owner. | crm-team.tsx:764-773 | options from /api/crm/me roles (CRM_ROLES, 7 values); server re-checks owner-only and pm-only grants (routes.ts:955-960) | CRM_ROLES = shared/schema.ts:1384; filter logic matches server gate | OK |
| Division select (`select-invite-division`, "All divisions" + list) | Select (conditional) | Optionally scopes the invitee to one division. | crm-team.tsx:774-786 | options from GET /api/crm/divisions → divisions.ts:279 → crm_divisions WHERE org_id, HQ first; server validates divisionId belongs to org (routes.ts:961-964) | SQL count 434 divisions = API list length; render shows select | OK |
| "Invite" button (`button-send-invite`) | Button | Creates the invitation, holds a seat, emails the link (texts too if a mobile was given), shows the link for manual copy if email fails. Disabled when email empty or no seats left. | crm-team.tsx:787-792 | POST /api/crm/invitations {email, role, divisionId, phone, sms} → routes.ts:942 → under the owner's seat lock: seat check → INSERT crm_invitations (token, expires_at = now + 14 days) → INSERT or UPDATE crm_members placeholder (status 'invited') → sendInviteEmail → optional sendSms → activity `invitation.sent` → 201 {invitation, link, emailed, texted, smsError} | PRESSED with audit-team-check@example.com: 201, `emailed:true`, link = http://127.0.0.1:8305/crm/join?token=… (route exists, App.tsx:420); SQL showed new crm_invitations row (expiry set) + placeholder member status 'invited'; then revoked (below) | OK |
| Role blurb paragraph (e.g. "Sees only their own assigned jobs…") | Text | One-line explanation of the selected role. | crm-team.tsx:794 | client only: ROLE_BLURB (crm-team.tsx:123-131) covers all 7 CRM_ROLES | render shows the "field" blurb; keys match CRM_ROLES | OK |
| Seat-limit text + "Choose a plan" / "See plans and add-ons" link (`text-seat-limit`, `link-seat-upgrade`) | Text + link (conditional) | Only when seats are full: explains why and links to Pricing. | crm-team.tsx:795-806 | client only: marketingUrl("/pricing") — strips `portal.` host prefix or appends ?portal=0 on a forced bare host (client/src/lib/site.ts:73-83) | not visible (seats unlimited); /pricing route exists in both routers (App.tsx:176 and 294) | OK |
| Invite-link box + "Copy" button (`button-copy-link`) | Box + button (conditional) | After inviting, shows the raw invite link and a copy button (claims success only if the clipboard actually took it). | crm-team.tsx:807-824 | client only (navigator.clipboard) | code; API response carries `link` (seen in pressed flow) | OK |

### Team tab — Pending invitations card (only with manageTeam and ≥1 pending)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Invite row (`invite-{id}`): email + role pill + division pill | Row | One pending invite: who, which role, which division (code pill when scoped). | crm-team.tsx:837-847 | GET /api/crm/invitations → routes.ts:926 → crm_invitations WHERE org_id AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC; token stripped | SQL pending count = API rows (0 at first audit moment; 1 later — a parallel audit run's `audit-join-042d31@example.com`, status `invited`, matches `SELECT * FROM crm_invitations WHERE revoked_at IS NULL AND accepted_at IS NULL`) | OK |
| Resend icon button (`button-resend-invite-{id}`, title "Resend invitation") | Icon button | Sends the invite email again with a NEW link; the old link stops working. | crm-team.tsx:849-853 | POST /api/crm/invitations/:id/resend → routes.ts:1057 → rotates token, extends expiry 14 days, re-emails, activity `invitation.resent` | PRESSED on my AUDIT invite: 200, new link with different token; DB token rotated (new link accepted by lookup logic) | OK |
| Revoke icon button (`button-revoke-{id}`, title "Revoke invitation") | Icon button | Cancels the invite after a confirm; the link dies and the held seat is released. | crm-team.tsx:854-863 | DELETE /api/crm/invitations/:id → routes.ts:1093 → SET revoked_at, DELETE the placeholder crm_members row (status 'invited', same email), activity `invitation.revoked` | PRESSED on my AUDIT invite: {ok:true}; SQL after: invitation revoked_at set, placeholder member gone, seats back to baseline | OK |
| "Couldn't load pending invitations…" line | Error text | Shown if the invitations query failed. | crm-team.tsx:829-831 | n/a | code | OK |

### Team tab — Team members card

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Member row (`member-{id}`): avatar + name + email | Row | One row per person (and per pending placeholder). | crm-team.tsx:883-891 | GET /api/crm/members → routes.ts:724 → crm_members WHERE org_id ORDER BY created_at DESC | API 3 rows (later 4) = SQL rows exactly | OK |
| Status pill (`{m.status}`) | Status pill (when not "active") | Shows "invited" or "disabled" next to people who aren't active. | crm-team.tsx:893 | crm_members.status | render: invited member shows pill | OK |
| Role select (`select-role-{id}`) or role pill | Select / pill | Manager: change the person's role (saves immediately). Owner rows show a fixed pill instead. | crm-team.tsx:894-909 | PATCH /api/crm/members/:id {role} → routes.ts:742 → memberPatchSchema; owner seat (user_id = org owner) refuses role/status changes; owner/pm grants re-checked server-side (routes.ts:763-777) | endpoint + schema verified (routes.ts:253-263); server test team-admin.test.ts; not pressed on others' rows | OK |
| ⓘ next to role (`InfoTip k=role-{role}`) | Help popover | Explains what that role can do. | crm-team.tsx:910 | client only: INFO_CONTENT[`role-${role}`] (info-content.ts:286-331) | entries exist for owner/admin/pm/office/field. NOTE: no `role-sales` or `role-subcontractor` entry → members with those roles render no ⓘ (info-tip.tsx:50 returns null by design) while other roles get one — cosmetic inconsistency, no wrong data | OK (gap noted) |
| Division select (`select-division-{id}`) or division code pill | Select / pill | Manager: scope the person to one division; otherwise a read-only code pill. | crm-team.tsx:911-928 | PATCH /api/crm/members/:id {divisionId} → routes.ts:778-782 validates division belongs to the org | code; render: select present on non-owner member (434 options) | OK |
| Password-reset icon button (`button-reset-password-{id}`, title "Send password reset email") | Icon button | Emails that person a set-your-own-password link (1-hour expiry); creates their login account if they never signed up. Toast says if the email couldn't be sent. | crm-team.tsx:931-935 | POST /api/crm/members/:id/send-password-reset → routes.ts:877 → creates users row on demand, sets users.reset_token/expiry (1 h), sendPasswordResetEmail; rate-capped 10/org; returns {emailed} | endpoint + body verified; NOT pressed (sends a real email / creates user rows) | OK |
| Remove icon button (`button-remove-{id}`, title "Remove from team" / "Revoke invite and remove") | Icon button | After a confirm, deactivates the person (they lose access immediately; their history stays) and revokes any pending invite for their email. | crm-team.tsx:936-948 | DELETE /api/crm/members/:id → routes.ts:829 → crm_members.status='disabled' + revoke matching pending crm_invitations; owner seat refused | endpoint verified; NOT pressed on records I didn't create | OK |
| "Cost rate / hr" input (`input-cost-{id}`) | Input (seeCosts + manageTeam, non-owner) | The person's hourly cost, used for margin math; saves when you leave the field, blank clears it. | crm-team.tsx:954-966 | PATCH /api/crm/members/:id {hourlyCostCents} → routes.ts:260 (int 0..$100k) → crm_members.hourly_cost_cents | render shows it on the invited field member only; value round-trips humanMoney (cents/100); server test profile-org-validation.test.ts:123 | OK |
| 15 permission switches (`switch-{perm}-{id}`) | Switches (non-owner, manageTeam) | Override one permission for one person on top of their role defaults; saves immediately. Labels cover all 15 permission keys. | crm-team.tsx:968-984 | PATCH /api/crm/members/:id {permissions} → routes.ts:253-263 (keys validated against CRM_PERMISSIONS) → crm_members.permissions jsonb; effectivePermissions recomputed server-side via crmEffectivePermissions | render: 15 switches on the non-owner member; PERM_LABEL keys = CRM_PERMISSIONS exactly (shared/schema.ts:1387-1403); endpoint verified | OK |
| Owner note "The owner has every permission and can't be changed here." | Text | Explains why the owner's row has no switches. | crm-team.tsx:986-990 | client only | render | OK |
| "Activity" button (`button-activity-{memberId}`) | Button (owner only) | Expands a per-person audit feed: everything that person did, newest first (sign-ins included). | crm-team.tsx:152-191, mounted 994 | GET /api/crm/members/:id/activity → server/crm/activity.ts:183 → crm_activity_log WHERE org_id AND actor_member_id ORDER BY created_at DESC LIMIT 200; OWNER role gate (403 otherwise) | PRESSED via API for dev member: 200 rows; top 3 identical to SQL `ORDER BY created_at DESC LIMIT 3` (ids act-6a5a4f0e…/act-7505b1ef…/act-d4067aa0…, same timestamps and text) | OK |
| Activity row (`row-activity-{id}`) / "No activity recorded yet" (`text-activity-empty`) / loading / error text | Rows + states | Each row is one audit line with a local-formatted timestamp; empty/loading/error states covered. | crm-team.tsx:167-188 | same query; text built by activityText (activity.ts:97) | API rows carry {id, text, at}; render of rows vs SQL timestamps match | OK |
| "No team members yet" empty state / "Couldn't load team members…" error | Empty/error states | Shown when the list is empty or the query failed. | crm-team.tsx:998-1004 | n/a | code | OK |

### Page-level states

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Loading spinner (`crm-loading`) | State | Shown while your workspace loads. | crm-team.tsx:516-522 | n/a | code | OK |
| "Couldn't load your workspace" ErrorCard | State | Shown if /api/crm/me fails. | crm-team.tsx:524-531 | n/a | code | OK |

---

### Notes and observations (not data bugs)

1. **ⓘ gap for two roles** — `INFO_CONTENT` has no `role-sales`/`role-subcontractor` entries (info-content.ts has owner/admin/pm/office/field only, lines 286-331), so members with those roles get no ⓘ while others do. The InfoTip component renders nothing for missing keys by design (info-tip.tsx:50), so no dead icon — just an inconsistent help affordance. The static guard test's closed role set (server/crm/info-content.test.ts:43-44) lists only the same 5 roles, so the build stays green.
2. **Seats count is plan-wide, not per-company** — "5 of unlimited used" counts people across every org the owner owns (Alpine Exteriors Test, Aspire Interiors, probe org) plus the agency team. The description sentence from the server discloses this ("for the CRM and agency team together"). Verified equal to the tenancy.ts seatHolders SQL.
3. Pending-invitation rows don't show the expiry date (the API returns `expiresAt`; the row just doesn't render it). Cosmetic.
4. The two `Vitest NC Owner Two …` rows are seeded test members with role `owner` (not the org owner seat). The page treats any role==="owner" row as owner (fixed pill, no switches/remove button) — consistent between the page and its own data; the underlying rows are test data, not a page bug.

### Routes used by this page with NO doc comment (candidates for doc comments)

- `server/crm/routes.ts:641` — GET /api/crm/org — used by this page's org form seed (via /api/crm/me) and cache invalidation.
- `server/crm/routes.ts:649` — PATCH /api/crm/org — "Save company profile" button.
- `server/crm/routes.ts:724` — GET /api/crm/members — the whole member list + seats.
- `server/crm/routes.ts:742` — PATCH /api/crm/members/:id — role/division/cost/permission edits.
- `server/crm/routes.ts:926` — GET /api/crm/invitations — pending invitations card.
- `server/crm/routes.ts:942` — POST /api/crm/invitations — Invite button.
- `server/crm/routes.ts:1093` — DELETE /api/crm/invitations/:id — Revoke button.
- `server/crm/calendar.ts:358` — GET /api/crm/calendar/google/status — My Google Calendar card.
- `server/crm/calendar.ts:386` — GET /api/crm/calendar/google/connect — Connect button.
- `server/crm/calendar.ts:588` — POST /api/crm/calendar/google/disconnect — Disconnect button.


## Settings (/crm/settings)

Single scrolling page of setting cards (no tabs). Signed-in account on dev: owner of org **SKU Dry-Run** (`c5b47b8d-caa8-47e6-ae7e-6248ad5df565`), permissions `manageSettings` + `manageIntegrations` — so every card below rendered in its most privileged form. Page gated on `manageSettings` (redirects to `/` otherwise) at client/src/pages/crm-settings.tsx:89-94. All data fetches: `/api/crm/me`, `/api/crm/org`, `/api/crm/payments/status`, `/api/crm/lead-sources`, `/api/crm/divisions`, `/api/crm/calendar/feed-url`, `/api/crm/calendar/google/status`, `/api/crm/sms/status`, `/api/crm/payments/settings`, `/api/crm/backups/settings` (owner only).

DB cross-check baseline: `SELECT … FROM crm_orgs WHERE id='c5b47b8d-…'` — every field shown on the page matched the API exactly; secrets (`calendarFeedToken`, `leadCaptureToken`) are correctly stripped from `/api/crm/org` by `presentOrg` (server/crm/routes.ts:283-297).

### Page header

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Settings" + subtitle "Company profile, document defaults, notifications and calendar." + ⓘ | Header + info tip | Titles the page; the ⓘ opens the "settings" help article | crm-settings.tsx:764-769 | client only: renders `INFO_CONTENT["settings"]` | key `settings` exists in client/src/lib/info-content.ts | OK |

### Card: Company profile

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Company name (input-company-name) | Input | Your business name; pre-filled from the org record | crm-settings.tsx:784-787 | GET /api/crm/org → server/crm/routes.ts:641 `presentOrg` → crm_orgs.name | SQL crm_orgs.name='SKU Dry-Run' = rendered value | OK |
| Legal entity (input-company-legal) | Input | The legal name (e.g. "Alpine Exteriors LLC") that prints on documents | crm-settings.tsx:788-792 | same → crm_orgs.legal_entity_name | DB NULL → empty field ✓ | OK |
| Email (input-company-email) | Input | Company email; also the fallback recipient for scheduled exports | crm-settings.tsx:793-797 | same → crm_orgs.email | SQL email='dev@constructhub.local' = rendered ✓ | OK |
| Phone (input-company-phone) | Input | Main company phone | crm-settings.tsx:798-802 | same → crm_orgs.phone | DB NULL → empty ✓ | OK |
| Website (input-company-website) | Input | Company website | crm-settings.tsx:803-807 | same → crm_orgs.website | DB NULL → empty ✓ | OK |
| Logo URL (input-company-logo) | Input | Web address of your logo, shown on estimates/invoices/portal | crm-settings.tsx:808-812 | same → crm_orgs.logo_url; PATCH validates URL shape (routes.ts:175-182) | DB NULL → empty ✓ | OK |
| Upload logo (input-company-logo-file) + logo preview (img-company-logo) + "PNG or JPG, 2MB max…" hint | File input + preview | Uploads a PNG/JPG (≤2MB); server checks real file type and stores it, then the URL appears in the Logo URL box | crm-settings.tsx:813-838, 430-447 | POST /api/crm/org/logo (multipart "logo") → server/crm/payments.ts:588-621: multer 2MB, magic-byte sniff (png/jpg only) → writes tmp/org-logos or R2 → UPDATE crm_orgs.logo_url | code only (no file pressed); client 2MB check matches server limit exactly | OK |
| Logo broken warning (text-company-logo-broken) | Conditional text | Shows "Couldn't load an image from this logo URL" only while the preview image fails to load | crm-settings.tsx:833-837 | client only: img onError handler | code only | OK |
| Address / Address line 2 / City / State / ZIP (input-company-address1/-address2/-city/-state/-postal) | Inputs | Company address printed on documents | crm-settings.tsx:839-865 | GET /api/crm/org → crm_orgs.address_line1/2, city, state, postal_code | all NULL → empty ✓ | OK |
| License # / License state (input-company-license-number/-state) | Inputs | Contractor license printed on documents | crm-settings.tsx:866-875 | same → crm_orgs.license_number, license_state | NULL → empty ✓ | OK |
| Industry (input-company-industry) | Input | Line of business | crm-settings.tsx:876-880 | same → crm_orgs.industry | SQL industry='Construction & Remodeling' = rendered ✓ | OK |
| Description (textarea-company-description) | Textarea | Short blurb about the company | crm-settings.tsx:881-885 | same → crm_orgs.description | NULL → empty ✓ | OK |
| Save company profile (button-save-company) | Button | Saves all company fields; refuses to save with an empty name | crm-settings.tsx:887-893, 279-302 | PATCH /api/crm/org → routes.ts:649-720: zod orgPatchSchema (name min 1, email format, logo URL must be http(s)/data-image/own path) → UPDATE crm_orgs | GET/PATCH shape matched (code); schema limits verified (max 200/300/5000 chars etc.) | OK |
| "Company theme" ⓘ (settings-theme) | Info tip | Explains the accent color used on client-facing documents | crm-settings.tsx:900 | client only: INFO_CONTENT["settings-theme"] | key exists in info-content.ts:502 | OK |
| Main color: Black / White buttons (theme-base-black / theme-base-white) | 2 buttons | Picks whether the document header band is black or white; saves immediately on click | crm-settings.tsx:906-925, 420-428 | PATCH /api/crm/org {themeBase:"black"\|"white"} → routes.ts:214, 684-687 → merged into crm_orgs.custom_fields.themeBase | code only; server zod enum matches the two buttons | OK |
| 20 color swatches (theme-swatch-<id>, e.g. theme-swatch-orange) | 20 buttons | Picks the accent color for estimates/invoices/contracts/portal; saves immediately | crm-settings.tsx:926-945, 306-313 | PATCH /api/crm/org {themeColor:id} → routes.ts:204-211 (isThemeColorId validation) → custom_fields.themeColor | 20 presets counted in shared/theme-colors.ts:27-66; rendered 20 swatches + grid, pressed=orange (no stored theme → default) ✓ | OK |
| Theme preview strip (theme-preview-strip / -name / -button) | Preview | Miniature estimate header showing the chosen accent + base with your company name | crm-settings.tsx:947-967 | client only: resolveOrgTheme(shared/theme-colors.ts:108) over org.customFields | rendered live (orange on black) ✓ | OK |

### Card: Divisions

Note: this dev org carries **434 crm_divisions rows, all "Vitest …" test fixtures** (SQL `count(*)`), and 434 crm_projects reference them. The card faithfully renders all 434 (no pagination) — dev-data pollution, not a code defect: the query is correctly org-scoped.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Couldn't load divisions" | Error text | Shows if the divisions fetch fails | crm-settings.tsx:983-985 | GET /api/crm/divisions | rendered false in run ✓ | OK |
| Division row (row-division-<id>) ×434: name, code pill, HQ pill (pill-hq-<id>), address/license line | List rows | Lists each operating arm: name, short code, HQ badge, "City, ST" line plus license/website when set; empty address shows "No address — falls back to the company's" | crm-settings.tsx:986-1024 | GET /api/crm/divisions → server/crm/divisions.ts:279-286: `WHERE org_id=? ORDER BY is_headquarters DESC, name ASC` → crm_divisions.* | SQL list == API list (434 rows, HQ first "Vitest VTWms9xv1bb"); rendered 434 rows ✓; screenshot settings-divisions.png | OK |
| Set as HQ (button-set-hq-<id>) — hidden on the HQ row | Button (per non-HQ row) | Makes that division the headquarters; the server clears the HQ flag on all others | crm-settings.tsx:1005-1010, 211-219 | PATCH /api/crm/divisions/:id {isHeadquarters:true} → divisions.ts:316-351 (single-winner: clears others) | code only; mutation shape matches server schema | OK |
| Edit (button-edit-division-<id>) | Button (per row) | Loads the division into the form below and scrolls to it | crm-settings.tsx:1011-1014, 238-255 | client only (fills form from row data incl. custom_fields.taxRates) | code only | OK |
| Delete (button-delete-division-<id>) | Button (per row) | Opens the confirm dialog naming the division | crm-settings.tsx:1015-1020, 1132-1152 | DELETE /api/crm/divisions/:id → divisions.ts:354-373: refuses (409) while `crm_projects.division_id` or `crm_members.division_id` reference it | code only (did not press); 409 message text matches the dialog copy. All 434 fixture divisions are referenced by projects → all would 409 | OK |
| Delete dialog (dialog-delete-division): Cancel (button-cancel-delete-division), Delete division (button-confirm-delete-division) | Dialog + 2 buttons | Cancel closes; Delete division removes it permanently (only possible when unused) | crm-settings.tsx:1132-1152, 225-236 | DELETE → on success removes row; 409 message shown as-is ("still in use by N project(s) and M member(s)") | code only | OK |
| Form inputs: Name, Code, Address, City, State, ZIP, License #, License state, Email, Phone, Website (input-division-*) | 11 inputs | Fields for adding a new division or editing one | crm-settings.tsx:1030-1089 | POST /api/crm/divisions or PATCH …/:id → divisions.ts divisionSchema (email format, code 1-20 chars; duplicate code → 409) | code only | OK |
| Sales tax — division default % (input-division-tax-default) | Input | Default sales-tax rate for this division | crm-settings.tsx:1090-1095, 168-175 | PATCH only: taxRates {default:bps} merged into crm_divisions.custom_fields.taxRates (divisions.ts:262-265, 337-345); resolved by server/crm/tax.ts:70-89 (city override → division default → org default) | client cap 30% == server max 3000 bps ✓; resolution order matches on-page hint (crm-settings.tsx:1104-1107) | OK |
| City tax overrides (textarea-division-tax-cities) | Textarea | One "City: rate%" per line; matched case-insensitively to the job city | crm-settings.tsx:1096-1102, 152-166 | PATCH taxRates {cities:{City:bps}} → same storage; tax.ts:77-82 city match | parse/serialize verified by code; server clamps 0-3000 | OK |
| "This is the headquarters" (checkbox-division-hq) | Checkbox | Marks the division as HQ on create/save | crm-settings.tsx:1108-1115 | POST/PATCH isHeadquarters → divisions.ts:299-302, 310 (first division becomes HQ automatically) | code only | OK |
| Cancel (button-cancel-division-edit) | Button (edit mode only) | Clears the form back to "Add a division" | crm-settings.tsx:1117-1122 | client only | code only | OK |
| Add division / Save division (button-save-division) | Button | Creates (or saves) the division; disabled until Name and Code are filled | crm-settings.tsx:1123-1128, 168-209 | POST /api/crm/divisions (body without taxRates) then PATCH {taxRates} when tax set — taxRates is PATCH-only server-side, the two-step matches divisions.ts:306-307 | code only | OK |

### Card: Estimate & invoice defaults

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Estimate footer (textarea-estimate-footer) | Textarea | Text printed at the bottom of every new estimate | crm-settings.tsx:1168-1173 | GET /api/crm/org → crm_orgs.estimate_footer; PATCH same table | SQL text "Alpine offers a 25-year workmanship warranty…" = rendered ✓ | OK |
| Invoice footer (textarea-invoice-footer) | Textarea | Text printed at the bottom of every new invoice | crm-settings.tsx:1174-1179 | crm_orgs.invoice_footer | DB NULL → empty ✓ | OK |
| Terms & conditions (textarea-terms) | Textarea | The T&C block that prints on contracts | crm-settings.tsx:1180-1185 | crm_orgs.terms_and_conditions | SQL 29-clause text = rendered ✓ | OK |
| Warranty text (textarea-warranty) | Textarea | Warranty wording for documents | crm-settings.tsx:1186-1191 | crm_orgs.warranty_text | SQL text = rendered ✓ | OK |
| Default deposit % (input-default-deposit) + state-cap note | Input | Deposit pre-filled on new estimates; blank = none | crm-settings.tsx:1192-1201, 461, 470 | PATCH {defaultDepositBps} → routes.ts:198 (int 0-10000) → crm_orgs.default_deposit_bps | DB NULL → "" ✓; client 0-100% == server cap ✓; out-of-range refused client-side with message (never clamped) | OK |
| Default sales tax % (input-default-tax) + fallback note | Input | Org-wide fallback tax when no city/division rate matches | crm-settings.tsx:1202-1212, 462, 472 | PATCH {defaultTaxRateBps} → routes.ts:200 (0-3000) → crm_orgs.default_tax_rate_bps; used last by server/crm/tax.ts:85-86 | DB NULL → "" ✓; caps match; "fallback" wording matches tax.ts resolution order | OK |
| Save defaults (button-save-defaults) | Button | Saves the four texts and both percentages | crm-settings.tsx:1214-1220, 466-488 | PATCH /api/crm/org (same handler as company profile) | code only; body keys all in orgPatchSchema | OK |

### Card: Notifications

15 event rows × 3 channel switches = 45 switches, each saving immediately when flipped. The stored prefs for this org are 15 legacy booleans, all `true` → rendered In-app **ON**, Email **ON**, Text **OFF** — verified in browser (row `estimateViewed` = true/true/false) and matching `crmNotificationChannel` (shared/schema.ts:1515-1526: boolean → sms false).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Sticky channel header "In-app / Email / Text" (notif-channel-header) | Column header | Labels the three switch columns while scrolling | crm-settings.tsx:1238-1244 | client only | rendered ✓ | OK |
| Row: Estimate viewed (switch-notif-estimateViewed[-inApp\|-sms]) | Label + 3 switches | Tells you when a client first opened an estimate | crm-settings.tsx:42, 1246-1271 | PATCH /api/crm/org {notificationPrefs:{estimateViewed:{inApp,email,sms}}} → routes.ts:234-242, 671-675 → merged into crm_orgs.custom_fields.notificationPrefs | key in CRM_NOTIFICATION_PREFS (shared/schema.ts:1483); rendered state true/true/false ✓ | OK |
| Row: Estimate approved | Label + 3 switches | A client approved and signed an estimate | crm-settings.tsx:43, 1246-1271 | same, key estimateApproved | key present; rendered ✓ | OK |
| Row: Estimate declined | Label + 3 switches | A client declined an estimate | crm-settings.tsx:44 | same, key estimateDeclined | ✓ | OK |
| Row: Payment received (online) | Label + 3 switches | An online payment landed in your Stripe account | crm-settings.tsx:45 | same, key invoicePaid | ✓ | OK |
| Row: Manual payment recorded | Label + 3 switches | Cash/check/wire/card recorded on an invoice | crm-settings.tsx:46 | same, key paymentReceived | ✓ | OK |
| Row: Client re-engaged | Label + 3 switches | A client re-opened an estimate — email + "call them" text | crm-settings.tsx:47 | same, key clientReengaged | ✓ | OK |
| Row: Bid sent to client | Label + 3 switches | A team member sent an estimate | crm-settings.tsx:48 | same, key estimateSent | ✓ | OK |
| Row: Team member signs in | Label + 3 switches | Someone on your team signed in (max one email/person/hour) | crm-settings.tsx:49 | same, key memberLogin | ✓ | OK |
| Row: Team member changes their account | Label + 3 switches | A member changed profile details or password | crm-settings.tsx:50 | same, key memberAccountChange | ✓ | OK |
| Row: Website lead received | Label + 3 switches | A lead came through your website form | crm-settings.tsx:51 | same, key leadReceived | ✓ | OK |
| Row: Weekly spam report | Label + 3 switches | AI Call Assistant's weekly "spam calls stopped" email (only weeks with spam) | crm-settings.tsx:52 | same, key spamReport | ✓ | OK |
| Row: Job approved (PM email) | Label + 3 switches | Project-manager handoff email when a client signs | crm-settings.tsx:53 | same, key jobApproved | ✓ | OK |
| Row: Client comments | Label + 3 switches | A client sent a message/photo from their portal | crm-settings.tsx:54 | same, key clientComments | ✓ | OK |
| Row: Financing interest | Label + 3 switches | A client clicked the financing option | crm-settings.tsx:55 | same, key financeClick | ✓ | OK |
| Row: Payment receipts | Label + 3 switches | Receipt email when a payment is recorded | crm-settings.tsx:56 | same, key paymentReceipt | ✓ | OK |
| "Text alerts also need a text sender set up in the SMS card below." | Hint | Points you at the SMS sender setup for text channels | crm-settings.tsx:1274-1276 | client only | ✓ | OK |
| SMS consent checkbox (checkbox-sms-consent) + disclosure + Privacy Policy link + consent stamp (text-sms-consent-stamp) | Checkbox + link + stamp | Your explicit opt-in to account-notification texts; the stamp shows when you consented and the phone used | crm-settings.tsx:1277-1297, 410-417 | POST /api/crm/me/sms-consent {agree} → server/crm/routes.ts:484-530: stamps/clears crm_members.sms_consent_at + sms_consent_phone; first consent also texts a carrier-standard confirmation to your phone | SQL sms_consent_at=2026-10-04T23:00:41Z, phone +5550100; rendered "Consented 10/4/2026, 7:00:41 PM — +5550100" ✓ (browser tz = EDT). /crm-privacy route exists (App.tsx:228) | OK |
| (Side effect) Flipping any Text switch ON also stamps consent | Behavior | The toggle itself counts as the affirmative opt-in | crm-settings.tsx:503-514 comment | routes.ts:705-717: on PATCH with notificationPrefs enabling sms → sets sms_consent_at/phone | code only | OK |

### Card: Bid discounts

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Preset offer rows (default-discount-marketing / -military / -pay_in_full / -bundle) with −% and conditions | 4 rows + % text | The standard offers every sent estimate starts with: Marketing −1%, Military −2%, Pay-in-full −5%, Bundle −5%; each row's switch enables/disables it | crm-settings.tsx:1311-1336, 358-376 | No DB row → falls back to DISCOUNT_PRESETS with enabled:false; PATCH /api/crm/org {discountDefaults:[…]} → routes.ts:225-231, 691 → crm_orgs.custom_fields.discountDefaults (max 20 entries, percentBps 0-10000) | DB custom_fields has no discountDefaults → 4 presets rendered, switches off ✓; % labels = preset constants (100/200/500/500 bps) | OK |
| Enable switch per row (switch-discount-<code>) | Switch (4+) | Turns that offer on/off for all future sent estimates; saves immediately | crm-settings.tsx:1321-1326 | same PATCH | code only | OK |
| Remove button on custom offers (button-remove-discount-<code>) | Button (custom rows only) | Deletes a custom offer (presets have no remove button) | crm-settings.tsx:1327-1333 | same PATCH with filtered array | code only | OK |
| "Your own offer" inputs (input-discount-label / -pct / -conditions) + Add (button-add-discount) + error text (text-discount-pct-error) | 3 inputs + button + error | Adds a custom discount (label, % 0-100, optional conditions); refuses out-of-range % with a message instead of saving | crm-settings.tsx:1337-1377 | same PATCH (appended entry, code `custom-<timestamp>`) | code only; client 100% cap == server 10000 bps ✓ | OK |

### Card: SMS (id="sms", deep-link target)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Plan-gate block (text-sms-plan + link-sms-upgrade) | Conditional text + external link | "Texting is included with the Pro, Growth and Agency plans — Upgrade in Pricing"; links to the marketing site's /pricing | crm-settings.tsx:1394-1405 | GET /api/crm/sms/status → server/crm/sms.ts:736-742 orgSmsStatus → orgSmsEntitled (sms.ts:103-123: owner plan via getEntitlements) | planAllowsSms=true here (dev platform admin) so block hidden; TEXTING_PLANS (shared/plan-copy.ts:371) lists exactly the 3 plans with teamTextSegments>0 — verified identical to server gate planIncludesTexting for all 4 plans | OK |
| Configured block (text-sms-configured) | Conditional text | "Texting via SignalWire from <number>" when a sender works | crm-settings.tsx:1406-1413 | orgSmsStatus → smsStatus (sms.ts:64-81): configured = a sender resolves (platform env or org's own number) | not shown here (unconfigured) | OK |
| Shared-number note (text-sms-client-note) | Conditional amber note | Warns the shared number texts your team only; texting clients needs your own registered number | crm-settings.tsx:1414-1421 | canTextClients=false when sender is the shared platform number | rendered? hidden because configured=false; logic matches orgCanTextClients | OK |
| Not-configured block (text-sms-not-configured + text-sms-missing + text-sms-gray-note) | Conditional text | "SMS is not configured — set SIGNALWIRE_SPACE_URL, PROJECT_ID, API_TOKEN, FROM_NUMBER…" | crm-settings.tsx:1423-1433 | smsMissingEnv() (sms.ts:55-57) lists unset env vars | API returned all 4 missing; page showed the same list ✓ | OK |
| Status pill (pill-sms-status) | Pill | "Configured" / "Not configured" / "Upgrade to enable" | crm-settings.tsx:1436-1440 | same status payload | rendered "Not configured" ✓ | OK |
| Sender mode select (select-sms-mode): shared / own number (billed via ConstructHUB) / own SignalWire account | Select | Chooses which number your texts come from | crm-settings.tsx:1450-1460 | PUT /api/crm/sms/sender {mode,fromNumber,spaceUrl,projectId,apiToken} → sms.ts:750-801: normalizes phone; byo requires space+project+token; token encrypted (apiTokenEnc), never returned | section gated on manageIntegrations ✓ (shown); apiTokenEnc stripped from /api/crm/org by presentOrg /Enc$/ rule — write-only confirmed | OK |
| Conditional inputs: Your text number (input-sms-from); BYO: space URL (input-sms-space), Project ID (input-sms-project), API token (input-sms-token) | Inputs | Details for your own number / own SignalWire account | crm-settings.tsx:1462-1503 | same PUT (400s with plain message when invalid) | code only | OK |
| Save sender (button-save-sms-sender) | Button | Stores the sender setup | crm-settings.tsx:1505-1511, 329-344 | PUT /api/crm/sms/sender → updates crm_orgs.custom_fields.sms, returns fresh status | code only | OK |
| Text estimates to clients (switch-sms-estimates) + BYO note (note-sms-estimates-byo) | Switch + note | Default "also text the estimate link" when sending a bid; disabled while SMS unconfigured or client-texting unavailable | crm-settings.tsx:1515-1535, 347-354 | PATCH /api/crm/org {smsEstimates} → custom_fields.smsEstimates (routes.ts:219, 689) | rendered OFF+disabled (unconfigured, canTextClients=false) ✓ | OK |
| Call the client to check their email (switch-voice-nudge) | Switch | Rings the client with a "check your inbox/spam" message when a bid is sent | crm-settings.tsx:1537-1552, 399-406 | PATCH /api/crm/org {voiceNudge} → custom_fields.voiceNudge | rendered OFF ✓ | OK |
| Text me when a bid is signed or money lands (switch-sms-alerts) | Switch | Owner texts on approvals/payments (per-text cost; off by default) | crm-settings.tsx:1554-1568, 388-395 | PATCH /api/crm/org {smsAlerts} → custom_fields.smsAlerts; sending side: textOrgOwners (sms.ts:984-1015) texts active owners' mobiles, else org phone | rendered OFF+disabled (unconfigured) ✓ | OK |
| Send a test text: input (input-sms-test-to) + button (button-sms-test-send) | Input + button | Sends a real test SMS (manageIntegrations only); disabled while unconfigured | crm-settings.tsx:1570-1586, 525-531 | POST /api/crm/sms/test {to} → sms.ts:803-831: manageIntegrations + plan + 503 when carrier env missing; sends via SignalWire/log provider | button rendered disabled ✓ (matches !smsStatus.configured) | OK |

### Card: Price floor lock (owner only — rendered)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Lock pricing switch (switch-price-lock) | Switch | Stops reps pricing below the floor (each SKU's price, or cost when no SKU matches) | crm-settings.tsx:1601-1614, 575-586 | PUT /api/crm/org/price-floor-lock {enabled,floorBps} → server/crm/pricebook.ts:169-189 (owner only) → crm_orgs.custom_fields.priceFloorLock | card shown because member role=owner ✓; DB has no priceFloorLock → switch off ✓ | OK |
| Floor margin over cost % (input-price-floor-bps) + hint | Input | Optional margin over cost used as the floor instead of SKU price | crm-settings.tsx:1615-1625 | same PUT (floorBps 0-10000, null = key dropped) | client 0-100% == server cap ✓ | OK |
| Save floor (button-save-price-floor) | Button | Saves the lock settings | crm-settings.tsx:1626-1632 | same PUT | code only | OK |

### Card: Scheduled exports (owner only — rendered)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Automatic email exports switch (switch-backup-enabled) | Switch | Turns the scheduled export email on/off (checked every 15 minutes server-side) | crm-settings.tsx:1649-1661 | PUT /api/crm/backups/settings {enabled,…} → server/crm/backups.ts:389-400: merged into crm_orgs.custom_fields.backup via jsonb_set (lastSentAt/lastError survive); scheduler tick = 15 min (backups.ts:302) | "15 minutes" copy == BACKUP_SCHEDULER_TICK_MS ✓; DB has no backup cfg → off ✓ | OK |
| Frequency select (select-backup-frequency): weekly / biweekly / custom | Select | How often the export email goes out | crm-settings.tsx:1662-1676 | same PUT (enum weekly\|biweekly\|custom) | ✓ | OK |
| Every N days (input-backup-custom-days) | Conditional input | Days between exports when frequency is custom | crm-settings.tsx:1677-1685 | same PUT (int 1-90; server 400 "Choose how many days…" when missing) | client min/max 1-90 == server ✓ | OK |
| Format select (select-backup-format): CSV (three files) / Excel (.xls, three sheets) | Select | CSV = 3 attachments; "Excel" = one SpreadsheetML 2003 workbook sent as .xls (UI labels it .xls honestly) | crm-settings.tsx:1686-1698 | same PUT (csv\|xlsx); builder backups.ts:215-228 | label "Excel (.xls, three sheets)" matches buildAttachments/toSpreadsheetXml ✓ | OK |
| Send to (input-backup-email) + placeholder | Input | Recipient address; blank = the default shown in the placeholder | crm-settings.tsx:1699-1705, 617-623 | GET /api/crm/backups/settings → backups.ts:372-387: defaultEmail = resolveRecipient (cfg.email → org.email → owner's seat email); PUT stores cfg.email (blank→null) | API defaultEmail=dev@constructhub.local == org email (SQL) == rendered placeholder ✓ | OK |
| Save export settings (button-save-backup) | Button | Saves the export schedule; disabled when enabled with no recipient at all | crm-settings.tsx:1706-1711, 625-640 | PUT /api/crm/backups/settings (owner only; invalid email 400 with field-mapped message) | code only | OK |
| Email hint (text-backup-email-hint) | Conditional text | "Leave Send to blank to send exports to <default>" or a destructive warning when no recipient exists anywhere | crm-settings.tsx:1713-1720 | same GET defaultEmail | rendered "Leave … blank to send exports to dev@constructhub.local." ✓ | OK |
| Send export now (button-send-now→button-send-backup-now) | Button | Immediately emails an export of clients, estimates and invoices; toast reports row counts and size | crm-settings.tsx:1721-1729, 642-652 | POST /api/crm/backups/send-now → backups.ts:402-424: buildBackupSections = ALL crm_customers + crm_estimates + crm_invoices of the org (no archive filter) → CSV/SpreadsheetML → sendWithFallback to resolveRecipient; stamps lastSentAt/lastError | code only (did not press — sends email); response shape {rows:{clients,estimates,invoices},bytes,recipient} matches toast ✓ | OK |
| Last sent line (text-backup-last-sent) | Text | "Last sent <date>" or "Never sent yet" | crm-settings.tsx:1730-1734 | crm_orgs.custom_fields.backup.lastSentAt (ISO → toLocaleString) | DB lastSentAt null → "Never sent yet" ✓ | OK |
| Last export failed line (text-backup-error) | Conditional text | Shows the last export error, when any | crm-settings.tsx:1736-1740 | custom_fields.backup.lastError | null → hidden ✓ | OK |

### Card: Payments

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Open payments" link (link-payments) | Link | Jumps to the Payments page (connect Stripe, take payments) | crm-settings.tsx:1753-1758 | route /crm/payments → CrmPaymentsPage (App.tsx:410) | route exists ✓ | OK |
| Status block (card-payments-status): account name / "No account connected" + explanation | Status + text | Shows your connected Stripe account (business name, email, or account id) and that money goes straight to your Stripe | crm-settings.tsx:1762-1775 | GET /api/crm/payments/status → server/crm/payments.ts:165-195: activeAccount = latest crm_payment_accounts WHERE org_id AND disconnected_at IS NULL | SQL: no payment account rows → API account:null → "No account connected" ✓ (Stripe off on dev, as expected) | OK |
| Status pill (pill-payments-status) | Pill | "Connected" / "Connected · charges off" / "Not connected" | crm-settings.tsx:1776-1780 | same payload (chargesEnabled) | rendered "Not connected" ✓ | OK |
| Settings load error (text-payment-settings-error) | Conditional text | If payment settings can't load, hides the whole fee/rail form so hardcoded defaults can't overwrite real settings | crm-settings.tsx:1786-1789 | GET /api/crm/payments/settings (manageSettings) | not shown (load OK) ✓ | OK |
| Allowed methods select (select-rail-mode): ACH+card / ACH only / card only | Select | Which payment rails clients may use | crm-settings.tsx:1801-1815, 659-675 | GET+PUT /api/crm/payments/settings → payments.ts:530-584: stored at crm_orgs.custom_fields.payments {railMode,…}; enforcement allowedRails (payments.ts:115-127): org policy ∩ Stripe account capability | API railMode "both" (no stored key → default) ✓ = rendered | OK |
| "ACH only above ($)" (input-ach-only-over) + threshold hint | Conditional input | With "both", payments at/above this amount become bank-transfer only | crm-settings.tsx:1816-1831 | same PUT achOnlyOverCents (cents, 0-$1M); applied only when ACH actually available (payments.ts:123-125) | client cap $1,000,000×100 == server max 100,000,000 cents ✓; "at or above" copy == `amountCents >= threshold` ✓ | OK |
| Save payment methods (button-save-rail-policy) | Button | Saves the rail policy | crm-settings.tsx:1832-1838, 687-706 | PUT {payments:{passFeeToClient,surchargeBps,railMode,achOnlyOverCents}} | code only | OK |
| Pass the card processing fee to the client (switch-pass-fee) + "Card checkouts add a clearly-labelled 'Card processing fee' line…" | Switch + text | Adds a card-fee line to card checkouts; ACH stays fee-free | crm-settings.tsx:1842-1855 | same PUT passFeeToClient; fee math cardFeeCents (payments.ts:130-134) | API passFeeToClient=false ✓ = rendered off | OK |
| Card surcharge % (input-surcharge-pct) | Conditional input | The surcharge % added for card payments | crm-settings.tsx:1856-1864 | same PUT surchargeBps (0-1000 = 0-10%); stored null when ≤0 (payments.ts:563-564) | client cap 10% == server 1000 bps ✓; invalid surcharge ignored when switch off (comment 688-690) ✓ | OK |
| Save fee setting buttons (button-save-card-fee / -off) | Buttons (2 layout variants) | Saves the fee passthrough setting | crm-settings.tsx:1865-1880 | same PUT | code only | OK |
| "ACH costs 0.8% capped at $5; cards cost 2.9% + 30¢" copy | Text | States Stripe's rates | crm-settings.tsx:1796-1799 | matches server disclosure (payments.ts:187-193) | ✓ | OK |
| Financing links ⓘ (financing) | Info tip | Explains the "Finance this project" button shown to clients | crm-settings.tsx:1886 | client only: INFO_CONTENT.financing | key exists (info-content.ts:228) ✓ | OK |
| Financing link rows (row-financing-<i>): label, URL, Primary pill (pill-primary-financing-<i>) | List rows | Up to 10 lender/partner links; the primary one shows as "Finance this project →" on estimates, invoices, portal | crm-settings.tsx:1892-1926, 674-675 | GET+PUT /api/crm/payments/settings financingLinks → payments.ts:556-580 via financingLinksSchema (max 10, http(s) only, exactly-one-primary normalized both sides) | API [] = no rows ✓; client max-10 gate == FINANCING_LINKS_MAX ✓ | OK |
| Set primary (button-primary-financing-<i>) | Button per non-primary row | Makes that link the one clients see | crm-settings.tsx:1905-1911 | same PUT (client maps primary to exactly one; server re-normalizes first-primary-wins) | code only | OK |
| Remove link (button-remove-financing-<i>) | Button per row | Deletes the link; promotes the first remaining link so a primary always exists | crm-settings.tsx:1912-1921 | same PUT | code only | OK |
| Add-link inputs (input-financing-label / -url) + Add link (button-add-financing) | 2 inputs + button | Adds a lender link (URL must start http:// or https://); first link becomes primary automatically | crm-settings.tsx:1927-1948 | same PUT; server rejects non-http(s) with message | client regex `/^https?:\/\//i` == server refine ✓ | OK |

### Card: Calendar

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Google Calendar connected" banner (text-google-calendar-connected) | Conditional banner | Shows after a successful Google OAuth round-trip (read once from the URL, then stripped) | crm-settings.tsx:125-134, 1966-1971 | GET /api/crm/calendar/google/callback redirects to /crm/settings?calendar=connected=1 (server/crm/calendar.ts:430) | code only | OK |
| "Google Calendar connection failed" banner (text-google-calendar-error) | Conditional banner | Shows the OAuth error | crm-settings.tsx:1972-1977 | same callback, error=… | code only | OK |
| Feed URL input (input-calendar-feed-url) | Read-only input | The secret iCal link for Apple/Google/Outlook; "the token in this URL is the password" | crm-settings.tsx:1987-1989 | GET /api/crm/calendar/feed-url → server/crm/calendar.ts:327-341: derives token `${orgId}.${counter}.hmac` from custom_fields.calendarFeedCounter (minted lazily if absent) | See note below — token validated live against GET /api/crm/calendar/feed.ics | OK |
| Copy (button-copy-calendar-feed) | Button | Copies the feed URL to the clipboard | crm-settings.tsx:1990-2002 | client only: navigator.clipboard | code only | OK |
| Regenerate (button-regenerate-calendar-feed) | Button | Confirms, then mints a new token — every old subscription stops updating | crm-settings.tsx:2003-2012, 714-721 | POST /api/crm/calendar/rotate-feed-token → calendar.ts:344-354: counter+1, stores sha256(token) + rotatedAt | PRESSED: 200 + new URL; DB counter 2→3, hash+rotatedAt updated; feed.ics with new token → 200 repeatedly (incl. 25 s later) ✓. NOTE: before the press, the displayed URL 401'd (see bug-note) | OK |
| Company Google Calendar section + status pill (pill-google-calendar-status) | Section + pill | Push-syncs EVERY appointment into a dedicated "ConstructHub CRM" calendar in a Google account; per-member calendars live on the Team page | crm-settings.tsx:2017-2032 | GET /api/crm/calendar/google/status → calendar.ts:358-384: configured (env present), connection from crm_orgs.custom_fields.googleCalendar (refresh token NOT exposed — present strips it) | API configured=true, connection=null → pill "Not connected" ✓ = rendered | OK |
| "Not configured on this server" block (text-google-calendar-not-configured) | Conditional text | Names the missing Google OAuth env vars when the server isn't set up | crm-settings.tsx:2034-2045 | same status payload `missing` | hidden here (configured) ✓ | OK |
| Connected line: "Connected <date> · last synced … / not synced yet" + sync error (text-google-calendar-sync-error) | Conditional text | Shows connection date and last sync result/error | crm-settings.tsx:2049-2057 | custom_fields.googleCalendar.{connectedAt,lastSyncAt,lastSyncError} | hidden (not connected) ✓ | OK |
| Sync now (button-sync-google-calendar) | Conditional button | Pushes all live appointments to Google and deletes events whose appointment is gone/canceled; toast reports pushed/written/removed | crm-settings.tsx:2058-2063, 729-739 | POST /api/crm/calendar/google/sync → calendar.ts:490-586: org scope (manageSettings), full replace of crmManaged events, orgFeedEvents, tz = org.timezone | code only (not connected → hidden; would 409 if pressed) | OK |
| Disconnect (button-disconnect-google-calendar) | Conditional button | Drops the Google connection (revokes token best-effort, local record cleared regardless) | crm-settings.tsx:2064-2067, 741-748 | POST /api/crm/calendar/google/disconnect → calendar.ts:588-610 | code only | OK |
| Connect Google Calendar (button-connect-google-calendar) | Button | Starts the Google OAuth flow (org scope; manageSettings required), lands back here with the banner | crm-settings.tsx:2070-2076, 723-727 | GET /api/crm/calendar/google/connect → calendar.ts:386-423: CSRF state in session, scope calendar.app.created, prompt=consent | route is /api/crm/calendar/google/connect (client line 724 matches) ✓; button enabled since configured=true ✓ | OK |

Feed-URL note (not a page defect): on this dev box the stored hash in `crm_orgs.custom_fields.calendarFeedToken` was written at 23:00:42 UTC by an outside seeder using a different SESSION_SECRET than the running server, so the displayed URL returned 401 "Invalid calendar feed token" for stretches of this audit (verified repeatedly: same token, same DB hash, alternating 401/200 windows while background seeders rewrote the row). Pressing the card's own Regenerate button re-minted the token under the server's secret after which the URL validated consistently (200 over repeated probes). The page code itself is correct and self-consistent (feed-url and feed.ics use the same deriveFeedToken/feedSecret).

### Card: Integrations have moved

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Open" link (link-integrations) | Link | Goes to the Integrations page (HOVER, API keys, webhooks, Stripe, Google) | crm-settings.tsx:2083-2099 | route /crm/integrations → CrmIntegrationsPage (App.tsx:413) | route exists ✓ | OK |

### Shortcut cards

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Team & permissions — Open (link-team) | Link | Members, roles, invitations, per-person overrides | crm-settings.tsx:2103-2117 | route /crm/team (App.tsx:411) | ✓ | OK |
| Price book — Open (link-pricebook) | Link | Materials, labor rates, assemblies, packages | crm-settings.tsx:2118-2132 | route /crm/pricebook (App.tsx:408) | ✓ | OK |
| Import your data — Open (link-migrate) | Link | Import clients/estimates/invoices from Jobber, QuickBooks, Leap, Excel | crm-settings.tsx:2133-2147 | route /crm/migrate (App.tsx:415) | ✓ | OK |
| Measurement reports — Open (link-reports) | Link | Import HOVER or CladAI reports (client auto-created) | crm-settings.tsx:2148-2162 | route /crm/reports (App.tsx:414) | ✓ | OK |

### Card: Lead sources (read-only)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Load error text | Error text | Shows if the fetch fails | crm-settings.tsx:2176-2177 | GET /api/crm/lead-sources | not shown ✓ | OK |
| Empty state "No lead sources yet" | Empty state | Explains sources appear as they're added to clients | crm-settings.tsx:2178-2180 | n/a | not shown (2 sources exist) | OK |
| Source pills (row-lead-source-<id>) | Pills | Read-only list of where clients come from | crm-settings.tsx:2181-2189 | GET /api/crm/lead-sources → server/crm/entities.ts:1478-1485: crm_lead_sources WHERE org_id AND active=true ORDER BY name | SQL 2 active rows (Call Assistant, Website) = API = rendered pills ✓ | OK |

### Footer

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Terms of Service (link-crm-terms) | Link | Opens the CRM terms page | crm-settings.tsx:2193-2196 | route /crm-terms → CrmTermsPage (App.tsx:227) | ✓ | OK |
| Privacy Policy (link-crm-privacy) | Link | Opens the CRM privacy page | crm-settings.tsx:2197 | route /crm-privacy → CrmPrivacyPage (App.tsx:228) | ✓ | OK |


## Integrations (route `/crm/integrations`)

Page component: `client/src/pages/crm-integrations.tsx`, route at `client/src/App.tsx:413`.
Gated on `manageSettings` (redirects to `/` otherwise); all connect/manage surfaces additionally need `manageIntegrations` (the API enforces the same permission per route — verified in server code and probed live).
Session org for all checks below: `c5b47b8d-caa8-47e6-ae7e-6248ad5df565` (SKU Dry-Run), dev platform admin user id 1 with all permissions.
Every status pill on this page was verified live on 2026-10-04 against the dev DB and rendered page text.

### Page header

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Integrations" title + subtitle | Header | Names the page: one directory of every outside connection and API. | crm-integrations.tsx:217-222 | client only | render dump of /crm/integrations | OK |
| ⓘ info icon (infoKey="integrations") | Info dialog | Opens a plain-English explainer about the Integrations page. | crm-integrations.tsx:220 → components/crm-ui.tsx:64 → components/info-tip.tsx:29 | client only: INFO_CONTENT["integrations"] at client/src/lib/info-content.ts:379 | key exists in info-content.ts:379; vitest server/crm/info-content.test.ts passes (3/3) | OK |

### Card: HOVER measurements (`card-hover`)

Current state on dev: `configured:true` (env vars `HOVER_CLIENT_ID`/`HOVER_CLIENT_SECRET` present, server/crm/hover.ts:89), `connected:false` (no `custom_fields->'hover'` on the org). The card therefore shows the "Connect HOVER" button; the connected-only elements below were verified by code and by probing their endpoints live (all correctly answer 409 "Connect HOVER first." while disconnected).

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "HOVER measurements" section title + ⓘ | Info dialog | Explains that HOVER pushes roof/siding measurements into the CRM automatically. | crm-integrations.tsx:227-232 | client only: INFO_CONTENT["hover"] at info-content.ts:408 | key exists; render shows title + description | OK |
| "You don't have the manageIntegrations permission — ask an admin." | Notice | Shown instead of all controls when the seat lacks the manage-integrations permission. | crm-integrations.tsx:235-238 | enforced server-side too (requirePermission "manageIntegrations" on every hover route, e.g. hover.ts:1245) | code only | OK |
| "Couldn't load the HOVER status — refresh to try again." | Error text | Shown if the status query fails. | crm-integrations.tsx:239-240 | n/a | code only | OK |
| "HOVER isn't configured" empty state | Empty state | Shown only when the deployment lacks HOVER OAuth credentials — not the case on dev. | crm-integrations.tsx:243-245 | hoverConfigured() = env HOVER_CLIENT_ID && HOVER_CLIENT_SECRET (hover.ts:89-90) | GET /api/crm/integrations/hover/status → configured:true | OK |
| "Connect HOVER" button (`button-connect-hover`) | Link (OAuth) | Starts the HOVER authorization: bounces you to hover.to to approve, then lands back here with a "HOVER connected" toast. | crm-integrations.tsx:252-254 | GET /api/crm/integrations/hover/connect → hover.ts:1244 → 302 to https://hover.to/oauth/authorize?…&redirect_uri=…/api/crm/integrations/hover/oauth/callback; callback (hover.ts:1260) exchanges the code, stores refreshTokenEnc in crm_orgs.custom_fields->'hover', registers the webhook, redirects to /crm/integrations?hover=connected | curl: 302 to hover.to with client_id and redirect_uri; callback route + flag handling verified in code (crm-integrations.tsx:144-150) | OK |
| "connected" pill (`pill-hover-connected`) | Status pill | Green pill shown when the org has a stored HOVER connection. | crm-integrations.tsx:259 | GET /api/crm/integrations/hover/status → hover.ts:1218-1241 → reads crm_orgs.custom_fields->'hover' (readHoverConn, hover.ts:157); connected = token row exists | API returns connected:false; SQL: no 'hover' key in custom_fields (jsonb_object_keys) — pill correctly hidden | OK |
| "since <date>" text | Text | Date the HOVER connection was first authorized. | crm-integrations.tsx:260-262 | same status endpoint, field connectedAt from custom_fields->'hover' | code + API shape | OK |
| "webhook verified / pending verification / not registered" (`text-hover-webhook`) | Status pill/text | Tells whether the automatic job-push webhook is registered with HOVER and confirmed. | crm-integrations.tsx:263-272 | same status endpoint, field webhook.verified (custom_fields->'hover'->'webhook') | API returns webhook:null → "webhook not registered" correct | OK |
| "last sync <date/time>" (`text-hover-lastsync`) | Text | When the last HOVER job pull ran (manual or automatic). | crm-integrations.tsx:273-277 | same status endpoint, field lastSyncAt; auto-sync loop runDueHoverSyncs (hover.ts:1162) runs when now - lastSyncAt ≥ syncEveryHours (server clock) | code + API shape | OK |
| Error line (`text-hover-error`) | Error text | Shows the last sync error, if any. | crm-integrations.tsx:279-281 | same status endpoint, field lastError | API returns lastError:null | OK |
| "Last sync: N scanned · N matched by email · N by phone · N by address · N created · N ambiguous · N errors" (`text-hover-syncreport`) | Stats line | Breakdown of the most recent sync run. | crm-integrations.tsx:282-292 | same status endpoint, field lastSyncReport persisted by runHoverSync (hover.ts:1150-1151) | API returns lastSyncReport:null — line hidden, correct | OK |
| "Auto-sync" cadence select (`select-hover-cadence`, options Every hour / 2 / 4 / 6 (default) / 12 / 24 / Once a week) | Select | Chooses how often ConstructHub pulls new HOVER jobs on its own; default every 6 hours. | crm-integrations.tsx:295-314 | POST /api/crm/integrations/hover/schedule {hours} → hover.ts:1342 → validates hours ∈ HOVER_SYNC_HOURS [1,2,4,6,12,24,168] (hover.ts:1157), writes custom_fields->'hover'->'syncEveryHours'; scheduler honors it (hover.ts:1167-1169) | probed live: {hours:3} → 400 "Pick a supported cadence."; all 7 UI option values are in the allowed set; default 6 matches server default | OK |
| "Sync now" button (`button-hover-sync`) | Button | Immediately pulls the HOVER job list and imports any completed jobs not yet in the CRM, then toasts the counts. | crm-integrations.tsx:317-321 | POST /api/crm/integrations/hover/sync → hover.ts:1328 → runHoverSync(orgId): lists jobs via HOVER API, inserts customers/measurements, writes lastSyncReport/lastSyncAt | probed live (disconnected): 409 {message:"Connect HOVER first."} — correct | OK |
| ⓘ next to Sync now (k="hover-sync") | Info dialog | Explains what "Sync now" backfills. | crm-integrations.tsx:322 | client only: INFO_CONTENT["hover-sync"] at info-content.ts:418 | key exists | OK |
| "Register webhook" button (`button-hover-register`) | Button | Asks HOVER to re-register the job-push webhook (only shown when webhook missing or unverified). | crm-integrations.tsx:323-329 | POST /api/crm/integrations/hover/register-webhook → hover.ts:1306 → ensureHoverWebhook (creates webhook at HOVER, stores id + hmacSecretEnc) | probed live (disconnected): 409 — correct | OK |
| "Disconnect" button (`button-hover-disconnect`) | Button | After a confirm, deletes the webhook at HOVER and wipes the stored tokens; jobs stop flowing in. | crm-integrations.tsx:330-336 | POST /api/crm/integrations/hover/disconnect → hover.ts:1354 → DELETE /v2/webhooks/{id} at HOVER (best effort), writeHoverConn(orgId, null) removes custom_fields->'hover' | code + endpoint probed (route exists, guarded by permission) | OK |

### Card: Lead capture (`card-lead-capture`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Lead capture" section title + ⓘ | Info dialog | Explains the embeddable website form. | crm-integrations.tsx:346-351 | client only: INFO_CONTENT["lead-capture"] at info-content.ts:427 | key exists | OK |
| "N leads in the last 30 days" (`text-lead-count`) | Stat | Counts clients created from the website form in the last 30 days. | crm-integrations.tsx:364-368 | GET /api/crm/integrations/lead-capture → server/crm/lead-capture.ts:169-190 → `SELECT count(*) FROM crm_customers WHERE org_id=? AND 'website-lead' = ANY(tags) AND created_at > now() - interval '30 days'` — rolling 30 days in Postgres server time, org-scoped, no test-row exclusion | API returned leads30d:3; SQL independently returned 3 (all 3 are QA-* test rows from earlier test runs — they are real rows, so the count is faithful); rendered page shows "3 leads in the last 30 days" | OK |
| Direct link input (`input-lead-form-url`) | Read-only input | Shows the public form URL (auto-selects on click so you can copy it). | crm-integrations.tsx:370-373 | same endpoint; formUrl = {portalBaseUrl}/lead-form/{token}; token stored in crm_orgs.custom_fields->'leadCaptureToken', minted lazily (lead-capture.ts:57-68) | API value matches input; URL host http://127.0.0.1:8305 correct for dev | OK |
| "Copy" link button (`button-copy-lead-link`) | Button | Copies the form link to the clipboard; toasts "Copied" (or "Copy failed" if the browser denies it). | crm-integrations.tsx:374-378 | client only (navigator.clipboard) | code only | OK |
| Embed code block (`text-lead-embed`) | Code snippet | The ready-to-paste iframe HTML pointing at the same form URL. | crm-integrations.tsx:381-385 | same endpoint (formUrl); assembled client-side | render dump shows `<iframe src="http://127.0.0.1:8305/lead-form/c5b4…">` matching the API token | OK |
| "Copy" embed button (`button-copy-lead-embed`) | Button | Copies the iframe HTML. | crm-integrations.tsx:386-390 | client only | code only | OK |
| "Rotate link" button (`button-rotate-lead-token`) | Button | After a confirm, mints a new token — every old link/embedded copy stops working. | crm-integrations.tsx:397-408 | POST /api/crm/integrations/lead-capture/rotate → lead-capture.ts:193-202 → mintLeadToken: writes new custom_fields->'leadCaptureToken' + leadCaptureRotatedAt | code + endpoint exists (not pressed: rotating would break the org's current link for other lanes; public intake POST /api/public/leads/:token verified by code — inserts crm_customers tagged website-lead, emails owner) | OK |

### Directory grid: summary cards

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Stripe payments" card (title + description) (`card-stripe`) | Card | Summary of the Stripe connection; the actual connect button lives on the Payments page. | crm-integrations.tsx:417-431 | pill fed by GET /api/crm/payments/status → server/crm/payments.ts:165-195 → account = latest crm_payment_accounts row for org with disconnected_at IS NULL (activeAccount, payments.ts:69-74); chargesEnabled from that row | API: account:null; SQL `SELECT … FROM crm_payment_accounts WHERE org_id=…` → 0 rows — "Not connected" is true. Stripe is off on dev ("missing":["STRIPE_SECRET_KEY"]) which the Payments page surfaces; the pill doesn't distinguish "server not configured" from "you never connected", which is cosmetically lossy but not false | OK |
| Stripe status pill (`pill-stripe-status`) | Status pill | "Connected" (green) when charges are enabled, "Charges off" when an account exists but can't charge, "Not connected" otherwise. | crm-integrations.tsx:425-429 | same status endpoint; tone = acct?.chargesEnabled | matches API/DB above | OK |
| "Open" link (`link-stripe-payments`) | Link | Jumps to the Payments page, where the Stripe Connect button lives. | crm-integrations.tsx:433-436 | route /crm/payments → client/src/App.tsx:410 → CrmPaymentsPage; connect flow at client/src/pages/crm-payments.tsx:164 calls GET /api/crm/payments/connect/stripe | route exists in App.tsx:410; connect endpoint exists (payments.ts:199) | OK |
| "Google Calendar" card (title + description) (`card-google-calendar`) | Card | Summary of the company-calendar sync; connect lives in Settings. | crm-integrations.tsx:441-456 | pill fed by GET /api/crm/calendar/google/status → server/crm/calendar.ts:358-384 → connection = crm_orgs.custom_fields->'googleCalendar' when it holds a refreshToken (googleConnectionOf, calendar.ts:137-141) | API: connection:null; SQL: custom_fields has no 'googleCalendar' key (jsonb_object_keys: only leadCaptureToken, calendarFeedToken, notificationPrefs, docNumberHighWater, calendarFeedCounter, leadCaptureRotatedAt, calendarFeedRotatedAt) — "Not connected" is true | OK |
| Google Calendar status pill (`pill-gcal-status`) | Status pill | "Connected" when an org-wide Google connection exists, else "Not connected". | crm-integrations.tsx:449-453 | same status endpoint; note the card reads only the org-wide `connection`, not the per-member `myConnection` | matches API/DB above | OK |
| "Open" link (`link-google-calendar-settings`) | Link | Jumps to Settings, which hosts the Google Calendar connect/disconnect controls. | crm-integrations.tsx:457-460 | route /crm/settings → App.tsx:412 → CrmSettingsPage; connect at client/src/pages/crm-settings.tsx:724 (GET /api/crm/calendar/google/connect) | route exists; settings page confirmed to contain the calendar section | OK |
| "CladAI" card (title + description) (`card-cladai`) | Card | Honest placeholder: no fake connect button; says manual CladAI report import is available meanwhile. | crm-integrations.tsx:465-478 | client only (static copy) | render shows "Coming soon" pill | OK |
| CladAI pill (`pill-cladai-status`) | Status pill | Static "Coming soon" — not driven by any backend state. | crm-integrations.tsx:473 | client only | render | OK |
| "Reports" link (`link-cladai-reports`) | Link | Jumps to the Reports page, where CladAI reports can be imported manually. | crm-integrations.tsx:479-482 | route /crm/reports → App.tsx:414 → CrmReportsPage; page subtitle confirms "Import a HOVER or CladAI report" (client/src/pages/crm-reports.tsx:199) | route exists; destination confirmed relevant | OK |

### Card: API keys

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "API keys" section title + ⓘ | Info dialog | Explains read-only API access for your own tools. | crm-integrations.tsx:490-495 | client only: INFO_CONTENT["api-keys"] at info-content.ts:388 | key exists | OK |
| New-key banner (`text-new-api-key`) + copy button (`button-copy-api-key`) | Banner + button | Shows the full new key exactly once after creation, with a copy button. | crm-integrations.tsx:504-520 | POST /api/crm/api-keys → server/crm/ops.ts:1219-1235 → inserts crm_api_keys (name, sha256 keyHash, keyPrefix=first 12 chars, scopes=['read']); plaintext key returned once in response | pressed live: created "AUDIT-lane5-tmp" → 201 with key chk_…; banner fields match response | OK |
| Key name input (`input-api-key-name`) | Input | Optional name for the new key (defaults to "API key"). | crm-integrations.tsx:522-524 | sent as {name} in POST body; server trims and defaults (ops.ts:1222) | body shape matches server | OK |
| "Create key" button (`button-create-api-key`) | Button | Creates a read-only API key for /api/v1 and shows it once. | crm-integrations.tsx:525-529 | POST /api/crm/api-keys {name} → ops.ts:1219 → insert crm_api_keys; 201 {id,name,keyPrefix,createdAt,key,warning} | pressed live: 201, key visible once, list refreshed | OK |
| "No API keys yet" empty state | Empty state | Shown when the org has no unrevoked keys. | crm-integrations.tsx:533-535 | GET /api/crm/api-keys → ops.ts:1210-1217 → `SELECT * FROM crm_api_keys WHERE org_id=? AND revoked_at IS NULL ORDER BY created_at DESC` (hash stripped) | after test cleanup GET returned []; SQL shows my AUDIT key with revoked_at set (excluded correctly); 18 older rows all revoked | OK |
| Key row (`row-api-key-{id}`): name + "prefix… · created · last used" line | Row | Lists one active key: its name, first characters, creation and last-use dates. | crm-integrations.tsx:538-547 | same GET; fields name, keyPrefix, createdAt, lastUsedAt from crm_api_keys | row rendered correctly during live create (see above) | OK |
| Revoke trash button (`button-revoke-api-key-{id}`) | Button | After a confirm, revokes the key — anything using it stops immediately. | crm-integrations.tsx:548-556 | DELETE /api/crm/api-keys/:id → ops.ts:1237-1244 → UPDATE crm_api_keys SET revoked_at=now() WHERE org_id=? AND id=? | pressed live on the AUDIT key: {ok:true}; GET list empty after; SQL revoked_at IS NOT NULL — cleaned up | OK |

### Card: Webhooks

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Webhooks" section title + ⓘ | Info dialog | Explains signed event notifications to your own endpoint. | crm-integrations.tsx:568-573 | client only: INFO_CONTENT["webhooks"] at info-content.ts:398 | key exists | OK |
| New-secret banner (`text-new-webhook-secret`) | Banner | Shows the HMAC signing secret exactly once after adding a webhook. | crm-integrations.tsx:582-588 | POST /api/crm/webhooks → ops.ts:1253-1284 → inserts crm_webhooks (url, events, secret=whsec_…); secret returned once | pressed live: secret shown in response | OK |
| Endpoint URL input (`input-webhook-url`) | Input | Where you type the https URL that should receive events. | crm-integrations.tsx:590-595 | sent as {url}; server validates z.string().url() max 500 AND rejects URLs resolving to private/loopback addresses (webhookUrlIsSafe, server/crm/integrations.ts:76) | shape matches server; SSRF guard confirmed in code (delivery re-checks per send, integrations.ts:118) | OK |
| Event checkboxes (`checkbox-webhook-event-{ev}` ×19: customer.created, customer.updated, project.created, project.stage_changed, estimate.sent, estimate.viewed, estimate.approved, estimate.declined, invoice.sent, invoice.viewed, invoice.paid, changeorder.approved, changeorder.declined, appointment.scheduled, appointment.completed, payment.succeeded, payment.failed, payment.reversed, payment.refunded) | Checkboxes | Pick which events this endpoint receives. | crm-integrations.tsx:596-609 | choices come from GET /api/crm/webhooks → ops.ts:1246-1251 (events = CRM_WEBHOOK_EVENTS, shared/schema.ts:2235); POST validates events ⊆ that enum, 1–40 items (ops.ts:1256-1258) | GET returned exactly these 19; rendered page lists all 19; server enum matches | OK |
| "Add webhook" button (`button-create-webhook`) | Button | Saves the endpoint + selected events; disabled until a URL and ≥1 event are entered. | crm-integrations.tsx:610-617 | POST /api/crm/webhooks {url, events} → ops.ts:1253 → insert crm_webhooks (active=true, failure_count=0) | pressed live with https://example.com/AUDIT-lane5-hook + ["invoice.paid"] → 201, row appeared | OK |
| "No webhooks yet" empty state | Empty state | Shown when the org has no webhook rows. | crm-integrations.tsx:621-623 | GET /api/crm/webhooks → ops.ts:1246 → `SELECT * FROM crm_webhooks WHERE org_id=?` (secret stripped) | after test cleanup GET returned {webhooks:[]}; SQL 0 rows — cleaned up | OK |
| Webhook row (`row-webhook-{id}`): URL + "events · N failures" line | Row | Lists one endpoint: its URL, subscribed events, and failure count if any. | crm-integrations.tsx:626-635 | same GET; fields url, events, failureCount from crm_webhooks | row rendered correctly during live create ("invoice.paid", 0 failures) | OK |
| active/disabled pill | Status pill | Green "active" while deliveries are enabled; red "disabled" after too many failures (server flips active=false). | crm-integrations.tsx:637-639 | crm_webhooks.active; emitCrmEvent disables on repeated failure (server/crm/integrations.ts) | live row showed active:true → "active" | OK |
| Delete trash button (`button-delete-webhook-{id}`) | Button | After a confirm, permanently deletes the webhook row. | crm-integrations.tsx:640-648 | DELETE /api/crm/webhooks/:id → ops.ts:1286-1292 → `DELETE FROM crm_webhooks WHERE org_id=? AND id=?` | pressed live on the AUDIT webhook: {ok:true}; GET empty after; SQL 0 rows — cleaned up | OK |

### Page-level behaviors (no single element)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Permission gate (whole page) | Redirect | If your seat can't manage settings you're bounced to the home page; if you can manage settings but not integrations, you see the page but every card says "ask an admin". | crm-integrations.tsx:46-52, 204 | GET /api/crm/me → permissions.manageSettings / manageIntegrations; server re-checks per route (requirePermission) | /api/crm/me returned both true; server-side checks read at hover.ts:1213, ops.ts:1211, lead-capture.ts:174 | OK |
| `?hover=connected` / `?hover=error` toast | Toast | After the HOVER OAuth round-trip, shows "HOVER connected" or "HOVER connection failed" and cleans the URL. | crm-integrations.tsx:144-150 | callback redirects to /crm/integrations?hover=connected (hover.ts:1302) or ?hover=error&why=… (hover.ts:1263) | code only (state/org binding verified in hover.ts:1265-1266) | OK |
| Lead form public route | Route | The Direct link / iframe URL loads the public form; submissions POST to /api/public/leads/:token and create a client tagged website-lead + email the owner. | client/src/App.tsx:243 (/lead-form/:token → PublicLeadFormPage) | GET /api/public/leads/:token (org name/logo, lead-capture.ts:205); POST /api/public/leads/:token (lead-capture.ts:216-249) → insert crm_customers (tags ['website-lead'], lead_source "Website"), honeypot + rate limit silently no-op; owner email via notifyLeadReceived | route exists in App.tsx:243; intake code read (not pressed — creates rows/emails) | OK |

### Notes / observations (not bugs)

- The "N leads in the last 30 days" figure currently counts three `QA-g06-*` test rows left by earlier QA runs. They are genuine rows in `crm_customers` tagged `website-lead`, so the number is a faithful count of the table; if the owner wants "real leads only" the table itself needs cleaning.
- The Stripe pill can't tell "this server has no Stripe keys" apart from "you haven't connected" — both render "Not connected". The Payments page does show the exact missing env var. Cosmetic, factually true.
- Time windows on this page: the only rolling window is lead capture's `created_at > now() - interval '30 days'` evaluated in Postgres server time; everything else is stored timestamps shown verbatim. No month-boundary or UTC/LT mismatch found.
- All `?? 0`-style fallbacks found (hover sync toast counters, cadence default 6h) match real server defaults (`HOVER_SYNC_HOURS`, hover.ts:1167 and 1239) — none present a fabricated value as data.


## Migration center — "Bring your data with you" (/crm/migrate)

Page file: `client/src/pages/crm-migrate.tsx`. Route: `client/src/App.tsx:415` (`<Route path="/crm/migrate" component={CrmMigratePage} />`, lazy-loaded at App.tsx:107, **no doc comment** on the route).

Backend: `server/crm/migrate.ts` (routes) + `server/crm/migrate-lib.ts` (pure parsing/mapping). Tests: `server/crm/migrate.test.ts`.

**Key fact for this audit: the page shows ZERO database-derived numbers.** Every number on screen comes from (a) parsing the uploaded file in the preview response (`totalRows`, `errors.length`) or (b) the import response counting its own per-row write outcomes (`created`/`skipped`/`errors`). There is no SQL query behind any tile, pill, or counter on this page, and no time-window math anywhere. "Verify status against DB" therefore reduces to: preview numbers reproduce exactly from the file bytes (verified live), and the import write path is org-scoped and dedupes correctly (verified by code + the existing server tests; running an import was prohibited, so no write was executed).

Org scoping on the write path: `ctx.org.id` from `requireOrg` (`server/crm/tenancy.ts:109`, session `activeOrgId` pin or default org). All inserts carry `orgId: ctx.org.id`; the customer dedupe query filters `org_id = ctx.org.id AND archived_at IS NULL` (migrate.ts:43-55); `resolveCustomer` for estimates/invoices matches non-archived clients in the same org by `lower(email)` then `lower(displayName)` (migrate.ts:125-155).

Live probes run (all read-only): `POST /api/crm/migrate/preview` with 3 small CSVs (200, shapes match); `POST /api/crm/migrate/import` with invalid entity / empty rows → 400, **no writes occur**; `POST /api/crm/migrate/assisted` with invalid system → 400 **before any email is attempted** (validation at migrate.ts:451-455). Assisted was NOT pressed with a valid system (it emails support@constructhub.us) — code verification only. Page rendered via Playwright: h1 "Bring your data with you", 3 entity cards, file input, preview button, assisted button, info tip, 5 system options, zero page errors.

---

### Page header

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Title "Bring your data with you" + subtitle | Static text | Names the page; subtitle says you can import clients, estimates and invoices from Jobber, QuickBooks, Leap or a spreadsheet. | client/src/pages/crm-migrate.tsx:205-210 | client only: render | Playwright render | OK |
| ⓘ info icon (`info-tip-migrate`) | Icon button → dialog | Opens a plain-English help dialog explaining the importer. | client/src/pages/crm-migrate.tsx:208 (infoKey) → client/src/components/info-tip.tsx:29 | client only: `INFO_CONTENT["migrate"]` exists at client/src/lib/info-content.ts:352 | key present; rendered | OK |

### Card 1 — "1 · Pick what you're importing"

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Clients" card (`button-entity-customers`) | Button (radio-style) | Selects client import; clears any chosen file/preview/result. Highlighted when active. | client/src/pages/crm-migrate.tsx:220-236 → reset() at :104 | client only: sets `entity` state | Playwright: 3 cards render | OK |
| "Estimates" card (`button-entity-estimates`) | Button (radio-style) | Selects estimate import; clears file/preview/result. Blurb "matched to clients you already imported" is accurate (import attaches by client email/name, migrate.ts:125-155). | client/src/pages/crm-migrate.tsx:220-236 | client only | Playwright render | OK |
| "Invoices" card (`button-entity-invoices`) | Button (radio-style) | Selects invoice import; clears file/preview/result. | client/src/pages/crm-migrate.tsx:220-236 | client only | Playwright render | OK |
| Label "CSV or TSV export (max 2 MB, 5,000 rows)" | Label | States the file limits next to the picker. Both limits are real and identical on both sides: client rejects `f.size > 2*1024*1024` (:69,115) and the server rejects `Buffer.byteLength(csv) > MAX_CSV_BYTES` (2 MiB, 413) and `rows.length > MAX_ROWS` (5000, 413) at migrate-lib.ts:14-15, migrate.ts:303-311. ("2 MB" is technically 2 MiB on both sides — consistent, not a mismatch.) | client/src/pages/crm-migrate.tsx:240 | POST /api/crm/migrate/preview → server/crm/migrate.ts:293 → 413 limits | constants match both sides; 413 path pinned by test migrate.test.ts:297-304 | OK |
| File picker (`input-migrate-file`) | File input | Reads the chosen .csv/.tsv/.txt into memory; toasts "File is over 2 MB" or "This file is empty" and refuses. | client/src/pages/crm-migrate.tsx:241-249, validation :113-142 | client only (server re-checks size on preview) | code + Playwright (renders) | OK |
| Hint "Comma or tab separated, quoted fields are fine…" | Static text | Reassures that Jobber/QuickBooks exports work as-is; the parser really is delimiter-auto-detecting and RFC-4180-quoting-aware (migrate-lib.ts:30-97). | client/src/pages/crm-migrate.tsx:250-253 | client only | parser read | OK |
| "Preview · filename" button (`button-preview`) | Button | Sends the file text to the server; server parses it, guesses the column mapping, validates every row, and returns headers + all rows + errors. The mapping selects and sample table then appear. | client/src/pages/crm-migrate.tsx:256-264 → doPreview :144-153 | POST /api/crm/migrate/preview → server/crm/migrate.ts:293-322 → parseCsv/guessMapping/validateRecord (migrate-lib.ts), **no DB access**; 400 on empty csv / bad entity / no header, 413 over 2 MiB or 5000 rows | live probe 200: 2-row CSV → `totalRows:2`, guessed `displayName:"Name"`, `email:"Email"`, `phone:"Phone"`, bad-email row flagged; bad-entity probe → 400 "entity must be one of…" | OK |
| "filename ready" (`text-file-ready`) | Status text | Confirms the file is in memory and ready to preview. | client/src/pages/crm-migrate.tsx:265-269 | client only | code | OK |

### Card 2 — "2 · Check the column mapping" (appears only after a successful preview)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "{n} rows" pill (in `text-preview-summary`) | Count pill | Shows how many data rows the file had (blank lines dropped by the parser). | client/src/pages/crm-migrate.tsx:282-283 (`preview.totalRows`) | POST /api/crm/migrate/preview → migrate.ts:321 `totalRows: rows.length` — count of parsed non-blank data rows, not a DB count | live probe: 4-line CSV (header + 3 rows, one blank) → totalRows 2, matches parser spec | OK |
| "all rows valid" / "{n} rows need attention" pill (in `text-preview-summary`) | Status pill | Green "all rows valid" when the server found no problems; amber "{n} rows need attention" otherwise. | client/src/pages/crm-migrate.tsx:284-286 (`preview.errors.length`) | server/migrate.ts:315-319 pushes **one error entry per problem** (a row can have several) | live probe: 1 bad row → pill basis 1, correct | BUG (minor) — pill says "rows" but counts error messages: a row with no name AND a bad email produces 2 errors, so the pill shows "2 rows need attention" for 1 row (behavior pinned by migrate.test.ts:199-200). Should count distinct `e.row`. Fix is local (client: `new Set(preview.errors.map(e=>e.row)).size`). |
| Column mapping selects (`select-map-displayName`, `-firstName`, `-lastName`, `-companyName`, `-email`, `-phone`, `-altPhone`, `-addressLine1`, `-city`, `-state`, `-postalCode`, `-notes` for Clients; `-customerName`, `-customerEmail`, `-title`, `-number`, `-status`, `-total` for Estimates; same plus `-paid` for Invoices) | Select ×12/6/7 | Each dropdown picks which file column feeds that field ("— skip —" = don't import it). Initial values come from the server's auto-guess. | client/src/pages/crm-migrate.tsx:289-309; FIELDS list :34-66 (keys exactly mirror server MIGRATE_FIELDS, migrate-lib.ts:111-143) | guessMapping: exact alias hit wins, else unique-prefix fallback, never two fields on one column (migrate-lib.ts:155-182) | live probes | OK for the selects themselves — **but see BUG below: the server's guess behind these dropdowns is wrong for "Customer Email"/"Client Email" headers** |
| (server auto-guess behind the selects) | — | The pre-filled mapping shown above. | — | server/crm/migrate-lib.ts:155-182 `guessMapping`: fields processed in declaration order; customerName's prefix fallback (`h.startsWith("customer")`/`"client"`) claims the "Customer Email"/"Client Email" header **before** customerEmail's exact alias is considered | live probe `entity:invoices, headers:"Customer Email,Invoice #,Total,Paid"` → response `mapping: {customerName:"Customer Email", customerEmail:null, …}`; same for "Client Email" with estimates | BUG — every standard Jobber/QuickBooks export whose only client identifier is a "Customer Email"/"Client Email" column gets `customerEmail: null` out of the box. The email lands in customerName, the preview still says "all rows valid" (validation passes because customerName is non-empty), and an import run as-guessed fails every row with `no client in your CRM matches "<the email>"` (migrate.ts:163/210 — resolveCustomer looks the email string up as a display name). A diligent user can correct the dropdowns manually, but the default guess is wrong and self-confidently validated. Test suite misses it because migrate.test.ts:282 passes the mapping explicitly. Root cause: single-pass greedy matching at migrate-lib.ts:161-173; fix is local and clear (claim all exact alias matches across fields first, run the prefix fallback only on unclaimed headers). |
| Preview sample table (`table-preview`, rows `preview-row-1`…`preview-row-8`) | Table | Shows the first 8 file rows remapped through your column choices, so you can eyeball what's about to import. | client/src/pages/crm-migrate.tsx:311-340 (`mappedPreview` slices `preview.rows` to 8, :185) | data from the preview response (raw parsed rows echoed back, migrate.ts:321) | slice matches "first 8" note | OK |
| Row-number cell + amber warning icon (title tooltip) | Icon + tooltip | The ⚠ flags which sample rows had validation problems; hover shows the messages. | client/src/pages/crm-migrate.tsx:324-331 (`errorByRow`, :195-201) | client only | code | OK |
| "Showing the first 8 of {n} rows." | Static text | Tells you the table is a sample when the file is bigger. | client/src/pages/crm-migrate.tsx:341-343 | client only | matches `slice(0, 8)` at :185 | OK |
| Error banner (`text-preview-errors`) | Banner | Lists the first 5 row problems ("#2 invalid email …"); warns they're skipped on import, not fatal — which is exactly what the import endpoint does (per-row `status:"error"`, migrate.ts:385-388). | client/src/pages/crm-migrate.tsx:345-352 | server errors from validateRecord (migrate-lib.ts:248-268) | live probe error text matches | OK |
| "No data rows found" banner (`text-preview-no-rows`) | Empty state | Appears when the file had a header but zero data rows; import button is disabled in that case (`:366`). | client/src/pages/crm-migrate.tsx:354-363 | client only | code | OK |
| "Import {n} rows" button (`button-run-import`) | Button | Imports every parsed row with the current mapping. Per row: clients are created in your org unless an active client already matches on email (case-insensitive) or digit-normalized phone (then skipped, or created with server-side `?force=1` which this UI never sends); estimates/invoices attach to an existing client by email then exact name, take the file's document number unless already used (then skipped), otherwise the next number from the shared E-/INV- allocator under lock. Money is integer cents; a "$12,345.67" total becomes a single "Imported total" line item and recalc runs for estimates. Server returns per-row created/skipped/error. | client/src/pages/crm-migrate.tsx:365-371 → doImport :155-172 | POST /api/crm/migrate/import → server/crm/migrate.ts:332-441 → inserts `crm_customers` (org_id, owner_member_id, portal_token) / `crm_estimates`+`crm_estimate_items` / `crm_invoices`+`crm_invoice_items`; dedupe migrate.ts:43-55; numbering migrate.ts:109-122 via doc-number.ts (NOT a count-based fallback); unique-violation 23505 on (org_id,number) → skipped :415-421 | endpoint probed only up to 400 validation (bad entity, empty rows — no writes, per assignment no import was run); write behavior verified by reading migrate.ts + pinned by server tests migrate.test.ts:203-295 (dupe-skip, ?force=1, phone dedupe, estimate attach, $12,345.67→1234567¢) | OK (endpoint correct) — **but see BUG below: invoices cache is never refreshed after an invoice import, and the server's actionable `hint` is never shown** |

### Card 3 — "3 · Import finished" (appears only after import)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "{created} created" pill (in `text-import-summary`) | Count pill | How many rows were written to your CRM. | client/src/pages/crm-migrate.tsx:383-384 (`result.created`) | migrate.ts:353-357,411 — number of rows whose insert succeeded, this request only | code (counting own writes; not SQL-verifiable without an import, which was prohibited) | OK |
| "{skipped} skipped (duplicates)" pill | Count pill | How many rows were NOT written because they already exist (client email/phone match, or document number already in use). | client/src/pages/crm-migrate.tsx:385 | migrate.ts:394-395,407-408,418-419 | code + tests migrate.test.ts:203-243 | OK for the count — **but the server's advice about what to do about skips is silently dropped, see next row** |
| Server `hint` (never rendered) | (invisible) | When rows are skipped the server sends a human sentence: for clients "Re-run with ?force=1 to create them anyway", for documents "Clear or change those numbers in the file to import them." (migrate.ts:428-440). The client declares the field in its ImportResponse type (:85) but no JSX ever prints it, and no button/control exists to re-run with force. | client/src/pages/crm-migrate.tsx:80-86 (type only); render block :377-418 uses just created/skipped/errors/results | same response | grep: only occurrence of `hint` in the page is the type declaration | BUG — the owner sees "N skipped (duplicates)" plus per-row messages, but never the explanation/remedy the server wrote; the suggested `?force=1` re-run is impossible from this UI (client never sends `force`). Fix is local: render `result.hint` under the pills (and optionally add a force affordance). |
| "{errors} errors" pill | Count pill | How many rows failed and were not imported. | client/src/pages/crm-migrate.tsx:386-388 | migrate.ts:427 | code | OK |
| Per-row details list (`text-import-details`) | List | One line per non-created row (max 50 shown): "Row 4: skipped — already exists as …". | client/src/pages/crm-migrate.tsx:390-402 | result.results from migrate.ts | code | OK |
| "View your clients →" link (`link-view-clients`) | Link | Goes to the Clients list (shown only after a client import). | client/src/pages/crm-migrate.tsx:404-409 | route /crm/clients exists at client/src/App.tsx:395 | App.tsx:395 | OK |
| "← Import another file" (`button-import-another`) | Button | Resets the wizard back to step 1 for the same entity type. | client/src/pages/crm-migrate.tsx:410-414 → reset(:104) | client only | code | OK |
| Query cache refresh after import | (side effect) | After a successful import the page tells the app to refetch the affected list so new records show up. Customers → `/api/crm/customers` invalidated; estimates → `/api/crm/estimates` invalidated (prefix-match covers the documents page's `/api/crm/estimates?…` keys, crm-documents.tsx:265). **Invoices → nothing.** | client/src/pages/crm-migrate.tsx:165-169 | — | code: no `entity === "invoices"` branch; /crm/invoices reads `/api/crm/invoices?…` keys (crm-documents.tsx:92,265) | BUG (minor, self-healing) — after an invoice import the invoices list isn't invalidated; with React Query's default staleTime 0 it refetches on next mount, so impact is stale data only in already-open tabs. One-line fix mirroring the estimates line. |

### Card 4 — "Coming from Jobber, Leap, or QuickBooks Online?" (assisted path)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Which system are you on?" select (`select-assisted-system`) | Select | Picks the old system: Jobber / Leap / QuickBooks Online / Housecall Pro / Something else. | client/src/pages/crm-migrate.tsx:442-456 | options must match server ASSISTED_SYSTEMS keys (migrate.ts:269-275) — they do, 1:1 | Playwright: 5 options render; bad-key probe → 400 listing exactly these 5 | OK |
| "Anything we should know?" textarea (`textarea-assisted-note`) | Text input | Optional free-text note (max 2000 chars enforced server-side, migrate.ts:456) sent along with the request. | client/src/pages/crm-migrate.tsx:457-462 | passed through to the email body (HTML-escaped, migrate.ts:466) | code | OK |
| "Request a hands-on migration" button (`button-request-assisted`) | Button | Emails ConstructHub's team (support@constructhub.us) with your org name, the system you picked and your note; then shows the confirmation panel. On failure toasts "Request not sent" with the server's fallback message (email us directly). | client/src/pages/crm-migrate.tsx:464-473 → requestAssisted :174-179 | POST /api/crm/migrate/assisted → server/crm/migrate.ts:447-477 → sendWithFallback (server/email.ts) to ADMIN_EMAIL, subject "Migration assist requested: {system} → {org name}"; no DB writes; 400 bad system (validated before any email), 502 on email failure | probed with invalid system → 400 before email (no email sent); valid press NOT exercised (would email outside the local env) — endpoint, method, body, and failure path verified by code | OK (by code) |
| "This emails our team — we'll reach out within 1 business day." | Static text | Sets the expectation. The same 1-business-day promise is in the email the server sends (migrate.ts:467), so the promise travels with the request. | client/src/pages/crm-migrate.tsx:470-472 | same | code | OK |
| Confirmation panel (`text-assisted-confirmation`) | Success state | After the request is accepted: "Request received. We'll reach out within 1 business day…" Replaces the form. | client/src/pages/crm-migrate.tsx:427-438 | client only | code | OK |

---

## Summary

- **Total element rows audited: 33** (page has no DB-backed stats; every pill/counter traces to the uploaded file or the import response).
- **OK: 29** — header + info dialog; all three entity cards, file input + its two limit toasts, Preview button (live 200, auto-map + validation verified), "{n} rows" pill, the mapping selects themselves, the preview table + first-8 note, error banner, no-rows state, Import button (write semantics verified by code + server tests, not executed), all three result pills' counts, details list, "View your clients" link (route exists), "Import another file", all 5 assisted-path elements (endpoint verified up to the email boundary by code; invalid-system 400 probed live).
- **BUG: 4**
  1. **Auto-mapping mis-assigns "Customer Email"/"Client Email"** — server `guessMapping` (server/crm/migrate-lib.ts:155-182) lets customerName's prefix alias "customer"/"client" steal the email column before customerEmail's exact alias is considered → `customerEmail: null` → every estimate/invoice row errors at import ("no client in your CRM matches"). Proven live via POST /api/crm/migrate/preview. Fix local + clear (exact-match-first pass).
  2. **"{n} rows need attention" counts problems, not rows** (client/src/pages/crm-migrate.tsx:284-286 + server error-per-problem at migrate.ts:315-319). Overstates when one row has 2+ issues. Trivial client fix.
  3. **Server's skip-remedy `hint` never displayed** (client/src/pages/crm-migrate.tsx:85 declares it; nothing renders it; no force path exists in the UI; server computes it at migrate.ts:435-439).
  4. **Invoices list not invalidated after an invoice import** (client/src/pages/crm-migrate.tsx:167-168 handle customers/estimates only). One-line fix.
- **UNCLEAR: 0.** **DEAD: 0.**
- Not executed by assignment: a real import (endpoint verified by code + migrate.test.ts:203-312) and a valid assisted request (emails an outside address; request shape and both non-happy paths verified).
- Route without doc comment: `/crm/migrate` at client/src/App.tsx:415 (the adjacent `/admin` route at :417 has one) — candidate for a doc comment.


# Section 13 — Legal pages audit

## CRM Terms of Service & Privacy Policy (/crm-terms, /crm-privacy)

**Component:** `client/src/pages/crm-legal.tsx` → exports `CrmTermsPage` and `CrmPrivacyPage`, wrapped in the shared `LegalShell`.

**Scope note (important):** despite the assignment title "Legal/contracts page", this file contains **no contracts UI** — no tabs, no document lists, no counts, no statuses, no signing actions. It is two pages of static legal text (Terms of Service §1–§10 and Privacy Policy §1–§10). The actual contracts/documents UI lives in `client/src/pages/crm-documents.tsx` and `client/src/pages/contract-sign.tsx`, which are separate pages/routes assigned elsewhere. Accordingly there are **no database-backed numbers to verify with SQL**: the component imports only `useEffect` and `CrmLogo` (a pure SVG/span lockup, `client/src/components/crm-logo.tsx` — no fetch), and the pages make **zero API calls** and read **zero tables**. The only "number" on either page is the hard-coded effective date.

**Routes (all exist in `client/src/App.tsx`, rendered for every host switch):** `/crm-terms` → `CrmTermsPage` (App.tsx:227, 238, 323, 421, 447, 473 + location checks :539, :603, :670); `/crm-privacy` → `CrmPrivacyPage` (App.tsx:228, 239, 324, 422, 448, 474 + :540, :604, :671). Both are in `SELF_TITLED` (App.tsx:358) so the document title set by `LegalShell` (`<title> | ConstructHUB CRM`, crm-legal.tsx:16-18) is not overridden. Both routes return HTTP 200 on the dev server and render fully in a real browser (Playwright/chromium, `ch_consent=denied`).

The source file's own docblock (crm-legal.tsx:10) says **"DRAFT for attorney review before being represented as final legal terms"** while the page presents a firm "Effective Date: September 30, 2026". Noted as an observation for the owner — flagged UNCLEAR below, not a data bug.

### Shared page chrome (LegalShell — present on both pages)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| ConstructHUB CRM logo (testid `link-legal-home`) | Link | Clicking the logo at the top goes to the site's home page (full page reload, plain `<a>`). On the portal host that is the CRM home; on the marketing host it is the landing page. | client/src/pages/crm-legal.tsx:22-24 | client only: `<a href="/">`; `/` → `CrmHomePage` on portal host (App.tsx:392), `HomePage`/`LandingPage` on public hosts (App.tsx:166, :288) | Playwright render: href `/` present; route `/` in App.tsx:166/:288/:392/:472; GET / → 200 | OK |
| Page H1 ("Terms of Service — ConstructHUB CRM" / "Privacy Policy — ConstructHUB CRM") | Static text | The page's main heading; also sets the browser tab title via `document.title`. | client/src/pages/crm-legal.tsx:16-18, :25, :57, :190 | client only: `useEffect` sets `document.title = "<title> | ConstructHUB CRM"` | Playwright render: title = "Terms of Service — ConstructHUB CRM \| ConstructHUB CRM" and "Privacy Policy — ConstructHUB CRM \| ConstructHUB CRM" | OK |
| "Effective Date: September 30, 2026" | Static text | The date these legal terms took effect, shown under the heading. | client/src/pages/crm-legal.tsx:13, :26 | client only: hard-coded string constant `EFFECTIVE`; no database value exists to compare against | Playwright render: exact string "Effective Date: September 30, 2026" on both pages; matches source constant | OK |
| "Questions? support@constructhub.us" (mailto link) | Link | Opens the user's email app addressed to ConstructHUB support. Footer line also states "support is by email only". | client/src/pages/crm-legal.tsx:30 | client only: `<a href="mailto:support@constructhub.us">`; no server contact | Playwright render: mailto href present on both pages | OK |
| Footer "Home" (testid `link-legal-footer-home`) | Link | Footer link back to the home page (same target as the logo). | client/src/pages/crm-legal.tsx:33 | client only: `<a href="/">` → routes per host as above | Playwright render: href `/`; GET / → 200 | OK |
| Footer "Terms of Service" | Link | Footer link to the CRM Terms of Service page (self-link on /crm-terms). | client/src/pages/crm-legal.tsx:35 | client only: `<a href="/crm-terms">` → `CrmTermsPage` (App.tsx:227 et al.) | Playwright render: href `/crm-terms`; GET /crm-terms → 200 | OK |
| Footer "Privacy Policy" | Link | Footer link to the CRM Privacy Policy page (self-link on /crm-privacy). | client/src/pages/crm-legal.tsx:37 | client only: `<a href="/crm-privacy">` → `CrmPrivacyPage` (App.tsx:228 et al.) | Playwright render: href `/crm-privacy`; GET /crm-privacy → 200 | OK |

### /crm-terms — Terms of Service body (testid `page-crm-terms`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Page container (testid `page-crm-terms`) | Container | The whole Terms page wrapper; confirms you are on the Terms route. | client/src/pages/crm-legal.tsx:57 | client only | Playwright render: `data-testid="page-crm-terms"` present | OK |
| Section headings 1–10 ("What the service is (and is not)" … "Changes and governing law") | Static text | The ten numbered sections of the CRM Terms. Pure legal copy; nothing clickable except the one inline link below. | client/src/pages/crm-legal.tsx:71-181 | client only: static JSX | Playwright render: exactly 10 `<h2>` headings, texts match source §1–§10 in order | OK |
| Body paragraphs and list items of §1–§10 | Static text | The legal text itself (service description, email-security rules, payments via Stripe, disclaimers, liability cap, etc.). | client/src/pages/crm-legal.tsx:58-181 | client only: static JSX | Playwright render: page text present; no scripts/data bindings in source (verified by full file read) | OK |
| Inline link "ConstructHUB Terms of Use" (testid `link-crm-terms-plans`) — in §1 | Link | Jumps from the CRM Terms to the separate platform-wide Terms of Use (the marketing-site legal doc about plans/billing). | client/src/pages/crm-legal.tsx:85 | client only: `<a href="/terms">` → `TermsOfUsePage` (App.tsx:230, :326) | Playwright render: href `/terms`; GET /terms → 200 | OK |
| File header "DRAFT for attorney review…" | (not rendered) | Source-code-only comment warning that these terms are a draft not yet attorney-reviewed — but the live page shows a firm "Effective Date" and no draft notice. | client/src/pages/crm-legal.tsx:10-11 | n/a — not a visible element | code only (full file read) | UNCLEAR — legal/copy decision for the owner, not a data defect |

### /crm-privacy — Privacy Policy body (testid `page-crm-privacy`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Page container (testid `page-crm-privacy`) | Container | The whole Privacy page wrapper; confirms you are on the Privacy route. | client/src/pages/crm-legal.tsx:190 | client only | Playwright render: `data-testid="page-crm-privacy"` present | OK |
| Section headings 1–10 ("The short version" … "Changes") | Static text | The ten numbered sections of the CRM Privacy Policy. | client/src/pages/crm-legal.tsx:199-333 | client only: static JSX | Playwright render: exactly 10 `<h2>` headings, texts match source §1–§10 in order | OK |
| §1 "The short version" bullet list (5 bullets: no data selling, opt-in-only texts, client-data visibility, Stripe handles cards, encrypted/Cloudflare) | Static text | The plain-English summary bullets at the top of the policy. | client/src/pages/crm-legal.tsx:200-206 | client only: static JSX | Playwright render: list present with 5 items | OK |
| Body paragraphs of §2–§10 | Static text | The policy text (what is collected, SMS consent, cookies, retention, children). Contains inline `<code>` tokens `ch_vid` and `ch_consent` (display-only). | client/src/pages/crm-legal.tsx:191-334 | client only: static JSX | Playwright render: text present incl. `ch_vid`/`ch_consent` tokens | OK |
| §7 factual claim: consent answer "remembered in a `ch_consent` cookie for a year" | Factual claim inside static text | States the consent cookie lasts one year. | client/src/pages/crm-legal.tsx:306 | POST /api/analytics/consent → server/analytics.ts:73-86 → Set-Cookie `ch_consent=granted\|denied; Max-Age=31536000` (=365 days, "1 year") at server/analytics.ts:49,75 | code: server/analytics.ts:46-50 (consentOpts Max-Age=31536000) matches the written claim | OK |
| §7 factual claim: Accept "sets a first-party analytics cookie (`ch_vid`, a random visitor id)" | Factual claim inside static text | States Accept generates a random visitor id cookie. | client/src/pages/crm-legal.tsx:302 | POST /api/analytics/consent → server/analytics.ts:76-79 → `ch_vid=<server-minted UUID>; Max-Age=31536000; HttpOnly` | code: server/analytics.ts:52-56,79 — `randomUUID()`, UUID-format enforced, HttpOnly | OK |
| §7 factual claim: Decline → "no analytics cookie is set and nothing is recorded" | Factual claim inside static text | States declining sets no tracking and records nothing. | client/src/pages/crm-legal.tsx:307 | POST /api/analytics/consent (granted=false) → server/analytics.ts:80-83 drops `ch_vid` (Max-Age=0); POST /api/analytics/events → server/analytics.ts:88-94 returns `{recorded: 0}` unless `ch_consent === "granted"` AND a minted `ch_vid` | code: server/analytics.ts:80-83, 93-94 matches claim | OK |
| §2/§4 factual claims: shortened IP, Stripe-only card data, SignalWire for calls/texts | Factual claim inside static text | States IPs are shortened and card/bank details never touch ConstructHUB servers. | client/src/pages/crm-legal.tsx:222-224, :303-304 | POST /api/analytics/events → server/analytics.ts `anonymizeIp` (server/analytics.ts:64-70: IPv4 /24, IPv6 /48) matches "shortened IP address"; Stripe-handling claim is architectural (stripe integration elsewhere), no server code here touches card data | code: server/analytics.ts:64-70 for the IP claim; rest code-only (out of this page's backend) | OK |

### Summary

- **Total elements audited: 20** (7 shared chrome + 5 Terms + 8 Privacy).
- **OK: 19, BUG: 0, DEAD: 0, UNCLEAR: 1** (the "DRAFT for attorney review" comment vs. the firm effective date — an owner decision, not a data defect).
- **SQL verification:** not applicable — this page performs no database reads and shows no account/org-dependent numbers; confirmed by full-file read (imports limited to `useEffect` + `CrmLogo`, the latter a pure SVG component). There is nothing on this page that *could* disagree with the database.
- **API verification:** not applicable — the pages make no API calls. The only backend the policy text *describes* (analytics consent/events) was verified by code against `server/analytics.ts` and matches the written claims.
- **Links:** all 5 distinct targets (`/`, `/terms`, `/crm-terms`, `/crm-privacy`, `mailto:support@constructhub.us`) verified — every route exists in `client/src/App.tsx` and returns 200 on the dev server; rendered hrefs confirmed in a real browser.
- Inbound references (outside this page, verified by grep): `/crm-terms` and `/crm-privacy` are linked from the client portal footer (`client-portal.tsx:148-150, :776-778`), the auth page (`auth.tsx:236-237`), the CRM settings footer (`crm-settings.tsx:2195-2197`) and the SMS-settings section (`crm-settings.tsx:1289`), and the cookie banner points portal visitors at `/crm-privacy` (`cookie-consent.tsx:76-77`). All resolve.


## Join the team (/crm/join)

Page: `client/src/pages/crm-join.tsx` — landing page for a team-invitation email link (`/crm/join?token=…`).
Registered twice in `client/src/App.tsx` — signed-in portal router `App.tsx:420` and signed-out portal router `App.tsx:454` — so the link works both logged in and logged out. Document title "Join the team" via `App.tsx:629`.

The page has no stats or tiles; the only data it shows is the invitation's email, role and inviting company name, which come from `GET /api/crm/invitations/lookup/:token` (`server/crm/routes.ts:1126`), joined to `crm_orgs.name`. There is no org scoping issue on lookup (the token *is* the scope). The accept endpoint is `POST /api/crm/invitations/accept` (`server/crm/routes.ts:1142`).

Live verification (all against dev DB `constructhub_dev_a6`, http://127.0.0.1:8305):
- `GET /api/auth/me` → 200, user id 1 `dev@constructhub.local` — matches `users` row.
- `GET /api/crm/invitations/lookup/<revoked-token>` → 404 `{"message":"Invitation not found"}` — DB row `2a64bef0…` has `revoked_at` set. Matches.
- `GET /api/crm/invitations/lookup/<accepted-token>` → 409 `{"message":"This invitation has already been used"}` — DB row has `accepted_at` set. Matches.
- Created AUDIT- invitation via `POST /api/crm/invitations` → 201, `link: http://127.0.0.1:8305/crm/join?token=…`, `expires_at` = created + 14 days in DB; invite email captured by the dev SMTP sink (`server/email.ts:208 sinkToOutbox` → `tmp/email-outbox.jsonl`), nothing sent externally.
- `GET /api/crm/invitations/lookup/<fresh-token>` → 200 `{"email":"audit-join-042d31@example.com","role":"field","orgName":"SKU Dry-Run"}` — exactly matches `crm_invitations` joined to `crm_orgs`.
- `POST /api/crm/invitations/accept` {token, phone} signed in as the wrong account → 403 `"This invitation was sent to audit-join-042d31@example.com. Sign in as that account to accept it."` — the email-binding check at `server/crm/routes.ts:1164`.
- Cleanup: `DELETE /api/crm/invitations/<id>` → 200; both AUDIT invites now `revoked_at` set and their `crm_members` placeholder rows (status `invited`) deleted — seat released. `SELECT count(*) FROM crm_members WHERE email LIKE 'audit-join%'` → 0.
- Rendered all three page states in Chromium (screenshots in `shots/join/`): missing-token card, bad-token error card, valid-invite card — all match the code below.

---

### Container: page header (all states)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| BrandMark — hard-hat icon + "ConstructHub CRM" | branding | Shows the product logo above the card. Pure decoration. | client/src/pages/crm-join.tsx:19-30 | client only: static markup | screenshot 01/02/03 | OK |

### Container: "Missing invitation link" card (when the URL has no ?token)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Card title "Missing invitation link" + body text | empty state | Tells the visitor the link from their email is incomplete and to use the real invitation link. No buttons — nothing else to do on this state. | client/src/pages/crm-join.tsx:82-96 | client only: no request made when token is absent (lookup query is `enabled: !!token`, crm-join.tsx:54) | screenshot 01-missing-token.png | OK |

### Container: join card — header (token present, any outcome)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| UserPlus icon + title "Join the team" | header | Static card header. | client/src/pages/crm-join.tsx:103-107 | client only | screenshots 02, 03 | OK |
| Description `text-invite-description` | text | One line under the title: "<org name> invited you to ConstructHub CRM." when the token checks out; "This invitation link can't be used…" when the server rejects it; "Checking your invitation…" while loading; a generic "You've been invited…" as the pre-load placeholder. | client/src/pages/crm-join.tsx:108-116 | data from `GET /api/crm/invitations/lookup/:token` → server/crm/routes.ts:1126 — `crm_invitations` row by unique `token`; rejects with 404 if missing/revoked, 409 if `accepted_at` set, 410 if `expires_at < now()` (server clock, UTC); on success returns `orgName` from `crm_orgs.name` (`?? null`) | GET lookup live: 200 "SKU Dry-Run invited you…" with matching DB row; 404/409 messages rendered verbatim in screenshots 02/03 | OK |
| Loading spinner (Loader2) | indicator | Spins while the invitation lookup is in flight. | client/src/pages/crm-join.tsx:119-123 | client only | code only (transient) | OK |
| Error box `text-invite-error` | banner | Red box quoting the server's sentence for a dead link: "Invitation not found" (bad/revoked token), "This invitation has already been used" (accepted), "This invitation has expired" (older than 14 days). Never shows raw JSON. | client/src/pages/crm-join.tsx:125-131 | server messages verified live (404, 409 above); 410 path code-verified at server/crm/routes.ts:1134 — no expired-but-pending invite existed to press it | GET lookup live (404/409 match DB state); screenshot 02; 410 code only | OK |

### Container: dead-link escape buttons (shown only when the lookup failed)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Go to my dashboard" `button-invite-error-home` (signed-in visitors only) | button | Takes a signed-in user whose link is dead to their own workspace home so they aren't stranded. | client/src/pages/crm-join.tsx:135-140 → `navigate("/")` | client only: route `/` → CrmHomePage, App.tsx:392 | route exists in App.tsx:392; button visible in screenshot 02 | OK |
| "Go to sign in" `button-invite-error-signin` (signed-out visitors only) | button | Takes a signed-out visitor to the login screen (without a return link, since the invite is dead anyway). | client/src/pages/crm-join.tsx:141-147 → `window.location.href = "/auth?mode=login"` | client only: route `/auth` → AuthPage, App.tsx:428 (signed-in router) and App.tsx:455 (public router) | route exists in App.tsx:428,455; code only (dev bypass always signs in, so the signed-out branch can't render here) | OK |

### Container: invitation summary box (valid invite)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Invitation for <email>" | text | Shows the exact email address the invitation was sent to — the account you must sign in with. | client/src/pages/crm-join.tsx:153-156 | `crm_invitations.email` from the lookup (stored lowercased at create, server/crm/routes.ts:966) | live: page showed `audit-join-render1b@example.com`, matching DB row; screenshot 03 | OK |
| "Role" status pill | badge | Shows the team role the admin picked for you (e.g. "sales" in amber — roleTone map: owner violet, admin blue, sales/field amber, pm teal, office green; client/src/components/crm-ui.tsx:207-224). | client/src/pages/crm-join.tsx:157-160 | `crm_invitations.role` from the lookup | live: DB role `sales`, pill "sales" rendered; screenshot 03 | OK |

### Container: phone input (valid invite)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Label "Your direct phone number *" + input `input-join-phone` | input | Your direct line, required before the Accept button turns on. Kept in page state and sent with the accept request; the button stays disabled until you type at least 7 digits. | client/src/pages/crm-join.tsx:162-165, disable rule at :177 | sent as `phone` in `POST /api/crm/invitations/accept`; server (routes.ts:1149-1188) trims, strips non-digits, requires 7–15 digits, rejects all-same-digit numbers, and falls back to the placeholder member's stored phone if the field is left blank | rendered in screenshot 03 (empty → Accept disabled); button body shape matches server; validation limits code-verified (a wrong-account accept 403s before phone checks, so the 400s couldn't be pressed safely) | OK |
| Hint "Clients on your jobs see this — they need to know exactly who to reach." | text | Explains why the phone number is mandatory. | client/src/pages/crm-join.tsx:166-168 | client only | screenshot 03 | OK |

### Container: signed-in actions (valid invite + session present)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Signed in as <email>…" note | text | Shows the account you're signed in with, and adds "This invitation was sent to <other email> — sign in with that account to accept." when they don't match (case-insensitive comparison). | client/src/pages/crm-join.tsx:171-175 | `GET /api/auth/me` → server/auth.ts:668 — fresh row from `users` (id, email, displayName…) or `null` when signed out | live: note rendered "Signed in as dev@constructhub.local. This invitation was sent to audit-join-render1b@example.com…"; screenshot 03 | OK |
| "Accept invitation" `button-accept-invite` | button | Claims the invite: sends token + phone; on success shows "Welcome aboard" and drops you on Team & Company for the new org. If the server says 401 (session expired) it sends you to sign in and then back here; any other failure (already used, expired, wrong account, bad phone) pops the server's message in an error toast. Button is greyed out while sending or until the phone field has ≥7 digits. | client/src/pages/crm-join.tsx:176-180; mutation :64-80; 401 redirect :71-77 | `POST /api/crm/invitations/accept` {token, phone} → server/crm/routes.ts:1142: re-validates invite (404/409/410), binds to `users.email` of the signed-in account (403 on mismatch, :1164), validates phone (:1149-1188), then atomically flips `crm_invitations.accepted_at` (:1194-1201, single-use race guard), updates the pre-created `crm_members` placeholder row (status→active, user_id, phone) or inserts a new active `crm_members` row (:1203-1228), writes an activity row, sets session activeOrgId to the inviting org (:1239) | endpoint + body verified live: POST → 403 with the exact invite email (wrong account, routes.ts:1164); success path (200/claim/member upsert) code-verified and covered by server/crm/invite-accept.test.ts — pressing it for real would need a second account, which I did not create; post-accept refresh target `GET /api/crm/me` exists (server/crm/routes.ts:404, standard query key confirmed); landing route `/crm/team` exists at App.tsx:411 | OK |

### Container: signed-out actions (valid invite + no session)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "First, sign in (or create an account) as <email>…" note | text | Tells the invitee which account to use before accepting. | client/src/pages/crm-join.tsx:183-187 | client only (data from lookup) | code only (dev bypass always signs in; branch chosen by the same `me` query verified live) | OK |
| "Create my account" `button-join-create-account` | button | Goes to the sign-up screen carrying a "come back to this invite afterwards" address. | client/src/pages/crm-join.tsx:188-191 → `/auth?mode=signup&next=<encoded /crm/join?token=…>` | client only: route `/auth` → AuthPage (App.tsx:455). AuthPage validates `next` against a same-site regex (auth.tsx:41) and, once signed in, routes back to it (auth.tsx:48). | route exists App.tsx:455; next-regex accepts the join URL (code-verified); return-to-next logic at auth.tsx:48 | OK |
| "I already have an account — sign in" `button-join-signin` | button | Goes to the sign-in screen, again carrying the return address so you land back on this invite ready to accept. | client/src/pages/crm-join.tsx:192-195 → `/auth?mode=login&next=…` | client only: same `/auth` route | route exists App.tsx:455; same auth.tsx:41/48 return path | OK |

---

### Notes / things I could not press

- No numbers, counts, or time-windowed stats exist on this page — nothing to reconcile against SQL beyond the email/role/orgName lookup, which matched exactly.
- 410 "This invitation has expired" (lookup and accept) is code-verified at server/crm/routes.ts:1134 and :1155 but not pressed live: no expired-but-pending invitation row exists in the DB and I may not fabricate one (read-only).
- The successful accept (200) was not pressed: it would flip `accepted_at` and create a real membership, which needs a real second account — out of audit bounds. The claim/upsert path is covered by `server/crm/invite-accept.test.ts` and read line-by-line.
- The signed-out rendering (create-account / sign-in buttons) can't render on this dev server because the dev bypass auto-authenticates; the branch condition is the same `/api/auth/me` query verified returning the dev user.
- Accept-button enable-on-phone-typing is code-verified (disable rule crm-join.tsx:177); a Playwright `fill` to photograph the enabled state hung on the SPA's refetch loop, and the logic is a one-line digit count.
- After accept, the server also pins `session.activeOrgId` to the inviting org (server/crm/routes.ts:1239), so landing on `/crm/team` shows the new company's team, not the old one — consistent with the "Welcome aboard" flow.

### Routes used by this page with no doc comment in App.tsx (doc-comment candidates)

- `client/src/App.tsx:420` — `<Route path="/crm/join" component={CrmJoinPage} />` in the signed-in PortalRouter (the comment above it at :417-419 belongs to `/admin`). This is the invitation-acceptance page reached from invite-email links.
- `client/src/App.tsx:454` — same route in PortalPublicRouter (no comment; the surrounding comments explain the *other* public routes).
- Secondary target: `client/src/App.tsx:411` — `/crm/team` (Team & Company), the post-accept landing, also has no doc comment.


## Platform admin (`/crm/admin` and `/admin`)

The platform-admin console: read-only monitoring across every account/org on the platform, plus beta-invite issuing. Rendered inside its own full-bleed shell (no workspace sidebar) for both routes — `client/src/App.tsx:579-599` wraps `CrmAdminPage` in a "Platform Admin" header with a back link; the bare routes are `client/src/App.tsx:416` (`/crm/admin`) and `client/src/App.tsx:419` (`/admin`). Access is gated twice: `isPlatformAdmin` from `GET /api/crm/me` (client hides the page) and `requirePlatformAdmin` on every `/api/admin/*` route (`server/crm/admin.ts:97` — checks the account email against `server/admin.ts` list, then the passphrase gate session when `ADMIN_GATE_USER/PASS` are configured). On this dev box the gate is not configured (`GET /api/admin/gate` → `{gateConfigured:false}`), so all data queries run; every endpoint returned 200 for the dev admin and is 403 for anyone not on the email list (code-verified, not pressed).

All numbers below were recomputed with SQL on `constructhub_dev_a6` and compared against the live API (`curl` against `http://127.0.0.1:8305`). Data in this DB is being actively written by other testers, so API-vs-SQL comparisons were sampled back-to-back; one apparent mismatch during sampling (SKU Dry-Run customers 9878 vs 9879) disappeared on an immediate re-read and was concurrent churn, not a bug.

Server clocks: the Node server runs in UTC; Postgres session TZ is EDT. "day" columns render in the browser's local time zone; analytics windows are rolling (`Date.now() − 24h/7d`, UTC) and Hub windows are UTC calendar days. All overview/org/user counts are **all-time totals with no time window and no org filter** — this is a cross-org console, so that is correct here.

### Admin shell (both routes)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Platform Admin" badge in header | Badge | Static label showing you're in the cross-account console, not a workspace. | client/src/App.tsx:585 | client only: static markup | Playwright render: no page errors; badge visible | OK |
| "← Back to my workspace" (`link-admin-back-to-workspace`) | Link | Leaves the console and opens your own CRM workspace home. | client/src/App.tsx:589-592 | client only: `<Link href="/crm">` → route `client/src/App.tsx:393` (`/crm` → CrmHomePage) | route `/crm` exists in App.tsx:393; rendered in DOM testid list | OK |

### Gate card (only when the passphrase is configured and not yet entered)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Gate status check | (data) | Asks the server whether the second-factor passphrase is set up and whether this browser already passed it; decides if the wall shows. | client/src/pages/crm-admin.tsx:125-128 | GET `/api/admin/gate` → `server/crm/admin.ts:162` → reads env `ADMIN_GATE_USER/PASS` and `req.session.platformAdminGate`; no tables | `GET /api/admin/gate` 200 → `{"gateConfigured":false,"gatePassed":false}`; gateOpen computed as `!configured \|\| passed` = true | OK |
| Username input (`input-admin-gate-user`) | Input | Where you type the admin console username. | client/src/pages/crm-admin.tsx:271 | client only: local state | code only; card not rendered on dev (gate not configured) | OK |
| Password input (`input-admin-gate-pass`) | Input | Where you type the admin console password. | client/src/pages/crm-admin.tsx:276 | client only: local state | code only | OK |
| "Sign in" button (`button-admin-gate-login`) | Button | Sends the passphrase; on success the page reloads all admin data, on failure shows "Sign-in failed". | client/src/pages/crm-admin.tsx:279-282 | POST `/api/admin/gate` `{username,password}` → `server/crm/admin.ts:169` → SHA-256 constant-time compare against env, 8-attempt/15-min limiter per edge IP, sets `req.session.platformAdminGate=true`; no tables | code only (env not set on dev → would 409; limiter + safeEq code read) | OK |

### Overview metric tiles (`section-overview`)

Six tiles fed by `GET /api/admin/overview` (`server/crm/admin.ts:185`): raw `count(*)` over `users`, `crm_orgs`, `crm_customers`, `crm_estimates`, `crm_invoices`; payments aggregate over `crm_payments` (`count(*)` + `sum(amount_cents) where status='succeeded'`); beta users = `count(*) from users where beta_at is not null`. All-time, platform-wide, no test-row exclusions (there is no test-row flag on these tables).

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Users 11 · 0 beta" tile (`metric-users`) + click | Stat + anchor link | Shows the total number of accounts on the platform with how many are beta accounts; clicking scrolls you down to the Users list. | client/src/pages/crm-admin.tsx:313-316 | GET `/api/admin/overview` → users=`count(*) users`; betaUsers=`count(*) users WHERE beta_at IS NOT NULL` | API `users:11, betaUsers:0` = SQL `SELECT count(*) FROM users` → 11, `… WHERE beta_at IS NOT NULL` → 0; anchor target `id="card-users"` on same page (rendered in DOM) | OK |
| "Orgs 9" tile (`metric-orgs`) + click | Stat + anchor link | Total number of companies (workspaces) on the platform; clicking scrolls to the Organizations list. | client/src/pages/crm-admin.tsx:317-319 | same route → orgs=`count(*) crm_orgs` | API `orgs:9` = SQL `SELECT count(*) FROM crm_orgs` → 9 | OK |
| "Clients 13,967 · all orgs" tile (`metric-customers`) | Stat | Total customer records across every company. No click — the CRM's own Clients page only shows your workspace, so a link would mislead. | client/src/pages/crm-admin.tsx:322-323 | same route → customers=`count(*) crm_customers` | API `customers:13967` = SQL `SELECT count(*) FROM crm_customers` → 13967 | OK |
| "Estimates 9,120 · all orgs" tile (`metric-estimates`) | Stat | Total estimates written across every company. | client/src/pages/crm-admin.tsx:324-325 | same route → estimates=`count(*) crm_estimates` | API `estimates:9120` = SQL → 9120 | OK |
| "Invoices 2,995 · all orgs" tile (`metric-invoices`) | Stat | Total invoices across every company. | client/src/pages/crm-admin.tsx:326-327 | same route → invoices=`count(*) crm_invoices` | API `invoices:2995` = SQL → 2995 | OK |
| "Payments $4.3M · 1,531 charges, all orgs" tile (`metric-payments`) | Stat | Shows the total money collected platform-wide (compact format, so $4,277,670.79 renders as "$4.3M") with the number of payment records underneath. | client/src/pages/crm-admin.tsx:328-330 | same route → `payments.count = count(*) crm_payments` (ALL statuses); `payments.succeededCents = sum(amount_cents) WHERE status='succeeded'` | API `{count:1531, succeededCents:427767079}` = SQL `SELECT count(*), coalesce(sum(case when status='succeeded' then amount_cents else 0 end),0) FROM crm_payments` → `1531, 427767079` | BUG (low) |
| (loading placeholders) | (behavior) | While data loads, each tile shows "—" (`?? "—"`), never a fake 0. | client/src/pages/crm-admin.tsx:314-330 | client only | code only | OK |

**BUG (low): Payments tile mixes two filters.** The big dollar figure counts only `succeeded` payments ($4,277,670.79) but the sub-line "1,531 charges, all orgs" counts **every** row in `crm_payments`, including 5 `reversed` ($724.45 clawed back) and 1 `failed` ($50 never collected) — verified: `SELECT status,count(*),sum(amount_cents) FROM crm_payments WHERE status<>'succeeded'` → `reversed|5|72445`, `failed|1|5000`. A reader assumes the 1,531 charges sum to the $4.3M; 6 charges ($774.45, 0.02%) are in the count but not the money. Root cause: `server/crm/admin.ts:193-198` computes `count` and `succeededCents` over different filters in one query; fix is local (either count `succeeded` only or label the sub-line "1,525 successful charges").

### Site Scan leads (`section-sitescan-leads`)

Rendered by `SiteScanLeads` from `client/src/pages/site-scan.tsx:1469-1523`, fed by `GET /api/admin/sitescan-leads` → `server/sitescan/routes.ts:803`: `SELECT l.id,l.email,l.verified_at,l.created_at,j.url,j.status FROM sitescan_leads l JOIN sitescan_jobs j ON j.id=l.job_id ORDER BY l.created_at DESC LIMIT 500` — latest 500 rows, joined to the scan job for the website URL and scan status.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Site Scan leads" card + "latest 500" note | Card | Lists the emails captured by the free website-scan tool, newest first, capped at 500. | client/src/pages/site-scan.tsx:1476-1482 | GET `/api/admin/sitescan-leads` → `server/sitescan/routes.ts:803` → `sitescan_leads` ⨝ `sitescan_jobs`, `ORDER BY created_at DESC LIMIT 500` | API returned 5 leads; SQL `SELECT count(*) FROM (… LIMIT 500) t` → 5; spot-checked email/url/verified_at/status of rows against `sitescan_leads` | OK |
| Leads table rows: Email / Website / Verified / Status | Table | One row per captured lead: the email, the scanned website, "Yes" if the email was verified (double-opt-in timestamp exists), and the scan job's status (e.g. `failed`). | client/src/pages/site-scan.tsx:1496-1517 | same route; `Verified` = `verified_at IS NOT NULL` | API rows match DB values (e.g. `kimi-free@…` verified_at set → "Yes"; `kimi-free2@…` null → "No") | OK |
| "No Site Scan leads yet." empty state | Empty state | Shows when the query returns zero leads. | client/src/pages/site-scan.tsx:1490-1493 | client only | code only | OK |
| "Platform admin access required." error line | Error state | Shows if the leads query fails (e.g. you got signed out). | client/src/pages/site-scan.tsx:1484-1487 | client only | code only | OK |

### Users card (`card-users`)

`GET /api/admin/users` → `server/crm/admin.ts:216`: all `users` ordered by `created_at DESC`, plus every `crm_members ⨝ crm_orgs` membership, plus per-user plan from the `subscriptions` table. `lastActiveAt` is computed client-visible as the **max `crm_members.last_active_at` across the user's memberships** (the `users` table has no sign-in stamp — code comment at `server/crm/admin.ts:245-246`); users with no memberships get `null` → "—".

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Users — 11 accounts" section title | Stat + header | Header for the account list; the number is the full account count. | client/src/pages/crm-admin.tsx:341-344 | GET `/api/admin/users` → array length over `SELECT * FROM users ORDER BY created_at DESC` | API returned 11 rows; SQL `SELECT count(*) FROM users` → 11 | OK |
| Search box (`input-user-search`, "Search email, name or org…") | Input | Filters the table as you type — matches email, display name, or any organization name. Purely on-screen; no server round trip. | client/src/pages/crm-admin.tsx:291-298, 348-354 | client only: `filteredUsers` filter | code only; rendered in DOM | OK |
| Users table (`table-users`) — User column | Table | Avatar + display name (falls back to "—" when null, email shown underneath). | client/src/pages/crm-admin.tsx:377-385 | same route → `users.display_name`, `users.email` | all 11 API rows compared field-by-field against SQL (name/email/plan/status/last-active/beta) — ALL USER ROWS MATCH | OK |
| Users table — Plan pill | Pill | Shows "Beta" if the account has a beta timestamp; otherwise the raw plan key ("standard") when the subscription has access, else "free". | client/src/pages/crm-admin.tsx:386, 98-106 | same route → `subscriptions.plan/status` per user (`plansByUserId`, `server/crm/admin.ts:146-151`), fallback `{plan:"free",status:"inactive"}` when no row | plan/status per user match SQL join `users LEFT JOIN subscriptions` for all 11 rows | OK (see note) |
| Users table — Organizations pills | Pills | One pill per org the account belongs to, "OrgName · role" (owner/admin/office/field); "—" when the account belongs to no org. Invited-but-never-joined rows (membership `user_id` null) don't appear here. | client/src/pages/crm-admin.tsx:387-396 | same route → `crm_members ⨝ crm_orgs` filtered `user_id IS NOT NULL` (`server/crm/admin.ts:234-238`) | membership sets (orgId, orgName, role, status) for all 11 users match SQL row-for-row — ALL MEMBERSHIP ROWS MATCH | OK |
| Users table — Joined | Date | The date the account was created, in your browser's time zone. | client/src/pages/crm-admin.tsx:397 | same route → `users.created_at` | instant comparison epoch-for-epoch passed | OK |
| Users table — Last active | Date | The most recent CRM activity stamp on any of the account's memberships (not a login time); "—" for accounts with no memberships. | client/src/pages/crm-admin.tsx:398 | same route → `max(crm_members.last_active_at)` per user | `extract(epoch FROM max(…))` compared for all users — ALL INSTANTS MATCH | OK |
| "No users found" empty state | Empty state | Shows when the search filter matches nobody. | client/src/pages/crm-admin.tsx:360-361 | client only | code only | OK |
| "Couldn't load users" error line | Error state | Shows if the users query fails. | client/src/pages/crm-admin.tsx:358-359 | client only | code only | OK |

Note on the Plan pill (not scored as a bug): it renders the **raw stored plan key**. On this DB the dev account's subscription row says `plan='standard'` — a legacy key the price book maps to "Starter" (`shared/plans.ts:423`) — so the pill says "standard", a plan name that exists nowhere a customer can buy it. Faithful to the DB row, purely cosmetic; mapping it through `effectivePlanKey` would match the rest of the product's naming.

### Organizations card (`card-orgs`)

`GET /api/admin/orgs` → `server/crm/admin.ts:273`: all `crm_orgs` (newest first) with per-org `count(*)` over `crm_members`, `crm_customers`, `crm_projects`, `crm_estimates`, `crm_invoices` (grouped by `org_id`, no other filter), owner from `users`, plan from the owner's `subscriptions` row.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Organizations — 9 orgs — click one for detail" | Stat + header | Header for the company list; count is the full org count; clicking a row opens the detail drawer below. | client/src/pages/crm-admin.tsx:411 | GET `/api/admin/orgs` → array length over `SELECT * FROM crm_orgs` | API returned 9 orgs; SQL `SELECT count(*) FROM crm_orgs` → 9 | OK |
| Orgs table (`table-orgs`) — Org / Owner | Table | Company name, and the account email that owns it ("—" when the owner account was deleted; two "P-Voice smoke" orgs point at user 8170 which no longer exists and correctly show "—"). | client/src/pages/crm-admin.tsx:438-439 | same route → `crm_orgs.name`, `users.email` via `owner_user_id` | all 9 owner emails match SQL `crm_orgs LEFT JOIN users` (incl. both null-owner rows) — ALL OWNER/PLAN ROWS MATCH | OK |
| Orgs table — Plan pill | Pill | Owner's plan (same rendering as the Users table; "Beta" if the owner has a beta timestamp). | client/src/pages/crm-admin.tsx:440 | same route → owner's `subscriptions.plan/status`, fallback free/inactive | match confirmed in same check | OK |
| Orgs table — Members / Clients / Projects / Estimates / Invoices counts | Numbers | How many team members, customers, projects, estimates and invoices that org has (all-time, including disabled members and void invoices — no status filters). | client/src/pages/crm-admin.tsx:441-445 | same route → `countByOrg` = `count(*) GROUP BY org_id` on the five tables (`server/crm/admin.ts:277-283`) | per-org five-tuple compared against independent SQL subqueries for all 9 orgs — ALL ORG COUNT ROWS MATCH (incl. Alpine Exteriors Test 2/1845/738/1004/418 and SKU Dry-Run 3/9879/2437/5807/2168) | OK |
| Orgs table — Created | Date | The date the company was created, browser-local. | client/src/pages/crm-admin.tsx:446 | same route → `crm_orgs.created_at` | code only (same data path as verified counts) | OK |
| Row click (`row-org-<id>`) | Row action | Opens the org detail drawer (right-side sheet) for that company. | client/src/pages/crm-admin.tsx:436 | client only: sets `detailOrgId` → drawer query below | Playwright: clicked first row, drawer opened with seat text | OK |
| "Couldn't load organizations" error line | Error state | Shows if the org query fails. | client/src/pages/crm-admin.tsx:412-413 | client only | code only | OK |

### Beta invites card (`card-beta-invites`)

Invites are the only write actions on this page. `GET /api/admin/beta-invites` → `server/crm/admin.ts:398`: all `crm_beta_invites` newest first, `token_hash` stripped, status derived: `accepted` if `accepted_at` set, else `expired` if `expires_at < now()`, else `pending`. POST → `server/crm/admin.ts:416`: zod email check, lowercases, refuses a second live invite for the same email (409), inserts a row with `hashBetaToken(sha256 of a fresh 32-byte token)`, `expires_at = now() + 30 days` (`BETA_INVITE_DAYS = 30`, `server/crm/beta.ts:17`), emails the link via `sendWithFallback`, optionally texts it (`sendSms`, shared platform number), and returns the raw link only when email failed (so the admin can copy it). DELETE → `server/crm/admin.ts:499`: deletes the row (404 if gone, 409 if already accepted); the emailed link dies because the token hash is gone.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Beta invites" section + info tip (`info-tip-beta-invites`) | Header + help | Explains invited accounts get unlimited CRM access for the beta; the ⓘ opens a longer help text. | client/src/pages/crm-admin.tsx:459-464 | client only | testid present in rendered DOM | OK |
| Email input (`input-beta-email`) | Input | The contractor's email to invite. Required, must look like an email. | client/src/pages/crm-admin.tsx:474-482 | client only | code only | OK |
| Phone input (`input-beta-phone`, "mobile (optional)") | Input | Optional mobile number — when filled, the invite is texted as well as emailed. | client/src/pages/crm-admin.tsx:484-491 | client only | code only | OK |
| "Send invite" button (`button-send-beta-invite`) | Button | Creates the invite, emails the magic link (and texts it if a phone was given), then shows a success toast and refreshes the list. If the person already has a live invite, you get "Invite failed — already has a pending invite". | client/src/pages/crm-admin.tsx:492-495, 172-198 | POST `/api/admin/beta-invites` `{email, phone, sms}` → `server/crm/admin.ts:416` → INSERT `crm_beta_invites` (email, token_hash, invited_by_user_id, expires_at); email via `server/email.ts sendWithFallback`; SMS via `server/crm/sms.ts sendSms` | Pressed with `audit-admin-20261004@example.com`: 201, row in DB with `expires_at = created_at + 30 days`, `emailed:true` on dev; duplicate POST (different case) → 409 as designed; token_hash never leaves the server in list responses; test row deleted afterwards | OK |
| Invite link banner (`beta-invite-link`) | Banner | Only appears when the email could not be sent — shows the raw signup link so you can hand it over manually. | client/src/pages/crm-admin.tsx:498-522 | (same POST response `link`) | code only (dev email path succeeded, so banner stayed hidden — verified `lastLink` set only when `!emailed`, line 184) | OK |
| Copy button (`button-copy-beta-link`) | Icon button | Copies the shown link to the clipboard; flips to a checkmark for 1.5 s, toasts "Copy failed" if the browser refuses. | client/src/pages/crm-admin.tsx:501-520 | client only: `navigator.clipboard.writeText` | code only | OK |
| Invites table (`table-beta-invites`) — Email / Status / Sent / Expires | Table | One row per invite ever sent: the email, a status pill (pending / accepted / expired), the sent date and the expiry date (browser-local). | client/src/pages/crm-admin.tsx:530-548 | GET `/api/admin/beta-invites` → `crm_beta_invites` ordered `created_at DESC`; status = accepted_at ? accepted : (expires_at < now() ? expired : pending) | API's 4 rows match DB exactly (all `x@example.com` invites from 2026-08-01, `expires_at` in the past, not accepted → pill "expired" ✓); epochs match | OK |
| "Revoke" button (`button-revoke-beta-<id>`, pending rows only) | Button | Deletes a pending invite after a confirm dialog — the emailed/texted link stops working immediately. Accepted invites can't be revoked (button hidden). | client/src/pages/crm-admin.tsx:550-564, 201-210 | DELETE `/api/admin/beta-invites/:id` → `server/crm/admin.ts:499` → `DELETE FROM crm_beta_invites WHERE id=$1`; 404 when already gone, 409 when `accepted_at` set | Pressed against my own test invite: 200 `{ok:true}`, row gone from DB (`count(*) → 0`); second DELETE → 404; accepted-case 409 verified by code read (no accepted row exists to press) | OK |
| "No invites yet" empty state | Empty state | Shows when no invites exist at all. | client/src/pages/crm-admin.tsx:526-527 | client only | code only | OK |
| "Couldn't load beta invites" error line | Error state | Shows if the list query fails. | client/src/pages/crm-admin.tsx:524-525 | client only | code only | OK |

### Org detail drawer (`sheet-org-detail`)

Row click → `GET /api/admin/orgs/:id` → `server/crm/admin.ts:320`: the org row, owner, owner's subscription, `getSeatUsage(org)` (`server/crm/tenancy.ts:224` — distinct seat holders across **all orgs the same owner owns**: active/invited `crm_members`, de-duplicated by account id or invited email, plus agency-team members when the Agency workspace module is on; beta owners get unlimited), members of this org (`crm_members WHERE org_id ORDER BY last_active_at DESC`), latest 10 estimates and latest 10 invoices by `created_at DESC`.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Sheet title + subtitle | Header | Company name; underneath it the owner's email and their plan pill (Beta pill if the owner is a beta account). | client/src/pages/crm-admin.tsx:578-582 | same route → `crm_orgs`, `users` (owner), `subscriptions` | Alpine Exteriors Test: title "Alpine Exteriors Test", subtitle `dev@constructhub.local` + plan matches `subscriptions` row (`standard/active`) | OK |
| Seats line (`text-org-seats`) | Stat | "Seats: N used of L · PlanName plan" — or "unlimited (beta)" / "no active plan". N counts seat holders across **all of the owner's orgs**, not just this one, so it can exceed this org's member count. | client/src/pages/crm-admin.tsx:590-595 | same route → `getSeatUsage` (`server/crm/tenancy.ts:224-288`) → `crm_members` active/invited across owner's orgs; limit from plan entitlements (`-1` = unlimited); platform admins always run on the top plan, so admin-owned orgs show "unlimited" | Alpine (owner 1, admin): rendered "Seats: 5 used · unlimited · Agency plan" — SQL recount of distinct holders → 5 ✓. Non-admin org (HCP Import Dry-Run, owner 3, no subscription): API `{plan:"none", planName:"current", limit:1, used:0}` → renders "0 used of 1 · no active plan" ✓. (Note: header pill said "standard" while seats said "Agency plan" for the admin org — two different real sources: raw subscription row vs admin entitlements, by design per `server/entitlements.ts:11-16`.) | OK |
| "Members (N)" + members table | Table + count | Everyone on this company's team with role pill, membership status (active/invited/disabled) and last-active date. N is this org's member count — can be smaller than the seats number above. | client/src/pages/crm-admin.tsx:597-616 | same route → `SELECT * FROM crm_members WHERE org_id ORDER BY last_active_at DESC` | Alpine drawer: 2 rows (`dev@…` owner/active, `tech@…` field/disabled) match DB exactly incl. order | OK |
| "Recent estimates" list | Table | The company's 10 newest estimates with number, status pill and total. | client/src/pages/crm-admin.tsx:618-637 | same route → `crm_estimates WHERE org_id ORDER BY created_at DESC LIMIT 10` | all 10 rows (E-2011…E-1998) match SQL numbers/status/totalCents in order | OK |
| "None yet." (estimates) | Empty state | Shows when the company has no estimates. | client/src/pages/crm-admin.tsx:620-621 | client only | code only | OK |
| "Recent invoices" list | Table | The company's 10 newest invoices with number, status pill and total. | client/src/pages/crm-admin.tsx:639-658 | same route → `crm_invoices WHERE org_id ORDER BY created_at DESC LIMIT 10` | all 10 rows (INV-1418…INV-1409) match SQL incl. paid/void statuses | OK |
| "None yet." (invoices) | Empty state | Shows when the company has no invoices. | client/src/pages/crm-admin.tsx:641-642 | client only | code only | OK |
| Drawer loading spinner / "Couldn't load this organization" | States | While the drawer fetches, or if the fetch failed. | client/src/pages/crm-admin.tsx:584-587 | client only | code only | OK |

### Visitor analytics (`section-admin-analytics`)

`GET /api/admin/analytics` → `server/analytics.ts:133`: rolling windows off `ch_analytics_events` (rows exist only for browsers that accepted the cookie banner — enforced at ingest, `server/analytics.ts:88-94`). `last24h`/`last7d` = `count(*)` and `count(distinct visitor_id)` since `now() − 24h/7d` (server clock, UTC box). Top pages = 7-day `count(*) GROUP BY path LIMIT 10`. Recent = latest 50 events with signed-in email joined from `users`. IPs are anonymized to /24 (IPv4) or /48 (IPv6) before storage (`server/analytics.ts:65`).

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "visitors · 24h" card | Stat | How many distinct visitors (by anonymous cookie id) were tracked in the last 24 hours. | client/src/pages/crm-admin.tsx:669-672 | GET `/api/admin/analytics` → `count(distinct visitor_id) WHERE created_at >= now()-interval '24 hours'` | API `0` = SQL same window → 0 | OK |
| "pageviews · 24h" card | Stat | How many page views were tracked in the last 24 hours. | client/src/pages/crm-admin.tsx:673-676 | same route → `count(*) WHERE created_at >= now()-interval '24 hours'` | API `0` = SQL → 0 | OK |
| "visitors · 7d" card | Stat | Distinct visitors over the last 7 days. | client/src/pages/crm-admin.tsx:677-680 | same route → `count(distinct visitor_id)` over 7-day window | API `179` = SQL → 179 | OK |
| "pageviews · 7d" card | Stat | Page views over the last 7 days. | client/src/pages/crm-admin.tsx:681-684 | same route → `count(*)` over 7-day window | API `487` = SQL → 487 | OK |
| "Top pages · 7d" card | List | The 10 most-viewed pages in the last 7 days with view counts. | client/src/pages/crm-admin.tsx:686-698 | same route → `GROUP BY path ORDER BY count(*) DESC LIMIT 10` (7-day window) | API top 5 (`/` 33, `/crm` 28, `/crm/estimates` 23, `/google-reviews` 22, `/crm/team` 22) identical to SQL; card hidden when empty (`(topPages?.length ?? 0) > 0`) | OK |
| Recent events table (When / Who / Page / IP / Device) | Table | The 50 most recent tracked visits: local timestamp, the signed-in account's email when known (otherwise "visitor <id>"), page, anonymized IP and browser string. | client/src/pages/crm-admin.tsx:699-737 | same route → `ch_analytics_events ORDER BY created_at DESC LIMIT 50` LEFT JOIN `users` for email; visitor id truncated to 8 chars in the response | API returned 50 rows; SQL `count(*) FROM (… LIMIT 50)` → 50; first row path/IP/UA match DB (IP stored already anonymized, `127.0.0.0/24`) | OK |
| "No tracked visits yet…" empty row | Empty state | Shows when nobody has accepted the cookie banner yet. | client/src/pages/crm-admin.tsx:716-720 | client only | code only | OK |
| "Couldn't load visitor analytics" error row | Error state | Shows if the rollup query fails. | client/src/pages/crm-admin.tsx:711-715 | client only | code only | OK |
| Section description ("Only visitors who accepted the cookie banner appear here") | Text | Accurate: ingest checks the `ch_consent=granted` cookie server-side before writing anything. | client/src/pages/crm-admin.tsx:666-667 | POST `/api/analytics/events` → `server/analytics.ts:88-94` | code read of the ingest gate | OK |

### Hub assistant (`section-admin-hub`)

`GET /api/admin/hub-stats` → `server/hub/index.ts:34` → `hubStatsRollup(30)` (`server/hub/store.ts:59-67`): `SELECT tier, outcome, reason, sum(count) FROM hub_stats WHERE day >= (now() AT TIME ZONE 'utc')::date - 30 GROUP BY … ORDER BY count DESC LIMIT 200` — UTC calendar days, last 30 days inclusive. Counters only: no messages, prompts or identities are stored (per module header).

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Hub assistant" section + description | Header | Explains these are outcome counts for the corner assistant over the last 30 days. | client/src/pages/crm-admin.tsx:742-744 | GET `/api/admin/hub-stats` → `hub_stats` rollup (above) | `days:30` in response; SQL window verified | OK |
| Outcomes table — Visitor / Outcome / Reason / Count | Table | How many assistant sessions ended each way: Visitor = "Signed in" (tier `builder`) or "Signed out" (tier `browse`); Outcome/Reason are the server's own short codes (e.g. `chat_ok` → "chat ok", reason "<5s" = answered in under 5 seconds; `limit`/`prefilter`/`output_block` = rate-limited, blocked by a preset rule, or output-safety blocked). | client/src/pages/crm-admin.tsx:745-776 | same route; `tier='builder' → "Signed in"` else "Signed out" (client line 768); outcome underscores replaced with spaces | all 20 API rows compared key-by-key (tier/outcome/reason/count) against the SQL rollup — ALL HUB ROWS MATCH | OK |
| "No Hub activity in the last 30 days." empty row | Empty state | Shows when the rollup returns nothing. | client/src/pages/crm-admin.tsx:761-765 | client only | code only | OK |
| "Couldn't load Hub stats" error row | Error state | Shows if the query fails. | client/src/pages/crm-admin.tsx:756-760 | client only | code only | OK |

### Findings summary

- **Total elements audited: 64** (2 shell, 4 gate card, 7 overview, 4 Site Scan leads, 9 users, 7 orgs, 10 beta invites, 8 org drawer, 9 analytics, 4 hub — every visible number, pill, button, link, input, empty/error state).
- **OK: 63 · BUG: 1 · UNCLEAR: 0 · DEAD: 0.**
- **BUG (low): Payments overview tile** — dollars count only `succeeded` payments while "N charges" counts all `crm_payments` rows including 5 reversed ($724.45) and 1 failed ($50). `server/crm/admin.ts:193-198`. Fix is local: same-status filter for both, or reword the sub-line.
- All cross-checks passed: overview totals (users 11, orgs 9, customers 13,967, estimates 9,120, invoices 2,995, payments 1,531/$4,277,670.79, beta 0); all 9 org rows (owner, plan, 5 counts each); all 11 user rows (profile, plan, memberships, last-active instants); Alpine Exteriors drawer (2 members, 10 estimates, 10 invoices, seats 5-of-unlimited); both seat edge cases (no-plan org → "0 used of 1 · no active plan"); 4 beta invites (status derivation); full invite lifecycle POST→409 duplicate→DELETE→404 (test data created as `audit-admin-20261004@example.com` and removed); 5 Site Scan leads; analytics 24h/7d/top-pages/recent-50; all 20 Hub rows.
- **Not pressable on dev:** gate sign-in (env not configured — would 409 by design), SMS side of invites (no phone carrier on dev; code-verified), Revoke on accepted invites (no accepted row exists; 409 path code-verified). Stripe is off on dev as expected — no checkout buttons on this page.


## Client Portal — homeowner portal (route `/` on client.constructhub.*; dev: any URL with `?client=1`)

Audited via the read-only **contractor-preview session** mechanism (POST /api/crm/customers/:id/portal-preview → GET /api/client/auth/preview sets a 15-min read-only `crm_client` cookie), rendered as **Joe & Mary Kane** (`2c25304d-e441-4df7-8e45-27282d4c2c74`, Alpine Exteriors Test) — the account with the most client-facing data on dev (83 sent estimates, 2 sent invoices, 1 approved/signed estimate). All numbers below were recomputed with SQL against `constructhub_dev_a6` and compared with the live API responses and a Playwright render (screenshots in `shots/client-portal/`). No writes were possible in preview (server refuses with 403 — verified), so no test data was created and none remained to clean up.

### A. Signed-out state — magic-link request (`RequestLink`, client-portal.tsx:63-155)

Shown when GET /api/client/documents returns 401 (verified: no cookie → 401 `{"message":"Sign in required"}`).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| ConstructHUB CRM logo (`client-portal-brand`) | branding | Shows the platform logo; pure branding, links nowhere | client-portal.tsx:90-92 (CrmLogo) | client only | screenshot signed-out.png | OK |
| "Your documents, in one place" + subtext | text | Static headline explaining the page | client-portal.tsx:93-96 | client only | screenshot | OK |
| "That sign-in link is invalid or has expired…" (`text-auth-invalid`) | banner | Only appears when the page loads with `?auth=invalid` (a bad/expired magic link redirected back) | client-portal.tsx:68-70, 101-108 | client only (reads window.location.search) | screenshot signed-out.png (loaded with ?auth=invalid) | OK |
| Email input (`input-client-email`) | input | Where the homeowner types the email their contractor has on file | client-portal.tsx:126-133 | client only | screenshot | OK |
| "Email me a sign-in link" (`button-request-link`) | button | Sends a magic-link request. ALWAYS answers "Check your inbox" whether or not the email exists (anti-enumeration). On a match, the server stores a 30-min single-use token (sha256 only) and emails a sign-in link to that address. | client-portal.tsx:135-138, submit 72-84 | POST /api/client/auth/request-link → server/crm/client-auth.ts:193 → zod email validate; rate limit 30/IP + 5/email per 15 min; SELECT * FROM crm_customers WHERE lower(email)=…; if any match: INSERT crm_client_tokens (token_hash, customer_ids=[all matching rows], expires 30 min) + email via sendWithFallback; responds {sent:true} regardless | pressed with nonexistent `audit-nonexistent-16f@example.com` → 200 {"sent":true"}; invalid email → 400; code-read the match branch (token insert + sink email, dev mail sinks to tmp/email-outbox.jsonl, no real mail) | OK |
| "Check your inbox" state (`text-link-sent`) | text | Shown after submit; says a link is on its way "if that email is on file" and that it expires in 30 minutes — matches the server's 30-minute TOKEN_TTL | client-portal.tsx:109-119 | client only; TTL cross-checked: client-auth.ts:39 TOKEN_TTL_MS = 30 min | code + screenshot | OK |
| Request error text (`text-request-error`) | text | Shows the error (e.g. rate-limit 429 message) if the POST fails | client-portal.tsx:134 | passes through server message | code only | OK |
| "Terms" link (`link-portal-terms`) | link | Opens the CRM terms-of-service page in this same client-portal face | client-portal.tsx:148 | route `/crm-terms` → CrmTermsPage — exists, App.tsx:473 and 539 | route in App.tsx:473; rendered /crm-terms?client=1 (title "Client Portal", content renders) | OK |
| "Privacy" link (`link-portal-privacy`) | link | Opens the CRM privacy page | client-portal.tsx:150 | route `/crm-privacy` → CrmPrivacyPage — exists, App.tsx:474 and 540 | route in App.tsx:474 | OK |

### B. Signed-in shell (sidebar / drawer / header / ribbon / footer)

Data: one GET /api/client/documents (client-auth.ts:394) powers the whole shell: `customer`, `orgs[]` (with logo/theme/contact), `accounts[]`, and everything in views C–J. Session = `crm_client` httpOnly cookie → crm_client_sessions row, 30-day sliding (client-auth.ts:146-189). Preview sessions additionally get `contractorPreview:true` and a banner.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Sidebar logo + org name (`client-portal-brand`, `text-sidebar-org`) | branding | Desktop-only left rail; shows org logo + name when the client belongs to exactly one contractor | client-portal.tsx:645-658 | orgs from /api/client/documents → crm_orgs WHERE id IN (customer's orgs); name + logo_url | screenshot home.png ("Alpine Exteriors Test") | OK |
| Nav: Home (`portal-nav-home`) | tab | Switches the main pane to Home; shows a count badge = unanswered non-expired estimates + unpaid invoices | client-portal.tsx:601-625, badge fn 259-263, filters 196-201 | client-side count over the /api/client/documents payload (estimates: approved_at/declined_at NULL AND (expires_at NULL OR > now, browser clock); invoices: paid_at NULL AND dueCents>0 where dueCents = max(0,total−retainage−paid) computed server-side client-auth.ts:526) | Playwright: sidebar badges ["1","1"]; SQL: awaiting=0, unpaid=1 for this customer → Home badge 1 ✓ | OK |
| Nav: Estimates (`portal-nav-estimates`) | tab | Lists every estimate the contractor sent; badge = awaiting count | client-portal.tsx:601-625 | same client-side filter | SQL awaiting=0 → no badge on Estimates (screenshot confirms) | OK |
| Nav: Invoices & receipts (`portal-nav-invoices`) | tab | Lists sent invoices; badge = unpaid count | client-portal.tsx:601-625 | same client-side filter | badge "1" matches SQL unpaid=1 | OK |
| Nav: Signed contracts (`portal-nav-contracts`) | tab | Lists approved estimates (signed contracts) | client-portal.tsx:601-625 | payload contracts = estimates WHERE approved_at IS NOT NULL (client-auth.ts:533-540) | SQL: 1 approved estimate → 1 row | OK |
| Nav: Measurement reports (`portal-nav-reports`) | tab | Lists ready measurement reports | client-portal.tsx:601-625 | payload reports = crm_measurements WHERE customer_id IN session AND status='ready' (client-auth.ts:434-443) | SQL: 0 rows for this customer; API reports:[] | OK |
| Nav: Photos (`portal-nav-photos`) | tab | Photo share section | client-portal.tsx:601-625 | see H | OK | OK |
| Nav: Messages (`portal-nav-messages`) | tab | Two-way message thread | client-portal.tsx:601-625 | see I | OK | OK |
| Nav: Contact us (`portal-nav-contact`) | tab | Office + team contact cards | client-portal.tsx:601-625 | see J | OK | OK |
| User chip (`text-portal-user`, avatar initial) | display | Shows the homeowner's name + "Homeowner"; initial from displayName | client-portal.tsx:666-678 | customer.displayName from crm_customers (first account) | screenshot "Joe & Mary Kane / Homeowner" | OK |
| Sign out icon (`button-client-logout`) | button | Deletes the client session server-side, clears the cookie, returns to the email-request page | client-portal.tsx:679-688, signOut 203-206 | POST /api/client/auth/logout → client-auth.ts:377 → DELETE crm_client_sessions WHERE token_hash=sha256(cookie); Set-Cookie empty | pressed: 200 {ok:true}; follow-up GET /api/client/documents → 401 | OK |
| Mobile hamburger (`button-portal-menu`) | button | Opens the left drawer with the same tool list (mobile only) | client-portal.tsx:700-740 | client only | code + mobile render (drawer nav `portal-drawer-nav`) | OK |
| Drawer items (`portal-drawer-home` … `portal-drawer-contact`) | buttons | Same nav as the sidebar, with the same badges; tapping closes the drawer | client-portal.tsx:712-738 | client only (same payload) | code only | OK |
| Header org logo + name (`text-org-name`) | display | Mobile/desktop header shows the contractor's logo and company name (or "Your documents" for multi-org clients) | client-portal.tsx:741-748 | orgs[0].logo_url / name | screenshot (no logo configured for this org → name only; SQL logo_url NULL) | OK |
| ⓘ info tip next to title (`info-tip-portal`) | button | Opens a plain-English "What is this portal?" dialog | client-portal.tsx:749; info-tip.tsx:29 | client only; key `portal` exists in client/src/lib/info-content.ts:541 | key present; icon visible in screenshots | OK |
| "Welcome, <name> · <org(s)>" line | text | Greets the client; lists all org names when the email exists at more than one contractor | client-portal.tsx:751-754 | customer.displayName + orgs[].name | screenshot | OK |
| Sign out button mobile (`button-client-logout-mobile`) | button | Same logout as the sidebar icon (mobile header) | client-portal.tsx:757-759 | POST /api/client/auth/logout | same endpoint verified | OK |
| Contractor-preview banner (`banner-contractor-preview`) | banner | Read-only warning shown only when a contractor uses "see what the client sees" | client-portal.tsx:763; crm-client-360.tsx:286-299 | payload `contractorPreview:true` (client-auth.ts:494) | screenshot (banner present in preview) | OK |
| Mobile bottom ribbon (`portal-ribbon`) | nav | Mobile-only bar: Home / Docs tabs, the raised camera button, Photos / Messages tabs | client-portal.tsx:784-827 | client only | rendered at 390px — ribbon + badges present | OK |
| Ribbon Home / Docs (`ribbon-home`, `ribbon-docs`) | tabs | Home = action view; Docs = all four document tables stacked (`documents` viewBody, client-portal.tsx:591-598) | client-portal.tsx:790-795 | client only | code only | OK |
| Ribbon capture button (`button-portal-capture`) + hidden file input (`input-portal-capture`) | button/input | Opens the phone camera; the chosen photo uploads straight to the contractor, then lands on Photos. In preview it toasts "Read-only preview" and the server would refuse anyway | client-portal.tsx:796-819, 630-642, capture mutation 211-227 | POST /api/client/photos (multipart: customerId + file) → server/crm/attachments.ts:471 → requireClient; 403 if the customer isn't in the session; rate 30/15 min; count(kind='photo', refId=customer) < MAX_PHOTOS_PER_CUSTOMER=20; mime ∈ PHOTO_MIMES (jpeg/png/heic/heif/webp); multer 10 MB cap; INSERT crm_attachments (stored under tmp/crm-attachments) | endpoint shape matches FormData body; preview-mode POST /api/client/comments & /photos refused 403 by blockPreviewWrites (notes-timeline.ts:182-183) — verified; did not upload a file | OK |
| Ribbon Photos / Messages (`ribbon-photos`, `ribbon-messages`) | tabs | Same views as the sidebar items | client-portal.tsx:820-825 | client only | code only | OK |
| Contact strip footer (`portal-contact-footer`) | footer | Always-visible strip: company name + phone + email + website links (mailto/tel/external) | client-portal.tsx:768, portal-messages.tsx:297-316 | orgs[0].email/phone/website from crm_orgs | screenshot: "Alpine Exteriors Test · dev@constructhub.local" — SQL org email matches, phone/website NULL → links hidden | OK |
| Powered-by logo + "Signed in by secure email link · Terms · Privacy" (`link-portal-terms-footer`, `link-portal-privacy-footer`) | links | Footer terms/privacy, same routes as A | client-portal.tsx:770-779 | routes /crm-terms, /crm-privacy (App.tsx:473-474) | routes exist | OK |
| Org theme accent | styling | Single-org clients get the contractor's brand colour via CSS variables on the page root; multi-org stays neutral | client-portal.tsx:253-257, 628 (orgThemeStyle); shared/theme-colors.ts:128 themePayload | crm_orgs.custom_fields theme → {theme:{hex,hsl,…}} | SQL: this org has no themeColor → default orange; code path verified end-to-end | OK |

### C. Home view (`viewBody.home`, client-portal.tsx:565-577)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Needs your action" card (`section-needs-action`) | card | Top of Home; one row per estimate waiting on an answer (not approved/declined, not expired) and one row per unpaid invoice. Hidden when nothing needs the client | client-portal.tsx:267-299 | client-side filter over /api/client/documents payload (filters 196-201) | SQL: awaiting=0, unpaid=1 → card shows exactly 1 invoice row (screenshot home.png) | OK |
| Estimate action row (`action-estimate-<id>`) + "Review" button | link | Row shows "E-### · title", total and expiry date; the whole row links to the public estimate page `/e/<token>` where the client approves/declines | client-portal.tsx:271-283 | e.link = `/e/${public_token}` (client-auth.ts:520); route /e/:token → PublicEstimatePage (App.tsx:475) | route exists; public estimate API verified live for E-1001 via its preview grant (200, correct document) | OK |
| Invoice action row (`action-invoice-<id>`) + "Pay" button | link | Row shows "INV-### · title", amount due and due date; links to the public invoice page `/i/<token>` (view & pay) | client-portal.tsx:284-296 | i.link = `/i/${public_token}` (client-auth.ts:529); route /i/:token → PublicInvoicePage (App.tsx:476) | screenshot shows "INV-1065 · Roof replacement — $9,378.56 due · by 8/30/2026"; SQL due = 937856¢, due_at 2026-08-30 ✓; /i/ API verified live via invoice preview-link (200) | OK |
| "Financing" section (`section-financing`) | card | Lists the contractor's lender links (org custom_fields.financingLinks, primary flagged); each row an Apply button | client-portal.tsx:569; crm-client-360.tsx:303-373 | GET /api/client/documents → financing = financingLinksOf(org) + getPrimaryFinancing(org) (client-auth.ts:481-490; server/crm/financing.ts:38-63) | SQL: org has no financingLinks → payload [] → empty state "No financing options yet" (screenshot) | OK |
| Financing Apply (`button-financing-<i>`) | button | Records the click (contractor gets an "applied for financing" email + timeline entry) THEN opens the lender site in a new tab; failure blocks the open | crm-client-360.tsx:307-331, 354-365 | POST /api/client/financing-click → server/crm/notes-timeline.ts:512 → requireClient; 403 in preview; body {label,url} must exactly match a link the org offers (else 400); INSERT crm_finance_clicks (org_id, customer_id, label, url) + fire-and-forget notify email | pressed in preview → 403 {"message":"Contractor preview is read-only…"} as designed; insert path code-verified | OK |
| "primary" badge | badge | Marks the lender link the contractor set as primary | crm-client-360.tsx:350 | primary = getPrimaryFinancing matches url (financing.ts:57) | code only (no data on dev) | OK |
| "From <company>" pamphlets (`section-pamphlets`) | card | Company brochures/warranties the contractor uploaded; each row a Download button | client-portal.tsx:571; client-uploads.tsx:78-105 | payload pamphlets = crm_attachments WHERE kind='pamphlet' AND org_id IN (client's orgs) (client-auth.ts:451-455) | SQL: 0 pamphlets for this org → section hidden entirely | OK |
| Pamphlet Download (`pamphlet-download-<id>`) | link | Downloads the file through the session-gated route | client-uploads.tsx:94-98 | GET /api/client/attachments/:id/download → attachments.ts:511 → kind='pamphlet' allowed if client has a customer row in that org; streams from tmp/crm-attachments | route + gating code-verified; no files to press | OK |
| "You're all caught up" empty state | empty state | Shown when no actions, no financing, no pamphlets | client-portal.tsx:572-575 | client only | not shown for this account (has 1 unpaid) — correct per condition | OK |

### D. Estimates view (`section-estimates`, client-portal.tsx:301-389)

Whole view = client-side render of the payload's `estimates` array (all crm_estimates WHERE customer_id IN session AND sent_at IS NOT NULL, newest first — client-auth.ts:414-418). For this account: 83 rows — SQL count 83 ✓ (82 status `sent`, 1 `approved`).

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Estimate row link (`client-estimate-<id>`) | link | "E-### · title" → public estimate page /e/<token> | client-portal.tsx:323-325 | link `/e/${public_token}`; route App.tsx:475 | API + route verified (see C) | OK |
| Multi-org subline (`<orgName>`) | text | Shows the contractor name under the title only when the client has >1 org | client-portal.tsx:326-328 | orgName per estimate (client-auth.ts:519) | single-org account → hidden; code OK | OK |
| Estimate attachments (`client-estimate-attachment-<id>`) | links | Files the contractor pinned to that estimate; each downloads via the gated route | client-portal.tsx:329-338 | crm_attachments kind='estimate' refId=estimate (client-auth.ts:456-460); download /api/client/attachments/:id/download (attachments.ts:526-535: allowed when the estimate belongs to a session customer) | 0 attachments on this account; route code-verified | OK |
| Status pill | pill | "approved"/"declined" from approved_at/declined_at, otherwise the raw status text (sent/viewed) | client-portal.tsx:340-344 | crm_estimates.status/approved_at/declined_at | SQL GROUP BY status: 82 sent + 1 approved — matches rendered pills (Counter from API payload) | OK |
| "Sent" date | text | Date the estimate was sent (browser-local format) | client-portal.tsx:345 | sent_at; "—" fallback (never null here — server filters sent_at NOT NULL) | spot-checked rows vs SQL sent_at | OK |
| "Total" | money | Estimate total in dollars | client-portal.tsx:346 | total_cents / 100, USD | rows show $300.00/$9,378.56; SQL totals match | OK |
| "Share" (`button-portal-share-<id>`) | button | Hidden in contractor preview; otherwise opens the share card to email this estimate to a spouse/co-signer | client-portal.tsx:348-354 | see share card rows below | hidden in preview (screenshot); endpoint verified | OK |
| Share card (`portal-share-card`) | card | Email input + "Send secure link" + Cancel; the recipient gets their own 30-min single-use link and joins the doc's allowlist (max 5) | client-portal.tsx:362-387 | POST /api/public/estimates/:token/share → server/crm/portal.ts:1095 → requireDocSession (client session must cover the estimate's customer); 400 if email already has access; 409 at 5 shares; UPDATE crm_estimates.custom_fields.sharedEmails; logEvent 'shared'; INSERT crm_client_tokens + email the new link (502 if the mail fails) | endpoint exists with exact body {email}; response {ok, sharedWith} matches toast `j.sharedWith` (client-portal.tsx:247); not pressed (would email + mutate) — code + shape verified | OK |
| Share email input (`input-portal-share-email`) | input | Recipient email; Send stays disabled until it looks like a valid email | client-portal.tsx:372-374, 377 | client-side regex only | code only | OK |
| "Send secure link" (`button-portal-share-send`) | button | Sends the share request; toasts "We emailed <addr> their own secure link." | client-portal.tsx:376-381 | same share route | code only | OK |
| Share Cancel | button | Closes the card without sending | client-portal.tsx:382 | client only | code only | OK |
| Empty state "No estimates yet" | empty state | When the contractor never sent anything | client-portal.tsx:304-306 | client only | n/a (account has 83) | OK |

### E. Invoices & receipts view (`section-invoices`, client-portal.tsx:391-435)

Payload: crm_invoices WHERE customer_id IN session AND sent_at IS NOT NULL AND voided_at IS NULL, newest first (client-auth.ts:419-429). For this account: 2 rows; SQL also shows 25 voided invoices correctly excluded ✓.

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Invoice row link (`client-invoice-<id>`) | link | "INV-### · title" → public invoice page /i/<token> (view & pay surface) | client-portal.tsx:413-415 | link `/i/${public_token}`; route App.tsx:476 | API verified via invoice preview-link (200, /i/ path) | OK |
| Status pill | pill | "paid" when paid_at set, else raw status (sent) | client-portal.tsx:421-423 | crm_invoices.paid_at/status | screenshot: INV-1065 "sent", INV-1001 "paid" — SQL paid_at matches | OK |
| "Due date" | text | Invoice due date | client-portal.tsx:425 | due_at | screenshot 8/30/2026 & 8/28/2026 = SQL due_at (browser-local format) | OK |
| "Amount due" | money | What's still owed = total − retainage − payments, floored at $0; shows "—" once paid | client-portal.tsx:426 | dueCents = max(0, total_cents − retainage_cents − paid_cents) computed server-side (client-auth.ts:526) | INV-1065: $9,378.56 (937856¢ SQL-computed ✓); INV-1001: "—" with paid_at set ✓ | OK |
| "Total" | money | Full invoice amount | client-portal.tsx:427 | total_cents | $9,378.56 / $4,689.28 = SQL ✓ | OK |
| Empty state "No invoices yet" | empty state | — | client-portal.tsx:395-396 | client only | n/a | OK |

### F. Signed contracts view (`section-contracts`, client-portal.tsx:437-485)

Payload: `contracts` = estimates (sent) with approved_at NOT NULL → id, number, title, totalCents, signatureName, approvedAt (client-auth.ts:533-540). For this account: 1 row (E-1001, signed "Joe Kane" 2026-07-29, $9,378.56) — SQL matches exactly ✓.

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Contract row link (`client-contract-<id>`) | link | Links to the public estimate page of the signed estimate (/e/<token>) | client-portal.tsx:459-461 | link `/e/${public_token}` | route verified | OK |
| "Signed by" | text | The typed signature name from approval | client-portal.tsx:466 | crm_estimates.signature_name ("—" if null) | "Joe Kane" = SQL ✓ | OK |
| "Signed on" | text | Approval date | client-portal.tsx:467 | approved_at | 7/29/2026 = SQL ✓ | OK |
| "Value" | money | total_cents of the signed estimate (note: approved_total_cents when discounts were picked isn't what's shown — for this account approved_total is NULL so identical) | client-portal.tsx:468 | total_cents | $9,378.56 = SQL ✓ | OK |
| "Contract PDF" Download (`client-contract-download-<id>`) | link | Only rendered when a server-minted contract PDF exists for that estimate; downloads via the gated route | client-portal.tsx:469-477; pdf map 188-194 | GET /api/client/contracts → attachments.ts:552 → crm_attachments kind='contract' refId=estimate; download /api/client/attachments/:id/download (kind='contract' allowed via estimate ownership, attachments.ts:526-535) | API returns {"contracts":[]} for this account; SQL: no kind='contract' row for this customer's estimate → cell correctly empty (org-wide 430 approved vs 54 PDFs — older approvals predate PDF delivery) | OK |
| Empty state "No signed contracts yet" | empty state | — | client-portal.tsx:441-442 | client only | n/a | OK |

### G. Measurement reports view (`section-reports`, client-portal.tsx:487-562)

Payload: crm_measurements WHERE customer_id IN session AND status='ready' (client-auth.ts:434-443), plus per-report download URLs. 0 rows for this account (SQL ✓) → empty state.

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Report row (`client-report-<id>`) | row | "<provider> report" + address + date + roof size (squares sq + pitch, siding sq ft, window count) | client-portal.tsx:505-528 | squares = squares_milli/1000, siding = wall_area_sf_milli/1000, windows from rawPayload.summary.windowsCount, pitch = predominant_pitch (client-auth.ts:541-563) | no ready reports on dev for this account; shape code-verified against measurementColumns in server/crm/reports.ts | OK |
| "View 3D model" (`client-report-3d-<id>`) | link | Opens the HOVER 3D model in a new tab (external URL) | client-portal.tsx:537-542 | rawPayload.model3dUrl (external https) | code only | OK |
| "Measurement PDF" (`client-report-pdf-<id>`) | link | Downloads the measurement PDF the provider delivered | client-portal.tsx:543-547 | rawPayload.pdfAttachmentId → /api/client/attachments/<id>/download (kind='measurement' gated by refId=customer, attachments.ts:522-525) | route code-verified; no data | OK |
| "Download" (`client-report-download-<id>`) | link | Downloads the stored report text file | client-portal.tsx:548-552 | /api/client/reports/:id/download → server/crm/reports.ts:732 → crm_measurements WHERE id AND customer_id IN session AND rawPayload.sourceText present; serves text/plain | GET without session would 401; route + gating code-verified | OK |
| Empty state "No measurement reports yet" | empty state | — | client-portal.tsx:490-492 | client only | shown for this account | OK |

### H. Photos view (`PortalPhotoShare`, client-uploads.tsx:109-176)

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Section (`section-photo-share`) | section | Hidden entirely when the client has no account row | client-uploads.tsx:125 | accounts[] from /api/client/documents | account exists → would render | OK |
| "Add a photo" (`button-upload-photo`) | button | Opens the file picker; uploads the chosen image straight to the contractor; disables at 20 photos | client-uploads.tsx:143-153 | POST /api/client/photos (attachments.ts:471, see B row); limit 20 = MAX_PHOTOS_PER_CUSTOMER (attachments.ts:60); 10 MB multer cap (MAX_BYTES, attachments.ts:59); types jpeg/png/heic/heif/webp (PHOTO_MIMES 89-95) | limit/byte/type values match the on-screen hint "JPEG, PNG or HEIC · 10 MB each · up to 20 photos" (hint omits webp/heif — same wording the server itself uses in its 415 message); endpoint shape matches the multipart body | OK |
| Photo grid (`client-photo-grid`, `client-photo-<id>`) | links | Thumbnails of what the client uploaded; clicking downloads/opens the original | client-uploads.tsx:158-171 | payload photos = crm_attachments kind='photo' refId=customer (client-auth.ts:461-463); inline preview `?inline=1` variant of the gated download | 0 photos for this account; route verified | OK |

### I. Messages view (`PortalMessages`, portal-messages.tsx:58-198)

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Thread (`portal-messages`, bubbles `portal-message-<id>`) | chat | The two-way thread with the contractor: own messages right-aligned, team replies left with author name and relative time; auto-refreshes every 20 s | portal-messages.tsx:80-89, 119-152 | GET /api/client/comments?customerId=… → server/crm/inbox.ts:306 → crm_client_comments WHERE customer_id (session-owned) ORDER created_at DESC LIMIT 200, reversed; fromMe = author_member_id IS NULL; author/to names resolved from crm_members | GET with preview cookie → 200 {messages:[]} (no comments in DB for this customer — SQL ✓); empty state renders | OK |
| "To" picker (`select-message-to`) | select | Only shown when the account has a project team; "the office (whole team)" or a specific person | portal-messages.tsx:154-168 | options from GET /api/client/team (inbox.ts:243) | team has 1 member → picker renders (verified in API response; UI screenshot messages.png) | OK |
| Message input (`input-portal-message`) | textarea | Enter sends (Shift+Enter = newline) | portal-messages.tsx:170-183 | client only | code only | OK |
| Send (`button-portal-message-send`) | button | Posts the message; contractor gets an email notification; replies land in the same thread | portal-messages.tsx:184-191 | POST /api/client/comments {customerId, body, toMemberId?} → attachments.ts:582 → requireClient + blockPreviewWrites (403 in preview, notes-timeline.ts:182); zod 1-4000 chars; 30/15 min rate; INSERT crm_client_comments (org_id, customer_id, body, estimate_id, to_member_id — toMemberId validated as an ACTIVE member of the client's org, attachments.ts:623-628); fire-and-forget email to the org | pressed in preview → 403 read-only refusal as designed; insert path code-verified | OK |

### J. Contact us view (`PortalContact`, portal-messages.tsx:202-294)

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Office card (`portal-contact`) | card | Company name + phone (tel: link), email (mailto:), website (new tab); each hidden when the org didn't set one | portal-messages.tsx:219-246 | GET /api/client/team → office from crm_orgs (inbox.ts:294-300) | screenshot: name + email only — SQL org phone/website NULL ✓ | OK |
| "Message now" — office (`button-message-office`) | button | Jumps to Messages with "the office" selected | portal-messages.tsx:247-250; client-portal.tsx:587 | client only (view switch) | code only | OK |
| "Your team on this job" list (`contact-member-<memberId>`) | rows | Everyone attached to this client's work: project manager + sales rep, crews assigned to their jobs, and whoever wrote their estimates — with direct phone/email links | portal-messages.tsx:255-289 | inbox.ts:258-292: active crm_members of the org filtered to ids from crm_projects.project_manager_member_id/sales_member_id, crm_jobs.assigned_member_ids of the customer's projects, crm_estimates.created_by_member_id; role labels owner→Owner, admin→Project Manager, sales→Sales | API returned exactly ["Dev Owner"/Owner] = the estimate author (SQL: no projects/PM/sales, only estimate_author 001da7a6…) ✓ | OK |
| Member phone/email links | links | tel: / mailto: the team member | portal-messages.tsx:272-278 | crm_members.phone/email ("" phone → link hidden) | screenshot: email shown, no phone ✓ | OK |
| "Message now" per member (`button-message-member-<id>`) | button | Jumps to Messages with "To: <name>" preselected | portal-messages.tsx:281-286 | client only (focusMemberId → toMemberId) | code only | OK |

### Data verification summary (Joe & Mary Kane, Alpine Exteriors Test)

| Page number | Value | SQL recomputation | Match |
|---|---|---|---|
| Estimates list count | 83 | `SELECT count(*) FROM crm_estimates WHERE customer_id=… AND sent_at IS NOT NULL` = 83 | ✓ |
| Status pills | 82 "sent" + 1 "approved" | GROUP BY status: 82 sent, 1 approved, 0 declined | ✓ |
| Home badge / Invoices badge | 1 / 1 | awaiting = 0 (`approved_at/declined_at NULL AND (expires_at IS NULL OR > now())` — all 82 sent expired 2026-08-09); unpaid = 1 (`paid_at NULL AND total−retainage−paid > 0`) | ✓ |
| Needs-action row | INV-1065, $9,378.56 due by 8/30/2026 | due = 937856¢, due_at 2026-08-30 | ✓ |
| Invoice rows | INV-1065 sent $9,378.56/$9,378.56; INV-1001 paid "—"/$4,689.28 | matches crm_invoices (2 sent & non-voided; 25 voided excluded) | ✓ |
| Contract row | E-1001, Joe Kane, 7/29/2026, $9,378.56 | approved estimate row (signature_name, approved_at, total_cents) | ✓ |
| Contract PDF cell | empty | no kind='contract' attachment for this customer's estimate | ✓ (by design) |
| Reports / Pamphlets / Photos / Financing | empty | 0 ready measurements; 0 pamphlets; 0 photos; org financingLinks absent | ✓ |
| Contact team | "Dev Owner · Owner" | team derivation query returns exactly the estimate author | ✓ |

Time semantics: there are no "this month"/rolling-window aggregates on this page. Every count is a full-history list scoped by customer id(s); the only time filter is estimate expiry (`expires_at` vs `now`, same instant on both sides) and the browser-local formatting of absolute timestamps. Multi-org sessions (same email at 2+ contractors — e.g. 1,000+ such emails on dev) merge all customer rows server-side via `lower(email)` at request-link and scope every query by the session's customer id array (client-auth.ts:202-207).

### Observations (not client-facing bugs)

- **Expired estimates stay listed**: 82 of this account's 83 estimates expired 2026-08-09 and still render with pill "sent" (that IS the DB status) plus a past "expires" date; opening one shows the server's "This estimate has expired." This is literal-status display, consistent with the doc page.
- **Preview-mode doc links hit the email gate**: from a whole-portal contractor preview, the /e/ and /i/ links land on the email-verification challenge, because document gates accept only real client sessions or per-document preview grants (portal.ts:131-139 resolve [] for `prev.` cookies). The CRM's own path is the per-document "preview link". Preview-only, by design of the gate; noted for awareness.
- No `?? 0`-style fabricated numbers found on this page; the only fallback is `money()` → "—" for null cents and date → "—", both honest.


# Section 17 — Public client portal & public lead form (no-login pages)

Audited 2026-10-04 against org `1e3050c1-3cfd-4d9b-ba5a-1c19ce074897` (Alpine Exteriors Test),
`c5b47b8d-caa8-47e6-ae7e-6248ad5df565` (SKU Dry-Run) and `b839980a-ad26-44d4-9e83-df427bd60fe8`
(Aspire Interiors). Dev DB `constructhub_dev_a6`, dev server http://127.0.0.1:8305.

Both pages are token-in-URL pages: there are **no lookup inputs / no login form** on either page.
The "lookup" is the unguessable token in the path: the portal resolves
`crm_customers.portal_token`, the lead form resolves
`crm_orgs.custom_fields->leadCaptureToken` (`${orgId}.${random}`).

---

## Client portal (route `/portal/:token`)

Route: `client/src/App.tsx:244` (no doc comment — see "Routes without doc comments" below).
Single data fetch: `GET /api/public/portal/:token` (`public-portal.tsx:25-29`), one payload
drives everything. Server: `server/crm/portal.ts:1341` `registerCrmPortalRoutes`.
The GET also writes `crm_customers.portal_last_seen_at = now()` (portal.ts:1359) — verified:
Kane's row showed `2026-10-04 23:01:18` right after my request.

Verified against customer **Joe & Mary Kane** (`2c25304d-e441-4df7-8e45-27282d4c2c74`, portal
token `43d3…6657`, 83 estimates / 27 invoices sent / 67 projects in DB).

### Header block

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Company logo `img` | image | Shows the company's logo above their name, if they uploaded one | public-portal.tsx:54 | GET /api/public/portal/:token → portal.ts:1394-1397 `company.logoUrl` = `crm_orgs.logo_url` | API payload for Kane (null → not rendered) and Aspire (null); code only | OK |
| Company name `h1` | text | The contractor's company name at the top of the page | public-portal.tsx:55 | same payload → `crm_orgs.name` | API "Alpine Exteriors Test" = DB `crm_orgs.name` ✓ | OK |
| "Welcome, {name}" | text | Greets the client by name | public-portal.tsx:56 | same payload → `crm_customers.display_name` | API "Joe & Mary Kane" = DB ✓ | OK |
| Phone row w/ Phone icon | text (conditional) | Shows the company phone number | public-portal.tsx:58 | same payload → `crm_orgs.phone` (null → hidden) | Kane DB phone NULL → absent from API ✓; Aspire "555-0300" → rendered ✓ | OK |
| Email row w/ Mail icon | text (conditional) | Shows the company email | public-portal.tsx:59 | same payload → `crm_orgs.email` | API `dev@constructhub.local` = DB ✓ | OK |
| "License {n} ({state})" badge w/ ShieldCheck | badge (conditional) | Should show the contractor's licence number and state under the contact line | public-portal.tsx:61-66 reads `company.licenseNumber` / `company.licenseState` | **Never sent**: portal.ts:1394-1397 `company` object = `{name, phone, email, website, logoUrl}` only — `license_number`/`license_state` exist on `crm_orgs` (shared/schema.ts:1108-1109) but are not in the response | Aspire Interiors HAS `license_number='CBC1264418'`, `license_state='FL'` in DB, yet `GET /api/public/portal/<Aspire customer>` returns no license fields; rendered page shows no badge (screenshot `shots/audit17/portal-license-bug.png`) | **BUG** |
| Loading spinner | state | Spins while the portal data loads | public-portal.tsx:31-33 | client only | code only | OK |
| "This link isn't valid" ErrorCard | state | Shown when the token is wrong/rotated | public-portal.tsx:35-41 | GET /api/public/portal/:token → portal.ts:1343-1347: token <24 chars → 404 "Not found"; unknown token → 404 "This portal link is no longer valid." | `curl /api/public/portal/abc` → 404; `curl …/43d3…6658` (off-by-one) → 404 | OK |

### "Estimates to review" banner (only when at least one needs action)

Filter (client-side, public-portal.tsx:44): `!approvedAt && !declinedAt`. Server sends every
**sent** estimate for this customer (`crm_estimates.sent_at IS NOT NULL`, portal.ts:1349-1351,
ordered newest first). No void/expiry/cancel filter exists anywhere in this pipeline.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "You have N estimates to review" card title | count + banner | Tells the client how many estimates are waiting for their decision | public-portal.tsx:69-75 (N = `needsAction.length`) | portal.ts:1349-1351 → `crm_estimates` WHERE `customer_id = $cust AND sent_at IS NOT NULL`; N = those without `approved_at`/`declined_at` (client-side). **Ignores `expires_at` and `status`** | API/JSON: N=82. SQL: `SELECT count(*) … AND approved_at IS NULL AND declined_at IS NULL` = 82 ✓ — but `… AND expires_at >= now()` = **0**, i.e. all 82 expired 2026-08-09. Server refuses actions on expired estimates with 410 (portal.ts:732, 824) and the /e page renders only an "This estimate expired on …" notice (public-estimate.tsx:425-433). Cancelled scope-option estimates (`status='cancelled'`, set at portal.ts:922; 121 cancelled/expired sent estimates exist DB-wide) would also be counted. Rendered page shows "You have 82 estimates to review" over rows all marked "expires 8/9/2026" (screenshot `shots/audit17/portal-expired-banner.png`) | **BUG** |
| Estimate row `<a data-testid="portal-estimate-{id}">` (per estimate) | link row | Opens that estimate's public page to review/approve/decline it | public-portal.tsx:77-89 | Row data from same payload: `number`, `title`, `total_cents`, `expires_at`; `link = /e/{public_token}` (portal.ts:1402). Landing route `/e/:token` exists at App.tsx:240 | Route App.tsx:240 ✓; API `link` = `/e/bd907a…`; total 30000 = DB `total_cents` 30000 ✓; expires 2026-08-09 = DB ✓ | OK (see banner BUG above: leads expired estimates to a dead-end notice) |
| "Review →" CTA span inside the row | styled span (part of the link) | The visual call-to-action on the row | public-portal.tsx:86 | client only (pointer-events-none span inside the `<a>`) | code only | OK |

### "Invoices to pay" banner (only when at least one open)

Filter (client-side, public-portal.tsx:45): `!paidAt && dueCents > 0`. Server sends every sent,
non-voided invoice (portal.ts:1352-1355: `sent_at IS NOT NULL AND voided_at IS NULL`) with
`dueCents = max(0, total_cents − retainage_cents − paid_cents)` (portal.ts:1366-1367).

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "You have N invoices to pay" card title | count + banner | Tells the client how many unpaid invoices they have | public-portal.tsx:94-100 | as above; N = rows with `paid_at IS NULL` and computed `dueCents > 0` | API/JSON: N=1. SQL `… paid_at IS NULL AND greatest(total-retainage-paid,0)>0` = 1 ✓ (INV-1065) | OK |
| Invoice row `<a data-testid="portal-invoice-{id}">` (per open invoice) | link row | Opens that invoice's public page (pay or view) | public-portal.tsx:102-118 | `dueCents` = `max(0, total_cents − retainage_cents − paid_cents)`; `link = /i/{public_token}` (portal.ts:1388); route `/i/:token` at App.tsx:241 ✓ | INV-1065: API dueCents 937856 = SQL `937856−0−0` ✓; dueAt 2026-08-30 = DB ✓ | OK |
| "Pay" vs "View" CTA on the row | label | Says "Pay" when online payment is actually offered for this amount, otherwise "View" | public-portal.tsx:113-115 (`i.payOnline === false ? "View" : "Pay"`) | portal.ts:1387: `payOnline = dueCents >= 50 AND onlinePaymentRails(org, dueCents).ach∨card` → payments.ts:79 `onlinePaymentRails` = Stripe configured (payments.ts:56-62) + connected account (`crm_payment_accounts`, not disconnected, `charges_enabled`) + rail capability ∩ org policy (`custom_fields->payments`, incl. `achOnlyOverCents`) | API `payOnline:false` on dev (Stripe off — expected); label logic code-verified; rails math cross-checked against payments.ts:115-127 | OK |
| Paid/voided invoices excluded from banner | hidden filter | Paid and voided invoices don't appear in the "to pay" list | public-portal.tsx:45 | `voided_at IS NULL` (portal.ts:1354); paid filtered client-side | Kane: 27 sent invoices in DB, 25 voided → banner/history show exactly the 2 non-void ✓ | OK |

### "Your estimates" card (always rendered)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Your estimates" card title | text | Heading over the full estimate history | public-portal.tsx:123-128 | client only | code only | OK |
| "Nothing here yet" EmptyState | empty state | Shown when the client has no estimates | public-portal.tsx:130-133 | client only (renders only when `estimates.length === 0`) | seen rendered for Aspire "Vitest theme" customer (screenshot) | OK |
| Estimate history row `<a>` (per estimate) | link row | Opens the estimate; shows number, title, total, and a status pill (approved / declined / sent / viewed / cancelled…) | public-portal.tsx:134-146 | same rows as banner; pill text = `approved_at ? "approved" : declined_at ? "declined" : status` (status from `crm_estimates.status`); tone via `statusTone` (crm-ui.tsx:176) | API rows: 83 = SQL count of sent estimates ✓; 1 approved row matches SQL `approved_at IS NOT NULL` = 1 ✓ | OK |
| Status pill on each estimate row | badge | Colour-coded status of the estimate | public-portal.tsx:141-143 | client only | code only | OK |

### "Your invoices" card (only when at least one sent invoice exists) — `data-testid="portal-invoice-history"`

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Your invoices" title + "Open one to see what's been paid and what's still due." | text | Heading and hint for the invoice history | public-portal.tsx:152-157 | client only | code only | OK |
| Invoice history row `<a data-testid="portal-invoice-row-{id}">` (per invoice) | link row | Opens the invoice; shows total, "paid {date}" or "{amount} due", and a status pill. Paid invoices stay listed (by design, public-portal.tsx:46) | public-portal.tsx:159-172 | sent, non-voided invoices (portal.ts:1352-1355); pill = `paid_at ? "paid" : status`; `dueCents` as above | API 2 rows = SQL sent-not-void 2 ✓; INV-1001 shows `paidAt` 2026-07-29 = DB `paid_at` ✓, dueCents 0 ✓ (468928−46893 retainage−422035 paid) | OK |
| Status pill per invoice row | badge | paid / sent / partial / … | public-portal.tsx:169 | client only | code only | OK |

### "Your projects" card (only when at least one project exists)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Your projects" title + "Where your work stands right now." | text | Heading for the project list | public-portal.tsx:178-184 | client only | code only | OK |
| Project row (per project) | row (not a link) | Shows project name/number, optional start date, and a stage pill | public-portal.tsx:186-194 | portal.ts:1356-1357 → `crm_projects` WHERE `customer_id` (no org filter needed; customer-scoped), newest first; `stageLabel = CRM_PROJECT_STAGE_META[status].label ?? status` | API 67 rows = SQL count 67 ✓; all status `lead` → label "Lead" ✓; `startDate` nulls hidden ✓ | OK |
| Stage pill (`{p.stageLabel}`) | badge | The project's current stage in plain words | public-portal.tsx:192 | server-resolved label (CRM_PROJECT_STAGE_META) | "Lead" label matches meta; API `stageLabel` never equals raw status for Kane (meta covered) | OK |

### Page chrome

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Secure link — only people with this URL can see this page." footer note | text | Reassures the client the page is private | public-portal.tsx:199-201 | client only (accurate: no login, bearer-token-in-URL model, portal.ts:1341-1347) | code only | OK |
| PrintLockdown | behavior (invisible) | Blocks printing/screenshots of the portal; shows a notice if the client tries to print | public-portal.tsx:51 → client/src/components/print-lockdown.tsx | client only (CSS + `beforeprint` toast) | code only | OK |

---

## Public lead form (route `/lead-form/:token`)

Route: `client/src/App.tsx:243` (no doc comment). Header fetch:
`GET /api/public/leads/:token` (`public-lead-form.tsx:34-36`); submit:
`POST /api/public/leads/:token` (`public-lead-form.tsx:38-57`). Server:
`server/crm/lead-capture.ts` (`registerCrmLeadCaptureRoutes`).
Token = `crm_orgs.custom_fields->>'leadCaptureToken'` (format `orgId.hex`, compared with
`timingSafeEqual`, lead-capture.ts:71-82).

### Header

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Org logo `img` | image | Contractor's logo atop the form, if set | public-lead-form.tsx:94 | GET /api/public/leads/:token → lead-capture.ts:205-209 returns `{name, logoUrl}` = `crm_orgs.name`, `crm_orgs.logo_url` | `curl GET /api/public/leads/<SKU token>` → 200 `{"name":"SKU Dry-Run","logoUrl":null}` = DB ✓ | OK |
| Org name `h1` | text | Contractor's company name on the form | public-lead-form.tsx:95 | same | matches DB `crm_orgs.name` ✓ | OK |
| "Tell us about your project and we'll get back to you." | text | Form subtitle | public-lead-form.tsx:96-98 | client only | code only | OK |
| "This form isn't available" ErrorCard | state | Shown for a bad/rotated token | public-lead-form.tsx:81-87 | GET → 404 `{message:"This form is no longer available."}` (lead-capture.ts:207) | `curl GET …/bogus` → 404 ✓ | OK |
| Loading spinner | state | Spins while the form header loads | public-lead-form.tsx:77-79 | client only | code only | OK |

### The form (`data-testid="public-lead-form-root"`)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Name `input-lead-name` (label "Name *") | input (required) | Visitor's name — the only required field; submit stays disabled until it's non-empty (public-lead-form.tsx:162) | public-lead-form.tsx:122-126 (maxLength 200) | POST body `name` → zod `min(1,"Add your name").max(200)` (lead-capture.ts:89) → inserted into `crm_customers.display_name` (lead-capture.ts:234) | live POST: "AUDIT-L17 Lead" → row `display_name` ✓ (row deleted after) | OK |
| Email `input-lead-email` | input type=email | Visitor's email | public-lead-form.tsx:129-133 (maxLength 200) | zod `.email("Enter a valid email address")` (lead-capture.ts:90) → `crm_customers.email` | live: bad email → 400 issue `path:["email"]`; good email landed in column ✓ | OK |
| Phone `input-lead-phone` | input type=tel | Visitor's phone | public-lead-form.tsx:135-139 (maxLength 40) | zod max 40 (lead-capture.ts:91) → `crm_customers.phone` | live: "555-0177" in column ✓ | OK |
| Address `input-lead-address` | input | Job address | public-lead-form.tsx:142-146 (maxLength 300) | zod max 300 (lead-capture.ts:93) → `crm_customers.address_line1` | live: "1 Audit Way" in column ✓ | OK |
| "How can we help?" `textarea-lead-message` | textarea | Free-text project description | public-lead-form.tsx:148-152 (maxLength 5000, rows=4) | zod max 5000 (lead-capture.ts:92) → `crm_customers.notes` | live: "Audit test message" in `notes` ✓ | OK |
| At-least-one-contact rule | validation | The server refuses a lead with neither email nor phone | public-lead-form.tsx: shows issue under Email | `.refine(email||phone, "Add an email or phone so we can reach you", path:["email"])` (lead-capture.ts:96-100) | live POST `{name only}` → 400 with that exact message and `path:["email"]` ✓ (frontend maps it under the Email field) | OK |
| Per-field error texts (`text-lead-{field}-error`) | error text | Shows the server validation message under the offending field | public-lead-form.tsx:70-72, 125, 132, 138, 145, 151 | renders `issues[].path[0]` in FIELDS allowlist (name,email,phone,address,message) | 400 responses above carry the exact `path`/`message` shape the mapper consumes ✓ | OK |
| Form-level error `text-lead-error` | error text | General failure line when there's no per-field message | public-lead-form.tsx:161, 67 | set from `body.message` on non-ok | code only (shape verified via 400/404 responses) | OK |
| Honeypot "Website" input | hidden input | Invisible bot-trap. Bots fill it; the server then pretends success but saves nothing | public-lead-form.tsx:153-160 (off-screen, tabIndex −1, autocomplete off) | POST: `if (website) return 201 {ok:true}` — no insert, no notification (lead-capture.ts:227) | live POST with `website` filled → 201 `{ok:true}`, **no `crm_customers` row created** (count before/after = unchanged) ✓ | OK |
| "Send" `button-lead-submit` | button (submit) | Sends the lead to the contractor's CRM | public-lead-form.tsx:162-166 (disabled while pending or empty name) | POST /api/public/leads/:token → lead-capture.ts:216-249: validates → (honeypot/rate-limit decoys) → finds org owner's `crm_members` row (`ownerMemberId`, lead-capture.ts:113-121) → creates/finds per-org "Website" lead source (`crm_lead_sources`, lead-capture.ts:103-110) → INSERT `crm_customers` `{org_id, display_name, email, phone, address_line1, notes, lead_source_id, owner_member_id, tags:['website-lead'], portal_token: fresh random}` → 201 `{ok:true}` → fire-and-forget `notifyLeadReceived` (in-app bell item linking `/crm/clients/{id}` + email "🌐 New website lead — …" to owner-member/owner-role emails, gated by org pref `leadReceived`, lead-capture.ts:128-163). Rate limit: 10/IP/15min, tripped → same fake 201 (lead-capture.ts:47, 228) | live POST 201; row verified in SQL with every column correct (owner = owner-role member, tag `website-lead`, lead source "Website", fresh portal token); test row then deleted via `DELETE /api/crm/customers/:id` (200) and confirmed gone | OK |
| Success panel `text-lead-success` ("Thanks — we'll be in touch.") | state | Replaces the form after a successful send | public-lead-form.tsx:101-110 | client only (`onSuccess → setSent(true)`) | code only | OK |

---

## Bugs found

1. **Portal license badge is dead — never renders for anyone.**
   Owner sees: nothing (the "License … (WA)" line under the company contact info never appears).
   Truth: the frontend expects `company.licenseNumber`/`company.licenseState` (public-portal.tsx:61-66),
   but `GET /api/public/portal/:token` never sends them — portal.ts:1394-1397 builds `company` as
   `{name, phone, email, website, logoUrl}` only, while `crm_orgs.license_number`/`license_state`
   (shared/schema.ts:1108-1109) hold the data. Proven with Aspire Interiors, which has
   `license_number='CBC1264418'`, `license_state='FL'` in `crm_orgs`; the API response for its
   customer's portal contains no license fields and the rendered page shows no badge
   (SQL + API + screenshot `shots/audit17/portal-license-bug.png`).
   Fix: local and clear — add `licenseNumber: org.licenseNumber, licenseState: org.licenseState`
   to the company payload in server/crm/portal.ts:1394-1397 (or delete the JSX block).

2. **"You have N estimates to review" counts estimates the client can no longer act on.**
   Owner sees (Kane portal): "You have 82 estimates to review" with "Review →" buttons; every row
   says "expires 8/9/2026" and each Review click lands on an "This estimate expired on 8/9/2026 —
   contact us" dead-end (410 from portal.ts:732/824; expired-notice UI public-estimate.tsx:425-433;
   screenshot `shots/audit17/portal-expired-banner.png`).
   Truth: SQL `… AND approved_at IS NULL AND declined_at IS NULL` = 82, but
   `… AND (expires_at IS NULL OR expires_at >= now())` = **0** — all 82 are expired. The same
   client-side filter (public-portal.tsx:44) also has no `status` filter, so `cancelled`
   scope-option estimates (status set at portal.ts:922) and migrated `expired`-status estimates
   are counted as "to review" too, although the estimate page blocks them (portal.ts:226).
   Root cause: public-portal.tsx:44 — `needsAction` ignores `expiresAt` and `status`.
   Fix: local and clear — e.g. `estimates.filter(e => !e.approvedAt && !e.declinedAt &&
   e.status !== "cancelled" && (!e.expiresAt || new Date(e.expiresAt) > new Date()))`
   (mirrors the "canRespond" rule public-estimate.tsx:543). Severity depends on intent: if the
   banner is meant as "action required", it's wrong today for every customer whose estimates
   lapsed; if old estimates are meant to stay visible, they belong in the history list only.

## Element counts

- Public portal: 27 elements — 25 OK, 2 BUG (license badge; review-banner count). 0 UNCLEAR / 0 DEAD (the license badge is counted as BUG rather than DEAD because the data exists in the DB and the JSX is wired — the backend just never sends it).
- Lead form: 17 elements — 17 OK, 0 BUG / 0 UNCLEAR / 0 DEAD.
- Combined: 44 total / 42 OK / 2 BUG / 0 UNCLEAR / 0 DEAD.

## Routes with no doc comment (doc-comment candidates)

- `client/src/App.tsx:243` — `/lead-form/:token` → PublicLeadFormPage (embedded "contact us" form; token = org's leadCaptureToken). No comment above the route (or the surrounding public-route block).
- `client/src/App.tsx:244` — `/portal/:token` → PublicPortalPage (client self-service portal; token = customer's portal_token). Same block, no comment.
- (Same block, adjacent, also uncommented: `/e/:token`, `/i/:token`, `/co/:token` at App.tsx:240-242.)

## Not verified / caveats

- **Rate limit on lead POST** (10/IP/15min → silent fake 201, lead-capture.ts:47,228): verified by
  code + the identical honeypot decoy path live; deliberately not tripped (shared fixed-window
  buckets could affect other lanes' requests from 127.0.0.1).
- **Lead-notification email/bell**: verified by code (lead-capture.ts:128-163); dev SMTP sends are
  swallowed by `.catch`, and I did not want to poke other orgs' notification prefs.
- **payOnline "Pay" label**: Stripe is off on dev, so every row shows "View" here; the true-label
  path (`payOnline:true`) was verified by code against payments.ts:79-127 only.
- No org on dev has both a logo and portal data, so the logo branch was verified via `logoUrl`
  presence/absence in the API rather than a rendered image.


