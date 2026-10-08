import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import fs from "fs";
import path from "path";
import type { AddressInfo } from "net";
import { build } from "esbuild";
import {
  FIXTURE_MARK, assertFixtureSeedAllowed, assertTutorialFixturesBootable, evaluateTutorialGate, fixtureMarked, tutorialFixturesOn,
} from "./gate";
import { providerFixture, registeredFixtureIds, registerTutorialFixtureRoutes, requireTutorialFixtures, resetTutorialFixtureAdapters, runTutorialFixtureBoot } from "./registry";
import { installTutorialEgressGuard, registerTutorialFixtures, type GoogleCalendarFixture, type SearchConsoleFixture, type SmsFixture, type StripeFixture } from "./index";
import { stripeFixture, FIXTURE_STRIPE_ACCOUNT } from "./providers/stripe";
import { FIXTURE_HOVER_JOBS } from "./providers/hover";
import { FIXTURE_GSC_PROPERTY, fixtureGscDays } from "./providers/search-console";
import { emailFixture } from "./providers/email";
import { smsFixture, FIXTURE_SMS_COMPANY_NUMBER, FIXTURE_SMS_PLATFORM_NUMBER } from "./providers/sms";

/**
 * The tutorial fixtures invent data. These tests are the proof that invented data stays inside a
 * recording slot: the gate, the one registry everything goes through, and the production build.
 * No database, no browser, no outside service.
 */
const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

/** A recording slot's environment, exactly as scripts/tutorials/app.ts builds it (schema mode). */
const SLOT_ENV = {
  TUTORIAL_FIXTURES: "1", TUTORIAL_SLOT: "5", PORT: "8185",
  DATABASE_URL: "postgres://dev:pw@127.0.0.1:5432/constructhub_dev?options=-c%20TimeZone%3DUTC%20-c%20search_path%3Dconstructhub_tut_slot5",
};
const KEYS = ["TUTORIAL_FIXTURES", "TUTORIAL_SLOT", "PORT", "DATABASE_URL", "NODE_ENV"] as const;
let saved: Record<string, string | undefined> = {};
const setEnv = (env: Record<string, string | undefined>) => { for (const k of KEYS) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; } resetTutorialFixtureAdapters(); };
beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); setEnv({ NODE_ENV: "test" }); });
afterEach(() => { setEnv(saved); });
const listen = (app: express.Express) => new Promise<import("http").Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
const slotOn = () => setEnv({ ...SLOT_ENV, NODE_ENV: "development" });

