/**
 * Re-filing HOVER captures piled on a rep's record (server/crm/hover-refile.ts) and the company-email staff rule
 * (server/crm/hover.ts isCompanyEmail). Lane Postgres; fresh org, removed afterwards.
 */
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";

let orgId = "", userId = 0;
const C: Record<string, string> = {};

async function customer(name: string, addr: string | null, zip = "98225", email: string | null = null) {
  const id = randomUUID();
  await pool.query(`INSERT INTO crm_customers(id,org_id,display_name,portal_token,address_line1,city,state,postal_code,email)
    VALUES($1,$2,$3,gen_random_uuid(),$4,'Bellingham','WA',$5,$6)`, [id, orgId, name, addr, zip, email]);
  return id;
}
async function capture(customerId: string, jobId: string, addr: string, zip = "98225", photos = 2) {
  const id = randomUUID();
  await pool.query(`INSERT INTO crm_measurements(id,org_id,customer_id,provider,status,external_id,address_line1,city,state,postal_code,raw_payload)
    VALUES($1,$2,$3,'hover','ready',$4,$5,'Bellingham','WA',$6,$7)`,
    [id, orgId, customerId, jobId, addr, zip, JSON.stringify({ hoverJobId: jobId, hoverJobName: null, matchedVia: "email" })]);
  for (let i = 0; i < photos; i++) {
    await pool.query(`INSERT INTO crm_attachments(id,org_id,kind,ref_id,file_name,mime,size_bytes,storage_path)
      VALUES(gen_random_uuid(),$1,'photo',$2,$3,'image/jpeg',1,'x')`, [orgId, customerId, `hover-${jobId}-${i}.jpg`]);
  }
  return id;
}

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname) || !["localhost", "127.0.0.1"].includes(target.hostname)) throw Error("Local development DB required");
  await (await import("./schema-ensure")).ensureCrmSchema();
  userId = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`refile-${randomUUID()}@example.invalid`])).rows[0].id;
  orgId = randomUUID();
  await pool.query("INSERT INTO crm_orgs(id,name,owner_user_id) VALUES($1,'refile',$2)", [orgId, userId]);
  C.rep = await customer("Rep Collector", "1 Rep Way", "98225", "rep@acmesiding.com");
  C.real = await customer("Real Homeowner", "200 Elm Street", "98226");
  C.dupA = await customer("Dup A", "300 Oak Ave", "98227");
  C.dupB = await customer("Dup B", "300 Oak Ave", "98227");
  await capture(C.rep, "100", "1 Rep Way", "98225");      // the rep's own house: stays
  await capture(C.rep, "101", "200 Elm Street", "98226"); // → the existing homeowner
  await capture(C.rep, "102", "300 Oak Ave", "98227");    // two clients there → new, flagged ambiguous
  await capture(C.rep, "103", "400 Pine Road", "98228");  // nobody → new client
  await capture(C.rep, "104", "400 Pine Road", "98228");  // second capture at the same house → joins that new client
  C.small = await customer("Two Houses", "5 A St", "98229");
  await capture(C.small, "200", "5 A St", "98229");
  await capture(C.small, "201", "6 B St", "98230");       // only 2 properties: not a collector
}, 60_000);

afterAll(async () => {
  for (const t of ["crm_leads", "crm_attachments", "crm_measurements", "crm_customers"]) await pool.query(`DELETE FROM ${t} WHERE org_id=$1`, [orgId]);
  await pool.query("DELETE FROM crm_orgs WHERE id=$1", [orgId]);
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
});

describe("company email (staff) rule", () => {
  it("matches the company's own domains, any TLD, and a free-mail box named after it", async () => {
    const { isCompanyEmail } = await import("./hover");
    const people = ["andrey@alpinesidingpros.com", "owner@gmail.com", null];
    expect(isCompanyEmail("mike@alpinesidingpros.com", people)).toBe(true);
    expect(isCompanyEmail("george@alpinesidingpros.net", people)).toBe(true);
    expect(isCompanyEmail("alpinesidingpros@outlook.com", people)).toBe(true);
    expect(isCompanyEmail("homeowner@gmail.com", people)).toBe(false);
    expect(isCompanyEmail("jane@otherbuilder.com", people)).toBe(false);
    // Free-mail people never make gmail.com "the company".
    expect(isCompanyEmail("someone@gmail.com", ["owner@gmail.com"])).toBe(false);
  });
});

