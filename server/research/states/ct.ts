/**
 * Connecticut. The DCP license and credential dataset (data.ct.gov ngch-56tr: home improvement, new home builders and
 * the trades) is already searched from ../licenses.ts. This pack adds, each checked live on 2026-10-15 (CLAUDE.md:
 * never fabricate government data; field names and status words are the publishers' own):
 *
 *   CT  Secretary of the State business registry (data.ct.gov n7gp-d28j, updated daily): status, sub-status and
 *       the published reason for an administrative dissolution, for companies.
 *   CT  DEEP formal enforcement case summaries, 2021 to today (data.ct.gov t2bf-45ba) and 1999 to 2021 (tvbr-6b6t):
 *       consent and unilateral orders with penalties and the order PDF.
 *   CT  Department of Labor debarment list (Wage and Workplace Standards, CGS 31-53a): the newest list on the DOL
 *       "Debarment Lists" page, a PDF read with pdftotext (poppler-utils). Firms only; the individuals the list
 *       names are not loaded (companies only, FCRA).
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import type { EnforcementHit } from "@shared/research-reports";
import { USER_AGENT, rateLimitHost } from "../../scrapers/polite-fetch";
import { clean, download, usDate, type BulkHit } from "../bulk";
import { decodeEntities } from "../bulk-sources";
import type { SodaEnforcement } from "../state-records";
import type { StatePack } from "./types";

const run = promisify(execFile);
type Row = Record<string, unknown>;
const s = (v: unknown): string | null => clean(v == null ? null : String(v));
const day = (v: unknown): string | null => s(v)?.slice(0, 10) ?? null;
const num = (v: unknown): number | null => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) ? null : n; };
const soda = (id: string) => ({ datasetUrl: `https://data.ct.gov/d/${id}`, url: `https://data.ct.gov/resource/${id}.json` });

// ── Secretary of the State business registry ─────────────────────────────────────────────────────────────────
const BUSINESS_REGISTRY: SodaEnforcement = {
  state: "CT", source: "Connecticut business registry (Secretary of the State)", scope: "Every business registered in Connecticut, updated daily",
  ...soda("n7gp-d28j"), nameFields: ["name"],
  toHit: (r: Row) => {
    const status = s(r.status), sub = s(r.sub_status);
    const address = clean([s(r.billingstreet), s(r.billing_unit), s(r.billingcity), s(r.billingstate), s(r.billingpostalcode)].filter(Boolean).join(", "));
    return {
      category: "business_status", name: s(r.name), id: s(r.accountnumber), date: day(r.date_registration), endDate: day(r.dissolution_date),
      status: status ? `${status}${sub ? ` (${sub})` : ""}` : null, city: s(r.billingcity),
      detail: [s(r.business_type), s(r.citizenship), s(r.reason_for_administrative) ? `Reason given: ${s(r.reason_for_administrative)}` : null].filter(Boolean).join(". ") || null,
      amount: null, adverse: status && /^(Revoked|Forfeited)$/i.test(status) ? true : null, address,
    };
  },
};

// ── DEEP formal enforcement ──────────────────────────────────────────────────────────────────────────────────
const DEEP_RECENT: SodaEnforcement = {
  state: "CT", source: "Connecticut DEEP enforcement orders (2021 to today)", scope: "Consent and unilateral orders, 2021 to today",
  ...soda("t2bf-45ba"), nameFields: ["respondent"], order: "date_issued DESC",
  toHit: (r: Row) => {
    const penalty = num(r.penalty_amount);
    const pdf = (r.path as { url?: string } | undefined)?.url ?? null;
    return {
      category: "environmental", name: s(r.respondent), id: s(r.order_number)?.replace(/\.pdf$/i, "") ?? null, date: day(r.date_issued), endDate: null,
      status: s(r.type_of_enforcement) ?? "Order", city: s(r.town),
      detail: [s(r.deep_program) ? `${s(r.deep_program)} program` : null, s(r.violation_description), s(r.violation_citation) ? `Cites ${s(r.violation_citation)}` : null,
        penalty != null ? `penalty $${penalty.toLocaleString("en-US")}` : null, pdf ? `Order: ${pdf}` : null].filter(Boolean).join(". ").slice(0, 900) || null,
      amount: penalty, adverse: true,
      address: clean([s(r.violation_address), s(r.town)].filter(Boolean).join(", ")),
    };
  },
};

const DEEP_OLDER: SodaEnforcement = {
  state: "CT", source: "Connecticut DEEP enforcement case summaries (1999 to 2021)", scope: "Formal enforcement case summaries, 1999 to 2021",
  ...soda("tvbr-6b6t"), nameFields: ["respondent"], order: "date DESC",
  toHit: (r: Row) => {
    const action = s(r.enforcement_action);
    const amount = action?.match(/\$\s?([\d,]+(?:\.\d{2})?)/)?.[1];
    const pdf = (r.path as { url?: string } | undefined)?.url ?? null;
    return {
      category: "environmental", name: s(r.respondent), id: s(r.consentorder)?.replace(/\.pdf$/i, "") ?? null, date: day(r.date), endDate: null,
      status: "Enforcement action", city: s(r.town),
      detail: [s(r.program) ? `${s(r.program)} program` : null, s(r.enforcement_title), action, pdf ? `Order: ${pdf}` : null].filter(Boolean).join(". ").slice(0, 900) || null,
      amount: amount ? Number(amount.replace(/,/g, "")) : null, adverse: true,
    };
  },
};

// ── Department of Labor debarment list ───────────────────────────────────────────────────────────────────────
const DOL_DEBAR_PAGE = "https://portal.ct.gov/dol/knowledge-base/articles/wage-and-workplace-standards/debarment-lists";

/** The newest "Debarment List - <Month D, YYYY>" link on the page. */
export function newestDebarmentList(html: string): { url: string; date: string } | null {
  let best: { url: string; date: string } | null = null;
  for (const m of Array.from(html.matchAll(/<a [^>]*href="([^"]+\.pdf[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi))) {
    const label = clean(decodeEntities(m[2].replace(/<[^>]+>/g, " "))) ?? "";
    const d = label.match(/Debarment List\s*-\s*([A-Za-z]+ \d{1,2}, \d{4})/i)?.[1];
    if (!d) continue;
    const t = new Date(`${d} 12:00 UTC`);
    if (Number.isNaN(t.getTime())) continue;
    const date = t.toISOString().slice(0, 10);
    if (!best || date > best.date) best = { url: new URL(decodeEntities(m[1]), DOL_DEBAR_PAGE).toString(), date };
  }
  return best;
}

