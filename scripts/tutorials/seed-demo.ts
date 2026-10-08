/**
 * Extra demo data for the walkthrough videos, on top of scripts/seed-crm-demo.ts ("Aspire
 * Interiors", Sarasota FL): a CRM plan, two more team members, a week of appointments around today,
 * message threads, JobCam photos, payments in several states, and clients in New York and Texas
 * with their own jobs, estimates, invoices, visits and messages — so no page is empty on camera.
 *
 *   DATABASE_URL=<a recording database> npx tsx scripts/tutorials/seed-demo.ts
 *
 * Runs when the template is built AND on every fresh recording database (produce.ts): it is
 * idempotent (fixed ids, insert-if-absent; the ids of clients and projects are uuids — demo-ids.ts
 * says why — and a workspace seeded with the old readable ones is renamed first), and it moves every date of the workspace forward by
 * the days that have passed since it was seeded, so "today" on the schedule is always today.
 * Everything it writes is ONE transaction: a copy of the template taken while it runs (`db.ts
 * reseed` applies it to the live template) sees the workspace before it or after it, never half.
 * ADDITIVE ONLY — step scripts find rows by name: never rename, reorder or delete a demo row.
 *
 * HARD RULES: everything here is fictional. Emails end in example.com, phones are 555-01xx, the
 * photos are the drawn job-site scenes of scripts/tutorials/assets/photos (gen-assets.ts: flat
 * illustration, nobody's house). Never copy a real
 * customer, address or job into this file — and it refuses any database that is not a recording
 * database on 127.0.0.1:5432.
 */
import { spawnSync } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { DEMO_CLIENT_KEYS, DEMO_PROJECT_NUMBERS, UUID_RE, demoClientId, demoProjectId, demoUuid, demoUuidIds, legacyIdMap, type DemoProjectNumber } from "./demo-ids";

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error("DATABASE_URL is not set");
{
  const u = new URL(raw);
  const where = `${u.pathname.slice(1)} ${u.searchParams.get("options") ?? ""}`;
  if (u.hostname !== "127.0.0.1" || (u.port || "5432") !== "5432" || !/constructhub_tut_[a-z0-9_]+/.test(where))
    throw new Error("seed-demo.ts only writes to a constructhub_tut_* recording database on 127.0.0.1:5432");
}
const { pool } = await import("../../server/db");
const client = await pool.connect();
const q = async (sql: string, params: unknown[] = []) => (await client.query(sql, params as any[])).rows;

