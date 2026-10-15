/**
 * The citation audit: one job per campaign that runs the finder (finder.ts) over every directory on the checklist,
 * writes what it found on each row (audit_* columns), moves the row's mark where the evidence is solid, and keeps a
 * progress row (citation_audits) the tab polls. Also the checklist build, the recount, and the spreadsheet
 * import / export (owner 2026-10-15: "have a way to submit links via excel page").
 *
 * Marks: a confirmed match or mismatch always sets the row (it is read from the listing itself); "not found" sets
 * "Not listed" unless the owner marked the row by hand; "unconfirmed" and "unsupported" never change a mark.
 */
import { and, asc, eq } from "drizzle-orm";
import { db, pool } from "../db";
import { businessLocations, citationCampaigns, citations } from "@shared/schema";
import { CITATION_DIRECTORIES, LEGACY_CITATION_NAMES, citationRank, directoryByName, directoryOfUrl, onDirectory, type CitationDirectory } from "./directories";
import { checkDirectory, defaultDeps, type BusinessProfile, type FinderDeps, type Found } from "./finder";

export const AUDIT_RESULTS = ["match", "mismatch", "not_found", "unconfirmed", "unsupported"] as const;

export async function ensureCitationsSchema(): Promise<void> {
  await pool.query(`
    ALTER TABLE citations ADD COLUMN IF NOT EXISTS check_source text;
    ALTER TABLE citations ADD COLUMN IF NOT EXISTS audit_result text;
    ALTER TABLE citations ADD COLUMN IF NOT EXISTS audit_reason text;
    ALTER TABLE citations ADD COLUMN IF NOT EXISTS audit_evidence jsonb;
    ALTER TABLE citations ADD COLUMN IF NOT EXISTS audit_checked_at timestamptz;
    ALTER TABLE citations ADD COLUMN IF NOT EXISTS note text;
    CREATE TABLE IF NOT EXISTS citation_audits (
      id serial PRIMARY KEY,
      campaign_id integer NOT NULL,
      user_id integer NOT NULL,
      status text NOT NULL DEFAULT 'queued',      -- queued | running | done | failed
      total integer NOT NULL DEFAULT 0,
      done integer NOT NULL DEFAULT 0,
      current_site text,
      summary jsonb NOT NULL DEFAULT '{}',
      error text,
      started_at timestamptz,
      finished_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS citation_audits_campaign_idx ON citation_audits (campaign_id, id DESC);
  `);
}

/** The campaign's count tiles. */
export async function recountCitations(campaignId: number): Promise<void> {
  const rows = await db.select().from(citations).where(eq(citations.campaignId, campaignId));
  await db.update(citationCampaigns).set({
    citationsFound: rows.filter((r) => r.isFound === true).length,
    opportunitiesFound: rows.filter((r) => r.isFound === false).length,
    lastRunAt: new Date(),
  }).where(eq(citationCampaigns.id, campaignId));
}

/**
 * The checklist rows for a campaign, one per directory, Google first. The Google row is filled from the linked
 * Business Profile; every other row starts unchecked (no guessing).
 */
export async function ensureChecklist(campaignId: number, userId: number): Promise<number> {
  const [campaign] = await db.select().from(citationCampaigns).where(and(eq(citationCampaigns.id, campaignId), eq(citationCampaigns.userId, userId)));
  if (!campaign) throw Object.assign(new Error("Campaign not found"), { status: 404 });
  const existing = await db.select().from(citations).where(eq(citations.campaignId, campaignId));
  const have = new Set(existing.map((c) => LEGACY_CITATION_NAMES[c.siteName] ?? c.siteName));
  const [loc] = campaign.locationId ? await db.select().from(businessLocations).where(and(eq(businessLocations.id, campaign.locationId), eq(businessLocations.userId, userId))) : [];
  let added = 0;
  for (const dir of CITATION_DIRECTORIES) {
    if (have.has(dir.name)) continue;
    const isGoogle = dir.url === "google.com";
    const linked = isGoogle && !!loc?.gbpLocationName;
    await db.insert(citations).values({
      campaignId, siteName: dir.name, siteUrl: `https://${dir.url}`,
      listingUrl: linked ? loc!.googleCid || null : null,
      isFound: linked ? true : null, napConsistent: null,
      category: dir.category, domainAuthority: null, lastChecked: linked ? new Date() : null,
      ...(linked ? { checkSource: "audit", auditResult: "match", auditReason: "Linked to your Google Business Profile.", auditCheckedAt: new Date() } : {}),
    } as any);
    added++;
  }
  await recountCitations(campaignId);
  return added;
}