describe("the safety gate", () => {
  it("is on only when every condition holds", () => {
    expect(evaluateTutorialGate(SLOT_ENV, "development")).toEqual({ requested: true, on: true, failures: [] });
    // Database mode (a real recording database) is a slot too.
    expect(evaluateTutorialGate({ ...SLOT_ENV, DATABASE_URL: "postgres://dev:pw@localhost:5432/constructhub_tut_slot5" }, "development").on).toBe(true);
    expect(evaluateTutorialGate({ ...SLOT_ENV, TUTORIAL_FIXTURES: undefined }, "development")).toMatchObject({ requested: false, on: false });
  });

  const broken: [string, Record<string, string | undefined>, string | undefined, RegExp][] = [
    ["a production process", SLOT_ENV, "production", /production/],
    ["the production database port", { ...SLOT_ENV, DATABASE_URL: SLOT_ENV.DATABASE_URL.replace(":5432", ":5433") }, "development", /5432/],
    ["another host", { ...SLOT_ENV, DATABASE_URL: SLOT_ENV.DATABASE_URL.replace("127.0.0.1", "db.internal") }, "development", /host/],
    ["the dev database itself (public schema)", { ...SLOT_ENV, DATABASE_URL: "postgres://dev:pw@127.0.0.1:5432/constructhub_dev" }, "development", /recording database/],
    ["a search path that also reaches public", { ...SLOT_ENV, DATABASE_URL: "postgres://dev:pw@127.0.0.1:5432/constructhub_dev?options=-c%20search_path%3Dconstructhub_tut_slot5,public" }, "development", /recording database/],
    ["the live database name", { ...SLOT_ENV, DATABASE_URL: "postgres://dev:pw@127.0.0.1:5432/constructhub" }, "development", /recording database/],
    ["no database", { ...SLOT_ENV, DATABASE_URL: undefined }, "development", /DATABASE_URL/],
    ["no slot (not started by the line)", { ...SLOT_ENV, TUTORIAL_SLOT: undefined }, "development", /TUTORIAL_SLOT/],
    ["slot 0 (the template's own boot)", { ...SLOT_ENV, TUTORIAL_SLOT: "0", PORT: "8180" }, "development", /TUTORIAL_SLOT/],
    ["slot 9", { ...SLOT_ENV, TUTORIAL_SLOT: "9", PORT: "8189" }, "development", /TUTORIAL_SLOT/],
    ["another port than the slot's", { ...SLOT_ENV, PORT: "8110" }, "development", /PORT/],
  ];
  it.each(broken)("is off for %s — and asking for fixtures there refuses to boot", (_what, env, nodeEnv, why) => {
    const v = evaluateTutorialGate(env, nodeEnv);
    expect(v.on).toBe(false);
    expect(v.failures.join(" ")).toMatch(why);
    setEnv({ ...env, NODE_ENV: nodeEnv });
    expect(tutorialFixturesOn()).toBe(false);
    expect(() => assertTutorialFixturesBootable()).toThrow(/REFUSING TO BOOT/);
  });

  it("does nothing at all when fixtures were not asked for", () => {
    for (const nodeEnv of ["production", "development", "test"]) {
      setEnv({ ...SLOT_ENV, TUTORIAL_FIXTURES: undefined, NODE_ENV: nodeEnv });
      expect(tutorialFixturesOn()).toBe(false);
      expect(() => assertTutorialFixturesBootable()).not.toThrow();
    }
    setEnv({ ...SLOT_ENV, TUTORIAL_FIXTURES: "true", NODE_ENV: "development" }); // only the exact "1"
    expect(tutorialFixturesOn()).toBe(false);
  });

  it("is false under NODE_ENV=production whatever else is set", () => {
    setEnv({ ...SLOT_ENV, NODE_ENV: "production" });
    expect(tutorialFixturesOn()).toBe(false);
    for (const id of registeredFixtureIds()) expect(providerFixture(id), id).toBeNull();
  });

  it("is a constant `false` in the production build, and that build refuses to boot with TUTORIAL_FIXTURES=1", async () => {
    // The production bundle is made with this exact define (script/build.ts): build the gate the same way and run it.
    expect(read("script/build.ts")).toContain(`"process.env.NODE_ENV": '"production"'`);
    const out = await build({ entryPoints: [path.join(ROOT, "server/tutorials/fixtures/gate.ts")], bundle: true, write: false, format: "cjs", platform: "node", define: { "process.env.NODE_ENV": '"production"' } });
    const mod = { exports: {} as any };
    // Even with NODE_ENV=development in the real environment, the built code has its own answer.
    setEnv({ ...SLOT_ENV, NODE_ENV: "development" });
    new Function("module", "exports", "process", out.outputFiles[0].text)(mod, mod.exports, process);
    expect(tutorialFixturesOn()).toBe(true); // the source, here, is in a slot…
    expect(mod.exports.tutorialFixturesOn()).toBe(false); // …the production build of the same file is not
    expect(() => mod.exports.assertTutorialFixturesBootable()).toThrow(/REFUSING TO BOOT[\s\S]*production/);
    expect(() => mod.exports.assertFixtureSeedAllowed(SLOT_ENV)).toThrow(/refusing to write/);
  });

  it("is the first thing the server runs", () => {
    const index = read("server/index.ts");
    const firstImport = index.split("\n").find((l) => l.startsWith("import "));
    expect(firstImport).toBe('import "./tutorials/fixtures/boot-guard";');
    const guard = read("server/tutorials/fixtures/boot-guard.ts");
    expect(guard).toContain("assertTutorialFixturesBootable();");
    expect(guard).toContain("process.exit(78)");
  });
});

