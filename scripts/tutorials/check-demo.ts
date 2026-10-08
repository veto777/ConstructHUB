/**
 * Walk EVERY demo entity's page in a running recording slot and fail on anything a viewer would see
 * as broken. Run it after ANY change to seed-demo.ts / seed-fixtures.ts / demo-ids.ts, before the
 * template is reseeded and again on a fresh copy afterwards (PRODUCER-GUIDE.md, "Demo data"):
 *
 *   npx tsx scripts/tutorials/app.ts up <slot> --no-warm     # a fresh copy of the template + this working copy's seeds
 *   npx tsx scripts/tutorials/check-demo.ts <slot>           # exit 0 = every page is fine
 *   npx tsx scripts/tutorials/app.ts down <slot>
 *
 * What it opens, for every client, project, estimate, invoice, payment, appointment and message
 * thread of the demo workspace (Florida, New York and Texas — read from the slot's database, so a
 * row added tomorrow is walked too):
 *   · the client page — and on it the client's estimates, invoices, jobs, payments and visits;
 *   · the client-portal preview ("See what the client sees") — the grant must be accepted;
 *   · the project page, the single-project route behind it, and the project's JobCam page;
 *   · the estimate page; the Estimates and Invoices lists (a row per document; invoices have no
 *     page of their own — they open on the client page, checked above);
 *   · Clients, Pipeline (a card per project), Payments (a row per payment), Schedule (every visit,
 *     in the month, week and agenda views) and Messages (every thread, opened).
 * It FAILS (exit 1) on: "not found" / "isn't available" text, a missing row, a page error, a console
 * error, or any 4xx/5xx answer from the app. Read-only: GETs, plus the preview-grant POST, which
 * writes nothing. It never touches the template and only talks to 127.0.0.1.
 */
import pg from "pg";
import { chromium, type Page } from "playwright";
import { SLOT_PORT, isSlot, listeningPid } from "./app";
import { databaseUrl, exists } from "./db";
import { UUID_ID_TABLES, UUID_RE } from "./demo-ids";

const BROKEN = /not found|isn['’]t available|something went wrong|couldn['’]t load|failed to load|no longer exists/i;