const DAY = 86400000;
/** A wall-clock time in the workspace's time zone (America/New_York), `day` days from today, as a UTC Date. */
function local(day: number, hour: number, minute = 0): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + day * DAY));
  const guess = new Date(`${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  const shown = new Date(guess.toLocaleString("en-US", { timeZone: "America/New_York" }) + " UTC");
  return new Date(guess.getTime() + (guess.getTime() - shown.getTime()));
}
const ago = (minutes: number) => new Date(Date.now() - minutes * 60000);

/**
 * A workspace seeded before 2026-10-08 has its New York / Texas clients and projects under readable
 * ids (`demo-client-hadley`, `demo-project-p-1997`) that the app refuses (demo-ids.ts). Rename them
 * to their uuids — the row itself and every column that points at it — inside this seed's one
 * transaction: nothing is deleted or re-made, so tokens, dates and document numbers stay as they
 * were. The tables have no foreign keys; a reference is any text column holding the id, so every
 * text column of every CRM / JobCam table is rewritten, and afterwards NOTHING may still hold an old
 * id (not in an array or a JSON value either) and no table may have gained or lost a row — else the
 * seed throws and the transaction rolls back. A no-op once done.
 */
async function renameLegacyIds(orgId: string): Promise<string | null> {
  const map = legacyIdMap();
  const from = map.map((m) => m.from), to = map.map((m) => m.to);
  for (const id of to) if (!UUID_RE.test(id)) throw new Error(`${id} is not a uuid`);
  const [{ n: present }] = await q(`select (select count(*) from crm_customers where id = any($1::text[]))::int + (select count(*) from crm_projects where id = any($1::text[]))::int as n`, [from]);
  if (!present) return null;
  const clash = await q(`select id from crm_customers where id = any($1::text[]) union all select id from crm_projects where id = any($1::text[])`, [to]);
  if (clash.length) throw new Error(`cannot rename the old demo ids: ${clash.length} uuid row(s) already exist beside them (${clash[0].id}…) — this workspace was seeded twice`);
  const cols = await q(`select c.table_name as t, c.column_name as c, c.data_type as d from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = current_schema() and (c.table_name like 'crm\\_%' or c.table_name like 'jobcam\\_%')
       and c.data_type in ('character varying', 'text', 'ARRAY', 'jsonb', 'json') order by 1, 2`);
  const tables = [...new Set(cols.map((c) => c.t as string))];
  const census = async () => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, Number((await q(`select count(*)::int as n from "${t}"`))[0].n)] as const)));
  const before = await census();
  let rows = 0;
  for (const c of cols) if (c.d === "character varying" || c.d === "text")
    rows += (await client.query(`update "${c.t}" as x set "${c.c}" = m.new from unnest($1::text[], $2::text[]) as m(old, new) where x."${c.c}" = m.old`, [from, to])).rowCount ?? 0;
  for (const c of cols) {
    const left = await q(`select "${c.c}"::text as v from "${c.t}" where "${c.c}"::text ~ 'demo-(client|project)-' limit 1`);
    if (left.length) throw new Error(`after the rename ${c.t}.${c.c} still holds an old demo id (${String(left[0].v).slice(0, 80)})`);
  }
  const after = await census();
  for (const t of tables) if (before[t] !== after[t]) throw new Error(`the rename changed the row count of ${t} (${before[t]} → ${after[t]})`);
  const [{ n: now }] = await q(`select (select count(*) from crm_customers where org_id = $2 and id = any($1::text[]))::int + (select count(*) from crm_projects where org_id = $2 and id = any($1::text[]))::int as n`, [to, orgId]);
  if (now !== present) throw new Error(`the rename moved ${now} of ${present} old demo rows`);
  return `renamed ${present} old demo ids to uuids (${rows} values in ${tables.length} tables, row counts unchanged)`;
}

async function main() {
  const [org] = await q(`select id, owner_user_id from crm_orgs where name = 'Aspire Interiors' limit 1`);
  if (!org) throw new Error("Aspire Interiors does not exist — run scripts/seed-crm-demo.ts first");
  const orgId: string = org.id;
  const seeded = demoUuidIds();
  const renamed = await renameLegacyIds(orgId);

  // ── Keep "now" current: shift every date of the workspace by the days since the last run ─────────
  await q(`create table if not exists tutorial_demo_state (key text primary key, value text not null)`);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const [anchor] = await q(`select value from tutorial_demo_state where key = 'anchor'`);
  if (anchor && anchor.value !== today) {
    const days = Math.round((Date.parse(today) - Date.parse(anchor.value)) / DAY);
    const cols = await q(`select table_name, column_name from information_schema.columns
      where table_schema = current_schema() and data_type like 'timestamp%' and (table_name like 'crm\\_%' or table_name like 'jobcam\\_%')
        and table_name in (select table_name from information_schema.columns where table_schema = current_schema() and column_name = 'org_id')`);
    const byTable = new Map<string, string[]>();
    for (const c of cols) byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c.column_name]);
    for (const [table, columns] of byTable)
      await q(`update "${table}" set ${columns.map((c) => `"${c}" = "${c}" + make_interval(days => $2)`).join(", ")} where org_id = $1`, [orgId, days]);
    console.log(`moved the workspace's dates forward ${days} day(s)`);
  }
  await q(`insert into tutorial_demo_state (key, value) values ('anchor', $1) on conflict (key) do update set value = excluded.value`, [today]);

  // ── The workspace itself: a CRM plan, the right time zone, nothing that could be a real address ──
  await q(`insert into crm_subscriptions (user_id, plan, status, billing_interval, current_period_end)
           values ($1, 'crm_max', 'active', 'month', now() + interval '20 days') on conflict (user_id) do nothing`, [org.owner_user_id]);
  await q(`update crm_orgs set timezone = 'America/New_York', email = 'office@aspireinteriors.example.com', license_number = 'DEMO-FL-1001' where id = $1`, [orgId]);
  for (const table of ["crm_members", "crm_divisions"])
    await q(`update ${table} set email = replace(email, '@aspireinteriors.co', '@aspireinteriors.example.com') where org_id = $1 and email like '%@aspireinteriors.co'`, [orgId]);
  // ── Divisions: one per demo state, every address invented (batch D, 2026-10-08) ─────────────────
  // The base seed's two divisions read like a real business ("2211 Meridian St, Bellingham, WA" as
  // headquarters, "1847 Main Street, Sarasota"). The demo company works in Florida, New York and
  // Texas, so: Florida — Sarasota is the headquarters; the Washington row BECOMES New York — Albany
  // (same row, same id: nothing points at a division that is gone); Texas — Austin is added. Street
  // lines are made up ("Demo …", with a suite) and were not checked against real ones; only the
  // city / state / ZIP are real places. Licence numbers are DEMO-<state>-1001.
  // NO SALES-TAX RATE is set on any division or on the company: the app's own starting state
  // (PRODUCER-GUIDE.md "Sales tax"), and where crm-sales-tax begins.
  const txDivision = demoUuid("demo-division-tx");
  await q(`update crm_divisions set code = 'NY', name = 'Aspire Interiors — New York', email = 'ny@aspireinteriors.example.com', phone = '(518) 555-0142',
             address_line1 = '77 Demo Larkspur St', address_line2 = 'Suite 5', city = 'Albany', state = 'NY', postal_code = '12210', license_state = 'NY', is_headquarters = false, updated_at = now()
           where org_id = $1 and code = 'WA' and not exists (select 1 from crm_divisions where org_id = $1 and code = 'NY')`, [orgId]);
  await q(`update crm_divisions set address_line1 = '410 Demo Harbor Way', address_line2 = 'Suite 2', is_headquarters = true, updated_at = now()
           where org_id = $1 and code = 'FL' and (address_line1 = '1847 Main Street' or address_line2 is null)`, [orgId]);
  await q(`insert into crm_divisions (id, org_id, name, code, email, phone, address_line1, address_line2, city, state, postal_code, license_number, license_state, is_headquarters)
           values ($1, $2, 'Aspire Interiors — Texas', 'TX', 'tx@aspireinteriors.example.com', '(512) 555-0131', '1200 Demo Cedar Elm Blvd', 'Suite 140', 'Austin', 'TX', '78704', 'DEMO-TX-1001', 'TX', false)
           on conflict (id) do nothing`, [txDivision, orgId]);
  // The company's own address was the same street line: the same invented one as its Florida division.
  await q(`update crm_orgs set address_line1 = '410 Demo Harbor Way', address_line2 = 'Suite 2' where id = $1 and address_line1 = '1847 Main Street'`, [orgId]);
  await q(`update crm_divisions set license_number = 'DEMO-' || code || '-1001' where org_id = $1`, [orgId]);
  await q(`update crm_members set title = 'Owner' where org_id = $1 and role = 'owner' and title is null`, [orgId]);

  // ── Team: two more roles, and a calendar colour each ───────────────────────────────────────────
  for (const m of [
    { id: "demo-member-priya", email: "priya@aspireinteriors.example.com", role: "sales", name: "Priya Shah", title: "Sales & Estimating", phone: "(941) 555-0145" },
    { id: "demo-member-owen", email: "owen@aspireinteriors.example.com", role: "pm", name: "Owen Brooks", title: "Project Manager", phone: "(941) 555-0152" },
  ]) await q(`insert into crm_members (id, org_id, email, role, status, display_name, title, phone) values ($1,$2,$3,$4,'active',$5,$6,$7) on conflict (id) do nothing`,
    [m.id, orgId, m.email, m.role, m.name, m.title, m.phone]);
  const members = await q(`select id, role, display_name from crm_members where org_id = $1 order by created_at`, [orgId]);
  const colours = ["#2563eb", "#f97316", "#16a34a", "#9333ea", "#0891b2", "#db2777"];
  for (let i = 0; i < members.length; i++) await q(`update crm_members set calendar_color = coalesce(calendar_color, $2) where id = $1`, [members[i].id, colours[i % colours.length]]);
  const member = (name: string): string => { const m = members.find((x) => x.display_name === name); if (!m) throw new Error(`no member ${name}`); return m.id; };
  const owner: string = members.find((m) => m.role === "owner")!.id;

  let customers = await q(`select id, display_name from crm_customers where org_id = $1`, [orgId]);
  const customer = (name: string): string => { const c = customers.find((x) => x.display_name === name); if (!c) throw new Error(`no client ${name}`); return c.id; };
  let projects = await q(`select id, number from crm_projects where org_id = $1`, [orgId]);
  const project = (number: string): string => { const p = projects.find((x) => x.number === number); if (!p) throw new Error(`no project ${number}`); return p.id; };

  // ── Schedule: a working week around today ──────────────────────────────────────────────────────
  type Appt = { n: number; day: number; from: [number, number]; hours: number; title: string; client: string; project?: string; by: string; crew: string[]; notes?: string; status?: string };
  const appts: Appt[] = [
    { n: 1, day: -2, from: [8, 0], hours: 8, title: "Kane — hardwood install, day 1", client: "Joe & Mary Kane", project: "P-2001", by: "Rita Santos", crew: ["Marco Delgado", "Dee Okafor"], status: "completed" },
    { n: 2, day: -1, from: [8, 0], hours: 8, title: "Kane — hardwood install, day 2", client: "Joe & Mary Kane", project: "P-2001", by: "Rita Santos", crew: ["Marco Delgado", "Dee Okafor"], status: "completed" },
    { n: 3, day: -1, from: [15, 30], hours: 1, title: "Whitfield — measure kitchen", client: "Dana Whitfield", project: "P-2002", by: "Demo Account", crew: ["Priya Shah"], status: "completed" },
    { n: 4, day: 0, from: [8, 0], hours: 7, title: "Kane — stairs and trim", client: "Joe & Mary Kane", project: "P-2001", by: "Rita Santos", crew: ["Marco Delgado", "Dee Okafor"], notes: "Gate code is on the job page." },
    { n: 5, day: 0, from: [10, 30], hours: 1, title: "Orozco — walk the downstairs", client: "Luis Orozco", project: "P-2003", by: "Demo Account", crew: [], notes: "Bring LVP samples." },
    { n: 6, day: 0, from: [14, 0], hours: 1.5, title: "Mercer — lobby proposal review", client: "The Mercer Group", project: "P-2004", by: "Demo Account", crew: ["Priya Shah"] },
    { n: 7, day: 1, from: [9, 0], hours: 6, title: "Nguyen — punch list", client: "Lan Nguyen", project: "P-2007", by: "Owen Brooks", crew: ["Marco Delgado"] },
    { n: 8, day: 1, from: [13, 0], hours: 1, title: "Bauer — colour sign-off", client: "Tom & Priya Bauer", project: "P-2006", by: "Demo Account", crew: ["Dee Okafor"] },
    { n: 9, day: 2, from: [8, 0], hours: 8, title: "Ellison — master suite floors", client: "Greta Ellison", project: "P-2005", by: "Rita Santos", crew: ["Dee Okafor", "Marco Delgado"] },
    { n: 10, day: 3, from: [8, 0], hours: 8, title: "Ellison — master suite floors, day 2", client: "Greta Ellison", project: "P-2005", by: "Rita Santos", crew: ["Dee Okafor"] },
    { n: 11, day: 3, from: [11, 0], hours: 1, title: "Castellano — warranty check-in", client: "Vince Castellano", project: "P-2008", by: "Demo Account", crew: [] },
    { n: 12, day: 5, from: [9, 30], hours: 2, title: "Bauer — cabinet doors back from shop", client: "Tom & Priya Bauer", project: "P-2006", by: "Owen Brooks", crew: ["Dee Okafor"] },
  ];
  const addAppt = async (a: Appt) => {
    const starts = local(a.day, a.from[0], a.from[1]);
    await q(`insert into crm_appointments (id, org_id, project_id, customer_id, created_by_member_id, title, notes, status, starts_at, ends_at, dispatched_member_ids, completed_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (id) do nothing`,
      [`demo-appt-${String(a.n).padStart(2, "0")}`, orgId, a.project ? project(a.project) : null, customer(a.client), member(a.by), a.title, a.notes ?? null,
        a.status ?? "scheduled", starts, new Date(starts.getTime() + a.hours * 3600000), a.crew.map(member), a.status === "completed" ? new Date(starts.getTime() + a.hours * 3600000) : null]);
  };
  for (const a of appts) await addAppt(a);

  // The base seed books its two visits at "now + n days", to the second; put them on the working day instead.
  await q(`update crm_appointments set starts_at = date_trunc('day', starts_at) + interval '12 hours', ends_at = date_trunc('day', starts_at) + interval '20 hours'
           where org_id = $1 and id not like 'demo-appt-%' and extract(second from starts_at) <> 0`, [orgId]);

  // ── Messages: three client threads, one still waiting for an answer ────────────────────────────
  type Msg = { n: number; client: string; from: "client" | string; body: string; at: Date; read?: boolean };
  const msgs: Msg[] = [
    { n: 1, client: "Joe & Mary Kane", from: "client", body: "Morning! Will the crew need the garage cleared out before they start on the stairs?", at: local(-1, 7, 42), read: true },
    { n: 2, client: "Joe & Mary Kane", from: "Rita Santos", body: "Good morning. Just the side by the door, please — that is where the saw goes. Thank you!", at: local(-1, 7, 58) },
    { n: 3, client: "Joe & Mary Kane", from: "client", body: "Done. The floors look wonderful so far.", at: local(-1, 12, 15), read: true },
    { n: 4, client: "Luis Orozco", from: "client", body: "Can we look at a lighter oak colour for the downstairs before you finish the estimate?", at: ago(95) },
    { n: 5, client: "Greta Ellison", from: "client", body: "Is the start date for the master suite still on?", at: local(-3, 9, 10), read: true },
    { n: 6, client: "Greta Ellison", from: "Demo Account", body: "Yes — Dee and Marco will be there at 8. We will text when they are on the way.", at: local(-3, 9, 50) },
  ];
  const addMsg = async (m: Msg) => {
    await q(`insert into crm_client_comments (id, org_id, customer_id, body, author_member_id, created_at, read_at) values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
      [`demo-msg-${String(m.n).padStart(2, "0")}`, orgId, customer(m.client), m.body, m.from === "client" ? null : member(m.from), m.at, m.from === "client" && !m.read ? null : m.at]);
  };
  for (const m of msgs) await addMsg(m);

  // ── Payments in several states (the seed already has one paid invoice) ─────────────────────────
  type Pay = { n: number; client: string; project: string; provider: string; purpose: string; cents: number; method: string | null; status: string; note?: string; fail?: string; daysAgo: number };
  const pays: Pay[] = [
    { n: 1, client: "Greta Ellison", project: "P-2005", provider: "manual", purpose: "deposit", cents: 183600, method: "check", status: "succeeded", note: "Check #2291", daysAgo: 6 },
    { n: 2, client: "The Mercer Group", project: "P-2004", provider: "stripe", purpose: "deposit", cents: 258000, method: "ach", status: "pending", daysAgo: 1 },
    { n: 3, client: "Tom & Priya Bauer", project: "P-2006", provider: "stripe", purpose: "progress", cents: 115500, method: "card", status: "failed", fail: "The card was declined.", daysAgo: 2 },
    { n: 4, client: "Lan Nguyen", project: "P-2007", provider: "manual", purpose: "progress", cents: 249000, method: "cash", status: "succeeded", note: "Cash, receipt given on site", daysAgo: 9 },
  ];
  for (const p of pays) {
    const at = ago(p.daysAgo * 24 * 60);
    await q(`insert into crm_payments (id, org_id, customer_id, project_id, provider, purpose, amount_cents, method, status, note, failure_reason, paid_at, created_at, settled_cents)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (id) do nothing`,
      [`demo-pay-${String(p.n).padStart(2, "0")}`, orgId, customer(p.client), project(p.project), p.provider, p.purpose, p.cents, p.method, p.status, p.note ?? null, p.fail ?? null,
        p.status === "succeeded" ? at : null, at, p.status === "succeeded" ? p.cents : 0]);
  }

  // ── Clients in New York and Texas (owner request 2026-10-08) ───────────────────────────────────
  // ALL INVENTED: the people, the two companies and the street addresses are made up for the demo
  // and were NOT checked against real names or real addresses — only the city / state / ZIP pairs
  // are real places. Phones are 555-01xx, emails are example.com. `line2` is always a unit or suite.
  // The tax rate on these documents is a number typed on the document, exactly as on the Florida
  // ones (7%): the app does not look a rate up by state. A rate has to be whole basis points.
  type NewClient = { id: string; name: string; company?: string; email: string; phone: string; line1: string; line2: string; city: string; state: "NY" | "TX"; zip: string; tags?: string[]; after: string };
  const newClients: NewClient[] = [
    { id: demoClientId("ferrante"), name: "Rosa & Stefan Ferrante", email: "ferrantes@example.com", phone: "(718) 555-0167", line1: "214 Alder Row", line2: "Apt 3B", city: "Brooklyn", state: "NY", zip: "11215", after: "Nguyen" },
    { id: demoClientId("oyelaran"), name: "Tunde Oyelaran", email: "tunde.oyelaran@example.com", phone: "(518) 555-0126", line1: "58 Wren Hollow Ln", line2: "Unit 2", city: "Albany", state: "NY", zip: "12203", after: "Ellison" },
    { id: demoClientId("lindqvist"), name: "Hannah Lindqvist", email: "hannah.lindqvist@example.com", phone: "(716) 555-0139", line1: "301 Tamarack St", line2: "Apt 4", city: "Buffalo", state: "NY", zip: "14222", after: "Orozco" },
    { id: demoClientId("wrenhaven"), name: "Wrenhaven Dental Studio", company: "Wrenhaven Dental Studio", email: "office@wrenhavendental.example.com", phone: "(914) 555-0184", line1: "40 Corbin Plaza", line2: "Suite 210", city: "White Plains", state: "NY", zip: "10601", tags: ["commercial"], after: "Kane" },
    { id: demoClientId("hadley"), name: "Caleb & Nora Hadley", email: "hadleys@example.com", phone: "(512) 555-0118", line1: "1712 Juniper Bend", line2: "Unit A", city: "Austin", state: "TX", zip: "78704", after: "Castellano" },
    { id: demoClientId("brewster"), name: "Imani Brewster", email: "imani.brewster@example.com", phone: "(214) 555-0172", line1: "905 Larkmoor Ave", line2: "Apt 12", city: "Dallas", state: "TX", zip: "75206", after: "Bauer" },
    { id: demoClientId("quintanilla"), name: "Rafael Quintanilla", email: "rafael.quintanilla@example.com", phone: "(713) 555-0155", line1: "433 Pecan Hollow Dr", line2: "Unit 6", city: "Houston", state: "TX", zip: "77008", after: "Mercer" },
    { id: demoClientId("halvorsen-quist"), name: "Halvorsen-Quist Properties", company: "Halvorsen-Quist Properties", email: "leasing@halvorsenquist.example.com", phone: "(210) 555-0164", line1: "2600 Stonewick Pkwy", line2: "Suite 140", city: "San Antonio", state: "TX", zip: "78209", tags: ["commercial"], after: "Whitfield" },
  ];
  // Lists show the newest client first. Each new client is filed just behind one of the original
  // eight (`after`), so the first row stays what it was and every screenful mixes the three states.
  for (const c of newClients) {
    const [anchorRow] = await q(`select created_at from crm_customers where org_id = $1 and display_name like '%' || $2 || '%' and id <> all($3::text[]) order by created_at limit 1`, [orgId, c.after, seeded.crm_customers]);
    if (!anchorRow) throw new Error(`no original client matching "${c.after}"`);
    await q(`insert into crm_customers (id, org_id, display_name, company_name, email, phone, address_line1, address_line2, city, state, postal_code, tags, owner_member_id, portal_token, created_at, updated_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, $15::timestamp - interval '100 microseconds', $15::timestamp) on conflict (id) do nothing`,
      [c.id, orgId, c.name, c.company ?? null, c.email, c.phone, c.line1, c.line2, c.city, c.state, c.zip, c.tags ?? null, owner, randomBytes(24).toString("hex"), anchorRow.created_at]);
  }
  customers = await q(`select id, display_name from crm_customers where org_id = $1`, [orgId]);

  // Their documents carry numbers BELOW the original ones (P-2001…, E-2001…, INV-2001…) and are filed
  // as older, so the next document made on camera is still E-2003 / INV-2003 / P-2009, as before.
  const oldest = async (table: string): Promise<Date> => (await q(`select min(created_at) as t from ${table} where org_id = $1 and id not like 'demo-%' and id <> all($2::text[])`, [orgId, Object.values(seeded).flat()]))[0].t;
  const before = (t: Date, minutes: number) => new Date(t.getTime() - minutes * 60000);

  // Lines are priced from the price book as it stands (materials by SKU, labour by rate, the flat item by code).
  const mats = await q(`select sku, name, unit, price_cents from crm_pb_materials where org_id = $1`, [orgId]);
  const rates = await q(`select name, hourly_price_cents from crm_pb_labor_rates where org_id = $1`, [orgId]);
  const flats = await q(`select code, name, unit, flat_price_cents from crm_pb_items where org_id = $1 and flat_price_cents is not null`, [orgId]);
  type Line = { kind: string; name: string; unit: string | null; qty: number; cents: number };
  const mat = (sku: string, qty: number): Line => { const m = mats.find((x) => x.sku === sku); if (!m) throw new Error(`no price-book material ${sku}`); return { kind: "material", name: m.name, unit: m.unit, qty, cents: m.price_cents }; };
  const labour = (rate: string, hours: number, what: string): Line => { const r = rates.find((x) => x.name === rate); if (!r) throw new Error(`no labour rate ${rate}`); return { kind: "labor", name: `${rate} — ${what}`, unit: "hr", qty: hours, cents: r.hourly_price_cents }; };
  const flat = (code: string): Line => { const f = flats.find((x) => x.code === code); if (!f) throw new Error(`no flat price-book item ${code}`); return { kind: "labor", name: f.name, unit: f.unit, qty: 1, cents: f.flat_price_cents }; };
  // The same sums as the app (server/crm/entities.ts estimateTotals), every line taxable, no discount.
  const totals = (lines: Line[], bps: number) => { const subtotal = lines.reduce((n, l) => n + Math.round(l.cents * l.qty), 0); const tax = Math.round((subtotal * bps) / 10000); return { subtotal, tax, total: subtotal + tax }; };

  type Doc = { number: string; client: string; title: string; status: string; bps: number; lines: Line[]; signedBy?: string; paidShare?: number };
  const estimates: Doc[] = [
    { number: "E-1997", client: "Tunde Oyelaran", title: "Galley kitchen floor and tile", status: "approved", bps: 800, signedBy: "Tunde Oyelaran",
      lines: [mat("TL-SUB312", 42), mat("TL-SET40", 2), mat("LVP-20M", 260), mat("UND-ACU", 260), labour("Install crew", 41, "tile and click-lock install")] },
    { number: "E-1998", client: "Caleb & Nora Hadley", title: "Whole-floor LVP", status: "approved", bps: 825, signedBy: "Nora Hadley",
      lines: [mat("LVP-20M", 1120), mat("UND-ACU", 1120), mat("BB-525", 310), labour("Install crew", 112, "click-lock install")] },
    { number: "E-1999", client: "Imani Brewster", title: "Subway tile backsplash", status: "draft", bps: 825,
      lines: [mat("TL-SUB312", 38), mat("TL-SET40", 1), labour("Install crew", 14, "tile install")] },
    { number: "E-2000", client: "Halvorsen-Quist Properties", title: "Duplex LVP, both units", status: "sent", bps: 825,
      lines: [mat("LVP-20M", 1480), mat("UND-ACU", 1480), labour("Install crew", 148, "click-lock install")] },
  ];
  const invoices: Doc[] = [
    { number: "INV-1999", client: "Hannah Lindqvist", title: "Baseboards and stair trim — final", status: "sent", bps: 875,
      lines: [mat("BB-525", 180), labour("Finish carpenter", 22, "baseboards and stair trim")] },
    { number: "INV-2000", client: "Rafael Quintanilla", title: "Kitchen cabinet respray — final", status: "partial", bps: 825, paidShare: 0.5,
      lines: [flat("PT-CABINET")] },
  ];
  const docTotal = (number: string): number => { const d = [...estimates, ...invoices].find((x) => x.number === number)!; return totals(d.lines, d.bps).total; };

  type NewProject = { number: DemoProjectNumber; client: string; name: string; status: string; city: string; state: "NY" | "TX"; trades: string[]; value?: number; pm?: string; sales?: string; stageDays: number; estimate?: string; invoice?: string };
  const newProjects: NewProject[] = [
    { number: "P-1993", client: "Rosa & Stefan Ferrante", name: "Ferrante — parlor floor white oak", status: "lead", city: "Brooklyn", state: "NY", trades: ["flooring"], sales: "Priya Shah", stageDays: 2 },
    { number: "P-1994", client: "Tunde Oyelaran", name: "Oyelaran — galley kitchen floor and tile", status: "approved", city: "Albany", state: "NY", trades: ["tile", "flooring"], value: docTotal("E-1997"), sales: "Priya Shah", stageDays: 2, estimate: "E-1997" },
    { number: "P-1995", client: "Hannah Lindqvist", name: "Lindqvist — baseboards and stair trim", status: "invoiced", city: "Buffalo", state: "NY", trades: ["carpentry"], value: docTotal("INV-1999"), pm: "Owen Brooks", stageDays: 3, invoice: "INV-1999" },
    { number: "P-1996", client: "Wrenhaven Dental Studio", name: "Wrenhaven — reception flooring", status: "estimating", city: "White Plains", state: "NY", trades: ["flooring"], sales: "Priya Shah", stageDays: 1 },
    { number: "P-1997", client: "Caleb & Nora Hadley", name: "Hadley — bungalow LVP", status: "scheduled", city: "Austin", state: "TX", trades: ["flooring", "carpentry"], value: docTotal("E-1998"), pm: "Owen Brooks", stageDays: 4, estimate: "E-1998" },
    { number: "P-1998", client: "Imani Brewster", name: "Brewster — subway tile backsplash", status: "estimating", city: "Dallas", state: "TX", trades: ["tile"], sales: "Priya Shah", stageDays: 1, estimate: "E-1999" },
    { number: "P-1999", client: "Rafael Quintanilla", name: "Quintanilla — kitchen cabinet respray", status: "complete", city: "Houston", state: "TX", trades: ["painting"], value: docTotal("INV-2000"), pm: "Owen Brooks", stageDays: 5, invoice: "INV-2000" },
    { number: "P-2000", client: "Halvorsen-Quist Properties", name: "Halvorsen-Quist — duplex flooring, both units", status: "proposal_sent", city: "San Antonio", state: "TX", trades: ["flooring"], value: docTotal("E-2000"), sales: "Priya Shah", stageDays: 3, estimate: "E-2000" },
  ];
  const projectsOldest = await oldest("crm_projects");
  for (const [i, p] of newProjects.entries()) {
    if (projects.some((have) => have.number === p.number)) continue; // already there, under the id its template gave it
    const at = before(projectsOldest, newProjects.length - i);
    await q(`insert into crm_projects (id, org_id, customer_id, number, name, status, city, state, trades, contract_value_cents, project_manager_member_id, sales_member_id, stage_changed_at, completed_at, created_at, updated_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) on conflict (id) do nothing`,
      [demoProjectId(p.number), orgId, customer(p.client), p.number, p.name, p.status, p.city, p.state, p.trades, p.value ?? null,
        p.pm ? member(p.pm) : null, p.sales ? member(p.sales) : null, ago(p.stageDays * 24 * 60), p.status === "complete" ? ago(p.stageDays * 24 * 60) : null, at]);
  }
  projects = await q(`select id, number from crm_projects where org_id = $1`, [orgId]);
  // Each New York and Texas job runs under its state's division (the Florida jobs fall to the headquarters,
  // which is the Florida division — one of them names it outright, as the base seed left it).
  await q(`update crm_projects p set division_id = d.id from crm_divisions d
            where p.org_id = $1 and d.org_id = $1 and d.code = p.state and p.state in ('NY', 'TX') and p.division_id is null and p.number = any($2::text[])`, [orgId, [...DEMO_PROJECT_NUMBERS]]);
  const projectOf = (doc: string, key: "estimate" | "invoice"): string | null => { const p = newProjects.find((x) => x[key] === doc); return p ? project(p.number) : null; };
  const emailOf = (name: string): string => newClients.find((c) => c.name === name)!.email;

  const estimatesOldest = await oldest("crm_estimates");
  for (const [i, e] of estimates.entries()) {
    const id = `demo-estimate-${e.number.toLowerCase()}`, t = totals(e.lines, e.bps);
    const sent = e.status !== "draft", viewed = e.status === "approved", approved = e.status === "approved";
    const made = await q(`insert into crm_estimates (id, org_id, customer_id, project_id, number, title, status, intro_text, subtotal_cents, discount_cents, tax_rate_bps, tax_cents, total_cents, public_token,
               sent_at, sent_to_email, first_viewed_at, last_viewed_at, view_count, approved_at, signature_name, expires_at, created_by_member_id, created_at, updated_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23) on conflict (id) do nothing returning id`,
      [id, orgId, customer(e.client), projectOf(e.number, "estimate"), e.number, e.title, e.status, "Thanks for having us out — here's the scope we walked through together.",
        t.subtotal, e.bps, t.tax, t.total, randomBytes(24).toString("hex"),
        sent ? ago(5 * 24 * 60) : null, sent ? emailOf(e.client) : null, viewed ? ago(4 * 24 * 60) : null, viewed ? ago(3 * 24 * 60) : null, viewed ? 2 : 0,
        approved ? ago(3 * 24 * 60) : null, approved ? e.signedBy ?? null : null, new Date(Date.now() + 25 * DAY), member("Priya Shah"), before(estimatesOldest, estimates.length - i)]);
    if (made.length) for (const [n, l] of e.lines.entries())
      await q(`insert into crm_estimate_items (id, org_id, estimate_id, sort_order, kind, name, quantity_milli, unit, unit_price_cents, taxable) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) on conflict (id) do nothing`,
        [`${id}-line-${n + 1}`, orgId, id, n, l.kind, l.name, Math.round(l.qty * 1000), l.unit, l.cents]);
  }
  const invoicesOldest = await oldest("crm_invoices");
  for (const [i, inv] of invoices.entries()) {
    const id = `demo-invoice-${inv.number.toLowerCase()}`, t = totals(inv.lines, inv.bps), paid = Math.round(t.total * (inv.paidShare ?? 0));
    const made = await q(`insert into crm_invoices (id, org_id, customer_id, project_id, number, title, status, subtotal_cents, tax_rate_bps, tax_cents, total_cents, paid_cents, due_at, public_token, sent_at, sent_to_email, first_viewed_at, view_count, created_at, updated_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,1,$18,$18) on conflict (id) do nothing returning id`,
      [id, orgId, customer(inv.client), projectOf(inv.number, "invoice"), inv.number, inv.title, inv.status, t.subtotal, inv.bps, t.tax, t.total, paid,
        new Date(Date.now() + 21 * DAY), randomBytes(24).toString("hex"), ago(6 * 24 * 60), emailOf(inv.client), ago(5 * 24 * 60), before(invoicesOldest, invoices.length - i)]);
    if (made.length) for (const [n, l] of inv.lines.entries())
      await q(`insert into crm_invoice_items (id, org_id, invoice_id, sort_order, kind, name, quantity_milli, unit, unit_price_cents, taxable) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) on conflict (id) do nothing`,
        [`${id}-line-${n + 1}`, orgId, id, n, l.kind, l.name, Math.round(l.qty * 1000), l.unit, l.cents]);
  }

  // Money received: two 30% deposits (the workspace's default deposit) and half of the Quintanilla invoice.
  const quintanillaInvoice = "demo-invoice-inv-2000";
  for (const p of [
    { n: 5, client: "Tunde Oyelaran", project: "P-1994", invoice: null, purpose: "deposit", cents: Math.round(docTotal("E-1997") * 0.3), method: "check", note: "Check #1042", daysAgo: 3 },
    { n: 6, client: "Caleb & Nora Hadley", project: "P-1997", invoice: null, purpose: "deposit", cents: Math.round(docTotal("E-1998") * 0.3), method: "check", note: "Check #5518", daysAgo: 3 },
    { n: 7, client: "Rafael Quintanilla", project: "P-1999", invoice: quintanillaInvoice, purpose: "progress", cents: Math.round(docTotal("INV-2000") * 0.5), method: "check", note: "Check #307", daysAgo: 4 },
  ]) {
    const at = ago(p.daysAgo * 24 * 60);
    await q(`insert into crm_payments (id, org_id, customer_id, project_id, invoice_id, provider, purpose, amount_cents, method, status, note, paid_at, created_at, settled_cents)
             values ($1,$2,$3,$4,$5,'manual',$6,$7,$8,'succeeded',$9,$10,$10,$7) on conflict (id) do nothing`,
      [`demo-pay-${String(p.n).padStart(2, "0")}`, orgId, customer(p.client), project(p.project), p.invoice, p.purpose, p.cents, p.method, p.note, at]);
  }

  // Visits in the coming week: sales and the project manager only — the installers' week is already full.
  for (const a of [
    { n: 13, day: 1, from: [15, 30], hours: 1, title: "Oyelaran — pre-install walkthrough", client: "Tunde Oyelaran", project: "P-1994", by: "Demo Account", crew: ["Priya Shah"] },
    { n: 14, day: 2, from: [10, 0], hours: 1, title: "Hadley — plank and colour selection", client: "Caleb & Nora Hadley", project: "P-1997", by: "Demo Account", crew: ["Priya Shah"], notes: "Bring the LVP sample board." },
    { n: 15, day: 3, from: [14, 0], hours: 1, title: "Ferrante — measure parlor floor", client: "Rosa & Stefan Ferrante", project: "P-1993", by: "Demo Account", crew: ["Priya Shah"] },
    { n: 16, day: 5, from: [13, 0], hours: 1.5, title: "Halvorsen-Quist — site walk, both units", client: "Halvorsen-Quist Properties", project: "P-2000", by: "Owen Brooks", crew: [] },
  ] as Appt[]) await addAppt(a);

  // Message threads, all answered or read: the one message still waiting is Luis Orozco's, as before.
  for (const m of [
    { n: 7, client: "Rosa & Stefan Ferrante", from: "client", body: "Hi! Our building asks for a certificate of insurance before any work starts. Can you send one?", at: local(-2, 18, 20), read: true },
    { n: 8, client: "Rosa & Stefan Ferrante", from: "Priya Shah", body: "Of course. I will email it to you and your building manager tomorrow morning.", at: local(-2, 18, 45) },
    { n: 9, client: "Caleb & Nora Hadley", from: "client", body: "Could the crew start a day earlier? We are back in Austin sooner than we planned.", at: local(-4, 8, 5), read: true },
    { n: 10, client: "Caleb & Nora Hadley", from: "Owen Brooks", body: "Let me check the schedule. I will confirm with you this afternoon.", at: local(-4, 8, 40) },
    { n: 11, client: "Halvorsen-Quist Properties", from: "client", body: "Both units will be empty at the same time, so the floors can be done in one visit.", at: local(-5, 16, 30), read: true },
  ] as Msg[]) await addMsg(m);

  // ── A follow-up that is due today, on a lead (producers, 2026-10-08: "Due for follow-up" was always empty) ──
  // Rosa & Stefan Ferrante (Brooklyn NY, P-1993 Lead): a weekly cadence whose last follow-up was a week
  // ago this morning — so it is due, zero days overdue, on any day the workspace is copied (the date
  // shift above moves it along). Set once: a cadence that is already there is left alone.
  await q(`update crm_customers set follow_up_cadence_days = 7, last_follow_up_at = $3 where org_id = $1 and id = $2 and follow_up_cadence_days is null`,
    [orgId, customer("Rosa & Stefan Ferrante"), local(-7, 0, 5)]);

  // ── A declined estimate (the Declined tab of Clients was empty) ────────────────────────────────
  // Dana Whitfield (Osprey FL, P-2002 Lead) had no estimate: E-1996 is her only one, sent, opened and
  // declined two days ago — so she is the one client under "Declined". Numbered and filed below every
  // other estimate; 7% typed on it like the other Florida documents.
  {
    const id = "demo-estimate-e-1996", who = customer("Dana Whitfield");
    const lines = [mat("TL-SUB312", 60), mat("TL-SET40", 2), labour("Install crew", 18, "tile install")], t = totals(lines, 700);
    const [dana] = await q(`select email from crm_customers where id = $1`, [who]);
    const made = await q(`insert into crm_estimates (id, org_id, customer_id, project_id, number, title, status, intro_text, subtotal_cents, discount_cents, tax_rate_bps, tax_cents, total_cents, public_token,
               sent_at, sent_to_email, first_viewed_at, last_viewed_at, view_count, declined_at, decline_reason, expires_at, created_by_member_id, created_at, updated_at)
             values ($1,$2,$3,$4,'E-1996','Kitchen floor — tile option','declined',$5,$6,0,700,$7,$8,$9,$10,$11,$12,$13,2,$13,$14,$15,$16,$17,$17) on conflict (id) do nothing returning id`,
      [id, orgId, who, project("P-2002"), "Thanks for having us out — here's the tile option we talked about.", t.subtotal, t.tax, t.total, randomBytes(24).toString("hex"),
        ago(6 * 24 * 60), dana?.email ?? null, ago(5 * 24 * 60), ago(2 * 24 * 60), "Going with a lower-cost option for now.", new Date(Date.now() + 24 * DAY), member("Priya Shah"), before(estimatesOldest, 12)]);
    if (made.length) for (const [n, l] of lines.entries())
      await q(`insert into crm_estimate_items (id, org_id, estimate_id, sort_order, kind, name, quantity_milli, unit, unit_price_cents, taxable) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) on conflict (id) do nothing`,
        [`${id}-line-${n + 1}`, orgId, id, n, l.kind, l.name, Math.round(l.qty * 1000), l.unit, l.cents]);
  }

  // ── JobCam: six photos on the Kane job and three on the Hadley job ─────────────────────────────
  // The pictures are the drawn job-site scenes of scripts/tutorials/assets/photos (gen-assets.ts) —
  // flat illustration, obviously not anybody's house — one per caption. (Until 2026-10-08 they were
  // flat brown cards reading "Demo photo N"; a folder that still holds one is re-made, see `source`.)
  for (const [i, t] of [["Before", "#64748b"], ["Progress", "#2563eb"], ["After", "#16a34a"], ["Issue", "#dc2626"]].entries())
    await q(`insert into jobcam_tags (id, org_id, name, color, created_by_member_id) values ($1,$2,$3,$4,$5) on conflict (id) do nothing`, [`demo-tag-${i + 1}`, orgId, t[0], t[1], owner]);
  const CLIP = "clip-floor-walkthrough.mp4";
  type Photo = { n: number; caption: string; asset: string; tags: string[]; by: string; minutesAgo: number; starred?: boolean; client?: boolean; job?: [project: string, client: string] };
  const photos: Photo[] = [
    { n: 1, caption: "Living room before — old carpet", asset: "site-09.jpg", tags: ["Before"], by: "Marco Delgado", minutesAgo: 3 * 24 * 60 + 300 },
    { n: 2, caption: "Subfloor checked and levelled", asset: "site-01.jpg", tags: ["Progress"], by: "Marco Delgado", minutesAgo: 2 * 24 * 60 + 200 },
    { n: 3, caption: "First rows of hardwood down", asset: "site-02.jpg", tags: ["Progress"], by: "Dee Okafor", minutesAgo: 2 * 24 * 60 + 30, client: true },
    { n: 4, caption: "Scratch on board by the hallway — replacing it", asset: "site-07.jpg", tags: ["Issue"], by: "Dee Okafor", minutesAgo: 24 * 60 + 240 },
    { n: 5, caption: "Hallway finished", asset: "site-03.jpg", tags: ["After"], by: "Marco Delgado", minutesAgo: 24 * 60 + 60, starred: true, client: true },
    { n: 6, caption: "Stair treads dry-fitted", asset: "site-05.jpg", tags: ["Progress"], by: "Dee Okafor", minutesAgo: 90 },
    // Three on the Hadley job in Austin (the CRM tour follows that job end to end). Older than every Kane
    // shot and untagged, so the Recent feed still opens on the same six tiles and no tag count moves.
    { n: 7, caption: "Front room before — old laminate", asset: "site-06.jpg", tags: [], by: "Priya Shah", minutesAgo: 5 * 24 * 60 + 200, job: ["P-1997", "Caleb & Nora Hadley"] },
    { n: 8, caption: "Hallway measured for planks", asset: "site-10.jpg", tags: [], by: "Priya Shah", minutesAgo: 5 * 24 * 60 + 185, job: ["P-1997", "Caleb & Nora Hadley"] },
    { n: 9, caption: "Sample planks against the baseboard", asset: "site-11.jpg", tags: [], by: "Priya Shah", minutesAgo: 5 * 24 * 60 + 170, client: true, job: ["P-1997", "Caleb & Nora Hadley"] },
    // More on the Hadley job, a short clip among them (the feed shows a video tile with its length)…
    { n: 10, caption: "Bedroom before — carpet to come up", asset: "site-09.jpg", tags: ["Before"], by: "Priya Shah", minutesAgo: 5 * 24 * 60 + 160, job: ["P-1997", "Caleb & Nora Hadley"] },
    { n: 11, caption: "Walk-through of the front room", asset: CLIP, tags: ["Before"], by: "Priya Shah", minutesAgo: 5 * 24 * 60 + 150, job: ["P-1997", "Caleb & Nora Hadley"] },
    // …and four on a New York job: Hannah Lindqvist's baseboards and stair trim in Buffalo (P-1995, invoiced).
    // (Producers, 2026-10-08: every JobCam video was Florida because only the Kane job had photos.) All older
    // than the Kane shots, so the Recent feed still opens on the same six tiles.
    { n: 12, caption: "Hallway measured for baseboard", asset: "site-10.jpg", tags: ["Before"], by: "Owen Brooks", minutesAgo: 4 * 24 * 60 + 300, job: ["P-1995", "Hannah Lindqvist"] },
    { n: 13, caption: "Baseboards on, doorway cased", asset: "site-07.jpg", tags: ["Progress"], by: "Marco Delgado", minutesAgo: 4 * 24 * 60 + 120, job: ["P-1995", "Hannah Lindqvist"] },
    { n: 14, caption: "Stair trim finished", asset: "site-05.jpg", tags: ["After"], by: "Marco Delgado", minutesAgo: 4 * 24 * 60 + 60, starred: true, client: true, job: ["P-1995", "Hannah Lindqvist"] },
    { n: 15, caption: "Front room done", asset: "site-03.jpg", tags: ["After"], by: "Owen Brooks", minutesAgo: 4 * 24 * 60 + 30, client: true, job: ["P-1995", "Hannah Lindqvist"] },
  ];
  // The first three Hadley shots were seeded without tags; a tag each, set once (a tag someone put on in a slot is left alone).
  for (const [n, tag] of [[7, "Before"], [8, "Progress"], [9, "Progress"]] as const)
    await q(`update jobcam_media set tags = $3 where org_id = $1 and id = $2 and coalesce(array_length(tags, 1), 0) = 0`, [orgId, `demo-photo-0${n}`, [tag]]);
  const kane = project("P-2001");
  for (const p of photos) {
    const id = `demo-photo-${String(p.n).padStart(2, "0")}`;
    const dir = path.join(process.cwd(), "tmp", "jobcam", "jobcam", orgId, id);
    const video = p.asset === CLIP;
    const files = video ? { original: "original.mp4", display: "poster.jpg", thumb: "thumb.jpg" } : { original: "original.jpg", display: "display.jpg", thumb: "thumb.jpg" };
    // The files live in this working copy (tmp/jobcam is the slot app's local object store), so every
    // checkout makes its own. `source` says which drawing a folder was made from: a folder without it
    // holds an old colour card and is made again.
    const from = path.join(import.meta.dirname, "assets", video ? "" : "photos", p.asset), source = path.join(dir, "source");
    if (!fs.existsSync(from)) throw new Error(`${p.asset} is not in scripts/tutorials/assets — run gen-assets.ts`);
    if (!fs.existsSync(path.join(dir, files.thumb)) || !fs.existsSync(source) || fs.readFileSync(source, "utf8").trim() !== p.asset) {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(from, path.join(dir, `${files.original}.tmp`));
      fs.renameSync(path.join(dir, `${files.original}.tmp`), path.join(dir, files.original));
      for (const [name, width] of [[files.display, 1280], [files.thumb, 480]] as const) {
        // Written beside and renamed: an app serving this folder never reads half a file.
        const r = spawnSync("nice", ["-n", "10", "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-threads", "2", ...(video ? ["-ss", "1"] : []), "-i", path.join(dir, files.original), "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", "-update", "1", "-f", "image2", path.join(dir, `${name}.tmp`)], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(`ffmpeg could not scale ${id}: ${r.stderr}`);
        fs.renameSync(path.join(dir, `${name}.tmp`), path.join(dir, name));
      }
      fs.writeFileSync(source, `${p.asset}\n`);
    }
    const key = (name: string) => `jobcam/${orgId}/${id}/${name}`;
    const at = ago(p.minutesAgo), bytes = fs.statSync(path.join(dir, files.original)).size;
    // A clip is its own file (H.264 MP4: the browser plays the original, so there is no transcode), a poster and a thumbnail.
    await q(`insert into jobcam_media (id, org_id, project_id, customer_id, uploader_member_id, kind, status, file_name, mime, bytes, rendition_bytes,
               r2_key_original, r2_key_display, r2_key_poster, r2_key_thumb, width, height, duration_s, captured_at, uploaded_at, caption, caption_source, tags, starred, client_visible, created_at, updated_at)
             values ($1,$2,$3,$4,$5,$17,'ready',$6,$18,$7,$8,$9,$10,$19,$11,$20,$21,$22,$12,$12,$13,'user',$14,$15,$16,$12,$12)
             -- a row that is already there keeps everything a script may have been written against; only the sizes follow the picture
             on conflict (id) do update set bytes = excluded.bytes, rendition_bytes = excluded.rendition_bytes`,
      [id, orgId, p.job ? project(p.job[0]) : kane, customer(p.job ? p.job[1] : "Joe & Mary Kane"), member(p.by), `demo-photo-${p.n}.${video ? "mp4" : "jpg"}`, bytes,
        fs.statSync(path.join(dir, files.display)).size + fs.statSync(path.join(dir, files.thumb)).size,
        key(files.original), video ? null : key(files.display), key(files.thumb), at, p.caption, p.tags, !!p.starred, !!p.client,
        video ? "video" : "photo", video ? "video/mp4" : "image/jpeg", video ? key(files.display) : null, video ? 1280 : 1600, video ? 720 : 1200, video ? 4 : null]);
  }

  // ── Quick Bid: two price-book items priced per square foot ─────────────────────────────────────
  // Quick Bid prices a per-sq-ft item against the wall (or roof) area of the client's latest ready
  // measurement report. The price book had no such item, so the button was disabled on every client
  // (batch B). The reports themselves are the HOVER fixture's three jobs (Ellison FL, Oyelaran NY,
  // Hadley TX — seed-fixtures / FIXTURES.md): with fixtures off there is still no report, and Quick
  // Bid says so. Invented prices, like the rest of the price book.
  const [painting] = await q(`select id from crm_pb_categories where org_id = $1 and name = 'Painting' limit 1`, [orgId]);
  for (const it of [
    { key: "demo-pb-ext-repaint", code: "PT-EXT-SF", name: "Exterior repaint, per sq ft of wall", rate: 285, text: "Two coats on siding and trim, priced by the wall area on the measurement report." },
    { key: "demo-pb-ext-wash", code: "PT-WASH-SF", name: "Exterior wash and prep, per sq ft of wall", rate: 45, text: "Soft wash, scrape and spot-prime before paint, priced by wall area." },
  ]) await q(`insert into crm_pb_items (id, org_id, category_id, code, name, description, unit, pricing_mode, rate_cents_per_sqft, sqft_metric) values ($1,$2,$3,$4,$5,$6,'sf','per_sqft',$7,'siding') on conflict (id) do nothing`,
    [demoUuid(it.key), orgId, painting?.id ?? null, it.code, it.name, it.text, it.rate]);

  // ── Good / better / best: three options on one open estimate ───────────────────────────────────
  // E-2002 (Luis Orozco, FL — sent and viewed, not decided): three display options with their totals,
  // the middle one recommended and equal to the estimate's own total. E-2000, which the options
  // walkthrough builds on camera from nothing, is left without any.
  {
    const [e] = await q(`select id, subtotal_cents, total_cents from crm_estimates where org_id = $1 and number = 'E-2002' limit 1`, [orgId]);
    if (e) for (const o of [
      { tier: 1, name: "Good", share: 0.88, text: "12 mil plank, standard underlayment, existing baseboards put back." },
      { tier: 2, name: "Better", share: 1, text: "20 mil plank, acoustic underlayment, existing baseboards put back.", recommended: true },
      { tier: 3, name: "Best", share: 1.17, text: "20 mil plank, acoustic underlayment, new 5 1/4 inch baseboards throughout." },
    ]) await q(`insert into crm_estimate_options (id, org_id, estimate_id, name, tier, description, recommended, show_total, subtotal_cents, total_cents) values ($1,$2,$3,$4,$5,$6,$7,true,$8,$9) on conflict (id) do nothing`,
      [demoUuid(`demo-option-e-2002-${o.tier}`), orgId, e.id, o.name, o.tier, o.text, !!o.recommended, o.share === 1 ? e.subtotal_cents : Math.round((e.subtotal_cents * o.share) / 100) * 100, o.share === 1 ? e.total_cents : Math.round((e.total_cents * o.share) / 100) * 100]);
  }

  const count = async (t: string) => Number((await q(`select count(*)::int as n from ${t} where org_id = $1`, [orgId]))[0].n);
  const states = (await q(`select state, count(*)::int as n from crm_customers where org_id = $1 group by state order by state`, [orgId])).map((r) => `${r.state} ${r.n}`).join(", ");
  // The app refuses a non-uuid id in these tables: none may exist when this seed is done.
  for (const t of Object.keys(seeded)) {
    const bad = await q(`select id from ${t} where org_id = $1 and id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' limit 3`, [orgId]);
    if (bad.length) throw new Error(`${t} has a row whose id is not a uuid (${bad.map((b) => b.id).join(", ")}) — its pages would say "not found"`);
  }
  if (DEMO_CLIENT_KEYS.length !== newClients.length || DEMO_PROJECT_NUMBERS.length !== newProjects.length) throw new Error("demo-ids.ts and seed-demo.ts disagree about the New York / Texas rows");
  return (renamed ? `${renamed}\n` : "") + `demo workspace: ${await count("crm_members")} team, ${await count("crm_customers")} clients (${states}), ${await count("crm_appointments")} appointments, `
    + `${await count("crm_client_comments")} messages, ${await count("crm_payments")} payments, ${await count("jobcam_media")} photos`;
}

// One transaction: all of it or none of it.
try {
  await client.query("begin");
  const summary = await main();
  await client.query("commit");
  console.log(summary);
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
