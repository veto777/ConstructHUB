---
name: LSA schema bootstrap
description: How LSA tables are created/altered — use ensureLsaSchema, not db:push.
---

All LSA tables for BOTH systems are created/altered idempotently at boot in
`server/lsa/schema-ensure.ts` (`ensureLsaSchema`, called from `server/routes.ts`),
using raw `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
This covers the per-user self-service tables (`lsa_connections`, `lsa_accounts`,
`lsa_leads`) AND the admin Account-Manager tables (`lsa_manager_connection`,
`lsa_manager_accounts`, `lsa_manager_invitations`, `lsa_manager_leads`,
`admin_audit_log`).

**Why:** these tables are intentionally kept out of the Drizzle `db:push` flow so
they exist in every environment without a manual migration step, and so a stray
`db:push` doesn't drift/recreate them. A proactive background timer querying a
manager table that was never pushed will spam "relation does not exist" otherwise.

**How to apply:** when adding/changing any LSA table or column, edit
`schema-ensure.ts` (DDL must match `shared/schema.ts` exactly) AND `shared/schema.ts`.
Do NOT rely on `db:push` for LSA tables.
