/**
 * Georgia. Checked live 2026-10-15.
 *
 *   Live enforcement search:
 *     Georgia EPD enforcement orders (enfo.gaepd.org; robots.txt absent; no CAPTCHA): the public "Search Enforcement
 *     Orders" form by facility name (proposed and executed orders, 1998 to today), then each matching order's details
 *     page for the cause, the requirements, the settlement amount and the legal authority.
 *
 * Georgia's licensing boards (contractors, electrical, plumbing, HVAC, engineers) all sit on sos.ga.gov behind a
 * Cloudflare challenge, so no license source is searched here yet (see `blocked`).
 */
import type { EnforcementHit } from "@shared/research-reports";
import { politeFetch } from "../http";
import { clean } from "../bulk";
import { tokens } from "../licenses";
import type { LiveEnforcementSearch, StatePack } from "./types";
import { hasAllWords, htmlText } from "./lib/g3-common";

const ENFO = "https://enfo.gaepd.org";
const MONTHS: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** "12‑Aug‑2024" (non-breaking hyphens) → 2024-08-12. */
export function epdDate(v: string | null | undefined): string | null {
  const m = (v ?? "").replace(/[‐-―]/g, "-").match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  const mon = m ? MONTHS[m[2].toUpperCase()] : undefined;
  return m && mon ? `${m[3]}-${mon}-${m[1].padStart(2, "0")}` : null;
}

export type EpdRow = { facility: string | null; county: string | null; order: string | null; authority: string | null; status: string | null; date: string | null; details: string | null };

/** Result rows of the search page. */
export function parseEpdSearch(html: string): { total: number; rows: EpdRow[] } {
  const total = Number(htmlText(html.match(/Total results:\s*([\d,]+)/)?.[1])?.replace(/,/g, "") ?? 0);
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  const rows: EpdRow[] = [];
  for (const m of Array.from(body.matchAll(/<tr>([\s\S]*?)<\/tr>/g))) {
    const fac = m[1].match(/data-label="Facility">([\s\S]*?)<\/th>/)?.[1] ?? "";
    const ord = m[1].match(/data-label="Order">([\s\S]*?)<\/td>/)?.[1] ?? "";
    const st = m[1].match(/data-label="Status\/Date">([\s\S]*?)<\/td>/)?.[1] ?? "";
    rows.push({
      facility: htmlText(fac.replace(/<em>[\s\S]*?<\/em>/, "")), county: htmlText(fac.match(/<em>([\s\S]*?)<\/em>/)?.[1]),
      order: htmlText(ord.replace(/<em>[\s\S]*?<\/em>/, "")), authority: htmlText(ord.match(/<em>([\s\S]*?)<\/em>/)?.[1]),
      status: htmlText(st.match(/<strong>([\s\S]*?)<\/strong>/)?.[1])?.replace(/\s*On$/i, "") ?? null,
      date: epdDate(htmlText(st.replace(/<strong>[\s\S]*?<\/strong>/, "").replace(/&#x2011;/g, "-"))),
      details: m[1].match(/href="(\/Details\/\d+)"/)?.[1] ?? null,
    });
  }
  return { total, rows };
}

/** The label/value table of an order's details page. */
export function parseEpdDetails(html: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const m of Array.from(html.matchAll(/<th scope="row">([\s\S]*?)<\/th>\s*<td>([\s\S]*?)<\/td>/g))) {
    const k = htmlText(m[1]);
    if (k) out[k] = htmlText(m[2].replace(/&#x2011;/g, "-"));
  }
  return out;
}

export function epdHit(row: EpdRow, d: Record<string, string | null>, url: string): EnforcementHit {
  const amount = d["Settlement Amount"]?.match(/\$\s?([\d,]+(?:\.\d{2})?)/)?.[1];
  const executed = epdDate(d["Date Executed"]);
  return {
    state: "GA", source: "Georgia EPD enforcement orders", sourceUrl: url, category: "environmental",
    name: d.Facility ?? row.facility, id: row.order, date: executed ?? row.date, endDate: null,
    status: row.status ? `${row.status} order` : null, city: d.County ?? row.county,
    detail: [d["Legal Authority"] ?? row.authority, d["Cause of Order"] ? `Cause: ${d["Cause of Order"]}` : null,
      d["Requirements of Order"] ? `Required: ${d["Requirements of Order"]}` : null].filter(Boolean).join(". ").slice(0, 900) || null,
    amount: amount ? Number(amount.replace(/,/g, "")) : null,
    // A proposed order is out for public comment and not yet in force.
    adverse: /executed/i.test(row.status ?? "") ? true : null,
  };
}

const MAX_PAGES = 4;
const MAX_DETAILS = 12;

async function epdText(url: string): Promise<string> {
  const res = await politeFetch(url, {}, { minDelayMs: 2000 });
  if (!res.ok) throw new Error(`Georgia EPD orders returned HTTP ${res.status}`);
  return res.text();
}

/** Orders whose facility name holds every word of the company's name. */
async function searchEpd(name: string): Promise<EnforcementHit[]> {
  if (!tokens(name).length || name.trim().length < 3) return [];
  const q = (p: number) => `${ENFO}/Search?${new URLSearchParams({ Facility: name.trim().slice(0, 100), Status: "All", ...(p > 1 ? { p: String(p) } : {}), handler: "search" })}`;
  const first = await epdText(q(1));
  if (!/Total results:|No orders found|No results/i.test(first)) throw new Error("Georgia EPD orders returned an unexpected page");
  const { total, rows } = parseEpdSearch(first);
  const pages = Math.min(MAX_PAGES, Math.ceil(total / 25));
  for (let p = 2; p <= pages; p++) rows.push(...parseEpdSearch(await epdText(q(p))).rows);
  const out: EnforcementHit[] = [];
  for (const row of rows.filter((r) => hasAllWords(name, r.facility)).slice(0, MAX_DETAILS)) {
    const url = row.details ? `${ENFO}${row.details}` : `${ENFO}/Search`;
    const d = row.details ? parseEpdDetails(await epdText(url)) : {};
    out.push(epdHit(row, d, url));
  }
  return out.filter((h) => clean(h.name));
}

const LIVE_ENFORCEMENT: LiveEnforcementSearch[] = [
  { source: "Georgia EPD enforcement orders", scope: "Proposed and executed EPD orders, 1998 to today (facility name)", category: "environmental", search: searchEpd },
];

export const pack: StatePack = {
  state: "GA",
  checked: "2026-10-15",
  liveEnforcement: LIVE_ENFORCEMENT,
  blocked: [
    "Georgia Secretary of State licensing boards (verify.sos.ga.gov: residential and general contractors, electrical, plumbing, conditioned air, low voltage, engineers): Cloudflare challenge on every page, robots.txt included",
    "Georgia Secretary of State corporations (ecorp.sos.ga.gov): Cloudflare challenge; bulk corporations data is sold ($1,000 one-time or $500/month)",
    "Georgia Insurance and Safety Fire Commissioner licensed professionals (sprinkler, elevator, boiler; Citizenserve portal): \"I am human\" check before results",
    "Georgia DOAS suspended and debarred suppliers (doas.ga.gov, purchasing law page): the current FY27 list (a .docx posted 2026-08) says NONE, as did FY23 and FY24; rechecked 2026-10-15",
    "GSFIC debarred, suspended or ineligible firms (gsfic.georgia.gov): still one PDF last updated 2020-01-10, with no firms listed; rechecked 2026-10-15",
  ],
};
