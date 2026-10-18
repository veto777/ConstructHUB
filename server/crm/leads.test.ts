/**
 * Leads (server/crm/leads.ts): the field mapping, the sensitive-field and honeypot rules, the script itself, and
 * against the dev server (DEV_AUTH_BYPASS_USER1=true; CRM_TEST_BASE_URL / E2E_PORT) the public form-sync endpoint
 * (CORS, dedupe, spam, client matching by the phone's last 10 digits), convert's address rule, the hosted form's
 * Leads row and the owner's import.
 *
 * Fixtures carry a per-run marker in the name / message and are deleted afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import vm from "vm";
import pg from "pg";
import {
  mapLeadFields, sanitizeFields, phoneKey, parseFormSyncBody, fieldRole, honeypotTripped, pageMetaFrom, SENSITIVE_FIELD,
} from "./leads";
import { formSyncScript } from "./form-sync-script";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const RUN = `LD${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ── Pure ────────────────────────────────────────────────────────────────────

describe("field mapping", () => {
  it("maps the common names, first + last and the owner's React keys", () => {
    const m = mapLeadFields({
      firstName: "Dana", lastName: "Whitfield", email: "Dana@Example.com", phone: "(614) 555-0142",
      address: "1450 Oak St", city: "Columbus", state: "OH", zip: "43215", service: "Roof repair",
      message: "Leak over the garage", details: "Two-story house",
    });
    expect(m).toMatchObject({
      name: "Dana Whitfield", email: "dana@example.com", phone: "(614) 555-0142", addressLine1: "1450 Oak St",
      city: "Columbus", state: "OH", postalCode: "43215", service: "Roof repair",
    });
    expect(m.message).toBe("Leak over the garage\n\nTwo-story house");
  });

  it("reads WordPress / builder style names and falls back to values that look like an email or phone", () => {
    expect(fieldRole("your-name")).toBe("name");
    expect(fieldRole("contact[email]")).toBe("email");
    expect(fieldRole("tel-mobile")).toBe("phone");
    expect(fieldRole("street_address")).toBe("addressLine1");
    expect(fieldRole("address_line_2")).toBe(null);
    expect(fieldRole("postal_code")).toBe("postalCode");
    expect(fieldRole("comments")).toBe("message");
    expect(fieldRole("project_type")).toBe("service");
    expect(fieldRole("company_name")).toBe(null);
    expect(fieldRole("email_address")).toBe("email");
    for (const k of ["_pageUrl", "_pageTitle", "_gclid", "_utm_source", "referrer", "sourcePath", "site_brand", "page_title"]) {
      expect(fieldRole(k), k).toBe(null); // tracking keys stay in `fields` only
    }
    const m = mapLeadFields({ input_1: "Pat Lee", input_2: "pat@example.com", input_3: "614-555-0199" });
    expect(m.email).toBe("pat@example.com");
    expect(m.phone).toBe("614-555-0199");
  });

  it("takes page and brand from the sites' own tracking keys", () => {
    expect(pageMetaFrom({ _pageUrl: "https://columbusroofing.example/contact", _pageTitle: "Contact", site_brand: "Columbus Roofing" }))
      .toEqual({ pageUrl: "https://columbusroofing.example/contact", title: "Contact", brand: "Columbus Roofing", source: null });
    expect(pageMetaFrom({ sourceUrl: "javascript:alert(1)" }).pageUrl).toBe(null);
  });
});

describe("sensitive fields and honeypots", () => {
  it("drops password, card, cvv, ssn, token, csrf and captcha names, truncates values, caps the field count", () => {
    const out = sanitizeFields({
      name: "Dana", password: "x", card_number: "4242", "cc-exp": "12/30", cvv: "123", ssn: "1", social_security: "1",
      _token: "t", csrf_token: "t", "g-recaptcha-response": "r", honeypot: "", long: "a".repeat(5000), empty: "  ",
    });
    expect(Object.keys(out)).toEqual(["name", "long"]);
    expect(out.long.length).toBe(2000);
    const many = sanitizeFields(Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`f${i}`, "v"])));
    expect(Object.keys(many).length).toBe(60);
    expect(SENSITIVE_FIELD.test("cf-turnstile-captcha")).toBe(true);
    // Payment-form spellings without "card" in them.
    for (const k of ["cc_number", "ccnum", "ccNo", "cc_exp", "cc", "cv2", "cvn", "security_code", "securityCode", "expiry", "routing_number", "account_number", "iban"])
      expect(SENSITIVE_FIELD.test(k), k).toBe(true);
    // ...without catching ordinary lead fields.
    for (const k of ["success", "accent", "address", "message", "service", "phone", "email", "zip", "city"])
      expect(SENSITIVE_FIELD.test(k), k).toBe(false);
  });

  it("treats a filled company_url or website as a bot", () => {
    expect(honeypotTripped({ name: "x", website: "" })).toBe(false);
    expect(honeypotTripped({ name: "x", company_url: "http://spam" })).toBe(true);
    expect(honeypotTripped({ name: "x", website: "spam.example" })).toBe(true);
  });
});

describe("phone key", () => {
  it("compares on the last 10 digits with a leading US 1 stripped", () => {
    expect(phoneKey("+1 (614) 555-0142")).toBe("6145550142");
    expect(phoneKey("614.555.0142")).toBe("6145550142");
    expect(phoneKey("16145550142")).toBe("6145550142");
    expect(phoneKey("555-0142")).toBe(null);
  });
});

describe("body parsing", () => {
  it("reads text/plain JSON (sendBeacon), application/json and urlencoded", () => {
    const env = { fields: { name: "A" }, pageUrl: "https://x.example/p", formId: "f", formName: null, title: "T" };
    expect(parseFormSyncBody(Buffer.from(JSON.stringify(env)), "text/plain;charset=UTF-8")).toMatchObject({ fields: { name: "A" }, pageUrl: "https://x.example/p", formId: "f" });
    expect(parseFormSyncBody(Buffer.from(JSON.stringify({ name: "B", email: "b@x.example" })), "application/json")?.fields).toEqual({ name: "B", email: "b@x.example" });
    expect(parseFormSyncBody(Buffer.from("name=C&email=c%40x.example"), "application/x-www-form-urlencoded")?.fields).toEqual({ name: "C", email: "c@x.example" });
    expect(parseFormSyncBody(Buffer.from("not json"), "text/plain")).toBe(null);
  });

  it("keeps the script's attribution envelope apart from the fields; a bare body has none", () => {
    const env = { fields: { name: "A" }, attribution: { gclid: "abc", referrer: "https://www.google.com/" } };
    expect(parseFormSyncBody(Buffer.from(JSON.stringify(env)), "text/plain")?.attribution).toEqual({ gclid: "abc", referrer: "https://www.google.com/" });
    expect(parseFormSyncBody(Buffer.from(JSON.stringify({ fields: { name: "A" }, attribution: ["x"] })), "text/plain")?.attribution).toBe(null);
    expect(parseFormSyncBody(Buffer.from(JSON.stringify({ name: "B", attribution: { gclid: "x" } })), "application/json")?.attribution).toBe(null);
  });
});

// ── The script, run in a fake browser ──────────────────────────────────────

type Beacon = { url: string; body: any };
function runScript(opts: { origin?: string; search?: string; referrer?: string; storage?: Record<string, string> } = {}) {
  const origin = opts.origin ?? "https://columbusroofing.example";
  const storage = opts.storage;
  const beacons: Beacon[] = [];
  const listeners: Record<string, ((e: any) => void)[]> = {};
  const timers: (() => void)[] = [];
  const siteFetchCalls: any[] = [];
  class FakeBlob { constructor(public parts: string[]) {} }
  class FakeXHR { open(_m: string, _u: string) {} send(_b?: any) { siteFetchCalls.push("xhr"); } }
  const win: any = {
    fetch: (...a: any[]) => { siteFetchCalls.push(a); return Promise.resolve({ ok: false, status: 400 }); },
    XMLHttpRequest: FakeXHR,
    addEventListener: () => {},
    URL, URLSearchParams, FormData: class {},
    sessionStorage: storage ? { getItem: (k: string) => storage[k] ?? null, setItem: (k: string, v: string) => { storage[k] = v; } } : undefined,
  };
  const doc: any = {
    title: "Contact us",
    referrer: opts.referrer ?? "",
    currentScript: { getAttribute: (n: string) => (n === "data-token" ? "org1.tok" : null) },
    querySelector: () => null,
    addEventListener: (t: string, fn: any) => { (listeners[t] ??= []).push(fn); },
  };
  const ctx = vm.createContext({
    window: win, document: doc, location: { href: `${origin}/contact${opts.search ?? ""}`, origin, search: opts.search ?? "" },
    navigator: { sendBeacon: (url: string, blob: FakeBlob) => { beacons.push({ url, body: JSON.parse(blob.parts[0]) }); return true; } },
    Blob: FakeBlob, URL, URLSearchParams, JSON, String, Object, setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; },
    clearTimeout: (id: number) => { timers[id - 1] = () => {}; },
  });
  vm.runInContext(formSyncScript("https://portal.constructhub.us"), ctx);
  const flush = () => { const all = timers.splice(0); for (const t of all) t(); };
  return { win, doc, beacons, listeners, flush, siteFetchCalls };
}

describe("form-sync.js", () => {
  it("is plain JavaScript under 5 KB with the endpoint and the token reader", () => {
    const js = formSyncScript("https://portal.constructhub.us");
    expect(Buffer.byteLength(js)).toBeLessThan(5120);
    expect(js).toContain("https://portal.constructhub.us/api/public/form-sync/");
    expect(js).toContain('d.addEventListener("submit"');
    expect(js).not.toContain("preventDefault");
  });

  it("copies a same-origin fetch JSON lead (the React sites) without touching the site's own request", async () => {
    const { win, beacons, flush, siteFetchCalls } = runScript();
    const body = JSON.stringify({ firstName: "Dana", email: "dana@example.com", phone: "6145550142", message: "Roof", _pageUrl: "https://columbusroofing.example/contact" });
    const r = await win.fetch("/api/contact", { method: "POST", body, headers: { "Content-Type": "application/json" } });
    expect(r.status).toBe(400); // the site's own answer comes back untouched
    expect(siteFetchCalls.length).toBe(1);
    expect(siteFetchCalls[0][1].body).toBe(body);
    flush();
    expect(beacons.length).toBe(1);
    expect(beacons[0].url).toBe("https://portal.constructhub.us/api/public/form-sync/org1.tok");
    expect(beacons[0].body.fields).toMatchObject({ firstName: "Dana", email: "dana@example.com" });
    expect(beacons[0].body.formName).toBe("/api/contact");
  });

  it("ignores GETs, other origins, non-leads, and bodies with a filled honeypot", async () => {
    const { win, beacons, flush } = runScript();
    await win.fetch("/api/contact?x=1");
    await win.fetch("https://other.example/api/contact", { method: "POST", body: JSON.stringify({ email: "a@b.example" }) });
    await win.fetch("/api/search", { method: "POST", body: JSON.stringify({ q: "roof" }) });
    await win.fetch("/submit.php", { method: "POST", body: "name=Bot&email=bot%40x.example&website=spam.example" });
    flush();
    expect(beacons.length).toBe(0);
  });

  it("sends a submit event and the fetch it triggers for the same person once", async () => {
    const { win, beacons, flush, listeners } = runScript();
    const form = {
      tagName: "FORM", id: "lf", getAttribute: () => null, closest: () => null,
      elements: [
        { name: "name", type: "text", value: "Pat Lee" }, { name: "email", type: "email", value: "pat@example.com" },
        { name: "password", type: "password", value: "secret" }, { name: "website", type: "text", value: "" },
      ],
    };
    for (const fn of listeners.submit) fn({ target: form });
    await win.fetch("/submit.php", { method: "POST", body: "name=Pat+Lee&email=pat%40example.com&service=Siding" });
    flush();
    expect(beacons.length).toBe(1);
    expect(beacons[0].body.fields).toEqual({ name: "Pat Lee", email: "pat@example.com", service: "Siding" });
  });

  it("offers window.ConstructHUBForms.send for anything else", () => {
    const { win, beacons, flush } = runScript();
    expect(win.ConstructHUBForms.send({ name: "Lee", phone: "614-555-0100" })).toBe(true);
    flush();
    expect(beacons.length).toBe(1);
    expect(beacons[0].body.attribution).toEqual({}); // no trail on this page, nothing claimed
  });

  it("reads the ad click, utm tags and an outside referrer on the landing page and keeps them for the tab", () => {
    const storage: Record<string, string> = {};
    const a = runScript({ search: "?gclid=EAIa&utm_source=google&utm_medium=cpc&utm_campaign=siding&foo=1", referrer: "https://www.google.com/", storage });
    a.win.ConstructHUBForms.send({ name: "Lee", phone: "614-555-0100" }); a.flush();
    expect(a.beacons[0].body.attribution).toEqual({
      gclid: "EAIa", utm_source: "google", utm_medium: "cpc", utm_campaign: "siding",
      referrer: "https://www.google.com/", landing: "https://columbusroofing.example/contact?gclid=EAIa&utm_source=google&utm_medium=cpc&utm_campaign=siding&foo=1",
    });
    // The next page in the same tab (the site's own referrer, no params) keeps the first touch.
    const b = runScript({ referrer: "https://columbusroofing.example/", storage });
    b.win.ConstructHUBForms.send({ name: "Lee", phone: "614-555-0100" }); b.flush();
    expect(b.beacons[0].body.attribution.gclid).toBe("EAIa");
    // The site's own pages as referrer, without storage, claim nothing.
    const c = runScript({ referrer: "https://columbusroofing.example/siding" });
    c.win.ConstructHUBForms.send({ name: "Lee", phone: "614-555-0100" }); c.flush();
    expect(c.beacons[0].body.attribution).toEqual({});
  });
});

// ── Against the dev server ─────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev" });
const q = <T = any>(text: string, params: any[] = []) => pool.query(text, params).then((r) => r.rows as T[]);
let ORG_ID = "";
let reachable = false;

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}
// A unique forged IP per call keeps the per-IP bucket out of the way (the dev server trusts the header).
let ipN = 0;
const ip = () => `10.${(Date.now() >> 8) & 255}.${(ipN >> 8) & 255}.${ipN++ & 255}`;
const token = async () => (await api("/api/crm/integrations/lead-capture")).body.token as string;
const beacon = (tok: string, fields: Record<string, string>, pageUrl = "https://columbusroofing.example/contact") =>
  fetch(`${BASE}/api/public/form-sync/${tok}`, {
    method: "POST", headers: { "content-type": "text/plain;charset=UTF-8", "x-forwarded-for": ip(), origin: "https://columbusroofing.example" },
    body: JSON.stringify({ fields, pageUrl, formId: "contact", title: "Contact" }),
  });
const leadsByMarker = (marker: string) =>
  q(`select * from crm_leads where org_id = $1 and (message like $2 or name like $2) order by received_at`, [ORG_ID, `%${marker}%`]);

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE}/api/crm/me`);
    if (res.status === 200) { ORG_ID = (await res.json()).org.id; reachable = true; }
  } catch { /* not running */ }
  if (!reachable) throw new Error(`CRM dev server not reachable at ${BASE}. Start it first.`);
});