describe("the registry — with the gate OFF nothing is reachable", () => {
  it("registers the providers, and hands out none of them", () => {
    expect(registeredFixtureIds()).toEqual(["auth", "email", "google-calendar", "hover", "search-console", "sms", "stripe"]);
    for (const id of registeredFixtureIds()) expect(providerFixture(id), id).toBeNull();
    expect(() => requireTutorialFixtures("x")).toThrow(/only available in a recording slot/);
  });

  it("mounts no route, installs no guard, runs no boot hook", async () => {
    const app = express();
    app.use(express.json());
    const realFetch = globalThis.fetch;
    expect(registerTutorialFixtures(app)).toBe(false);
    expect(registerTutorialFixtureRoutes(app, async () => "org")).toEqual([]);
    expect(installTutorialEgressGuard()).toBe(false);
    expect(globalThis.fetch).toBe(realFetch);
    expect(await runTutorialFixtureBoot(async () => { throw new Error("must not be asked"); })).toEqual([]);
    const server = await listen(app);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      for (const [method, url] of [["GET", "/__tutorial/fixtures"], ["GET", "/__tutorial/ready"], ["GET", "/__tutorial/stripe/checkout/cs_test_x"], ["POST", "/__tutorial/stripe/checkout/cs_test_x/pay"],
        ["POST", "/__tutorial/action/stripe.pay"], ["POST", "/__tutorial/action/email.link"], ["POST", "/__tutorial/action/sms.inbound"], ["GET", "/__tutorial/auth/as?member=Rita%20Santos"],
        ["GET", "/__tutorial/hover/api/v2/jobs"], ["POST", "/__tutorial/hover/oauth/token"]] as const) {
        const r = await fetch(base + url, { method });
        expect(r.status, `${method} ${url}`).toBe(404);
        expect(await r.text(), `${method} ${url}`).toBe("Not found"); // the registry's own 404, not a page fallback
      }
    } finally { server.close(); }
  });

  it("a fixture helper called directly, or a stand-in someone kept a reference to, refuses", async () => {
    slotOn();
    const stripe = providerFixture<StripeFixture>("stripe")!, gcal = providerFixture<GoogleCalendarFixture>("google-calendar")!, sms = providerFixture<SmsFixture>("sms")!, gsc = providerFixture<SearchConsoleFixture>("search-console")!;
    expect(stripe && gcal && sms && gsc).toBeTruthy();
    setEnv({ NODE_ENV: "development" }); // the gate closes
    await expect(stripe.client.checkout.sessions.create({ mode: "payment", success_url: "http://portal.constructhub.us:8185/i/x", line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 1000, product_data: { name: "x" } } }] })).rejects.toThrow();
    await expect(gcal.fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList")).rejects.toThrow(/recording slot/);
    await expect(sms.fetch("https://sms.tutfx.example.com/api/laml/2010-04-01/Accounts/p/Messages.json", { method: "POST", body: "To=%2B19415550134&Body=x" })).rejects.toThrow(/recording slot/);
    await expect(gsc.fetch("https://www.googleapis.com/webmasters/v3/sites")).rejects.toThrow(/recording slot/);
    const ctx = { req: {} as any, orgId: "org", origin: "http://127.0.0.1:8185" };
    for (const action of ["link", "opened", "signIn"]) await expect(emailFixture.actions![action]({ to: "kane@example.com", estimate: "E-2001" }, ctx)).rejects.toThrow(/recording slot/);
    for (const action of ["settle", "fail", "refund"]) await expect(stripeFixture.actions![action]({}, ctx), action).rejects.toThrow();
  });

  it("no fixture row can be written: the seed refuses without the gate, and away from a recording database", () => {
    expect(() => assertFixtureSeedAllowed({})).toThrow(/TUTORIAL_FIXTURES=1 is not set/);
    expect(() => assertFixtureSeedAllowed({ DATABASE_URL: SLOT_ENV.DATABASE_URL })).toThrow(/refusing to write/);
    for (const url of ["postgres://u:p@127.0.0.1:5433/constructhub", "postgres://u:p@127.0.0.1:5432/constructhub_dev", "postgres://u:p@10.0.0.5:5432/constructhub_tut_slot1", "postgres://u:p@127.0.0.1:5432/constructhub"])
      expect(() => assertFixtureSeedAllowed({ TUTORIAL_FIXTURES: "1", DATABASE_URL: url }), url).toThrow(/refusing to write/);
    expect(() => assertFixtureSeedAllowed({ TUTORIAL_FIXTURES: "1", DATABASE_URL: SLOT_ENV.DATABASE_URL })).not.toThrow();
    expect(() => assertFixtureSeedAllowed({ TUTORIAL_FIXTURES: "1", DATABASE_URL: "postgres://u:p@127.0.0.1:5432/constructhub_dev?options=-c%20search_path%3Dconstructhub_tut_template" })).not.toThrow();
    // The seed asks BEFORE it opens a connection, and writes nothing that is not marked.
    const seed = read("scripts/tutorials/seed-fixtures.ts");
    expect(seed.indexOf("assertFixtureSeedAllowed();")).toBeGreaterThan(0);
    expect(seed.indexOf("assertFixtureSeedAllowed();")).toBeLessThan(seed.indexOf('await import("../../server/db")'));
    const inserts = [...seed.matchAll(/insert into (\w+) \(id,[\s\S]*?\[(id\([^)]*\))/g)];
    expect(inserts.map((m) => m[1]).sort()).toEqual(["crm_payment_accounts", "crm_payment_refunds", "crm_payments"]);
    expect(seed.match(/insert into /g)!.length).toBe(inserts.length);
    expect(seed).not.toMatch(/\b(delete from|drop |truncate|alter table|create table)\b/i);
  });

  it("feature code reaches a fixture only through the registry, at the listed seams", () => {
    const seams: Record<string, string[]> = {};
    const walk = (dir: string) => { for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${d.name}`;
      if (d.isDirectory()) { if (rel !== "server/tutorials/fixtures" && d.name !== "node_modules") walk(rel); continue; }
      if (!/\.tsx?$/.test(d.name) || /\.test\./.test(d.name)) continue;
      const src = read(rel);
      if (/tutorials\/fixtures/.test(src)) {
        // Only the public face — never a provider file, never the gate behind the registry's back.
        for (const m of src.matchAll(/from "([^"]*tutorials\/fixtures[^"]*)"|import "([^"]*tutorials\/fixtures[^"]*)"/g)) expect(m[1] ?? m[2], rel).toMatch(/tutorials\/fixtures(\/boot-guard)?$/);
        seams[rel] = [...src.matchAll(/providerFixture<\w+>\("([a-z-]+)"\)/g)].map((m) => m[1]);
      }
    } };
    walk("server"); walk("client/src"); walk("shared");
    expect(seams).toEqual({
      "server/crm/calendar.ts": ["google-calendar"],
      "server/crm/hover.ts": ["hover"],
      "server/crm/integrations.ts": ["stripe"],
      "server/crm/payments.ts": ["stripe"],
      "server/crm/sms.ts": ["sms"],
      "server/email.ts": ["email"],
      "server/index.ts": [],   // the boot guard
      "server/routes.ts": [],  // registerTutorialFixtures(app)
    });
    // The client is never told: no page has a fixture branch.
    expect(Object.keys(seams).some((f) => f.startsWith("client/") || f.startsWith("shared/"))).toBe(false);
  });
});

describe("with the gate ON (a recording slot)", () => {
  it("mounts the stand-ins for this machine only and lists what each simulates", async () => {
    slotOn();
    const app = express();
    app.use(express.json()); app.use(express.urlencoded({ extended: false }));
    expect(registerTutorialFixtureRoutes(app, async () => "org-1")).toEqual(["stripe", "hover", "auth"]);
    const server = await listen(app);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const list = await (await fetch(`${base}/__tutorial/fixtures`)).json();
      expect(list.fixtures.map((f: any) => f.id).sort()).toEqual(registeredFixtureIds());
      for (const f of list.fixtures) { expect(f.simulates.length, f.id).toBeGreaterThan(30); expect(f.seam.length, f.id).toBeGreaterThan(10); }
      // A request that came through a proxy or a tunnel is not "this machine".
      expect((await fetch(`${base}/__tutorial/fixtures`, { headers: { "x-forwarded-for": "198.51.100.7" } })).status).toBe(404);
      expect((await fetch(`${base}/__tutorial/action/nope.nothing`, { method: "POST" })).status).toBe(404);

      // The stand-in checkout: the real SDK creates the session; the page is neutral — no provider's name on it.
      const stripe = providerFixture<StripeFixture>("stripe")!;
      const session = await stripe.client.checkout.sessions.create({
        mode: "payment", payment_method_types: ["us_bank_account", "card"], customer_email: "hannah.lindqvist@example.com",
        success_url: `${base}/i/token?paid=1`, cancel_url: `${base}/i/token?paid=0`, metadata: { invoiceId: "inv-1", orgId: "org-1" },
        line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 286556, product_data: { name: "Invoice INV-1999 — Baseboards", description: "Payable to Aspire Interiors" } } }],
      }, { stripeAccount: FIXTURE_STRIPE_ACCOUNT });
      expect(session.id).toMatch(/^cs_test_tutfx_/);
      expect(fixtureMarked(session.id)).toBe(true);
      expect(session.url).toBe(`${base}/__tutorial/stripe/checkout/${session.id}`);
      expect(session.payment_status).toBe("unpaid");
      const html = await (await fetch(session.url!)).text();
      expect(html).toContain("$2,865.56");
      expect(html).toContain("Secure checkout");
      expect(html).toContain("Demonstration checkout page");
      expect(html.replaceAll("/__tutorial/stripe/", "")).not.toMatch(/stripe|powered by|#635bff/i);
      expect((await stripe.client.accounts.retrieve(FIXTURE_STRIPE_ACCOUNT)).charges_enabled).toBe(true);
      await expect(stripe.client.accounts.retrieve("acct_1RealLookingAccount")).rejects.toThrow();
    } finally { server.close(); }
  });

  it("signs its events with a secret only this process has — the webhook's own check is what accepts them", () => {
    slotOn();
    const a = providerFixture<StripeFixture>("stripe")!;
    const payload = JSON.stringify({ id: "evt_tutfx_1", object: "event", type: "checkout.session.completed", account: FIXTURE_STRIPE_ACCOUNT, data: { object: {} } });
    const header = a.client.webhooks.generateTestHeaderString({ payload, secret: a.webhookSecret });
    expect(a.client.webhooks.constructEvent(payload, header, a.webhookSecret).id).toBe("evt_tutfx_1");
    expect(() => a.client.webhooks.constructEvent(payload, header, "whsec_somebody_elses")).toThrow();
    expect(() => a.client.webhooks.constructEvent(payload.replace("evt_tutfx_1", "evt_forged"), header, a.webhookSecret)).toThrow();
    expect(a.webhookSecret).toMatch(/^whsec_[0-9a-f]{48}$/);
    // …and the real handlers are untouched: one signature check, no fixture branch around it.
    const integrations = read("server/crm/integrations.ts");
    expect(integrations).toContain("event = stripe.webhooks.constructEvent(req.rawBody, String(sig), CONNECT_WEBHOOK_SECRET);");
    expect(integrations.match(/constructEvent\(/g)!.length).toBe(1);
    expect(integrations).not.toMatch(/tutorialFixturesOn|skipSignature|TUTORIAL_/);
    expect(read("server/crm/payments.ts")).not.toMatch(/tutorialFixturesOn|TUTORIAL_/);
  });

  it("blocks every server-side request that would leave the machine", async () => {
    slotOn();
    const real = globalThis.fetch;
    try {
      expect(installTutorialEgressGuard()).toBe(true);
      await expect(fetch("https://api.stripe.com/v1/charges")).rejects.toThrow(/blocked/);
      await expect(fetch("https://hover.to/api/v2/jobs")).rejects.toThrow(/blocked/);
    } finally { globalThis.fetch = real; }
  });
});

describe("fixture content is fictional and recognisable", () => {
  it("marks what it writes", () => {
    for (const v of [FIXTURE_MARK.id + "pay-card-paid", FIXTURE_STRIPE_ACCOUNT, "cs_test_tutfx_ab12", "pi_tutfx_card_seedcardpaid", `hover:${FIXTURE_HOVER_JOBS[0].id}`]) expect(fixtureMarked(v), v).toBe(true);
    for (const v of ["demo-pay-01", "acct_1Nv0FGQ9RKHgCVdK", "cs_test_a1B2c3", "", null, 5]) expect(fixtureMarked(v), String(v)).toBe(false);
  });

  it("uses example.com emails, 555-01xx phones, no government data and no real provider link", () => {
    const files = ["scripts/tutorials/seed-fixtures.ts", "scripts/tutorials/gen-assets.ts", "scripts/tutorials/assets/clients-import.csv",
      ...fs.readdirSync(path.join(ROOT, "server/tutorials/fixtures/providers")).map((f) => `server/tutorials/fixtures/providers/${f}`)];
    for (const f of files) {
      const src = read(f);
      for (const m of src.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)) expect(m[0], f).toMatch(/(@|\.)example\.com$/);
      for (const m of src.matchAll(/\(\d{3}\) \d{3}-\d{4}|\+1\d{10}/g)) expect(m[0].replace(/\D/g, "").slice(-7), `${f}: ${m[0]}`).toMatch(/^55501\d\d$/);
      expect(src, f).not.toMatch(/\.gov\b|permit_databases|appraiser/i);
    }
    for (const j of FIXTURE_HOVER_JOBS) { expect(j.contact.email).toMatch(/@example\.com$/); expect(j.contact.phone).toMatch(/555-01\d\d$/); expect(j.id).toMatch(/^tutfx-/); }
    expect(new Set(FIXTURE_HOVER_JOBS.map((j) => j.address.region))).toEqual(new Set(["FL", "NY", "TX"]));
    for (const n of [FIXTURE_SMS_COMPANY_NUMBER, FIXTURE_SMS_PLATFORM_NUMBER]) expect(n).toMatch(/^\+1\d{3}55501\d\d$/);
    // The fixture seed puts online payments in all three states of the demo map, and never touches seed-demo's rows.
    const seed = read("scripts/tutorials/seed-fixtures.ts");
    for (const p of ["P-1997", "P-1994", "P-2005", "P-2007", "P-1999"]) expect(seed).toContain(`"${p}"`);
    for (const s of ['"succeeded"', '"processing"', '"refunded"', '"failed"']) expect(seed).toContain(s);
    expect(seed).not.toMatch(/update crm_(invoices|estimates|customers|projects|payments)\b/);
  });

  it("an inbound text can only come from a fictional number", async () => {
    slotOn();
    const ctx = { req: {} as any, orgId: "org", origin: "http://127.0.0.1:8185" };
    await expect(smsFixture.actions!.inbound({ from: "+14155552671", body: "STOP" }, ctx)).rejects.toThrow(/fictional/);
  });

  it("the Search Console skeleton has 28 days of fixed, plausible rows for a reserved example property — and is not wired in", () => {
    expect(FIXTURE_GSC_PROPERTY).toBe("sc-domain:gatorbuilders-demo.example");
    const today = new Date("2026-10-08T12:00:00Z");
    const days = fixtureGscDays(today);
    expect(days).toHaveLength(28);
    expect(days[0].date).toBe("2026-09-10"); expect(days[27].date).toBe("2026-10-07");
    expect(fixtureGscDays(today)).toEqual(days); // no randomness: a re-record shows the same chart
    for (const d of days) { expect(d.impressions).toBeGreaterThan(300); expect(d.clicks).toBeGreaterThan(5); expect(d.clicks).toBeLessThan(d.impressions * 0.06); expect(d.position).toBeGreaterThan(5); }
    for (const f of fs.readdirSync(path.join(ROOT, "server/gsc"))) expect(read(`server/gsc/${f}`), f).not.toContain("tutorials/fixtures");
  });

  it("answers Search Console's own calls in a slot", async () => {
    slotOn();
    const gsc = providerFixture<SearchConsoleFixture>("search-console")!;
    const sites = await (await gsc.fetch("https://www.googleapis.com/webmasters/v3/sites")).json();
    expect(sites.siteEntry[0].siteUrl).toBe(FIXTURE_GSC_PROPERTY);
    const q = (dimensions: string[]) => gsc.fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(FIXTURE_GSC_PROPERTY)}/searchAnalytics/query`, { method: "POST", body: JSON.stringify({ dimensions }) }).then((r) => r.json());
    expect((await q(["date"])).rows).toHaveLength(28);
    expect((await q(["query"])).rows[0].keys[0]).toBe("flooring contractor near me");
    expect((await q(["page"])).rows[0].keys[0]).toBe("https://gatorbuilders-demo.example/");
    expect((await gsc.fetch("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Areal-site.com/searchAnalytics/query", { method: "POST", body: "{}" })).status).toBe(403);
  });
});

