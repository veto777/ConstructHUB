/**
 * Measurement report import — three behaviours pinned:
 *   1. The parser (pure): HOVER-style text yields the full contact block and
 *      roof measurements; a generic report falls back to the first
 *      email/phone/address-shaped strings; a partial parse warns instead of
 *      failing; extractPdfText pulls text out of a flate-compressed PDF
 *      content stream.
 *   2. Confirm dedupe (against the running dev server): confirming a report
 *      creates the customer; confirming a second report with the same email
 *      MATCHES that customer instead of duplicating it.
 *   3. The provider webhook: no key / bogus key → 401, a real org API key →
 *      measurement + customer created, and a replayed externalId is
 *      idempotent.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHash, randomBytes } from "crypto";
import { deflateSync } from "zlib";
import pg from "pg";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";
const ALPINE_ORG = "1e3050c1-3cfd-4d9b-ba5a-1c19ce074897";

let parseMeasurementReport: any, parseHasContent: any, extractPdfText: any;

beforeAll(async () => {
  ({ parseMeasurementReport, parseHasContent, extractPdfText } = await import("./reports"));
});

// ── Pure: the parser ────────────────────────────────────────────────────────

const HOVER_TEXT = `
HOVER Inc.
Measurements Report

Prepared for: Marcus Bell
Property Address:
1420 Palma Sola Blvd
Bradenton, FL 34209

Contact: marcus.bell@example.com
Phone: (941) 555-0148

Roof Measurements
Total Roof Area: 3,245.6 SF
Roof Facets: 14
Predominant Pitch: 6/12
Ridges: 62.5 ft
Hips: 88.2 ft
Valleys: 41.0 ft
Rakes: 112.4 ft
Eaves: 96.7 ft
Suggested Waste: 12%
`;

describe("parseMeasurementReport — HOVER layout", () => {
  it("detects the provider", () => {
    expect(parseMeasurementReport(HOVER_TEXT).provider).toBe("hover");
  });

  it("extracts the full contact block", () => {
    expect(parseMeasurementReport(HOVER_TEXT).contact).toEqual({
      name: "Marcus Bell",
      email: "marcus.bell@example.com",
      phone: "(941) 555-0148",
      addressLine1: "1420 Palma Sola Blvd",
      city: "Bradenton",
      state: "FL",
      postalCode: "34209",
    });
  });

  it("extracts the roof measurements, squares derived from area", () => {
    const p = parseMeasurementReport(HOVER_TEXT);
    expect(p.measurements.roofAreaSf).toBeCloseTo(3245.6);
    expect(p.measurements.squares).toBeCloseTo(32.46, 2);
    expect(p.measurements.pitch).toBe("6/12");
    expect(p.measurements.facetCount).toBe(14);
    expect(p.measurements.wastePercent).toBe(12);
    expect(p.measurements.ridgeLf).toBeCloseTo(62.5);
    expect(p.measurements.hipLf).toBeCloseTo(88.2);
    expect(p.measurements.valleyLf).toBeCloseTo(41);
    expect(p.measurements.eaveLf).toBeCloseTo(96.7);
    expect(p.measurements.rakeLf).toBeCloseTo(112.4);
    expect(p.warnings).toEqual([]);
  });
});

describe("parseMeasurementReport — generic fallback", () => {
  it("takes the first email/phone/address-shaped strings, provider other", () => {
    const p = parseMeasurementReport(
      "Site survey\nHomeowner: Priya Raman\nCall 813.555.0177 or email priya.r@example.net\n900 Bayshore Blvd\nTampa, FL 33606\nSquares: 18.2\nWaste: 10%\nPitch 4/12",
    );
    expect(p.provider).toBe("other");
    expect(p.contact.name).toBe("Priya Raman");
    expect(p.contact.email).toBe("priya.r@example.net");
    expect(p.contact.phone).toBe("813.555.0177");
    expect(p.contact.addressLine1).toBe("900 Bayshore Blvd");
    expect(p.contact.city).toBe("Tampa");
    expect(p.measurements.squares).toBeCloseTo(18.2);
    expect(p.measurements.wastePercent).toBe(10);
    expect(p.measurements.pitch).toBe("4/12");
  });

  it("a contact-only parse warns about measurements but still has content", () => {
    const p = parseMeasurementReport("Customer: Sam Ortega, sam@example.com, 941-555-0100");
    expect(parseHasContent(p)).toBe(true);
    expect(p.contact.email).toBe("sam@example.com");
    expect(p.warnings.some((w: string) => /measurements/i.test(w))).toBe(true);
  });

  it("gibberish has no content (the route turns this into a 422)", () => {
    const p = parseMeasurementReport("the quick brown fox jumps over the lazy dog");
    expect(parseHasContent(p)).toBe(false);
    expect(p.warnings.length).toBeGreaterThan(0);
  });
});

describe("extractPdfText — minimal no-dependency extraction", () => {
  it("reads text-showing operators out of a flate stream", () => {
    const content = "BT /F1 14 Tf 72 720 Td (Prepared for: Dana Reese) Tj [(Roo) -18 (f Area)] TJ ET";
    const fakePdf = Buffer.concat([
      Buffer.from("%PDF-1.4\n4 0 obj\n<< /Length 0 >>\nstream\n", "latin1"),
      deflateSync(Buffer.from(content, "latin1")),
      Buffer.from("\nendstream\nendobj\n%%EOF", "latin1"),
    ]);
    const text = extractPdfText(fakePdf);
    expect(text).toContain("Prepared for: Dana Reese");
    expect(text).toContain("Roof Area");
  });

  it("returns empty for a PDF with no extractable text (route → 422)", () => {
    expect(extractPdfText(Buffer.from("%PDF-1.4 binary junk with no streams"))).toBe("");
  });
});

// ── Server: dedupe on confirm, webhook key auth ─────────────────────────────

const api = async (path: string, opts: RequestInit = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

describe("report import (dev server)", () => {
  beforeAll(async () => {
    // The shared dev session may be parked on any org by other suites.
    const r = await fetch(`${BASE}/api/crm/org/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: ALPINE_ORG }),
    });
    expect(r.status).toBe(200);
  });

  it("confirm creates the customer once; a same-email report matches instead", async () => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `e2e-reports-${stamp}@example.com`;
    // Phone dedupe matches on digits — a constant phone would match a leftover
    // from any earlier run, so it is as unique per run as the email.
    const n = String(Math.floor(100000 + Math.random() * 900000));
    const phone = `(941) 5${n.slice(0, 2)}-${n.slice(2)}`;
    const reportText = (name: string) =>
      `Prepared for: ${name}\n123 Test Ln\nSarasota, FL 34236\n${email}\n${phone}\nTotal Roof Area: 2,000 SF\nWaste: 10%`;

    const up1 = await api("/api/crm/reports/upload", { method: "POST", body: JSON.stringify({ text: reportText("Casey One") }) });
    expect(up1.status).toBe(201);
    const conf1 = await api(`/api/crm/reports/${up1.body.id}/confirm`, { method: "POST", body: "{}" });
    expect(conf1.status).toBe(201);
    expect(conf1.body.created).toBe(true);
    expect(conf1.body.customer.email).toBe(email);

    // Same email in a second report → the same customer, not a duplicate.
    const up2 = await api("/api/crm/reports/upload", { method: "POST", body: JSON.stringify({ text: reportText("Casey Two") }) });
    const conf2 = await api(`/api/crm/reports/${up2.body.id}/confirm`, { method: "POST", body: "{}" });
    expect(conf2.status).toBe(200);
    expect(conf2.body.created).toBe(false);
    expect(conf2.body.customer.id).toBe(conf1.body.customer.id);

    // A draft cannot be confirmed twice.
    const again = await api(`/api/crm/reports/${up1.body.id}/confirm`, { method: "POST", body: "{}" });
    expect(again.status).toBe(409);
  });

  it("rejects an upload with nothing parseable", async () => {
    const r = await api("/api/crm/reports/upload", { method: "POST", body: JSON.stringify({ text: "nothing useful here at all" }) });
    expect(r.status).toBe(422);
  });
});

describe("measurements webhook — API key auth", () => {
  it("rejects missing and bogus keys, accepts a real one, replays idempotently", async () => {
    const payload = (externalId: string, email: string) =>
      JSON.stringify({
        externalId,
        customer: { name: "Webhook Wade", email, addressLine1: "5 Reef Rd", city: "Tampa", state: "FL", postalCode: "33602" },
        measurements: { squares: 20.5, pitch: "5/12", facetCount: 8, wastePercent: 10 },
      });
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `e2e-hook-${stamp}@example.com`;
    const ext = `hook-${stamp}`;

    const noKey = await api("/api/crm/integrations/measurements/webhook", { method: "POST", body: payload(ext, email) });
    expect(noKey.status).toBe(401);
    const badKey = await api("/api/crm/integrations/measurements/webhook", {
      method: "POST",
      headers: { Authorization: "Bearer chk_notrealnotrealnotreal" },
      body: payload(ext, email),
    });
    expect(badKey.status).toBe(401);

    // Mint a key exactly the way POST /api/crm/api-keys does (hash at rest).
    const plain = `chk_${randomBytes(24).toString("hex")}`;
    const pool = new pg.Pool({ connectionString: DATABASE_URL });
    try {
      await pool.query(
        `insert into crm_api_keys (org_id, name, key_hash, key_prefix, scopes) values ($1, $2, $3, $4, $5)`,
        [ALPINE_ORG, "reports test key", createHash("sha256").update(plain).digest("hex"), plain.slice(0, 12), ["read"]],
      );
    } finally {
      await pool.end();
    }

    const good = await api("/api/crm/integrations/measurements/webhook", {
      method: "POST",
      headers: { Authorization: `Bearer ${plain}` },
      body: payload(ext, email),
    });
    expect(good.status).toBe(201);
    expect(good.body.created).toBe(true);
    expect(good.body.customerId).toBeTruthy();

    const replay = await api("/api/crm/integrations/measurements/webhook", {
      method: "POST",
      headers: { Authorization: `Bearer ${plain}` },
      body: payload(ext, email),
    });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.measurementId).toBe(good.body.measurementId);
  });
});
