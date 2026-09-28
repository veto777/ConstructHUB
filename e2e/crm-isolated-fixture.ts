import { test as base, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { q } from "./db";
import { switchOrg } from "./helpers";

/** A separate org per test means sweeps cannot grow with another test's data
 * or inherit its role changes. Only rows in this org are cleaned up. */
export const test = base.extend<{ crmOrgId: string }>({
  crmOrgId: [async ({ page }, use) => {
    const orgId = randomUUID();
    await q(`insert into crm_orgs(id, name, owner_user_id) values ($1, 'E2E isolated CRM', 1)`, [orgId]);
    await q(`insert into crm_members(org_id, user_id, email, role, status) values ($1, 1, 'e2e@example.invalid', 'owner', 'active')`, [orgId]);
    try {
      await switchOrg(page, orgId);
      expect((await (await page.request.get('/api/crm/me')).json()).org.id).toBe(orgId);
      await use(orgId);
    } finally {
      await page.close();
      const tables = await q<{ table_name: string }>(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'org_id' and table_name like 'crm_%'`);
      for (const { table_name } of tables) {
        if (!/^crm_[a-z_]+$/.test(table_name)) throw new Error('Unexpected CRM table');
        await q(`delete from "${table_name}" where org_id = $1`, [orgId]);
      }
      await q(`delete from crm_orgs where id = $1`, [orgId]);
    }
  }, { auto: true }],
});
