import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, db } from "../db";
import { citationCampaigns, citations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { applyFinding, ensureChecklist, ensureCitationsSchema, exportCsv, importCsv, latestAudit, parseCsv, profileFor, runAudit, startAudit, templateCsv, toCsv } from "./audit";
import { CITATION_DIRECTORIES } from "./directories";
import type { FinderDeps } from "./finder";
import type { Loaded } from "./fetch";

const OWNER = 1;

describe("citation audit", () => {
  let locationId = 0, campaignId = 0;
  beforeAll(async () => {
    // What boot does: the location table's newer columns (logo_url) and the audit's own columns.
    const { ensureGbpSchema } = await import("../gbp/schema");
    await ensureGbpSchema();
    await ensureCitationsSchema();
    // Raw SQL: the local template DB may predate columns the app adds at boot (business_locations.logo_url).
    const { rows: [loc] } = await pool.query(`insert into business_locations (user_id, business_name, address, city, state, zip_code, phone) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [OWNER, "Vitest Siding Co", "12 Test St", "Bellingham", "WA", "98225", "(360) 555-0101"]);
    locationId = loc.id;
    const [c] = await db.insert(citationCampaigns).values({ userId: OWNER, locationId, campaignName: "vitest audit", businessName: "Vitest Siding Co", address: "12 Test St", phone: "(360) 555-0101" } as any).returning();
    campaignId = c.id;
  });
  afterAll(async () => {
    await pool.query("delete from citation_audits where campaign_id=$1", [campaignId]);
    await db.delete(citations).where(eq(citations.campaignId, campaignId));
    await db.delete(citationCampaigns).where(eq(citationCampaigns.id, campaignId));
    await pool.query("delete from business_locations where id=$1", [locationId]);
    await pool.end();
  });

  it("builds the 30-row checklist once, Google unchecked without a link", async () => {
    expect(await ensureChecklist(campaignId, OWNER)).toBe(30);
    expect(await ensureChecklist(campaignId, OWNER)).toBe(0);
    const rows = await db.select().from(citations).where(eq(citations.campaignId, campaignId));
    expect(rows.length).toBe(30);
    expect(rows.every((r) => r.isFound === null)).toBe(true);
  });

  it("reads the business from the location", async () => {
    const [c] = await db.select().from(citationCampaigns).where(eq(citationCampaigns.id, campaignId));
    const p = await profileFor(c, OWNER);
    expect(p).toMatchObject({ name: "Vitest Siding Co", phone: "(360) 555-0101", city: "Bellingham", state: "WA", zip: "98225", street_address: "12 Test St" });
  });

  it("CSV: parses quotes and CRLF, round-trips, and the template lists every site", () => {
    expect(parseCsv('Site,Listing URL,Status,Note\r\n"Yelp","https://www.yelp.com/biz/x","Listed & correct","has, comma"\r\nBBB,,missing,\r\n')).toEqual([
      ["Site", "Listing URL", "Status", "Note"], ["Yelp", "https://www.yelp.com/biz/x", "Listed & correct", "has, comma"], ["BBB", "", "missing", ""],
    ]);
    expect(parseCsv(toCsv([["a", 'q"uote'], ["b,c", "line\nbreak"]]))).toEqual([["a", 'q"uote'], ["b,c", "line\nbreak"]]);
    const t = parseCsv(templateCsv());
    expect(t.length).toBe(31);
    expect(t.slice(1).map((r) => r[0])).toEqual(CITATION_DIRECTORIES.map((d) => d.name));
  });

  it("imports a spreadsheet: by site name, by link, with statuses; skips what it cannot place", async () => {
    const csv = [
      "Site,Listing URL,Status,Note",
      "Yelp,https://www.yelp.com/biz/vitest-siding-bellingham,Listed & correct,",
      ",https://www.bbb.org/us/wa/bellingham/profile/siding/vitest-1,wrong,phone is old",
      "Manta,,Not listed,",
      "Houzz,https://www.yelp.com/biz/other,,",
      "Some Random Site,,listed,",
      "Angi,,maybe,",
    ].join("\n");
    const out = await importCsv(campaignId, csv);
    expect(out.updated).toBe(3);
    expect(out.skipped.map((s) => s.line)).toEqual([5, 6, 7]);
    const rows = await db.select().from(citations).where(eq(citations.campaignId, campaignId));
    const by = (n: string) => rows.find((r) => r.siteName === n)!;
    expect(by("Yelp")).toMatchObject({ isFound: true, napConsistent: true, listingUrl: "https://www.yelp.com/biz/vitest-siding-bellingham", checkSource: "import" });
    expect(by("BBB")).toMatchObject({ isFound: true, napConsistent: false, note: "phone is old" });
    expect(by("Manta")).toMatchObject({ isFound: false, listingUrl: null });
    expect(by("Houzz").isFound).toBeNull();
  });

  it("a finding moves the mark only where the evidence is solid", async () => {
    const rows = await db.select().from(citations).where(eq(citations.campaignId, campaignId));
    const yp = rows.find((r) => r.siteName === "Yellow Pages")!, manta = rows.find((r) => r.siteName === "Manta")!, yelp = rows.find((r) => r.siteName === "Yelp")!;
    const ev = { checked: [], candidates: [], searchUrl: null, title: null };
    await applyFinding(yp, { result: "match", listingUrl: "https://www.yellowpages.com/bellingham-wa/mip/vitest-1", reason: "ok", how: "search_page", fields: null, partial: false, evidence: ev });
    // Manta was imported as "Not listed" (source import, not manual): the audit may say not found again.
    await applyFinding(manta, { result: "not_found", listingUrl: null, reason: "none", how: "search_page", fields: null, partial: false, evidence: ev });
    // A hand mark is never flipped to "not listed" by an automatic not-found.
    await db.update(citations).set({ checkSource: "manual" } as any).where(eq(citations.id, yelp.id));
    await applyFinding({ ...yelp, checkSource: "manual" } as any, { result: "not_found", listingUrl: null, reason: "none", how: "search_page", fields: null, partial: false, evidence: ev });
    // Unconfirmed never changes a mark.
    const bbb = rows.find((r) => r.siteName === "BBB")!;
    await applyFinding(bbb, { result: "unconfirmed", listingUrl: null, reason: "blocked", how: "none", fields: null, partial: false, evidence: ev });
    const after = await db.select().from(citations).where(eq(citations.campaignId, campaignId));
    const by = (n: string) => after.find((r) => r.siteName === n)! as any;
    expect(by("Yellow Pages")).toMatchObject({ isFound: true, napConsistent: true, checkSource: "audit", auditResult: "match", listingUrl: "https://www.yellowpages.com/bellingham-wa/mip/vitest-1" });
    expect(by("Manta")).toMatchObject({ isFound: false, auditResult: "not_found" });
    expect(by("Yelp")).toMatchObject({ isFound: true, checkSource: "manual", auditResult: "not_found" });
    expect(by("BBB")).toMatchObject({ isFound: true, napConsistent: false, auditResult: "unconfirmed" });
  });

  it("runs a whole audit with a fake web, writes progress and a summary, and exports it", async () => {
    const page = (url: string, body: string, status = 200): Loaded => ({ url, status, body, mode: "http", blocked: status >= 400 });
    const listing = `<html><head><title>Vitest Siding Co</title><script type="application/ld+json">${JSON.stringify({ "@type": "LocalBusiness", name: "Vitest Siding Co", telephone: "(360) 555-0101", address: { streetAddress: "12 Test St", addressLocality: "Bellingham", addressRegion: "WA", postalCode: "98225" } })}</script></head><body><h1>Vitest Siding Co</h1></body></html>`;
    const deps: FinderDeps = {
      budgetMs: 5_000,
      // Every search page is blocked; the web search knows MapQuest's listing and nothing else.
      load: async (url) => (url.includes("mapquest.com/us/") ? page(url, listing) : page(url, "", 403)),
      webSearch: async (_q, dir) => (dir.name === "MapQuest" ? ["https://www.mapquest.com/us/washington/vitest-siding-co-1"] : []),
    };
    const { audit, started } = await startAudit(campaignId, OWNER, deps);
    expect(started).toBe(true);
    // Run it in the foreground for the test (startAudit also scheduled it; the campaign lock makes the second run a no-op).
    await runAudit(audit.id, deps);
    let a = await latestAudit(campaignId);
    for (let i = 0; i < 100 && a && a.status !== "done" && a.status !== "failed"; i++) { await new Promise((r) => setTimeout(r, 100)); a = await latestAudit(campaignId); }
    expect(a?.status).toBe("done");
    expect(a?.done).toBe(30);
    expect(a?.summary.match).toBeGreaterThanOrEqual(1);
    expect((a?.summary.unsupported ?? 0)).toBeGreaterThanOrEqual(3);   // Google (unlinked), Facebook, Apple Maps
    expect((a?.summary.not_found ?? 0)).toBe(0);                       // blocked everywhere else: never "not listed"
    const rows = await db.select().from(citations).where(eq(citations.campaignId, campaignId));
    const mq = rows.find((r) => r.siteName === "MapQuest")! as any;
    expect(mq).toMatchObject({ isFound: true, napConsistent: true, auditResult: "match", listingUrl: "https://www.mapquest.com/us/washington/vitest-siding-co-1" });
    const [c] = await db.select().from(citationCampaigns).where(eq(citationCampaigns.id, campaignId));
    const csv = parseCsv(exportCsv(c, rows));
    expect(csv[1][0]).toBe("Site");
    const mqRow = csv.find((r) => r[0] === "MapQuest")!;
    expect(mqRow[2]).toBe("Listed & correct");
    expect(mqRow[7]).toBe("Vitest Siding Co");
    expect(mqRow[8]).toBe("(360) 555-0101");
  });
});
