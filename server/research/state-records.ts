/**
 * State enforcement and standing records searched live, per state (the bulk-file ones are in ./bulk-sources.ts).
 * Companies only, like the rest of ./records (FCRA). Every dataset and form here was queried live on 2026-10-14;
 * field names and code meanings are the publishers' own (CLAUDE.md: never fabricate government data).
 *
 *   TX  TDLR administrative orders (penalties, revocations; licensed and unlicensed respondents), public search form
 *   TX  Comptroller franchise-tax status (right to transact business; forfeitures), data.texas.gov 9cir-efmm
 *   TX  TCEQ administrative orders, civil judgments, notices of enforcement and violation, and complaints
 *
 * Addresses (2026-10-15, from each dataset's /api/views metadata): the Comptroller's taxpayer mailing address, the
 * TCEQ regulated entity's delivery address (notices of enforcement) and site address (notices of violation); the
 * TDLR orders carry the license number. The other TCEQ datasets publish a county only.
 */
import type { EnforcementHit, RecordSource } from "@shared/research-reports";
import { politeFetch } from "./http";
import { nameClause, sodaRows } from "./licenses";
import { decodeEntities } from "./bulk-sources";
import { clean, usDate } from "./bulk";
import { adverseFrom } from "./adverse";
import { capNote, failureNote, noteOf, type Noted, withNote } from "./notes";

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => clean(v == null ? null : String(v));
const day = (v: unknown): string | null => { const t = s(v); return t ? (/^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : usDate(t)) : null; };
const num = (v: unknown): number | null => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) ? null : n; };
/** Street, city, state and ZIP fields joined (null when the row has no street). */
const addr = (r: Row, street: string[], rest: string[]): string | null => {
  const st = street.map((f) => s(r[f])).filter(Boolean).join(" ");
  return st ? [st, ...rest.map((f) => s(r[f]))].filter(Boolean).join(" ") : null;
};
const usd = (n: number | null) => (n == null ? null : `$${n.toLocaleString("en-US")}`);

export type SodaEnforcement = {
  state: string; source: string; scope: string; datasetUrl: string; url: string; nameFields: string[]; order?: string;
  toHit: (r: Row) => Omit<EnforcementHit, "state" | "source" | "sourceUrl">;
};

const soda = (domain: string, id: string) => ({ datasetUrl: `https://${domain}/d/${id}`, url: `https://${domain}/resource/${id}.json` });

// Comptroller right_to_transact_business_code, from the dataset's attached layout ("Franchise Layout.docx").
const TX_TRANSACT: Record<string, string> = {
  A: "Active", D: "Active, eligible for termination or withdrawal", N: "Forfeited (Comptroller code N)",
  I: "Franchise tax involuntarily ended", U: "Not established",
};
const TX_SOS: Record<string, string> = {
  A: "Active", F: "Forfeited franchise tax", R: "Reinstated", D: "Dissolved", W: "Withdrawn", T: "Terminated", C: "Converted", M: "Merged",
};