afterAll(async () => {
  if (ORG_ID) {
    await q(`delete from crm_projects where org_id = $1 and name like $2`, [ORG_ID, `%${RUN}%`]);
    await q(`delete from crm_customers where org_id = $1 and (display_name like $2 or notes like $2)`, [ORG_ID, `%${RUN}%`]);
    await q(`delete from crm_leads where org_id = $1 and (name like $2 or message like $2 or external_id like $2)`, [ORG_ID, `%${RUN}%`]);
  }
  await pool.end();
});

describe("GET /form-sync.js", () => {
  it("serves JavaScript, cacheable, with this deployment's endpoint", async () => {
    const res = await fetch(`${BASE}/form-sync.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/javascript/);
    expect(res.headers.get("cache-control")).toContain("public");
    const js = await res.text();
    expect(js).toContain("/api/public/form-sync/");
  });
});

describe("POST /api/public/form-sync/:token", () => {
  it("answers CORS for any origin, the preflight included", async () => {
    const tok = await token();
    const pre = await fetch(`${BASE}/api/public/form-sync/${tok}`, {
      method: "OPTIONS", headers: { origin: "https://columbusroofing.example", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
    const res = await beacon(tok, { name: `${RUN} cors`, email: `cors-${RUN.toLowerCase()}@example.com`, message: `${RUN} cors` });
    expect(res.status).toBe(201);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const bad = await fetch(`${BASE}/api/public/form-sync/nope.nope`, { method: "POST", body: "{}", headers: { "content-type": "text/plain" } });
    expect(bad.status).toBe(404);
    expect(bad.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("stores the mapped lead with every field, never the sensitive ones; caps the body at 32 KB", async () => {
    const tok = await token();
    const res = await beacon(tok, {
      "your-name": `${RUN} mapped`, "your-email": `mapped-${RUN.toLowerCase()}@example.com`, "your-phone": "614-555-0111",
      street: "1450 Oak St", city: "Columbus", state: "OH", zip: "43215", service: "Siding", message: `${RUN} mapped`,
      password: "hunter2", card_number: "4242424242424242", _gclid: "abc",
    });
    expect(res.status).toBe(201);
    const [lead] = await leadsByMarker(`${RUN} mapped`);
    expect(lead).toMatchObject({ source: "form_sync", status: "new", city: "Columbus", postal_code: "43215", service: "Siding", address_line1: "1450 Oak St" });
    expect(lead.source_label).toContain("columbusroofing.example");
    expect(lead.fields._gclid).toBe("abc");
    expect(lead.fields.password).toBeUndefined();
    expect(lead.fields.card_number).toBeUndefined();
    const big = await fetch(`${BASE}/api/public/form-sync/${tok}`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ fields: { message: "x".repeat(40_000) } }) });
    expect(big.status).toBe(413);
  });

  it("counts the same person + message within 10 minutes once, and drops a filled honeypot", async () => {
    const tok = await token();
    const f = { name: `${RUN} dupe`, email: `dupe-${RUN.toLowerCase()}@example.com`, message: `${RUN} dupe` };
    expect((await beacon(tok, f)).status).toBe(201);
    expect((await beacon(tok, f)).status).toBe(201);
    expect((await beacon(tok, { ...f, message: `${RUN} dupe, second question` })).status).toBe(201);
    expect((await leadsByMarker(`${RUN} dupe`)).length).toBe(2);
    expect((await beacon(tok, { name: `${RUN} bot`, email: "bot@example.com", website: "spam.example", message: `${RUN} bot` })).status).toBe(201);
    expect((await leadsByMarker(`${RUN} bot`)).length).toBe(0);
  });

  it("stores a lead nobody can reach as spam", async () => {
    const tok = await token();
    await beacon(tok, { name: `${RUN} nocontact`, message: `${RUN} nocontact` });
    const [lead] = await leadsByMarker(`${RUN} nocontact`);
    expect(lead.status).toBe("spam");
  });

  it("links an existing client by the phone's last 10 digits and never edits the client", async () => {
    const [c] = await q(`insert into crm_customers (org_id, display_name, phone, address_line1, portal_token)
      values ($1, $2, '+1 (614) 555-0177', '9 Elm St', md5(random()::text)) returning id, updated_at`, [ORG_ID, `${RUN} existing client`]);
    const tok = await token();
    await beacon(tok, { name: `${RUN} phone match`, phone: "614.555.0177", email: `other-${RUN.toLowerCase()}@example.com`, address: "1 New Rd", message: `${RUN} phone match` });
    const [lead] = await leadsByMarker(`${RUN} phone match`);
    expect(lead.customer_id).toBe(c.id);
    const [after] = await q(`select address_line1, email, updated_at from crm_customers where id = $1`, [c.id]);
    expect(after.address_line1).toBe("9 Elm St");
    expect(after.email).toBe(null);
    expect(new Date(after.updated_at).getTime()).toBe(new Date(c.updated_at).getTime());
  });
});

describe("the hosted form writes a Leads row too", () => {
  it("creates the client as before and a website_form lead linked to it", async () => {
    const tok = await token();
    const res = await api(`/api/public/leads/${tok}`, { method: "POST", headers: { "x-forwarded-for": ip() }, body: JSON.stringify({ name: `${RUN} hosted`, phone: "614-555-0123", address: "100 Test St", message: `${RUN} hosted`, website: "" }) });
    expect(res.status).toBe(201);
    const [lead] = await leadsByMarker(`${RUN} hosted`);
    expect(lead.source).toBe("website_form");
    const [client] = await q(`select id from crm_customers where org_id = $1 and display_name = $2`, [ORG_ID, `${RUN} hosted`]);
    expect(lead.customer_id).toBe(client.id);
  });
});

describe("CRM API", () => {
  it("lists with counts per status and filters by source and search", async () => {
    const res = await api(`/api/crm/leads?status=new&source=form_sync&q=${encodeURIComponent(RUN)}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.counts).sort()).toEqual(["archived", "contacted", "converted", "new", "spam"]);
    expect(res.body.counts.spam).toBeGreaterThanOrEqual(1);
    expect(res.body.rows.every((r: any) => r.source === "form_sync" && r.status === "new")).toBe(true);
  });

  it("every column header sorts: ?sort=name|contact|service|source|receivedAt&dir=asc|desc, in SQL, empties last", async () => {
    const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
    const rows = async (qs: string) => {
      const res = await api(`/api/crm/leads?status=all&q=${encodeURIComponent(RUN)}&limit=200&${qs}`);
      expect(res.status).toBe(200);
      return res.body.rows as any[];
    };
    const asc = (await rows("sort=name&dir=asc")).map((r) => r.name).filter(Boolean);
    expect(asc.length).toBeGreaterThan(1);
    for (let i = 1; i < asc.length; i++) expect(collator.compare(asc[i - 1], asc[i])).toBeLessThanOrEqual(0);
    const desc = (await rows("sort=name&dir=desc")).map((r) => r.name).filter(Boolean);
    expect(desc).toEqual([...asc].reverse());
    const received = (await rows("sort=receivedAt&dir=asc")).map((r) => new Date(r.receivedAt).getTime());
    for (let i = 1; i < received.length; i++) expect(received[i]).toBeGreaterThanOrEqual(received[i - 1]);
    for (const key of ["contact", "service", "source"]) expect((await rows(`sort=${key}&dir=asc`)).length).toBe(asc.length || received.length);
    expect((await api(`/api/crm/leads?sort=zip`)).status).toBe(400);
    expect((await api(`/api/crm/leads?sort=name&dir=sideways`)).status).toBe(400);
  });

  it("changes status", async () => {
    const [lead] = await leadsByMarker(`${RUN} mapped`);
    const res = await api(`/api/crm/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ status: "contacted" }) });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("contacted");
    expect((await api(`/api/crm/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ status: "won" }) })).status).toBe(400);
  });

  it("convert needs an address for a new client, then creates it (and a pipeline project)", async () => {
    const [lead] = await leadsByMarker(`${RUN} cors`);
    const refused = await api(`/api/crm/leads/${lead.id}/convert`, { method: "POST", body: JSON.stringify({}) });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe("Enter the client's address.");
    const ok = await api(`/api/crm/leads/${lead.id}/convert`, { method: "POST", body: JSON.stringify({ addressLine1: "22 Pine Ave", city: "Columbus", state: "OH", addToPipeline: true }) });
    expect(ok.status).toBe(200);
    expect(ok.body.createdClient).toBe(true);
    expect(ok.body.lead.status).toBe("converted");
    const [client] = await q(`select address_line1, city, portal_token from crm_customers where id = $1`, [ok.body.customer.id]);
    expect(client).toMatchObject({ address_line1: "22 Pine Ave", city: "Columbus" });
    expect(client.portal_token).toBeTruthy();
    const [project] = await q(`select status from crm_projects where id = $1`, [ok.body.projectId]);
    expect(project.status).toBe("lead");
    await q(`update crm_projects set name = name || ' ' || $2 where id = $1`, [ok.body.projectId, RUN]);
    await q(`update crm_customers set notes = coalesce(notes, '') || ' ' || $2 where id = $1`, [ok.body.customer.id, RUN]);
    // A second click returns the same client instead of making another.
    const again = await api(`/api/crm/leads/${lead.id}/convert`, { method: "POST", body: JSON.stringify({ addressLine1: "22 Pine Ave" }) });
    expect(again.status).toBe(200);
    expect(again.body.createdClient).toBe(false);
    expect(again.body.customer.id).toBe(ok.body.customer.id);
  });

  it("convert links an existing client without an address", async () => {
    const [lead] = await leadsByMarker(`${RUN} phone match`);
    const ok = await api(`/api/crm/leads/${lead.id}/convert`, { method: "POST", body: JSON.stringify({ customerId: lead.customer_id }) });
    expect(ok.status).toBe(200);
    expect(ok.body.createdClient).toBe(false);
  });

  it("imports idempotently by externalId (owner)", async () => {
    const rows = [
      { externalId: `${RUN}-1`, source: "import", sourceLabel: "Old site", receivedAt: "2025-03-02T15:00:00Z", firstName: "Old", lastName: `${RUN}`, email: `old1-${RUN.toLowerCase()}@example.com`, address: "5 Maple St", message: `${RUN} import 1`, pageUrl: "https://columbusroofing.example/contact" },
      { externalId: `${RUN}-2`, name: `${RUN} import 2`, phone: "614-555-0190", status: "converted" },
    ];
    const first = await api("/api/crm/leads/import", { method: "POST", body: JSON.stringify(rows) });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ inserted: 2, skipped: 0 });
    const again = await api("/api/crm/leads/import", { method: "POST", body: JSON.stringify(rows) });
    expect(again.body).toMatchObject({ inserted: 0, skipped: 2 });
    const [one] = await q(`select name, address_line1, received_at, source from crm_leads where org_id = $1 and external_id = $2`, [ORG_ID, `${RUN}-1`]);
    expect(one).toMatchObject({ name: `Old ${RUN}`, address_line1: "5 Maple St", source: "import" });
    expect(new Date(one.received_at).toISOString()).toBe("2025-03-02T15:00:00.000Z");
    const tooMany = await api("/api/crm/leads/import", { method: "POST", body: JSON.stringify(Array.from({ length: 1001 }, () => ({}))) });
    expect(tooMany.status).toBe(400);
  });
});

