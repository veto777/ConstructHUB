/**
 * SIGN IN AS A DEMO TEAM MEMBER — tutorial fixture. Recording slots only (../gate.ts).
 *
 * A slot signs every request in as the demo owner (DEV_AUTH_BYPASS_USER1). To film what a crew
 * member or a salesperson sees, the recorder's second browser session opens
 * /__tutorial/auth/as?member=<name> and gets a REAL passport session for that member's user — the
 * dev bypass never overrides a real session (server/test-auth.ts), so every permission check then
 * runs as that member. The user row is created on first use and marked (`account_id` tutfx-…).
 *
 * There is no stand-in for the homeowner here: the client portal's own emailed sign-in link is
 * used (email.link).
 */
import type { Router } from "express";
import { FIXTURE_MARK } from "../gate";
import { defineProviderFixture, requireTutorialFixtures } from "../registry";

function routes(r: Router) {
  r.get("/as", async (req: any, res) => {
    try {
      requireTutorialFixtures("signing in as a demo member");
      const name = String(req.query.member || "");
      const { pool } = await import("../../../db");
      const { rows: [m] } = await pool.query(
        `select m.id, m.email, m.display_name, m.user_id from crm_members m join crm_orgs o on o.id = m.org_id
          where o.name = 'Aspire Interiors' and m.status = 'active' and m.display_name = $1 limit 1`, [name]);
      if (!m) return res.status(404).type("text/plain").send(`no active demo member named "${name}"`);
      if (!/@([a-z0-9-]+\.)*example\.com$/i.test(m.email)) return res.status(400).type("text/plain").send("that member's email is not an example.com address");
      let userId: number | null = m.user_id;
      if (!userId) {
        const { rows: [u] } = await pool.query(
          `insert into users (email, display_name, email_verified, company_name, account_id) values ($1,$2,true,'Aspire Interiors',$3)
           on conflict (email) do update set display_name = excluded.display_name returning id`, [m.email.toLowerCase(), m.display_name, `${FIXTURE_MARK.id}user-${m.id}`]);
        userId = u.id;
        await pool.query(`update crm_members set user_id = $2 where id = $1`, [m.id, userId]);
      }
      const { rows: [user] } = await pool.query(`select * from users where id = $1`, [userId]);
      // The same shape passport deserialises (server/auth.ts): camelCase fields of the row.
      const shaped: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(user)) shaped[k.replace(/_([a-z])/g, (_x, c: string) => c.toUpperCase())] = v;
      req.login(shaped, (err: unknown) => {
        if (err) return res.status(500).type("text/plain").send("could not start the session");
        const next = String(req.query.next || "/crm");
        res.redirect(302, /^\/[a-z0-9/_-]*$/i.test(next) ? next : "/crm");
      });
    } catch (e: any) {
      res.status(400).type("text/plain").send(String(e?.message || e).slice(0, 200));
    }
  });
}

export const authFixture = defineProviderFixture({
  id: "auth",
  simulates: "A second signed-in person: a real session for one of the demo company's own team members (crew, sales, project manager).",
  seam: "none in feature code — a local-only route that calls passport's req.login(); the dev bypass yields to a real session",
  routes,
  actions: {
    /**
     * {} — the demo owner's first day: the "Finish setting up" card on Home shows only while a required
     * step is open, and the demo workspace is complete. This clears the owner's own mobile number and
     * the checklist's "dismissed" stamp IN THIS SLOT'S COPY, so the card is there to be worked through.
     * Run it from the script's `before` list (it happens before the camera starts); the video then fills
     * the number back in. Nothing else of the workspace changes.
     */
    unfinishedSetup: async (_input, { orgId }) => {
      requireTutorialFixtures("an unfinished setup checklist");
      const { pool } = await import("../../../db");
      const { rowCount } = await pool.query(`update crm_members set phone = null where org_id = $1 and role = 'owner'`, [orgId]);
      await pool.query(`update crm_orgs set onboarding_dismissed_at = null where id = $1`, [orgId]);
      return { owners: rowCount ?? 0, checklist: "open: Your profile" };
    },
  },
});