describe("the line starts a slot with fixtures and nothing else", () => {
  const app = read("scripts/tutorials/app.ts");
  it("sets the two gate variables, for slots 1–8 only, and waits for the stand-ins", () => {
    expect(app).toContain('if (fixtures) { env.TUTORIAL_FIXTURES = "1"; env.TUTORIAL_SLOT = String(o.slot); }');
    expect(app).toContain("const fixtures = o.fixtures ?? isSlot(o.slot);");
    expect(app).toContain("/__tutorial/ready");
    expect(app).not.toMatch(/\.\.\.process\.env/);
  });
  it("produce.ts seeds the fixture rows after the demo seed, into the slot's own copy", () => {
    const produce = read("scripts/tutorials/produce.ts");
    expect(produce).toMatch(/await seedDemo\(database\)[\s\S]{0,80}if \(fixtures\) console\.log\(`  \$\{await seedFixtures\(database\)\}`\)/);
    expect(produce).toContain("startApp({ slot, database, fixtures })");
    const db = read("scripts/tutorials/db.ts");
    expect(db).toContain('await step("scripts/tutorials/seed-fixtures.ts", () => seedFixtures(TEMPLATE));');
    // The reseed: under the exclusive template lock unless told otherwise, the demo seed first, fixtures only on request.
    expect(db).toContain("opts.withoutLock ? fn() : withLock(TEMPLATE_LOCK, fn);");
    expect(db).toMatch(/return locked\(async \(\) => \{[\s\S]{0,200}const before = await census\(TEMPLATE\);\s*let out = await seedDemo\(TEMPLATE\);[\s\S]*if \(opts\.fixtures\) out \+= /);
  });
});
