/**
 * Throwaway accounts for the dashboard tests (aggregate.test.ts, route.test.ts):
 * real rows in the lane's development database, every one owned by a user
 * created here and deleted in `cleanup`. Shared dev data is never touched.
 *
 *   none     — no plan, no CRM org
 *   starter  — Starter (Stripe, active), nothing set up
 *   agency   — Agency (Stripe, active) with Google, reviews, Guard, a grid, a
 *              Site Scan, Click Guard visits, searches, notifications and a CRM
 *              org (customer, lead, sold job, estimates, visits, team activity);
 *              also an admin member of `other`'s org (for the pinned-org test)
 *   other    — Growth, with its OWN rows in every table the agency user's tiles
 *              read: none of them may ever show up on the agency dashboard
 *   teammate — no plan; on the agency user's Agency team (agency_members)
 */
import pg from "pg";
import { randomUUID } from "node:crypto";

export type Seeded = {
  none: number; starter: number; agency: number; other: number; teammate: number;
  agencyOrg: string; otherOrg: string;
  users: number[];
};

const month = () => new Date().toISOString().slice(0, 7);

export function assertDevDatabase(url = process.env.DATABASE_URL): void {
  if (!url) throw new Error("DATABASE_URL is required");
  const u = new URL(url);
  if (!["localhost", "127.0.0.1", "::1"].includes(u.hostname) || !/^\/constructhub_dev(?:_a\d+)?$/.test(u.pathname)) {
    throw new Error("The dashboard tests require a local ConstructHUB development database");
  }
}

export async function seedDashboardAccounts(pool: pg.Pool, tag = randomUUID().slice(0, 8)): Promise<Seeded> {
  const users: number[] = [];
  try {
    return await seed(pool, tag, users);
  } catch (err) {
    // A half-seeded run still cleans up after itself.
    await cleanupDashboardAccounts(pool, { users } as Seeded).catch(() => {});
    throw err;
  }
}