export type AuditRow = { id: number; campaignId: number; userId: number; status: string; total: number; done: number; currentSite: string | null; summary: Record<string, number>; error: string | null; startedAt: string | null; finishedAt: string | null; createdAt: string };

const rowOf = (r: any): AuditRow => ({ id: r.id, campaignId: r.campaign_id, userId: r.user_id, status: r.status, total: r.total, done: r.done, currentSite: r.current_site, summary: r.summary ?? {}, error: r.error, startedAt: r.started_at, finishedAt: r.finished_at, createdAt: r.created_at });

export async function latestAudit(campaignId: number): Promise<AuditRow | null> {
  const { rows } = await pool.query(`SELECT * FROM citation_audits WHERE campaign_id = $1 ORDER BY id DESC LIMIT 1`, [campaignId]);
  return rows[0] ? rowOf(rows[0]) : null;
}

/** The business as Google has it, for the comparison. null when there is too little to search with. */
export async function profileFor(campaign: typeof citationCampaigns.$inferSelect, userId: number): Promise<BusinessProfile | null> {
  const [loc] = campaign.locationId ? await db.select().from(businessLocations).where(and(eq(businessLocations.id, campaign.locationId), eq(businessLocations.userId, userId))) : [];
  const name = (loc?.businessName || campaign.businessName || "").trim();
  const phone = (loc?.phone || campaign.phone || "").trim() || null;
  // Legacy rows hold Google's full "street, city, ST zip" string in address.
  const addr = (loc?.address || campaign.address || "").trim();
  let street = addr, city = (loc?.city || "").trim(), state = (loc?.state || "").trim(), zip = (loc?.zipCode || "").trim();
  if (!city && addr.includes(",")) {
    const parts = addr.split(",").map((s) => s.trim());
    street = parts[0] ?? "";
    city = parts[1] ?? "";
    const m = /^([A-Z]{2})\s*(\d{5})?/.exec(parts[2] ?? "");
    if (m) { state = m[1]; zip = zip || m[2] || ""; }
  }
  if (!name || (!phone && !city && !zip)) return null;
  return { name, phone, street_address: street || null, city, state, postal_code: zip || null, service_area_only: street ? null : true, zip };
}

const running = new Set<number>();

/** Start an audit for the campaign (one at a time per campaign). Returns the progress row to poll. */
export async function startAudit(campaignId: number, userId: number, deps: FinderDeps = defaultDeps): Promise<{ audit: AuditRow; started: boolean }> {
  const current = await latestAudit(campaignId);
  if (current && (current.status === "queued" || current.status === "running") && Date.now() - new Date(current.createdAt).getTime() < 30 * 60_000) {
    return { audit: current, started: false };
  }
  await ensureChecklist(campaignId, userId);
  const rows = await db.select().from(citations).where(eq(citations.campaignId, campaignId));
  const { rows: [ins] } = await pool.query(`INSERT INTO citation_audits (campaign_id, user_id, status, total) VALUES ($1, $2, 'queued', $3) RETURNING *`, [campaignId, userId, rows.length]);
  const audit = rowOf(ins);
  setImmediate(() => { runAudit(audit.id, deps).catch((e) => console.error("[citations] audit crashed:", e?.message || e)); });
  return { audit, started: true };
}

