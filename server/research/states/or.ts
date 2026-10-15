/**
 * Oregon, beyond the original CCB and BCD license datasets (../licenses.ts) and the DOJ complaints (../records.ts).
 * Every source below was opened and searched live on 2026-10-15; field names and code meanings are the publishers'.
 *
 *   Bulk (companies only):
 *     BOLI prevailing-wage List of Ineligibles (debarred from public works, ORS 279C.860) and BOLI Prevailing Wage
 *       Case Closure Letters ("contractors named in cases where an investigation substantiated violations", the last
 *       two years). Both are SharePoint lists behind oregon.gov/boli/employers/Pages/pwr-ineligible-contractors.aspx,
 *       read through the site's own list API (the page's data-table web part reads the same lists).
 *   Live enforcement (companies only):
 *     Secretary of State business registry, active businesses (data.oregon.gov tckn-sxa6; principal-place rows)
 *     DCBS active workers' compensation employers (data.oregon.gov q9zj-c8r2; monthly), with the insurer and the
 *       published insured-status codes
 */
import type { EnforcementHit } from "@shared/research-reports";
import { clean } from "../bulk";
import { decodeEntities } from "../bulk-sources";
import type { BulkHit, BulkSource } from "../bulk";
import { nameClause, sodaRows } from "../licenses";
import type { LiveEnforcementSearch, StatePack } from "./types";
import { anyDay, businessParts, fetchJson, nameMatches } from "./lib/g8-common";

// ── BOLI prevailing wage: List of Ineligibles + Case Closure Letters ─────────────────────────────────────────
const BOLI_PAGE = "https://www.oregon.gov/boli/employers/Pages/pwr-ineligible-contractors.aspx";
const BOLI_API = "https://www.oregon.gov/boli/employers/_api/web/GetList";
const listItems = (list: string, query: string) =>
  `${BOLI_API}('${encodeURIComponent(list)}')/items?${query}`;

type Item = Record<string, any>;
async function spItems(url: string): Promise<Item[]> {
  const body = await fetchJson<{ value?: Item[] }>(url, { headers: { accept: "application/json;odata=nometadata" } }, "BOLI list", 1500);
  if (!Array.isArray(body.value)) throw new Error("BOLI list returned an unexpected payload");
  return body.value;
}

const enf = (h: EnforcementHit, business: string, addresses: string[] = []): BulkHit =>
  ({ kind: "enforcement", hit: { ...h, address: addresses[0] ?? null }, business, person: null, keys: { addresses } });

/** The list's Address field is rich text: one or more addresses, a line each, separated by blank lines. */
export function boliAddresses(html: string | null | undefined): string[] {
  if (!html) return [];
  // A blank line (<div><br></div>, or <p></p>) separates two addresses; any other tag only breaks a line.
  const marked = html.replace(/[\u200b]/g, "").replace(/<div>\s*<br\s*\/?>\s*<\/div>|<p>\s*<\/p>/gi, "\u0001");
  return marked.split("\u0001")
    .map((block) => decodeEntities(block.replace(/<[^>]+>/g, "\n")).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join(" "))
    .filter(Boolean);
}

async function* boliLoader(): AsyncIterable<BulkHit> {
  const today = new Date().toISOString().slice(0, 10);
  // List of Ineligibles: Title = contractor (a trailing "*" means "Not to be removed from debarment"),
  // tdlw = "Date placed", lhcs = "Removal date" (the list's own field titles), Aliases.
  for (const r of await spItems(listItems("/boli/employers/Lists/Debarments", "$top=5000&$select=Id,Title,tdlw,lhcs,Aliases,Address"))) {
    const title = clean(r.Title);
    if (!title) continue;
    const names = businessParts(title);
    const aliases = businessParts(clean(r.Aliases)?.replace(/^aka\s+/i, ""));
    if (!names.length) continue; // a person only: never indexed (companies only)
    const removal = anyDay(r.lhcs);
    const permanent = /\*/.test(title);
    yield enf({
      state: "OR", source: "Oregon BOLI prevailing-wage List of Ineligibles (debarred)", sourceUrl: BOLI_PAGE, category: "debarment",
      name: names.join(" / "), id: null, date: anyDay(r.tdlw), endDate: removal,
      status: permanent ? "Ineligible; not to be removed from debarment" : removal && removal < today ? "Removal date passed" : "Ineligible for public works contracts",
      city: null, detail: ["Ineligible to receive public works contracts subject to the Prevailing Wage Rate Law (ORS 279C.860)",
        aliases.length ? `Also listed as ${aliases.join(", ")}` : null].filter(Boolean).join(". "),
      amount: null, adverse: true,
    }, [...names, ...aliases].join(" "), boliAddresses(r.Address));
  }
  // Case Closure Letters: the PDF's file name is "<contractor> - <case number>.pdf"; "Date issued" is its own field.
  const letters = await spItems(listItems("/boli/employers/Documents",
    "$top=5000&$select=FileLeafRef,FileRef,Date_x0020_issued,DocType&$filter=" + encodeURIComponent("DocType eq 'PWR Case Closure Letters'")));
  for (const r of letters) {
    const file = clean(r.FileLeafRef)?.replace(/\.pdf$/i, "");
    const m = file?.match(/^(.*\S)\s+-\s+([\w-]+)$/);
    if (!m) continue;
    const names = businessParts(m[1].replace(/\s+-\s+DBA as\s+/i, " dba "));
    if (!names.length) continue;
    yield enf({
      state: "OR", source: "Oregon BOLI prevailing-wage case closure letters", sourceUrl: r.FileRef ? `https://www.oregon.gov${encodeURI(r.FileRef)}` : BOLI_PAGE,
      category: "wage", name: names.join(" / "), id: m[2], date: anyDay(r.Date_x0020_issued), endDate: null,
      status: "Case closed with violations substantiated", city: null,
      detail: "BOLI issues a Prevailing Wage Case Closure Letter to contractors named in cases where an investigation substantiated violations",
      amount: null, adverse: true,
    }, names.join(" "));
  }
}

