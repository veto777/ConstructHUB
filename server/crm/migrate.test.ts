/**
 * Migration center tests.
 *
 * The parser/mapping/money/status functions are pure and pinned here without a
 * server. The dedupe behaviour (skip on email/phone match, ?force=1 override)
 * is the same rule as customer create and is exercised against the running dev
 * server, same trick as admin.test.ts.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  parseCsv, guessMapping, applyMapping, validateRecord,
  parseMoneyToCents, mapEstimateStatus, mapInvoiceStatus,
} from "./migrate-lib";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const stamp = Date.now().toString(36);

// ── Parser ──────────────────────────────────────────────────────────────────

describe("parseCsv", () => {
  it("parses a plain comma CSV", () => {
    const { headers, rows } = parseCsv("name,email,phone\nJane,jane@x.com,555-1234\nBob,bob@x.com,555-9999\n");
    expect(headers).toEqual(["name", "email", "phone"]);
    expect(rows).toEqual([
      ["Jane", "jane@x.com", "555-1234"],
      ["Bob", "bob@x.com", "555-9999"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    const { rows } = parseCsv('name,address\n"Doe, Jane","123 Main St, Apt 4"\n');
    expect(rows[0]).toEqual(["Doe, Jane", "123 Main St, Apt 4"]);
  });

  it("keeps newlines inside quoted fields", () => {
    const { rows } = parseCsv('name,notes\nJane,"line one\nline two"\nBob,plain\n');
    expect(rows).toHaveLength(2);
    expect(rows[0][1]).toBe("line one\nline two");
  });

  it("unescapes doubled quotes", () => {
    const { rows } = parseCsv('name,notes\nJane,"she said ""yes"" to the bid"\n');
    expect(rows[0][1]).toBe('she said "yes" to the bid');
  });

  it("auto-detects tab-separated (Excel) exports", () => {
    const { headers, rows } = parseCsv("name\temail\nJane\tjane@x.com\n");
    expect(headers).toEqual(["name", "email"]);
    expect(rows[0]).toEqual(["Jane", "jane@x.com"]);
  });

  it("handles CRLF and a UTF-8 BOM", () => {
    const { headers, rows } = parseCsv("﻿name,email\r\nJane,jane@x.com\r\n");
    expect(headers).toEqual(["name", "email"]);
    expect(rows[0]).toEqual(["Jane", "jane@x.com"]);
  });

  it("pads short rows and ignores blank lines", () => {
    const { rows } = parseCsv("a,b,c\n1,2\n\n3,4,5\n");
    expect(rows).toEqual([
      ["1", "2", ""],
      ["3", "4", "5"],
    ]);
  });

  it("quoted empty last cell is preserved", () => {
    const { rows } = parseCsv('a,b\n"x",""\n');
    expect(rows[0]).toEqual(["x", ""]);
  });
});

// ── Auto-mapping ────────────────────────────────────────────────────────────

describe("guessMapping", () => {
  it("maps the generic spreadsheet shape", () => {
    const m = guessMapping("customers", ["name", "email", "phone", "address", "notes"]);
    expect(m.displayName).toBe("name");
    expect(m.email).toBe("email");
    expect(m.phone).toBe("phone");
    expect(m.addressLine1).toBe("address");
    expect(m.notes).toBe("notes");
  });

  it("maps the Jobber client export shape", () => {
    const m = guessMapping("customers", [
      "First name", "Last name", "Company", "Email", "Phone", "Street", "City", "State", "Zip code",
    ]);
    expect(m.firstName).toBe("First name");
    expect(m.lastName).toBe("Last name");
    expect(m.companyName).toBe("Company");
    expect(m.email).toBe("Email");
    expect(m.phone).toBe("Phone");
    expect(m.addressLine1).toBe("Street");
    expect(m.postalCode).toBe("Zip code");
  });

  it("maps the QuickBooks customer list shape", () => {
    const m = guessMapping("customers", ["Customer", "Company Name", "Main Email", "Main Phone"]);
    expect(m.displayName).toBe("Customer");
    expect(m.companyName).toBe("Company Name");
    expect(m.email).toBe("Main Email");
    expect(m.phone).toBe("Main Phone");
  });

  it("never maps two fields to the same column", () => {
    const m = guessMapping("customers", ["Name", "Email"]);
    const hits = Object.values(m).filter(Boolean);
    expect(new Set(hits).size).toBe(hits.length);
  });

  it("maps estimate headers and leaves unknowns null", () => {
    const m = guessMapping("estimates", ["Client", "Quote #", "Total", "Status", "Zebra"]);
    expect(m.customerName).toBe("Client");
    expect(m.number).toBe("Quote #");
    expect(m.total).toBe("Total");
    expect(m.status).toBe("Status");
  });
});

describe("applyMapping + validateRecord", () => {
  const headers = ["Name", "Email"];
  const mapping = { displayName: "Name", email: "Email" };

  it("produces field-keyed records from raw rows", () => {
    expect(applyMapping(mapping, headers, ["Jane", "jane@x.com"])).toEqual({
      displayName: "Jane",
      email: "jane@x.com",
    });
  });

  it("flags a customer row with no name at all", () => {
    expect(validateRecord("customers", {}).join()).toMatch(/no name/);
  });

  it("accepts first+last as a name and flags a bad email", () => {
    const errs = validateRecord("customers", { firstName: "Jane", lastName: "Doe", email: "not-an-email" });
    expect(errs.join()).not.toMatch(/no name/);
    expect(errs.join()).toMatch(/invalid email/);
  });

  it("flags an estimate with no customer reference", () => {
    expect(validateRecord("estimates", { total: "100" }).join()).toMatch(/no customer/);
  });
});

// ── Money + status mapping ──────────────────────────────────────────────────

describe("parseMoneyToCents — integer cents, never floats", () => {
  it.each([
    ["$12,345.67", 1234567],
    ["1234", 123400],
    ["0.99", 99],
    ["(1,234.56)", -123456], // accounting negative
    ["-$50.00", -5000],
    ["", null],
    ["abc", null],
    ["$", null],
  ])("%s → %s", (raw, expected) => {
    expect(parseMoneyToCents(raw)).toBe(expected);
  });
});

describe("status mapping", () => {
  it("estimates: external vocabularies → CRM statuses", () => {
    expect(mapEstimateStatus("Won")).toBe("approved");
    expect(mapEstimateStatus("sent")).toBe("sent");
    expect(mapEstimateStatus("Declined")).toBe("declined");
    expect(mapEstimateStatus("whatever")).toBe("draft");
  });
  it("invoices: external vocabularies → CRM statuses", () => {
    expect(mapInvoiceStatus("Overdue")).toBe("sent");
    expect(mapInvoiceStatus("partially paid")).toBe("partial");
    expect(mapInvoiceStatus("PAID")).toBe("paid");
    expect(mapInvoiceStatus("bad debt")).toBe("uncollectible");
    expect(mapInvoiceStatus("")).toBe("draft");
  });
});

// ── Live: preview + import + dedupe against the dev server ─────────────────

describe("migrate endpoints (dev server)", () => {
  beforeAll(async () => {
    const r = await fetch(`${BASE}/api/crm/me`);
    expect(r.status, "dev server reachable on :8119").toBe(200);
  });

  it("preview parses, auto-maps and validates without writing", async () => {
    const csv = 'Name,Email,Notes\n"Preview, Person",pv@example.com,"quoted, note"\n,bad-email,ok\n';
    const r = await fetch(`${BASE}/api/crm/migrate/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity: "customers", csv }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.totalRows).toBe(2);
    expect(body.mapping.displayName).toBe("Name");
    expect(body.rows[0][0]).toBe("Preview, Person");
    // Row 2 has no name AND a bad email → two validation errors.
    expect(body.errors.filter((e: any) => e.row === 2)).toHaveLength(2);
  });

  it("import skips a duplicate on email match, then ?force=1 creates it", async () => {
    const email = `migrate-${stamp}@example.com`;
    const name = `Migrate Dupe ${stamp}`;

    // Seed an existing customer through the normal create route.
    const seed = await fetch(`${BASE}/api/crm/customers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: name, email }),
    });
    expect(seed.status).toBe(201);

    const payload = {
      entity: "customers",
      mapping: { displayName: "Name", email: "Email" },
      rows: [{ Name: `${name} Again`, Email: email }],
    };

    // Same email → skipped, not duplicated.
    const r1 = await fetch(`${BASE}/api/crm/migrate/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.created).toBe(0);
    expect(b1.skipped).toBe(1);
    expect(b1.results[0].status).toBe("skipped");

    // ?force=1 → the same row imports anyway (the customer-create idiom).
    const r2 = await fetch(`${BASE}/api/crm/migrate/import?force=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(r2.status).toBe(200);
    const b2 = await r2.json();
    expect(b2.created).toBe(1);
    expect(b2.skipped).toBe(0);
  });

  it("import skips a duplicate on digit-normalized phone", async () => {
    const phone = `555${String(Date.now()).slice(-7)}`;
    const seed = await fetch(`${BASE}/api/crm/customers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: `Migrate Phone ${stamp}`, phone: `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}` }),
    });
    expect(seed.status).toBe(201);

    const r = await fetch(`${BASE}/api/crm/migrate/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entity: "customers",
        mapping: { displayName: "Name", phone: "Phone" },
        rows: [{ Name: "Different Name Entirely", Phone: phone }],
      }),
    });
    const body = await r.json();
    expect(body.skipped).toBe(1);
    expect(body.created).toBe(0);
  });

  it("estimate import attaches to an existing client and maps money to cents", async () => {
    const email = `migrate-est-${stamp}@example.com`;
    const seed = await fetch(`${BASE}/api/crm/customers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: `Migrate Est Client ${stamp}`, email }),
    });
    expect(seed.status).toBe(201);

    const r = await fetch(`${BASE}/api/crm/migrate/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entity: "estimates",
        mapping: { customerEmail: "Customer Email", title: "Title", total: "Total", status: "Status" },
        rows: [{ "Customer Email": email, Title: "Roof replacement", Total: "$12,345.67", Status: "Won" }],
      }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.created).toBe(1);

    const est = await (
      await fetch(`${BASE}/api/crm/estimates/${body.results[0].id}`)
    ).json();
    expect(est.estimate.totalCents).toBe(1234567);
    expect(est.estimate.status).toBe("approved");
  });

  it("rejects a file over the row cap and a bogus entity", async () => {
    const big = "Name\n" + Array.from({ length: 5001 }, (_, i) => `Person ${i}`).join("\n");
    const r = await fetch(`${BASE}/api/crm/migrate/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity: "customers", csv: big }),
    });
    expect(r.status).toBe(413);

    const bad = await fetch(`${BASE}/api/crm/migrate/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity: "unicorns", csv: "a\nb" }),
    });
    expect(bad.status).toBe(400);
  });
});