async function main() {
  const slot = Number(process.argv[2]);
  if (!isSlot(slot)) throw new Error("Usage: npx tsx scripts/tutorials/check-demo.ts <slot>   (the slot's app must be up: app.ts up <slot>)");
  const database = `constructhub_tut_slot${slot}`, port = SLOT_PORT(slot);
  if (!(await exists(database))) throw new Error(`${database} does not exist — run: npx tsx scripts/tutorials/app.ts up ${slot}`);
  if (!(await listeningPid(port))) throw new Error(`nothing is listening on :${port} — run: npx tsx scripts/tutorials/app.ts up ${slot}`);
  const base = `http://portal.constructhub.us:${port}`;

  // ── What the workspace holds ───────────────────────────────────────────────────────────────────
  const db = new pg.Client({ connectionString: await databaseUrl(database) });
  await db.connect();
  const rows = async (sql: string) => (await db.query(sql)).rows as any[];
  const org = `(select id from crm_orgs where name = 'Aspire Interiors' order by created_at limit 1)`;
  const clients = await rows(`select id, display_name as name, coalesce(state, '?') as state from crm_customers where org_id = ${org} order by state, display_name`);
  const projects = await rows(`select p.id, p.number, p.name, p.customer_id, coalesce(p.state, c.state, '?') as state from crm_projects p left join crm_customers c on c.id = p.customer_id where p.org_id = ${org} order by p.number`);
  const estimates = await rows(`select e.id, e.number, e.customer_id, coalesce(c.state, '?') as state from crm_estimates e left join crm_customers c on c.id = e.customer_id where e.org_id = ${org} order by e.number`);
  const invoices = await rows(`select e.id, e.number, e.customer_id, coalesce(c.state, '?') as state from crm_invoices e left join crm_customers c on c.id = e.customer_id where e.org_id = ${org} order by e.number`);
  const payments = await rows(`select id, customer_id from crm_payments where org_id = ${org} order by id`);
  const appointments = await rows(`select id, title, customer_id from crm_appointments where org_id = ${org} order by starts_at`);
  const threads = await rows(`select m.customer_id, (array_agg(m.body order by m.created_at desc))[1] as last from crm_client_comments m where m.org_id = ${org} group by 1`);
  await db.end();
  if (!clients.length || !projects.length) throw new Error(`${database} has no demo workspace`);

  const problems: string[] = [];
  // Ids the app would refuse, before a single page is opened.
  for (const [table, list] of [["crm_customers", clients], ["crm_projects", projects]] as const)
    for (const r of list) if (!UUID_RE.test(r.id) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.id)) problems.push(`${table} ${r.id} (${r.name}) is not a uuid (${UUID_ID_TABLES.join(", ")} must be)`);
  // A reference to a row that does not exist is a page that will say "not found" one click later.
  const clientIds = new Set(clients.map((c) => c.id)), projectIds = new Set(projects.map((p) => p.id));
  for (const [what, list] of [["project", projects], ["estimate", estimates], ["invoice", invoices], ["payment", payments], ["appointment", appointments], ["thread", threads]] as const)
    for (const r of list) if (r.customer_id && !clientIds.has(r.customer_id)) problems.push(`${what} ${r.number ?? r.id ?? r.customer_id} points at a client that does not exist (${r.customer_id})`);
  void projectIds;

  const browser = await chromium.launch({ headless: true, args: ["--host-resolver-rules=MAP portal.constructhub.us 127.0.0.1, MAP client.constructhub.us 127.0.0.1"] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  let where = "", pages = 0;
  const flag = (what: string) => { problems.push(`${where}: ${what}`); };
  page.on("pageerror", (e) => flag(`page error — ${e.message.slice(0, 200)}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) flag(`console error — ${m.text().slice(0, 200)}`); });
  page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).port === String(port)) flag(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  page.on("requestfailed", (r) => { const f = r.failure()?.errorText ?? ""; if (!/ERR_ABORTED/.test(f) && new URL(r.url()).port === String(port)) flag(`request failed — ${new URL(r.url()).pathname} ${f}`); });

  /** Open a page, wait until it is quiet, and require the texts and test ids a viewer must see. */
  const open = async (label: string, url: string, need: { text?: string[]; ids?: string[] } = {}): Promise<void> => {
    where = `${label} (${url})`; pages++;
    await page.goto(base + url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await settle(page);
    await require(label, need);
  };
  const require = async (label: string, need: { text?: string[]; ids?: string[] }) => {
    for (const id of need.ids ?? []) await page.locator(`[data-testid="${id}"]`).first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => flag(`${label}: no [data-testid="${id}"] on the page`));
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    for (const t of need.text ?? []) if (!body.includes(t.replace(/\s+/g, " "))) flag(`${label}: the page does not show "${t}"`);
    const hit = BROKEN.exec(body);
    if (hit) flag(`${label}: the page says "${body.slice(Math.max(0, hit.index - 40), hit.index + 80)}"`);
  };
  const of = <T extends { customer_id: string }>(list: T[], clientId: string) => list.filter((x) => x.customer_id === clientId);

  // ── Lists ──────────────────────────────────────────────────────────────────────────────────────
  await open("Clients", "/crm/clients", { ids: clients.map((c) => `client-${c.id}`), text: clients.map((c) => c.name) });
  await open("Pipeline", "/crm/pipeline", { ids: projects.map((p) => `card-project-${p.id}`), text: projects.map((p) => p.number) });
  await open("Estimates", "/crm/estimates", { ids: estimates.map((e) => `doc-row-${e.id}`), text: estimates.map((e) => e.number) });
  await open("Invoices", "/crm/invoices", { ids: invoices.map((i) => `doc-row-${i.id}`), text: invoices.map((i) => i.number) });
  await open("Payments", "/crm/payments", { ids: payments.map((p) => `payment-${p.id}`) });

  // ── Every client: the page, what hangs off it, and the portal preview ─────────────────────────
  for (const c of clients) {
    const label = `${c.state} client ${c.name}`;
    await open(label, `/crm/clients/${c.id}`, {
      text: [c.name],
      ids: [...of(estimates, c.id).map((e) => `estimate-${e.id}`), ...of(invoices, c.id).map((i) => `invoice-${i.id}`), ...of(projects, c.id).map((p) => `project-${p.id}`),
        ...of(payments, c.id).map((p) => `client-payment-${p.id}`), ...of(appointments, c.id).slice(0, 15).map((a) => `appointment-${a.id}`)],
    });
    where = `${label} — portal preview`; pages++;
    // Asked from inside the page: the browser maps the CRM host name to this machine; nothing here may reach the real host.
    const made = await page.evaluate(async (id) => { const r = await fetch(`/api/crm/customers/${id}/portal-preview`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); return { status: r.status, body: await r.text() }; }, c.id);
    if (made.status !== 200) { flag(`the preview grant was refused (${made.status} ${made.body.slice(0, 120)})`); continue; }
    const redeem = new URL((JSON.parse(made.body) as { url: string }).url);
    if (!["portal.constructhub.us", "client.constructhub.us", "127.0.0.1", "localhost"].includes(redeem.hostname) || redeem.port !== String(port)) { flag(`the preview link points away from this slot (${redeem.host})`); continue; }
    const visitor = await browser.newContext();
    try {
      const tab = await visitor.newPage();
      await tab.goto(redeem.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
      const cookie = (await visitor.cookies()).find((k) => k.name === "crm_client");
      if (!cookie || !decodeURIComponent(cookie.value).startsWith("prev.")) flag("the portal refused the preview grant (no preview session was set) — is the client's id a uuid?");
    } finally { await visitor.close(); }
  }

  // ── Every project: its page and its JobCam page ───────────────────────────────────────────────
  for (const p of projects) {
    await open(`${p.state} project ${p.number}`, `/crm/projects/${p.id}`, { text: [p.name, p.number] });
    // The page can draw a project from the list it already holds; the route that checks the id's
    // shape is the single-record one (a direct link, the JobCam page, older builds of this page).
    const one = await page.evaluate(async (id) => { const r = await fetch(`/api/crm/projects/${id}`); return { status: r.status, body: (await r.text()).slice(0, 300) }; }, p.id);
    if (one.status !== 200 || !one.body.includes(p.number)) flag(`GET /api/crm/projects/${p.id} answered ${one.status} ${one.body.slice(0, 80)}`);
    await open(`${p.state} project ${p.number} JobCam`, `/crm/projects/${p.id}/jobcam`, { text: [p.name], ids: ["jobcam-feed-project"] });
  }
  for (const e of estimates) await open(`${e.state} estimate ${e.number}`, `/crm/estimates/${e.id}`, { text: [e.number], ids: ["estimate-detail"] });

  // ── Schedule: every visit must be on the calendar in some view ────────────────────────────────
  {
    const seen = new Set<string>();
    const collect = async () => { for (const id of await page.$$eval('[data-testid^="event-"], [data-testid^="appt-"]', (els) => els.map((e) => e.getAttribute("data-testid")!.replace(/^(event|appt)-/, "")))) seen.add(id); };
    const everyone = async () => {
      await page.locator('[data-testid="select-calendar-scope"]').click();
      await page.locator('[data-testid="scope-all"]').click();
      await settle(page);
    };
    for (const view of ["", "?view=week", "?view=agenda"]) {
      await open(`Schedule ${view || "month"}`, `/crm/schedule${view}`, { ids: ["select-calendar-scope"] });
      await everyone(); await collect();
      if (view !== "?view=agenda") for (const button of ["button-cal-prev", "button-cal-next", "button-cal-next"]) { await page.locator(`[data-testid="${button}"]`).click(); await settle(page); await collect(); }
      await require(`Schedule ${view || "month"}`, {});
    }
    where = "Schedule";
    for (const a of appointments) if (!seen.has(a.id)) flag(`visit "${a.title}" (${a.id}) is on no calendar view`);
  }

  // ── Messages: every thread, opened ────────────────────────────────────────────────────────────
  await open("Messages", "/crm/inbox", { ids: threads.map((t) => `thread-${t.customer_id}`) });
  for (const t of threads) {
    const name = clients.find((c) => c.id === t.customer_id)?.name ?? t.customer_id;
    where = `Messages — ${name}`; pages++;
    await page.locator(`[data-testid="thread-${t.customer_id}"]`).first().click().catch(() => flag("the thread could not be opened"));
    await settle(page);
    await require(`thread ${name}`, { text: [name, String(t.last).slice(0, 40)] });
    await page.goto(`${base}/crm/inbox`, { waitUntil: "domcontentloaded" }); await settle(page);
  }
  await browser.close();

  const by = (list: { state: string }[]) => ["FL", "NY", "TX"].map((s) => `${s} ${list.filter((x) => x.state === s).length}`).join(", ");
  console.log(`slot ${slot}: opened ${pages} pages — ${clients.length} clients (${by(clients)}), ${projects.length} projects (${by(projects)}), ${estimates.length} estimates, ${invoices.length} invoices, `
    + `${payments.length} payments, ${appointments.length} visits, ${threads.length} message threads`);
  if (problems.length) { console.error(`\n✗ ${problems.length} problem(s):\n${[...new Set(problems)].map((p) => `  · ${p}`).join("\n")}`); process.exit(1); }
  console.log("✓ no \"not found\", no page or console error, no 4xx/5xx, every row where it belongs");
}

/** Network quiet, then a beat for the last render. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(350);
}

main().then(() => process.exit(0), (e) => { console.error(`✗ ${e instanceof Error ? e.message : e}`); process.exit(1); });