export async function runAudit(auditId: number, deps: FinderDeps = defaultDeps): Promise<void> {
  const { rows: [a] } = await pool.query(`SELECT * FROM citation_audits WHERE id = $1`, [auditId]);
  if (!a || running.has(a.campaign_id)) return;
  running.add(a.campaign_id);
  const summary: Record<string, number> = { match: 0, mismatch: 0, not_found: 0, unconfirmed: 0, unsupported: 0 };
  try {
    await pool.query(`UPDATE citation_audits SET status = 'running', started_at = now() WHERE id = $1`, [auditId]);
    const [campaign] = await db.select().from(citationCampaigns).where(eq(citationCampaigns.id, a.campaign_id));
    if (!campaign) throw new Error("Campaign not found");
    const profile = await profileFor(campaign, a.user_id);
    if (!profile) throw new Error("Add the business phone and city to this location first; the audit needs them to tell your business from others with the same name.");
    const rows = (await db.select().from(citations).where(eq(citations.campaignId, a.campaign_id)))
      .map((c) => ({ c, rank: citationRank.get(LEGACY_CITATION_NAMES[c.siteName] ?? c.siteName) ?? 999 })).sort((x, y) => x.rank - y.rank).map((x) => x.c);
    await pool.query(`UPDATE citation_audits SET total = $2 WHERE id = $1`, [auditId, rows.length]);
    let done = 0;
    for (const row of rows) {
      const dir = directoryByName(row.siteName);
      await pool.query(`UPDATE citation_audits SET current_site = $2 WHERE id = $1`, [auditId, row.siteName]);
      let found: Found;
      if (!dir) found = { result: "unsupported", listingUrl: row.listingUrl, reason: "This site is no longer on the checklist.", how: "none", fields: null, partial: false, evidence: { checked: [], candidates: [], searchUrl: null, title: null } };
      else if (dir.url === "google.com") {
        // Google: the linked profile is the truth, nothing to crawl.
        found = row.isFound ? { result: "match", listingUrl: row.listingUrl, reason: "Linked to your Google Business Profile.", how: "none", fields: null, partial: false, evidence: { checked: [], candidates: [], searchUrl: null, title: null } }
          : { result: "unsupported", listingUrl: null, reason: "Link this location to your Google Business Profile and this row fills itself in.", how: "none", fields: null, partial: false, evidence: { checked: [], candidates: [], searchUrl: null, title: null } };
      } else {
        try { found = await checkDirectory(dir, profile, row.listingUrl, deps); }
        catch (e: any) { found = { result: "unconfirmed", listingUrl: null, reason: `The check failed: ${String(e?.message || e).slice(0, 160)}`, how: "none", fields: null, partial: false, evidence: { checked: [], candidates: [], searchUrl: null, title: null } }; }
      }
      await applyFinding(row, found);
      summary[found.result] = (summary[found.result] ?? 0) + 1;
      done++;
      await pool.query(`UPDATE citation_audits SET done = $2, summary = $3 WHERE id = $1`, [auditId, done, JSON.stringify(summary)]);
    }
    await recountCitations(a.campaign_id);
    await pool.query(`UPDATE citation_audits SET status = 'done', finished_at = now(), current_site = NULL, summary = $2 WHERE id = $1`, [auditId, JSON.stringify(summary)]);
  } catch (e: any) {
    await pool.query(`UPDATE citation_audits SET status = 'failed', finished_at = now(), error = $2, current_site = NULL WHERE id = $1`, [auditId, String(e?.message || e).slice(0, 500)]).catch(() => undefined);
  } finally {
    running.delete(a.campaign_id);
  }
}

/** Write one finding onto its checklist row (exported for tests). */
export async function applyFinding(row: typeof citations.$inferSelect, found: Found): Promise<void> {
  const evidence = { how: found.how, partial: found.partial, fields: found.fields, checked: found.evidence.checked, candidates: found.evidence.candidates, searchUrl: found.evidence.searchUrl, title: found.evidence.title, loads: found.evidence.loads ?? [] };
  const set: Record<string, unknown> = { auditResult: found.result, auditReason: found.reason, auditEvidence: evidence, auditCheckedAt: new Date() };
  if (found.result === "match" || found.result === "mismatch") {
    set.isFound = true;
    set.napConsistent = found.result === "match" ? (found.partial ? null : true) : false;
    set.lastChecked = new Date();
    set.checkSource = "audit";
    if (found.listingUrl) set.listingUrl = found.listingUrl;
  } else if (found.result === "not_found" && (row as any).checkSource !== "manual") {
    set.isFound = false;
    set.napConsistent = null;
    set.lastChecked = new Date();
    set.checkSource = "audit";
  }
  await db.update(citations).set(set as any).where(eq(citations.id, row.id));
}

// ── spreadsheets ─────────────────────────────────────────────────────────────────────────────────────────────────
/** RFC 4180-ish CSV → rows of cells (quotes, doubled quotes, CRLF, a BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const csvCell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export const STATUS_WORDS: Record<string, "listed" | "wrong" | "missing" | "unchecked"> = {
  listed: "listed", correct: "listed", live: "listed", found: "listed", yes: "listed", ok: "listed", "listed & correct": "listed", "listed and correct": "listed",
  wrong: "wrong", mismatch: "wrong", incorrect: "wrong", "listed wrong info": "wrong", "listed, wrong info": "wrong", "wrong info": "wrong", "wrong details": "wrong",
  missing: "missing", "not listed": "missing", none: "missing", no: "missing", absent: "missing",
  unchecked: "unchecked", "not checked": "unchecked", "": "unchecked",
};

export type ImportOutcome = { updated: number; skipped: { line: number; reason: string }[] };

/**
 * Apply a spreadsheet (CSV) of listings to a campaign. Columns are found by header name: Site / Directory,
 * Listing URL / URL / Link, Status, Note. A row names its site, or its link does.
 */
