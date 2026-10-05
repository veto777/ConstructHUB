# App Privacy answers (App Store Connect → each app → App Privacy)

Apple has no API for these, so they are entered once on the website. They must match the privacy policies
(`/privacy` for ConstructHUB, `/crm-privacy` for the CRM) and what the apps really do (checked 2026-10-05):
no ads, no analytics or advertising SDKs, no tracking; browser error reports carry no user id
(`server/ops/client-errors.ts`); permit/property searches are not stored as text.

**Privacy Policy URL** is already set by the API.

## Both apps — the first question
"Do you or your third-party partners collect data from this app?" → **Yes, we collect data from this app**.

For **every** data type below, the follow-up answers are the same unless the row says otherwise:
- Purpose: **App Functionality** (only)
- Linked to the user's identity: **Yes**
- Used for tracking: **No**

## ConstructHUB: Contractor Tools

| Category | Data type | Notes |
|---|---|---|
| Contact Info | Name | account / company name |
| Contact Info | Email Address | sign-in, account email |
| Contact Info | Phone Number | profile, business phone |
| Contact Info | Physical Address | business address |
| User Content | Emails or Text Messages | review requests and messages the user sends to their customers |
| User Content | Photos or Videos | business photos, posts, attachments |
| User Content | Audio Data | AI Call Assistant call recordings |
| User Content | Other User Content | review replies, posts, documents |
| Identifiers | User ID | the account id |
| Identifiers | Device ID | the push-notification token (only if notifications are turned on) |
| Usage Data | Product Interaction | the account activity / audit log (sign-ins, security changes) |
| Diagnostics | Other Diagnostic Data | **Linked: No** — anonymous error reports |

## ConstructHUB CRM

| Category | Data type | Notes |
|---|---|---|
| Contact Info | Name | the user, and the clients they add |
| Contact Info | Email Address | |
| Contact Info | Phone Number | |
| Contact Info | Physical Address | client and job addresses |
| Financial Info | Other Financial Info | invoice and payment amounts recorded for the business (no card numbers — Stripe holds those) |
| User Content | Emails or Text Messages | client messages and texts |
| User Content | Photos or Videos | job photos |
| User Content | Other User Content | estimates, signatures, notes, documents |
| Identifiers | User ID | |
| Identifiers | Device ID | the push-notification token (only if notifications are turned on) |
| Usage Data | Product Interaction | the activity / audit log |
| Diagnostics | Other Diagnostic Data | **Linked: No** — anonymous error reports |

Everything not listed: **not collected** (Health, Location, Sensitive Info, Contacts, Browsing History, Search
History, Purchases, Advertising Data, Crash Data, Performance Data, Surroundings, Body, Other Data).

After saving the answers, click **Publish** at the top right of the App Privacy page.
