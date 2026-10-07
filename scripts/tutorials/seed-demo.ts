/**
 * Extra demo data for the walkthrough videos, on top of scripts/seed-crm-demo.ts ("Aspire
 * Interiors", Sarasota FL): a CRM plan, two more team members, a week of appointments around today,
 * message threads, JobCam photos, payments in several states — so no page is empty on camera.
 *
 *   DATABASE_URL=<a recording database> npx tsx scripts/tutorials/seed-demo.ts
 *
 * Runs when the template is built AND on every fresh recording database (produce.ts): it is
 * idempotent (fixed ids, insert-if-absent), and it moves every date of the workspace forward by
 * the days that have passed since it was seeded, so "today" on the schedule is always today.
 *
 * HARD RULES: everything here is fictional. Emails end in example.com, phones are 555-01xx, the
 * photos are flat colour cards made by ffmpeg and labelled as demo photos. Never copy a real
 * customer, address or job into this file — and it refuses any database that is not a recording
 * database on 127.0.0.1:5432.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error("DATABASE_URL is not set");
{
  const u = new URL(raw);
  const where = `${u.pathname.slice(1)} ${u.searchParams.get("options") ?? ""}`;
  if (u.hostname !== "127.0.0.1" || (u.port || "5432") !== "5432" || !/constructhub_tut_[a-z0-9_]+/.test(where))
    throw new Error("seed-demo.ts only writes to a constructhub_tut_* recording database on 127.0.0.1:5432");
}
const { pool } = await import("../../server/db");
const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params as any[])).rows;

const DAY = 86400000;
/** A wall-clock time in the workspace's time zone (America/New_York), `day` days from today, as a UTC Date. */
function local(day: number, hour: number, minute = 0): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + day * DAY));
  const guess = new Date(`${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  const shown = new Date(guess.toLocaleString("en-US", { timeZone: "America/New_York" }) + " UTC");
  return new Date(guess.getTime() + (guess.getTime() - shown.getTime()));
}
const ago = (minutes: number) => new Date(Date.now() - minutes * 60000);

async function main() {
  const [org] = await q(`select id, owner_user_id from crm_orgs where name = 'Aspire Interiors' limit 1`);
  if (!org) throw new Error("Aspire Interiors does not exist — run scripts/seed-crm-demo.ts first");
  const orgId: string = org.id;

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

  const customers = await q(`select id, display_name from crm_customers where org_id = $1`, [orgId]);
  const customer = (name: string): string => { const c = customers.find((x) => x.display_name === name); if (!c) throw new Error(`no client ${name}`); return c.id; };
  const projects = await q(`select id, number from crm_projects where org_id = $1`, [orgId]);
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
  for (const a of appts) {
    const starts = local(a.day, a.from[0], a.from[1]);
    await q(`insert into crm_appointments (id, org_id, project_id, customer_id, created_by_member_id, title, notes, status, starts_at, ends_at, dispatched_member_ids, completed_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (id) do nothing`,
      [`demo-appt-${String(a.n).padStart(2, "0")}`, orgId, a.project ? project(a.project) : null, customer(a.client), member(a.by), a.title, a.notes ?? null,
        a.status ?? "scheduled", starts, new Date(starts.getTime() + a.hours * 3600000), a.crew.map(member), a.status === "completed" ? new Date(starts.getTime() + a.hours * 3600000) : null]);
  }

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
  for (const m of msgs) {
    await q(`insert into crm_client_comments (id, org_id, customer_id, body, author_member_id, created_at, read_at) values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
      [`demo-msg-${String(m.n).padStart(2, "0")}`, orgId, customer(m.client), m.body, m.from === "client" ? null : member(m.from), m.at, m.from === "client" && !m.read ? null : m.at]);
  }

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

  // ── JobCam: six photos on the Kane job. Flat colour cards — obviously not anybody's house. ─────
  for (const [i, t] of [["Before", "#64748b"], ["Progress", "#2563eb"], ["After", "#16a34a"], ["Issue", "#dc2626"]].entries())
    await q(`insert into jobcam_tags (id, org_id, name, color, created_by_member_id) values ($1,$2,$3,$4,$5) on conflict (id) do nothing`, [`demo-tag-${i + 1}`, orgId, t[0], t[1], owner]);
  type Photo = { n: number; caption: string; colour: string; tags: string[]; by: string; minutesAgo: number; starred?: boolean; client?: boolean };
  const photos: Photo[] = [
    { n: 1, caption: "Living room before — old carpet", colour: "0x8d99ae", tags: ["Before"], by: "Marco Delgado", minutesAgo: 3 * 24 * 60 + 300 },
    { n: 2, caption: "Subfloor checked and levelled", colour: "0xb08968", tags: ["Progress"], by: "Marco Delgado", minutesAgo: 2 * 24 * 60 + 200 },
    { n: 3, caption: "First rows of hardwood down", colour: "0x9c6644", tags: ["Progress"], by: "Dee Okafor", minutesAgo: 2 * 24 * 60 + 30, client: true },
    { n: 4, caption: "Scratch on board by the hallway — replacing it", colour: "0x7f5539", tags: ["Issue"], by: "Dee Okafor", minutesAgo: 24 * 60 + 240 },
    { n: 5, caption: "Hallway finished", colour: "0xa47148", tags: ["After"], by: "Marco Delgado", minutesAgo: 24 * 60 + 60, starred: true, client: true },
    { n: 6, caption: "Stair treads dry-fitted", colour: "0x6f4e37", tags: ["Progress"], by: "Dee Okafor", minutesAgo: 90 },
  ];
  const font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  const kane = project("P-2001");
  for (const p of photos) {
    const id = `demo-photo-${String(p.n).padStart(2, "0")}`;
    const dir = path.join(process.cwd(), "tmp", "jobcam", "jobcam", orgId, id);
    const files = { original: "original.jpg", display: "display.jpg", thumb: "thumb.jpg" };
    if (!fs.existsSync(path.join(dir, files.thumb))) {
      fs.mkdirSync(dir, { recursive: true });
      const label = path.join(dir, "label.txt");
      fs.writeFileSync(label, `Demo photo ${p.n}`);
      const sub = path.join(dir, "sub.txt");
      fs.writeFileSync(sub, p.caption);
      const esc = (f: string) => f.replace(/:/g, "\\:");
      const made = spawnSync("nice", ["-n", "10", "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-threads", "2", "-f", "lavfi",
        "-i", `color=c=${p.colour}:s=1600x1200:d=1,noise=alls=12:allf=t,vignette=PI/5`,
        "-vf", `drawtext=fontfile=${font}:textfile='${esc(label)}':fontsize=110:fontcolor=white@0.92:x=(w-text_w)/2:y=h/2-130,`
          + `drawtext=fontfile=${font}:textfile='${esc(sub)}':fontsize=46:fontcolor=white@0.85:x=(w-text_w)/2:y=h/2+40`,
        "-frames:v", "1", "-q:v", "4", "-update", "1", path.join(dir, files.original)], { encoding: "utf8" });
      if (made.status !== 0) throw new Error(`ffmpeg could not make ${id}: ${made.stderr}`);
      for (const [name, width] of [[files.display, 1280], [files.thumb, 480]] as const) {
        const r = spawnSync("nice", ["-n", "10", "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-threads", "2", "-i", path.join(dir, files.original), "-vf", `scale=${width}:-2`, "-q:v", "5", "-update", "1", path.join(dir, name)], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(`ffmpeg could not scale ${id}: ${r.stderr}`);
      }
      fs.rmSync(label); fs.rmSync(sub);
    }
    const key = (name: string) => `jobcam/${orgId}/${id}/${name}`;
    const at = ago(p.minutesAgo), bytes = fs.statSync(path.join(dir, files.original)).size;
    await q(`insert into jobcam_media (id, org_id, project_id, customer_id, uploader_member_id, kind, status, file_name, mime, bytes, rendition_bytes,
               r2_key_original, r2_key_display, r2_key_thumb, width, height, captured_at, uploaded_at, caption, caption_source, tags, starred, client_visible, created_at, updated_at)
             values ($1,$2,$3,$4,$5,'photo','ready',$6,'image/jpeg',$7,$8,$9,$10,$11,1600,1200,$12,$12,$13,'user',$14,$15,$16,$12,$12) on conflict (id) do nothing`,
      [id, orgId, kane, customer("Joe & Mary Kane"), member(p.by), `demo-photo-${p.n}.jpg`, bytes,
        fs.statSync(path.join(dir, files.display)).size + fs.statSync(path.join(dir, files.thumb)).size,
        key(files.original), key(files.display), key(files.thumb), at, p.caption, p.tags, !!p.starred, !!p.client]);
  }

  const count = async (t: string) => Number((await q(`select count(*)::int as n from ${t} where org_id = $1`, [orgId]))[0].n);
  console.log(`demo workspace: ${await count("crm_members")} team, ${await count("crm_appointments")} appointments, ${await count("crm_client_comments")} messages, `
    + `${await count("crm_payments")} payments, ${await count("jobcam_media")} photos`);
}

main().then(() => pool.end(), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