async function seed(pool: pg.Pool, tag: string, users: number[]): Promise<Seeded> {
  const q = (text: string, params: unknown[] = []) => pool.query(text, params).then((r) => r.rows);
  const user = async (name: string) => {
    const [u] = await q("INSERT INTO users(email, display_name, email_verified) VALUES($1,$2,true) RETURNING id", [`dash-${tag}-${name.split(" ")[0].toLowerCase()}@example.invalid`, name]);
    users.push(u.id);
    return u.id as number;
  };
  const plan = (userId: number, key: string) =>
    q("INSERT INTO subscriptions(user_id, plan, status, stripe_subscription_id, current_period_end) VALUES($1,$2,'active',$3, now() + interval '20 days')",
      [userId, key, `sub_dash_${randomUUID()}`]);

  const none = await user("Nora None");
  const starter = await user("Sam Starter");
  const agency = await user("Dana Agency");
  const other = await user("Otto Other");
  const teammate = await user("Tess Teammate");
  await plan(starter, "starter");
  await plan(agency, "agency");
  await plan(other, "growth");

  // ── Grow / Protect / Win rows for a user ────────────────────────────────
  async function growthRows(userId: number, n: { locations: number; reviews: [number, string, boolean][]; visits: number; searches: number }) {
    const locs: number[] = [];
    for (let i = 0; i < n.locations; i++) {
      const [l] = await q("INSERT INTO business_locations(user_id, business_name) VALUES($1,$2) RETURNING id", [userId, `Dash ${tag} ${userId} #${i}`]);
      locs.push(l.id);
    }
    for (const [rating, age, replied] of n.reviews) {
      await q(`INSERT INTO google_profile_reviews(user_id, location_id, reviewer_name, rating, review_date, reply_comment)
               VALUES($1,$2,'Reviewer',$3, now() - $4::interval, $5)`, [userId, locs[0], rating, age, replied ? "Thanks!" : null]);
    }
    const [d] = await q("INSERT INTO tracked_domains(user_id, domain, tracking_id) VALUES($1,$2,$3) RETURNING id", [userId, `dash-${tag}-${userId}.example.invalid`, `trk-${randomUUID()}`]);
    for (let i = 0; i < n.visits; i++) {
      await q("INSERT INTO click_visits(domain_id, ip_address, is_suspicious, visited_at) VALUES($1,$2,true, now() - interval '1 hour')", [d.id, `198.51.100.${(i % 200) + 1}`]);
    }
    for (let i = 0; i < n.searches; i++) {
      await q("INSERT INTO search_queries(user_id, search_type, search_value) VALUES($1,'county','Dash County')", [userId]);
    }
    return { locs, domainId: d.id as number };
  }

  // The agency user: two locations; reviews 5★ (2 days, replied), 4★ (20 days, replied), 3★ (20 days, unanswered)
  // and a Google-deleted 1★ that must not count.
  const a = await growthRows(agency, { locations: 2, reviews: [[5, "2 days", true], [4, "20 days", true], [3, "20 days", false]], visits: 0, searches: 2 });
  await q("INSERT INTO google_profile_reviews(user_id, location_id, reviewer_name, rating, review_date, google_deleted) VALUES($1,$2,'Gone',1, now(), true)", [agency, a.locs[0]]);
  await q("INSERT INTO gbp_grants(user_id, google_subject, email, scopes) VALUES($1,$2,$3,'{}')", [agency, `sub-${tag}`, `dash-${tag}@example.invalid`]);
  await q("INSERT INTO gbp_guard(location_id, user_id, mode, checked_at) VALUES($1,$2,'notify', now() - interval '5 minutes')", [a.locs[0], agency]);
  await q("INSERT INTO gbp_guard_changes(location_id, user_id, field, source, evidence, status) VALUES($1,$2,'phone','Google update','{}'::jsonb,'pending')", [a.locs[0], agency]);
  await q(`INSERT INTO ranking_grid_scans(user_id, business_name, place_id, lat, lon, keyword, status, average_rank)
           VALUES($1,'Dash','place','0','0','roofer','completed','3.4')`, [agency]);
  await q(`INSERT INTO sitescan_jobs(id, user_id, url, page_cap, state, status, report, completed_at)
           VALUES(gen_random_uuid(), $1, 'https://dash.example.invalid', 5, '{}'::jsonb, 'completed', '{"scores":{"overall":72}}'::jsonb, now() - interval '1 day')`, [agency]);
  // Three visits this week from two IPs (two suspicious), one suspicious visit 40 days ago (outside every window).
  await q(`INSERT INTO click_visits(domain_id, ip_address, is_suspicious, visited_at) VALUES
           ($1,'203.0.113.1',true, now() - interval '1 hour'), ($1,'203.0.113.1',true, now() - interval '2 days'),
           ($1,'203.0.113.2',false, now() - interval '3 days'), ($1,'203.0.113.3',true, now() - interval '40 days')`, [a.domainId]);
  await q("INSERT INTO agency_clients(user_id, name) VALUES($1,'Dash client')", [agency]);
  await q("INSERT INTO agency_members(user_id, member_id, role) VALUES($1,$2,'manager')", [agency, teammate]);
  await q("INSERT INTO growth_budgets(key, period, used) VALUES($1,'0',7)", [`quota:user:${agency}:searches:${month()}`]);
  await q(`INSERT INTO user_notifications(user_id, kind, title, body, link, severity, read_at, created_at) VALUES
           ($1,'gbp.new_review','New Google review','Reviewer: 5 stars.','/google-reviews','info', NULL, now() - interval '1 hour'),
           ($1,'gbp.profile_change','Business Profile change detected',NULL,'/locations','warning', now(), now() - interval '2 hours'),
           ($1,'gbp.new_review','Old review',NULL,'/google-reviews','info', NULL, now() - interval '40 days')`, [agency]);

  // ── The other user: more of everything, all of it theirs ────────────────
  const o = await growthRows(other, { locations: 3, reviews: [[1, "1 day", false], [1, "1 day", false]], visits: 5, searches: 4 });
  await q("INSERT INTO gbp_grants(user_id, google_subject, email, scopes) VALUES($1,$2,$3,'{}')", [other, `sub-o-${tag}`, `dash-o-${tag}@example.invalid`]);
  await q("INSERT INTO gbp_guard(location_id, user_id, mode) VALUES($1,$2,'lockdown'),($3,$2,'notify')", [o.locs[0], other, o.locs[1]]);
  await q("INSERT INTO agency_clients(user_id, name) VALUES($1,'Other client 1'),($1,'Other client 2')", [other]);
  await q("INSERT INTO user_notifications(user_id, kind, title, severity) VALUES($1,'gbp.new_review','Other user notification','info')", [other]);

  // ── CRM orgs ────────────────────────────────────────────────────────────
  async function org(ownerId: number, name: string) {
    const [g] = await q(`INSERT INTO crm_orgs(name, owner_user_id, phone, address_line1, city, state) VALUES($1,$2,'555-0100','1 Main St','Tampa','FL') RETURNING id`, [name, ownerId]);
    const [m] = await q(`INSERT INTO crm_members(org_id, user_id, email, role, status, display_name, phone, created_at)
                         VALUES($1,$2,$3,'owner','active','Owner','555-0101', now() - interval '30 days') RETURNING id`, [g.id, ownerId, `owner-${tag}-${ownerId}@example.invalid`]);
    return { id: g.id as string, ownerMember: m.id as string };
  }
  const customer = async (orgId: string, name: string) =>
    (await q("INSERT INTO crm_customers(org_id, display_name, portal_token) VALUES($1,$2,$3) RETURNING id", [orgId, name, randomUUID()]))[0].id as string;
  const project = (orgId: string, customerId: string, status: string, cents: number | null) =>
    q("INSERT INTO crm_projects(org_id, customer_id, name, status, contract_value_cents) VALUES($1,$2,'Job',$3,$4)", [orgId, customerId, status, cents]);
  const estimate = (orgId: string, customerId: string, status: string, cents: number) =>
    q("INSERT INTO crm_estimates(org_id, customer_id, status, total_cents, public_token) VALUES($1,$2,$3,$4,$5)", [orgId, customerId, status, cents, randomUUID()]);

  const ao = await org(agency, `Dash ${tag} Agency Co`);
  const ac = await customer(ao.id, "Alice Client");
  await project(ao.id, ac, "lead", null);
  await project(ao.id, ac, "approved", 500_000);
  await estimate(ao.id, ac, "sent", 120_000);
  await estimate(ao.id, ac, "approved", 250_000);
  await q(`INSERT INTO crm_appointments(org_id, title, status, starts_at, created_by_member_id) VALUES
           ($1,'Today visit','scheduled', date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 minute', $2),
           ($1,'Later visit','scheduled', date_trunc('day', now() AT TIME ZONE 'UTC') + interval '3 days', $2),
           ($1,'Cancelled visit','canceled', date_trunc('day', now() AT TIME ZONE 'UTC') + interval '2 minutes', $2)`, [ao.id, ao.ownerMember]);
  await q("INSERT INTO crm_team_activity(org_id, member_id, type, title, link, created_at) VALUES($1,$2,'note','sent estimate 1001','/crm/clients/x', now() - interval '30 minutes')", [ao.id, ao.ownerMember]);

  const oo = await org(other, `Dash ${tag} Other Co`);
  for (const name of ["B1", "B2", "B3", "B4"]) {
    const c = await customer(oo.id, name);
    await estimate(oo.id, c, "sent", 990_000);
    await project(oo.id, c, "lead", 10_000);
  }
  // The agency user is an admin in the other org too — a newer membership, so not the default.
  await q("INSERT INTO crm_members(org_id, user_id, email, role, status, created_at) VALUES($1,$2,$3,'admin','active', now())", [oo.id, agency, `admin-${tag}@example.invalid`]);

  return { none, starter, agency, other, teammate, agencyOrg: ao.id, otherOrg: oo.id, users };
}

