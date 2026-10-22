/**
 * The three-step sign-up's validation (shared/signup.ts, server/signup-leads.ts), then the lead
 * endpoints against the running dev server: step 1 saves the email, step 2 updates only the lead
 * this browser started, and nothing is saved for a refused body. Rows it creates are deleted.
 */
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { formatUsPhoneInput, normalizeSignupEmail, normalizeUsMobile, parseSignupDetails } from "@shared/signup";
import { SIGNUP_LEADS_DDL, leadSource, parseLeadStart } from "./signup-leads";

describe("normalizeUsMobile", () => {
  it.each([
    ["(555) 234-5678", "+15552345678"],
    ["555.234.5678", "+15552345678"],
    ["555-234-5678", "+15552345678"],
    ["+1 555 234 5678", "+15552345678"],
    ["1 (555) 234-5678", "+15552345678"],
    ["5552345678", "+15552345678"],
  ])("normalizes %j to E.164", (raw, e164) => {
    expect(normalizeUsMobile(raw)).toBe(e164);
  });

  it.each([
    [""], ["555-1234"], ["555234567"], ["55523456789"], ["+44 20 7946 0958"],
    ["(055) 234-5678"], ["(155) 234-5678"], ["(555) 034-5678"], ["(555) 134-5678"],
    ["555-CALL-NOW"], [null], [undefined], [5552345678], ["5".repeat(41)],
  ])("refuses %j", (raw) => {
    expect(normalizeUsMobile(raw as any)).toBeNull();
  });

  it("formats as typed", () => {
    expect(formatUsPhoneInput("555")).toBe("555");
    expect(formatUsPhoneInput("5552")).toBe("(555) 2");
    expect(formatUsPhoneInput("5552345678")).toBe("(555) 234-5678");
    expect(formatUsPhoneInput("+1 555 234 5678 99")).toBe("(555) 234-5678");
  });
});

describe("step 1 and step 2 bodies", () => {
  it("accepts a valid email, lower-cased and trimmed", () => {
    expect(parseLeadStart({ email: "  Pat@Example.COM " })).toEqual({ ok: true, email: "pat@example.com", source: "auth" });
    expect(normalizeSignupEmail("a@b.co")).toBe("a@b.co");
  });

  it.each([[""], ["pat"], ["pat@"], ["pat@example"], ["pat @example.com"], [`${"a".repeat(250)}@b.co`], [42], [null]])(
    "refuses the email %j", (email) => {
      expect(parseLeadStart({ email }).ok).toBe(false);
    });

  it("keeps a known source shape and drops anything else", () => {
    expect(leadSource("prefill")).toBe("prefill");
    expect(leadSource("landing-hero")).toBe("landing-hero");
    expect(leadSource("<script>")).toBe("auth");
    expect(leadSource(undefined)).toBe("auth");
  });

  const good = { firstName: " Pat ", lastName: "Smith  Jr", phone: "(555) 234-5678", trade: "roofing", teamSize: "2-5" };
  it("parses step 2 into stored values", () => {
    expect(parseSignupDetails(good)).toEqual({
      ok: true, details: { firstName: "Pat", lastName: "Smith Jr", phone: "+15552345678", trade: "roofing", teamSize: "2-5" },
    });
  });

  it.each([
    [{ firstName: "" }, "Enter your first and last name"],
    [{ lastName: "  " }, "Enter your first and last name"],
    [{ phone: "123" }, "Enter a valid US mobile number"],
    [{ trade: "astronaut" }, "Pick your trade"],
    [{ teamSize: "500" }, "Pick your team size"],
  ])("refuses step 2 with %j", (patch, message) => {
    expect(parseSignupDetails({ ...good, ...patch })).toEqual({ ok: false, message });
  });

  it("only adds columns and tables idempotently", () => {
    for (const sql of SIGNUP_LEADS_DDL) expect(sql).toMatch(/^(ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS|CREATE (TABLE|INDEX) IF NOT EXISTS)/);
  });
});

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const testEmail = `signup-lead-test-${Date.now()}@example.com`;

async function post(path: string, body: unknown, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

describe("POST /api/auth/signup-lead (dev server)", () => {
  afterAll(async () => {
    await pool.query(`DELETE FROM signup_leads WHERE email = $1`, [testEmail]);
    await pool.end();
  });

  it("refuses a bad email and saves nothing", async () => {
    const r = await post("/api/auth/signup-lead", { email: "not-an-email" });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Enter a valid email address");
  });

  it("says when the email already has an account, without saving a lead", async () => {
    const { rows: [u] } = await pool.query(`SELECT email FROM users ORDER BY id LIMIT 1`);
    if (!u) return;
    const r = await post("/api/auth/signup-lead", { email: u.email.toUpperCase() });
    expect(r.body).toEqual({ exists: true });
    const { rows } = await pool.query(`SELECT 1 FROM signup_leads WHERE email = lower($1) AND converted_user_id IS NULL AND created_at > now() - interval '1 minute'`, [u.email]);
    expect(rows).toHaveLength(0);
  });

  it("refuses step 2 without a step-1 lead on this browser", async () => {
    const r = await post("/api/auth/signup-lead/details", { firstName: "Pat", lastName: "Smith", phone: "5552345678", trade: "roofing", teamSize: "1" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("no-lead");
  });

  it("saves the email on step 1, then this browser's answers on step 2", async () => {
    const start = await post("/api/auth/signup-lead", { email: testEmail, source: "prefill" });
    expect(start.status).toBe(200);
    expect(start.body).toEqual({ ok: true });
    expect(start.cookie).toBeTruthy();

    const bad = await post("/api/auth/signup-lead/details", { firstName: "Pat", lastName: "Smith", phone: "555", trade: "roofing", teamSize: "1" }, start.cookie);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe("Enter a valid US mobile number");

    const ok = await post("/api/auth/signup-lead/details", { firstName: "Pat", lastName: "Smith", phone: "(555) 234-5678", trade: "hvac", teamSize: "6-10" }, start.cookie);
    expect(ok.status).toBe(200);

    const { rows: [lead] } = await pool.query(`SELECT * FROM signup_leads WHERE email = $1`, [testEmail]);
    expect(lead).toMatchObject({ first_name: "Pat", last_name: "Smith", phone: "+15552345678", trade: "hvac", team_size: "6-10", source: "prefill", converted_user_id: null });
  });
});