describe("where a lead came from", () => {
  it("stores the script's attribution as _ fields (the form's own key wins) and names the channel in the API", async () => {
    const tok = await token();
    const post = (fields: Record<string, string>, attribution: Record<string, string>) => fetch(`${BASE}/api/public/form-sync/${tok}`, {
      method: "POST", headers: { "content-type": "text/plain;charset=UTF-8", "x-forwarded-for": ip(), origin: "https://columbusroofing.example" },
      body: JSON.stringify({ fields, pageUrl: "https://columbusroofing.example/contact", formId: "contact", attribution }),
    });
    expect((await post({ name: `${RUN} Ad Click`, email: `${RUN.toLowerCase()}-ad@example.com`, message: `${RUN} ad`, _utm_campaign: "mine" },
      { gclid: "EAIa", utm_source: "google", utm_medium: "cpc", utm_campaign: "theirs", referrer: "https://www.google.com/", password: "nope", extra: "dropped" })).status).toBe(201);
    expect((await post({ name: `${RUN} Facebook`, email: `${RUN.toLowerCase()}-fb@example.com`, message: `${RUN} fb` }, { fbclid: "IwAR" })).status).toBe(201);
    const [ad] = await leadsByMarker(`${RUN} ad`);
    expect(ad.fields).toMatchObject({ _gclid: "EAIa", _utm_source: "google", _utm_medium: "cpc", _utm_campaign: "mine", _referrer: "https://www.google.com/" });
    expect(ad.fields).not.toHaveProperty("_password");
    expect(ad.fields).not.toHaveProperty("_extra");
    const list = (await api(`/api/crm/leads?q=${encodeURIComponent(RUN)}`)).body;
    const byName = Object.fromEntries(list.rows.map((r: any) => [r.name, r.channel]));
    expect(byName[`${RUN} Ad Click`]).toEqual({ key: "google_ads", label: "Google Ads", detail: "mine" });
    expect(byName[`${RUN} Facebook`]).toEqual({ key: "facebook", label: "Facebook", detail: null });
  });
});