const SODA_SOURCES: SodaEnforcement[] = [
  {
    state: "TX", source: "Texas Comptroller franchise-tax status", scope: "Every franchise-tax entity, updated weekly",
    ...soda("data.texas.gov", "9cir-efmm"), nameFields: ["taxpayer_name"],
    toHit: (r) => {
      const code = s(r.right_to_transact_business_code)?.trim() ?? "";
      const sos = s(r.sos_status_code)?.trim() ?? "";
      return {
        category: "business_status", name: s(r.taxpayer_name), id: s(r.taxpayer_number), date: day(r.sos_charter_date) ?? day(r.responsibility_beginning_date),
        endDate: day(r.sos_status_date), city: s(r.taxpayer_city),
        // A blank code is unknown, not "ended" (audit 2026-10-15, decision 3).
        status: `Right to transact business in Texas: ${TX_TRANSACT[code] ?? (code ? `code ${code}` : "not published")}`,
        detail: [sos ? `Secretary of State status: ${TX_SOS[sos] ?? `code ${sos}`}` : null, s(r.secretary_of_state_sos_or_coa_file_number) ? `SOS file ${s(r.secretary_of_state_sos_or_coa_file_number)}` : null].filter(Boolean).join(". ") || null,
        amount: null, adverse: null,
        address: addr(r, ["taxpayer_address"], ["taxpayer_city", "taxpayer_state", "taxpayer_zip"]),
      };
    },
  },
  {
    state: "TX", source: "TCEQ administrative orders", scope: "2015 to today",
    ...soda("data.texas.gov", "u66a-qggj"), nameFields: ["respondent_name"], order: "order_date DESC",
    toHit: (r) => ({
      category: "environmental", name: s(r.respondent_name), id: s(r.tceqdocketno) ?? s(r.case_no), date: day(r.order_date), endDate: null,
      status: "Order issued", city: s(r.county) ? `${s(r.county)} County` : null,
      detail: [s(r.program) ? `${s(r.program)} enforcement order` : "Enforcement order", num(r.penalty_assessed) != null ? `penalty assessed ${usd(num(r.penalty_assessed))}` : null,
        num(r.penalty_deferred) ? `${usd(num(r.penalty_deferred))} deferred` : null].filter(Boolean).join(", "),
      amount: num(r.penalty_assessed), adverse: true,
    }),
  },
  {
    state: "TX", source: "TCEQ civil judgments", scope: "Judgments won by the state",
    ...soda("data.texas.gov", "7ift-kbgd"), nameFields: ["respondent_name"], order: "order_date DESC",
    toHit: (r) => ({
      category: "environmental", name: s(r.respondent_name), id: s(r.district_court_docket_no) ?? s(r.case_no), date: day(r.order_date), endDate: null,
      status: "Civil judgment", city: s(r.county) ? `${s(r.county)} County` : null,
      detail: [s(r.program), num(r.penalty_assessed) != null ? `penalty ${usd(num(r.penalty_assessed))}` : null, num(r.attorney_fees) ? `attorney fees ${usd(num(r.attorney_fees))}` : null].filter(Boolean).join(", ") || null,
      amount: num(r.penalty_assessed), adverse: true,
    }),
  },
  {
    state: "TX", source: "TCEQ notices of enforcement", scope: "Sites named after the company",
    ...soda("data.texas.gov", "rua3-iswk"), nameFields: ["reg_ent_name"],
    toHit: (r) => ({
      category: "environmental", name: s(r.reg_ent_name), id: s(r.noe_id) ?? s(r.invstn_no), date: day(r.noe_dt), endDate: null,
      status: "Notice of enforcement", city: s(r.city_name),
      detail: [s(r.reg_ent_desc_txt), num(r.viol_cnt) != null ? `${num(r.viol_cnt)} violation(s)` : null, s(r.a_viol_citations) ? `citing ${s(r.a_viol_citations)}` : null, s(r.tnrcc_dkt_num_txt) ? `docket ${s(r.tnrcc_dkt_num_txt)}` : null].filter(Boolean).join(", ") || null,
      amount: null, adverse: null,
      address: addr(r, ["deliv_txt"], ["city_name", "usps_state_cd", "zip_cd"]),
    }),
  },
  {
    state: "TX", source: "TCEQ notices of violation", scope: "2021 to today",
    ...soda("data.texas.gov", "mwzi-gyw7"), nameFields: ["rn_name"],
    toHit: (r) => ({
      category: "environmental", name: s(r.rn_name), id: s(r.violation_id) ?? s(r.investigation_no), date: day(r.invest_approved_dt), endDate: day(r.violation_status_date),
      status: "Notice of violation", city: s(r.phys_city),
      detail: [num(r.viol_cnt) != null ? `${num(r.viol_cnt)} violation(s)` : null, s(r.a_viol_citations) ? `citing ${s(r.a_viol_citations)}` : null].filter(Boolean).join(", ") || null,
      amount: null, adverse: null,
      address: addr(r, ["phys_loc"], ["phys_city", "phys_state", "phys_zip"]),
    }),
  },
  {
    state: "TX", source: "TCEQ environmental complaints", scope: "2000 to today",
    ...soda("data.texas.gov", "tdzs-qqjn"), nameFields: ["reg_ent_name"], order: "incid_rcvd_dt DESC",
    toHit: (r) => ({
      category: "environmental", name: s(r.reg_ent_name), id: s(r.incid_track_num), date: day(r.incid_rcvd_dt), endDate: day(r.incid_status_dt),
      status: s(r.inc_status) ? `Complaint: ${s(r.inc_status)}` : "Complaint", city: s(r.county) ? `${s(r.county)} County` : null,
      detail: [s(r.pgm_name), s(r.incid_desc)?.slice(0, 300), s(r.incid_action) ? `Action: ${s(r.incid_action)?.slice(0, 200)}` : null].filter(Boolean).join(". ") || null,
      amount: null, adverse: null,
    }),
  },
];

// ── TDLR administrative orders (public search form) ──────────────────────────────────────────────────────────
const TDLR_FORM = "https://www.tdlr.texas.gov/cimsfo/fosearch.asp";
const TDLR_RESULTS = "https://www.tdlr.texas.gov/cimsfo/fosearch_results.asp";

