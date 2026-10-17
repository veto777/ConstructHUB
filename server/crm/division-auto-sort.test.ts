/**
 * Auto-sort by address (owner, 2026-10-17): unassigned clients — and their estimates — go to the division
 * that covers their ADDRESS, read from the client record, then website lead forms matched by email/phone.
 * Clients with no address anywhere stay unassigned; a division someone picked is never overwritten.
 * Runs against the dev database (no server needed): a throwaway org, cleaned up afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import pg from "pg";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
const DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL
  ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";
process.env.DATABASE_URL ??= DATABASE_URL;

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const q = (sql: string, args: unknown[] = []) => pool.query(sql, args).then((r) => r.rows);

let ws: typeof import("./division-workspaces");
let addr: typeof import("./customer-address-state");
const orgId = randomUUID();
const fl = randomUUID();
const wa = randomUUID();
const ids = { stated: randomUUID(), fromForm: randomUUID(), fromText: randomUUID(), nowhere: randomUUID(), picked: randomUUID(),
  twoJobs: randomUUID(), shareA: randomUUID(), shareB: randomUUID(), linked: randomUUID() };
const projFl = randomUUID();
const projWa = randomUUID();
const estimateId = randomUUID();

beforeAll(async () => {
  ws = await import("./division-workspaces");
  addr = await import("./customer-address-state");
  await q(`insert into crm_orgs (id, name, owner_user_id) values ($1, 'vitest auto-sort', 0)`, [orgId]);
  await q(`insert into crm_divisions (id, org_id, name, code, state) values ($1,$3,'Alpine FL','FL','fl'), ($2,$3,'Alpine WA','WA','WA')`, [fl, wa, orgId]);
  const cust = (id: string, name: string, extra: Record<string, string | null>) =>
    q(`insert into crm_customers (id, org_id, display_name, portal_token, email, phone, state, address_line1, division_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, orgId, name, randomUUID(), extra.email ?? null, extra.phone ?? null, extra.state ?? null, extra.addressLine1 ?? null, extra.divisionId ?? null]);
  await cust(ids.stated, "Has state", { state: "WA" });
  await cust(ids.fromForm, "Form only", { email: "form.only@example.com", phone: "(360) 555-0101" });
  await cust(ids.fromText, "Text only", { addressLine1: "2137 Example Trail Holiday FL 34690" });
  await cust(ids.nowhere, "No address", {});
  await cust(ids.picked, "Picked FL", { state: "WA", divisionId: fl });
  // A website form submission matched by PHONE (different formatting) carrying a full address.
  await q(`insert into crm_leads (id, org_id, source, name, phone, address_line1, fields)
           values ($1,$2,'website_form','Form only','+1 360-555-0101','5590 Example Rd. Bellingham, WA 98226', '{}'::jsonb)`,
    [randomUUID(), orgId]);
  await q(`insert into crm_estimates (id, org_id, customer_id, public_token, number) values ($1,$2,$3,$4,'E-T1')`,
    [estimateId, orgId, ids.fromForm, randomUUID()]);
  // A client with no address of their own and one job in each state.
  await cust(ids.twoJobs, "Two jobs", {});
  await q(`insert into crm_projects (id, org_id, customer_id, name, state) values ($1,$3,$4,'FL job','FL'), ($2,$3,$4,'WA job','WA')`,
    [projFl, projWa, orgId, ids.twoJobs]);
  // Two clients sharing one office phone; an UNLINKED form on that phone says Florida → evidence for neither.
  await cust(ids.shareA, "Share A", { phone: "813-555-0199" });
  await cust(ids.shareB, "Share B", { phone: "(813) 555 0199" });
  await q(`insert into crm_leads (id, org_id, source, phone, address_line1, fields) values ($1,$2,'website_form','8135550199','1 Bay St, Tampa, FL 33602','{}'::jsonb)`,
    [randomUUID(), orgId]);
  // A form LINKED to a client wins over a contact match that points elsewhere.
  await cust(ids.linked, "Linked", { email: "linked@example.com" });
  await q(`insert into crm_leads (id, org_id, source, email, address_line1, customer_id, fields) values
    ($1,$3,'website_form','linked@example.com','5590 Example Rd, Bellingham, WA 98226',$4,'{}'::jsonb),
    ($2,$3,'website_form','linked@example.com','1 Bay St, Tampa, FL 33602',null,'{}'::jsonb)`,
    [randomUUID(), randomUUID(), orgId, ids.linked]);
});

afterAll(async () => {
  await q(`delete from crm_estimates where org_id = $1`, [orgId]);
  await q(`delete from crm_leads where org_id = $1`, [orgId]);
  await q(`delete from crm_projects where org_id = $1`, [orgId]);
  await q(`delete from crm_customers where org_id = $1`, [orgId]);
  await q(`delete from crm_divisions where org_id = $1`, [orgId]);
  await q(`delete from crm_orgs where id = $1`, [orgId]);
  await pool.end();
});

describe("auto-sort by address", () => {
  it("reads lead-form addresses, including address-like form answers", () => {
    expect(addr.leadFormState({ fields: { "Project address": "12 Bay St, Largo, FL 33770" } })).toBe("FL");
    expect(addr.leadFormState({ fields: { Zip: "98226" } })).toBe("WA");
    expect(addr.leadFormState({ fields: { Message: "I live in Bellingham WA" } })).toBeNull(); // not an address field
  });

  it("places clients and their estimates by address; leaves the rest", async () => {
    const out = await ws.applyUnassignedSuggestions(orgId);
    const div = async (id: string) => (await q(`select division_id from crm_customers where id = $1`, [id]))[0].division_id;
    expect(await div(ids.stated)).toBe(wa);
    expect(await div(ids.fromForm)).toBe(wa);     // only the website form had the address
    expect(await div(ids.fromText)).toBe(fl);     // "… Holiday FL 34690" in the address line
    expect(await div(ids.nowhere)).toBeNull();     // no address anywhere → not guessed
    expect(await div(ids.picked)).toBe(fl);       // a pick is never overwritten
    expect((await q(`select division_id from crm_estimates where id = $1`, [estimateId]))[0].division_id).toBe(wa);
    // Each job goes by its own address; the client itself has no single state.
    const pdiv = async (id: string) => (await q(`select division_id from crm_projects where id = $1`, [id]))[0].division_id;
    expect(await pdiv(projFl)).toBe(fl);
    expect(await pdiv(projWa)).toBe(wa);
    expect(await div(ids.twoJobs)).toBeNull();
    // A shared phone is not evidence; a linked form beats a contact-only one.
    expect(await div(ids.shareA)).toBeNull();
    expect(await div(ids.shareB)).toBeNull();
    expect(await div(ids.linked)).toBe(wa);
    expect(out.counts.customers).toBe(4);
    // Idempotent: a second run moves nothing.
    const again = await ws.applyUnassignedSuggestions(orgId);
    expect(again.counts).toEqual({ customers: 0, projects: 0, estimates: 0 });
  });

  it("a new client's division comes from its address", async () => {
    expect(await addr.divisionIdForAddress(orgId, { addressLine1: "1 Elm St", city: "Bellingham", state: "Washington" })).toBe(wa);
    expect(await addr.divisionIdForAddress(orgId, { postalCode: "33770" })).toBe(fl);
    expect(await addr.divisionIdForAddress(orgId, { postalCode: "46037" })).toBeNull(); // Indiana: no division
    expect(await addr.divisionIdForAddress(orgId, {})).toBeNull();
  });
});