describe("address key", () => {
  it("collapses suffixes, directions and a city tail so the same house always matches", async () => {
    const { normalizeHoverAddress: n } = await import("./hover-share");
    expect(n("1110 Warren Street", "98225")).toBe("1110 warren st|98225");
    expect(n("1110 WARREN St.", "98225-1234")).toBe("1110 warren st|98225");
    expect(n("1110 Warren Street, Bellingham, WA", "98225")).toBe("1110 warren st|98225");
    expect(n("23120 Southeast Black Nugget Road, Issaquah, WA", "98029")).toBe(n("23120 SE Black Nugget Rd", "98029"));
    expect(n("1226 62nd Street North", "33710")).toBe("1226 62nd st n|33710");
    expect(n("1110 Warren Street", "98226")).not.toBe(n("1110 Warren Street", "98225"));
  });
});

describe("lead form at the capture address", () => {
  it("hands a new HOVER client the homeowner's own name and contact from their form", async () => {
    const { leadFormAtAddress } = await import("./hover");
    await pool.query(`INSERT INTO crm_leads(org_id,source,name,email,phone,address_line1,city,state,postal_code,received_at)
      VALUES($1,'import','Derek Derouen','derek@example.invalid','(360) 555-0101','1110 Warren St','Bellingham','WA','98225',now()),
            ($1,'import','Old Owner','old@example.invalid',null,'1110 Warren Street','Bellingham','WA','98225',now() - interval '1 year')`, [orgId]);
    expect(await leadFormAtAddress(orgId, "1110 Warren Street", "98225")).toEqual({ name: "Derek Derouen", email: "derek@example.invalid", phone: "(360) 555-0101" });
    expect(await leadFormAtAddress(orgId, "1110 Warren Street", "98226")).toBeNull();
    expect(await leadFormAtAddress(orgId, "9 Nowhere Lane", "98225")).toBeNull();
  });
});

describe("re-filing a collector's captures", () => {
  it("dry run reports the moves and writes nothing", async () => {
    const { refileHoverCollectors } = await import("./hover-refile");
    const r = await refileHoverCollectors(orgId, { dryRun: true });
    expect(r.collectors.map((c) => c.name)).toEqual(["Rep Collector"]);
    expect(r.moves).toHaveLength(4);
    const still = await pool.query("SELECT count(*)::int n FROM crm_measurements WHERE customer_id=$1", [C.rep]);
    expect(still.rows[0].n).toBe(5);
  });

  it("moves each capture and its photos to the right client, and undo puts them back", async () => {
    const { refileHoverCollectors, undoRefile } = await import("./hover-refile");
    const { moves } = await refileHoverCollectors(orgId);
    expect(moves).toHaveLength(4);
    const by = (job: string) => moves.find((m) => m.hoverJobId === job)!;
    expect(by("101")).toMatchObject({ toCustomerId: C.real, created: false, photos: 2 });
    expect(by("102")).toMatchObject({ created: true, ambiguous: true });
    expect(by("103").created).toBe(true);
    expect(by("104")).toMatchObject({ toCustomerId: by("103").toCustomerId, created: false });
    const repLeft = await pool.query("SELECT external_id FROM crm_measurements WHERE customer_id=$1", [C.rep]);
    expect(repLeft.rows.map((r) => r.external_id)).toEqual(["100"]);
    const repPhotos = await pool.query("SELECT count(*)::int n FROM crm_attachments WHERE ref_id=$1", [C.rep]);
    expect(repPhotos.rows[0].n).toBe(2);
    const created = await pool.query("SELECT email, phone, custom_fields FROM crm_customers WHERE id=$1", [by("103").toCustomerId]);
    expect(created.rows[0]).toMatchObject({ email: null, phone: null });
    expect(created.rows[0].custom_fields).toMatchObject({ hoverNeedsContact: true, hoverRefiledFrom: C.rep });
    // A second run finds nothing more to do.
    expect((await refileHoverCollectors(orgId)).moves).toHaveLength(0);

    await undoRefile(orgId, moves);
    const back = await pool.query("SELECT count(*)::int n FROM crm_measurements WHERE customer_id=$1", [C.rep]);
    expect(back.rows[0].n).toBe(5);
    const photosBack = await pool.query("SELECT count(*)::int n FROM crm_attachments WHERE ref_id=$1", [C.rep]);
    expect(photosBack.rows[0].n).toBe(10);
  });
});