/** Every TDLR order whose company name starts with this name (the form matches from the start, 20 characters at most). */
export async function searchTdlrOrders(name: string): Promise<EnforcementHit[]> {
  const prefix = name.toUpperCase().replace(/[^A-Z0-9&' -]/g, " ").replace(/\s+/g, " ").trim().slice(0, 20).trim();
  if (prefix.length < 3) return [];
  const body = new URLSearchParams({ pht_status: "-1", pht_lic: "", pht_lnm: "", pht_fnm: "", pht_oth_name: prefix, phy_city: "-1", phy_cnty: "-1", phy_zip: "", B1: "Search" });
  const res = await politeFetch(TDLR_RESULTS, { method: "POST", body: body.toString(), headers: { "content-type": "application/x-www-form-urlencoded", referer: TDLR_FORM } }, { minDelayMs: 1500 });
  if (!res.ok) throw new Error(`TDLR returned HTTP ${res.status}`);
  const html = await res.text();
  if (!/records? found/i.test(html)) throw new Error("TDLR returned an unexpected page");
  return parseTdlrOrders(html);
}

export function parseTdlrOrders(html: string): EnforcementHit[] {
  const text = (v: string) => clean(decodeEntities(v.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")));
  const out: EnforcementHit[] = [];
  for (const m of Array.from(html.matchAll(/<tr style="background:[^"]*">([\s\S]*?)<\/tr>/g))) {
    const cells = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => c[1]);
    if (cells.length < 3) continue;
    const pairs = Array.from(cells[0].matchAll(/<span class="default_text">\s*([^<]*?)\s*<\/span>\s*<span class="results_text">([^<]*)<\/span>/g))
      .map((p) => [p[1].replace(/[:#]\s*$/, "").trim(), clean(decodeEntities(p[2]))] as const);
    const get = (label: string) => pairs.filter(([k]) => k.toLowerCase().startsWith(label)).map(([, v]) => v).filter((v): v is string => !!v);
    const names = Array.from(new Set([...get("company"), ...get("name")]));
    if (!names.length) continue;
    const date = cells[1].match(/results_text">\s*(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1] ?? null;
    const order = text(cells[1].replace(/<span class="default_text">Date:<\/span>\s*<span class="results_text">[^<]*<\/span>/, ""));
    // The amount is the penalty only when the order text calls it one ("administrative penalty of $1,000"); a
    // restitution or fee figure is left in the text, not reported as the penalty.
    const amount = order?.match(/penalt(?:y|ies)[^$.;]{0,60}\$\s?([\d,]+(?:\.\d{2})?)/i)?.[1] ?? order?.match(/\$\s?([\d,]+(?:\.\d{2})?)[^.;]{0,40}penalt/i)?.[1];
    const license = get("license")[0] ?? null;
    out.push({
      state: "TX", source: "Texas TDLR administrative orders", sourceUrl: TDLR_FORM, category: "discipline",
      name: names.join(" / "), id: get("complaint")[0] ?? null, date: usDate(date), endDate: null,
      status: license && /not licensed/i.test(license) ? "Order against an unlicensed respondent" : license ? `Order on license ${license}` : "Order issued",
      city: [get("city")[0], get("county")[0] ? `${get("county")[0]} County` : null].filter(Boolean).join(", ") || null,
      detail: [order, text(cells[2]) ? `Basis: ${text(cells[2])}` : null].filter(Boolean).join(" ").slice(0, 800) || null,
      // From the order's own words: a penalty, revocation or suspension is adverse; a dismissal is not; else unknown.
      amount: amount ? Number(amount.replace(/,/g, "")) : null, adverse: adverseFrom(order),
      licenseNumber: license && !/not licensed/i.test(license) ? license : null,
    });
  }
  return out;
}

// ── Per state ────────────────────────────────────────────────────────────────────────────────────────────────
const MAX_ROWS = 500;

/** One open-data enforcement dataset, searched by every word of the name, kept to rows that really name it. */
export async function searchSodaEnforcement(src: SodaEnforcement, name: string, matches: (n: string | null) => boolean): Promise<Noted<EnforcementHit>> {
  const rows = await sodaRows(src.url, nameClause(src.nameFields, name), MAX_ROWS, src.source, src.order);
  // A full page means there may be more rows than were read: the report says so.
  return withNote(rows.map((r) => ({ state: src.state, source: src.source, sourceUrl: src.datasetUrl, ...src.toHit(r) })).filter((h) => matches(h.name)), rows.length >= MAX_ROWS ? capNote(MAX_ROWS, null, "records read") : null);
}

export async function searchStateEnforcement(name: string, state: string, matches: (n: string | null) => boolean): Promise<{ hits: EnforcementHit[]; sources: RecordSource[] }> {
  const hits: EnforcementHit[] = [];
  const sources: RecordSource[] = [];
  for (const src of SODA_SOURCES.filter((x) => x.state === state)) {
    try {
      const found = await searchSodaEnforcement(src, name, matches);
      hits.push(...found);
      sources.push({ source: src.source, scope: src.scope, searched: true, note: `${found.length} record(s)${noteOf(found) ? ` (${noteOf(found)})` : ""}` });
    } catch (err: any) {
      sources.push({ source: src.source, scope: src.scope, searched: false, note: failureNote(err) });
    }
  }
  if (state === "TX") {
    try {
      const found = (await searchTdlrOrders(name)).filter((h) => matches(h.name));
      hits.push(...found);
      sources.push({ source: "Texas TDLR administrative orders", scope: "Electrical, A/C, elevator, water well and other TDLR trades", searched: true, note: `${found.length} order(s)` });
    } catch (err: any) {
      sources.push({ source: "Texas TDLR administrative orders", scope: "TDLR trades", searched: false, note: failureNote(err) });
    }
  }
  return { hits, sources };
}

export const stateEnforcementStates = new Set([...SODA_SOURCES.map((x) => x.state), "TX"]);