// ── Secretary of State: active businesses ────────────────────────────────────────────────────────────────────
const SOS_DATASET = "https://data.oregon.gov/d/tckn-sxa6";
const SOS_URL = "https://data.oregon.gov/resource/tckn-sxa6.json";

async function searchSos(name: string): Promise<EnforcementHit[]> {
  const rows = await sodaRows(SOS_URL, `${nameClause("business_name", name)} AND associated_name_type='PRINCIPAL PLACE OF BUSINESS'`, 200, "Oregon business registry");
  return rows.filter((r) => nameMatches(name, String(r.business_name ?? ""))).map((r) => ({
    state: "OR", source: "Oregon Secretary of State business registry (active businesses)",
    sourceUrl: typeof (r.business_details as any)?.url === "string" ? (r.business_details as any).url : SOS_DATASET,
    category: "business_status" as const, name: clean(String(r.business_name ?? "")), id: clean(String(r.registry_number ?? "")),
    date: anyDay(r.registry_date), endDate: null,
    status: `Active${clean(String(r.entity_type ?? "")) ? ` (${clean(String(r.entity_type))})` : ""}`,
    city: [clean(String(r.city ?? "")), clean(String(r.state ?? ""))].filter(Boolean).join(", ") || null,
    address: [r.address, r.address_continued, r.city, r.state, r.zip].map((v) => clean(v == null ? null : String(v))).filter(Boolean).join(" ") || null,
    detail: r.registry_date ? `Registered ${anyDay(r.registry_date)}` : null, amount: null, adverse: null,
  }));
}

// ── DCBS workers' compensation employer database ─────────────────────────────────────────────────────────────
const WC_DATASET = "https://data.oregon.gov/d/q9zj-c8r2";
const WC_URL = "https://data.oregon.gov/resource/q9zj-c8r2.json";
/** insurer_status, from the dataset's column description (DCBS, 2026-10-15). */
const WC_STATUS: Record<string, string> = { "1": "Active coverage", "01": "Active coverage", "3": "Double coverage", "03": "Double coverage", "4": "Pending coverage", "04": "Pending coverage", "12": "Pending investigation" };

async function searchWorkersComp(name: string): Promise<EnforcementHit[]> {
  const rows = await sodaRows(WC_URL, `(${nameClause("legal_business_name", name)}) OR (${nameClause("dba_name", name)})`, 200, "Oregon workers' comp employers");
  return rows.filter((r) => nameMatches(name, String(r.legal_business_name ?? ""), String(r.dba_name ?? ""))).map((r) => {
    const code = clean(String(r.insurer_status ?? "")) ?? "";
    const dba = clean(String(r.dba_name ?? ""));
    return {
      state: "OR", source: "Oregon DCBS workers' compensation coverage (active employers)", sourceUrl: WC_DATASET, category: "business_status" as const,
      name: [clean(String(r.legal_business_name ?? "")), dba].filter(Boolean).join(" / "), id: clean(String(r.employer_num ?? "")),
      date: anyDay(r.liab_begin_date), endDate: anyDay(r.liad_end_date),
      status: `Workers' comp: ${WC_STATUS[code] ?? (code ? `code ${code}` : "status not given")}`,
      city: [clean(String(r.ppb_city ?? "")), clean(String(r.ppb_state ?? ""))].filter(Boolean).join(", ") || null,
      address: [r.ppb_address2, r.ppb_city, r.ppb_state, r.ppb_zip].map((v) => clean(v == null ? null : String(v))).filter(Boolean).join(" ") || null,
      phone: r.phone ? clean(`${r.phone_area ?? ""}${r.phone}`) : null,
      detail: [clean(String(r.insurer_name ?? "")) ? `Insurer: ${clean(String(r.insurer_name))}` : (r.record_origin ? null : "Self-insured"),
        clean(String(r.naics_description ?? "")), clean(String(r.employees_range ?? "")) ? `${clean(String(r.employees_range))} employees` : null].filter(Boolean).join(". ") || null,
      amount: null, adverse: null,
    };
  });
}

const liveEnforcement: LiveEnforcementSearch[] = [
  { source: "Oregon Secretary of State business registry (active businesses)", scope: "Active businesses only (inactive ones are not published)", search: searchSos },
  { source: "Oregon DCBS workers' compensation coverage (active employers)", scope: "Employers with an active policy, updated monthly", search: searchWorkersComp },
];

const bulk: BulkSource[] = [
  { id: "or-boli-pwr", state: "OR", label: "Oregon BOLI prevailing wage: ineligible contractors and case closure letters", pageUrl: BOLI_PAGE,
    everyHours: 24, minRows: 30, load: boliLoader, companiesOnly: true },
];

export const pack: StatePack = {
  state: "OR",
  checked: "2026-10-15",
  liveEnforcement,
  bulk,
  blocked: [
    "CCB contractor search, complaint and disciplinary history (search.ccb.state.or.us): robots.txt disallows every path; CCB publishes no disciplinary list elsewhere",
    "Building Codes Division enforcement actions: no published list (the enforcement page describes the process only)",
  ],
};