export async function cleanupDashboardAccounts(pool: pg.Pool, s: Seeded | undefined): Promise<void> {
  if (!s) return;
  const q = (text: string, params: unknown[] = []) => pool.query(text, params);
  const users = s.users;
  const orgs = (await pool.query("SELECT id FROM crm_orgs WHERE owner_user_id = ANY($1::int[])", [users])).rows.map((r) => r.id);
  for (const t of ["crm_team_activity", "crm_appointments", "crm_estimates", "crm_projects", "crm_customers", "crm_members"]) {
    await q(`DELETE FROM ${t} WHERE org_id = ANY($1::varchar[])`, [orgs]);
  }
  await q("DELETE FROM crm_members WHERE user_id = ANY($1::int[])", [users]);
  await q("DELETE FROM crm_orgs WHERE id = ANY($1::varchar[])", [orgs]);
  await q("DELETE FROM click_visits WHERE domain_id IN (SELECT id FROM tracked_domains WHERE user_id = ANY($1::int[]))", [users]);
  for (const t of ["tracked_domains", "google_profile_reviews", "ranking_grid_scans", "search_queries", "review_requests", "subscriptions", "business_locations"]) {
    await q(`DELETE FROM ${t} WHERE user_id = ANY($1::int[])`, [users]);
  }
  await q("DELETE FROM growth_budgets WHERE key LIKE ANY($1)", [users.map((u) => `quota:user:${u}:%`)]);
  await q("DELETE FROM session WHERE sess::text LIKE ANY($1)", [users.map((u) => `%\"user\":${u}}%`)]);
  await q("DELETE FROM users WHERE id = ANY($1::int[])", [users]);
}