/** Firm lines of the list's text ("-Firm Name, Town[, ST]      Indefinite"); individuals' lines are skipped. */
export function parseDebarmentText(text: string): { name: string; city: string | null; expires: string }[] {
  const out: { name: string; city: string | null; expires: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*(.+?)\s{2,}(\S.*?)\s*$/);
    if (!m || /an individual/i.test(m[1])) continue;
    const parts = m[1].split(",").map((p) => p.trim()).filter(Boolean);
    let city: string | null = null;
    if (parts.length >= 3 && /^[A-Z]{2}$/.test(parts[parts.length - 1])) city = parts.splice(-2).join(", ");
    else if (parts.length >= 2) city = parts.pop() ?? null;
    const name = clean(parts.join(", "));
    if (name) out.push({ name, city, expires: m[2] });
  }
  return out;
}

async function* ctDebarmentLoader(): AsyncIterable<BulkHit> {
  await rateLimitHost(DOL_DEBAR_PAGE, 1500);
  const res = await fetch(DOL_DEBAR_PAGE, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`debarment page returned HTTP ${res.status}`);
  const list = newestDebarmentList(await res.text());
  if (!list) throw new Error("no debarment list linked on the page");
  const pdf = await download(list.url);
  let text: string;
  try { text = (await run("pdftotext", ["-layout", pdf, "-"], { maxBuffer: 8 << 20 })).stdout; }
  finally { await fs.rm(pdf, { force: true }); }
  for (const f of parseDebarmentText(text)) {
    const ends = usDate(f.expires) ?? (/^\w+ \d{1,2}, \d{4}$/.test(f.expires) ? new Date(`${f.expires} 12:00 UTC`).toISOString().slice(0, 10) : null);
    const hit: EnforcementHit = {
      state: "CT", source: "Connecticut Department of Labor debarment list", sourceUrl: list.url, category: "debarment",
      name: f.name, id: null, date: null, endDate: ends, status: /indefinite/i.test(f.expires) ? "Debarred indefinitely" : ends ? `Debarred until ${ends}` : `Debarred (expiration: ${f.expires})`,
      city: f.city, detail: `On the debarment list of ${list.date} (CGS 31-53a): no state or public works contract may be awarded to the firm, or to a firm it has an interest in, until the expiration date`,
      amount: null, adverse: true,
    };
    yield { kind: "enforcement", hit, business: f.name, person: null };
  }
}

export const pack: StatePack = {
  state: "CT",
  checked: "2026-10-15",
  enforcement: [BUSINESS_REGISTRY, DEEP_RECENT, DEEP_OLDER],
  bulk: [
    { id: "ct-dol-debarment", state: "CT", label: "Connecticut Department of Labor debarment list", pageUrl: DOL_DEBAR_PAGE, everyHours: 24 * 7, minRows: 5,
      load: ctDebarmentLoader, companiesOnly: true, category: "debarment" },
  ],
  blocked: [
    "CT DOL stop-work orders (CGS 31-76a): the DOL describes them but publishes no list",
    "CT DCP disciplinary actions: published only as individual press releases, no list or dataset",
    "CT Judicial Branch case look-up: no public API or bulk file",
  ],
};