export async function importCsv(campaignId: number, csv: string): Promise<ImportOutcome> {
  const rows = parseCsv(csv);
  if (!rows.length) return { updated: 0, skipped: [{ line: 1, reason: "The file is empty." }] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  let iSite = col("site", "directory", "site name", "directory name", "name"), iUrl = col("listing url", "url", "link", "listing link", "listing"), iStatus = col("status", "what you found", "result"), iNote = col("note", "notes", "comment");
  let start = 1;
  if (iSite < 0 && iUrl < 0) {
    // No header: Site, Listing URL, Status, Note in that order.
    iSite = 0; iUrl = 1; iStatus = 2; iNote = 3; start = 0;
  }
  const existing = await db.select().from(citations).where(eq(citations.campaignId, campaignId));
  const byName = new Map(existing.map((c) => [(LEGACY_CITATION_NAMES[c.siteName] ?? c.siteName).toLowerCase(), c]));
  const out: ImportOutcome = { updated: 0, skipped: [] };
  for (let n = start; n < rows.length; n++) {
    const r = rows[n], line = n + 1;
    const siteText = iSite >= 0 ? (r[iSite] ?? "").trim() : "";
    const urlText = iUrl >= 0 ? (r[iUrl] ?? "").trim() : "";
    const statusText = iStatus >= 0 ? (r[iStatus] ?? "").trim().toLowerCase() : "";
    const note = iNote >= 0 ? (r[iNote] ?? "").trim() : "";
    let dir: CitationDirectory | undefined = siteText ? directoryByName(siteText) : undefined;
    let url: string | null = null;
    if (urlText) {
      try { const u = new URL(urlText.startsWith("http") ? urlText : `https://${urlText}`); if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(); u.protocol = "https:"; url = u.href; } catch { out.skipped.push({ line, reason: `“${urlText.slice(0, 60)}” is not a web link.` }); continue; }
      if (!dir) dir = directoryOfUrl(url);
      else if (!onDirectory(url, dir)) { out.skipped.push({ line, reason: `The link is not on ${dir.name}; row skipped.` }); continue; }
    }
    if (!dir) { out.skipped.push({ line, reason: siteText ? `“${siteText}” is not one of the checklist sites.` : "No site name and no link." }); continue; }
    const row = byName.get(dir.name.toLowerCase());
    if (!row) { out.skipped.push({ line, reason: `${dir.name} is not on this campaign's checklist yet. Build the checklist, then import again.` }); continue; }
    const status = statusText in STATUS_WORDS ? STATUS_WORDS[statusText] : url ? "listed" : null;
    if (status === null) { out.skipped.push({ line, reason: `Unknown status “${statusText.slice(0, 40)}”. Use Listed, Wrong, Missing or Not checked.` }); continue; }
    const map = { listed: [true, true], wrong: [true, false], missing: [false, null], unchecked: [null, null] } as const;
    const [isFound, napConsistent] = map[status];
    await db.update(citations).set({
      isFound, napConsistent, lastChecked: status === "unchecked" ? null : new Date(), checkSource: "import",
      ...(url ? { listingUrl: url } : status === "missing" ? { listingUrl: null } : {}),
      ...(note ? { note } : {}),
    } as any).where(eq(citations.id, row.id));
    out.updated++;
  }
  if (out.updated) await recountCitations(campaignId);
  return out;
}

export const statusOfRow = (c: { isFound: boolean | null; napConsistent: boolean | null }) =>
  c.isFound === true ? (c.napConsistent === false ? "Listed, wrong info" : "Listed & correct") : c.isFound === false ? "Not listed" : "Not checked";

export function exportCsv(campaign: typeof citationCampaigns.$inferSelect, rows: (typeof citations.$inferSelect)[]): string {
  const head = ["Site", "Category", "Status", "Listing URL", "Checked by", "Audit result", "Audit reason", "Name on site", "Phone on site", "Address on site", "Audit checked at", "Note"];
  const body = rows.map((c) => {
    const ev: any = (c as any).auditEvidence ?? {};
    const f = ev.fields ?? {};
    const addr = [f.street_address?.observed, f.city?.observed, f.state?.observed, f.postal_code?.observed].filter(Boolean).join(", ");
    return [LEGACY_CITATION_NAMES[c.siteName] ?? c.siteName, c.category ?? "", statusOfRow(c), c.listingUrl ?? "", (c as any).checkSource ?? "", (c as any).auditResult ?? "", (c as any).auditReason ?? "",
      f.name?.observed ?? "", f.phone?.observed ?? "", addr, (c as any).auditCheckedAt ? new Date((c as any).auditCheckedAt).toISOString() : "", (c as any).note ?? ""];
  });
  return toCsv([[`Citations — ${campaign.businessName}`, `Campaign: ${campaign.campaignName}`, `Exported ${new Date().toISOString().slice(0, 10)}`], head, ...body]);
}

export function templateCsv(): string {
  return toCsv([["Site", "Listing URL", "Status", "Note"], ...CITATION_DIRECTORIES.map((d) => [d.name, "", "", ""])]);
}
