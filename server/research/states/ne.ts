/**
 * Nebraska. Every source below was opened and searched live on 2026-10-15; field names, statuses and codes are the
 * publishers' own (CLAUDE.md: never fabricate government data).
 *
 *   live  Nebraska Department of Labor contractor registrations (dol.nebraska.gov/conreg public search): every
 *         contractor and subcontractor registered to work in Nebraska, with its registration number, expiration,
 *         workers' compensation status, sales tax option, employee count, address and phone.
 *   live  Nebraska State Electrical Division licenses and registrations (the division's public search on Tyler
 *         State Regulatory Central): contractors, journeymen, apprentices, fire alarm installers and the rest,
 *         with status and the contact address; searched by name, credential number or street address.
 *   ne-eca-unpaid  Department of Labor list of contractors with unpaid fines for Employee Classification Act
 *         (worker misclassification) violations, a PDF linked from the Labor Standards contractor overview page (read with ./lib/g6-pdf.ts).
 *
 * Nebraska has no state general-contractor license; contractors register with the Department of Labor (above).
 */
import { entityHolder } from "../licenses";
import type { LicenseHit } from "@shared/research-reports";
import { promises as fs } from "node:fs";
import { clean, download, usDate, type BulkSource } from "../bulk";
import { addressMatches, type IdQuery } from "../identifiers";
import { politeFetch } from "../http";
import type { LiveLicenseSearch, StatePack } from "./types";
import { capNote, escapeRegExp, noteOf, withNote } from "../notes";
import { looksLikeBusiness } from "./lib/business-name";
import { htmlText, joinAddr } from "./lib/g6-common";
import { pdfTable } from "./lib/g6-pdf";

// ── NE DOL contractor registration ───────────────────────────────────────────────────────────────────────────
const CONREG = "https://dol.nebraska.gov/conreg";
const CONREG_SEARCH = `${CONREG}/Search/AdvancedSearch`;

/** Results per page the search is asked for (it answers one page). */
const CONREG_PAGE = 25;

async function conregSearch(fields: Record<string, string>): Promise<string[]> {
  const body = new URLSearchParams({ Page: "1", ResultsPerPage: String(CONREG_PAGE), TotalPages: "0" });
  for (const [k, v] of Object.entries(fields)) body.set(`AdvancedSearch.${k}`, v);
  const res = await politeFetch(CONREG_SEARCH, { method: "POST", body: body.toString(), headers: { "content-type": "application/x-www-form-urlencoded", referer: `${CONREG}/Search` } }, { minDelayMs: 1200 });
  if (!res.ok) throw new Error(`Nebraska DOL contractor search returned HTTP ${res.status}`);
  const html = await res.text();
  if (!/contractor-search-form|Contractor Option/.test(html)) throw new Error("Nebraska DOL contractor search returned an unexpected page");
  return Array.from(new Set(Array.from(html.matchAll(/\/conreg\/Contractor\/Details\/(\d+)/g), (m) => m[1])));
}

/** The details page as label → value (the page lists labels and values in order). */
export function parseConregDetail(html: string): Record<string, string> {
  const t = htmlText(html.replace(/<script[\s\S]*?<\/script>/g, "")) ?? "";
  const body = t.slice(t.indexOf("Contractor/Subcontractor Name"), t.indexOf(" Print "));
  const labels = ["Contractor/Subcontractor Name", "Corporation Name", "Business Contact Email", "Business Entity", "Address", "City", "State", "Zip", "Telephone", "Registration Number", "Registration Expiration", "Sales Tax Option", "Number of Employees", "Worker's Compensation Status"];
  const out: Record<string, string> = {};
  for (let i = 0; i < labels.length; i++) {
    const a = body.indexOf(labels[i] + " ");
    if (a < 0) continue;
    const start = a + labels[i].length + 1;
    let end = body.length;
    for (const l of labels.slice(i + 1)) { const b = body.indexOf(" " + l + " ", start - 1); if (b >= 0) { end = b; break; } }
    const v = clean(body.slice(start, end));
    if (v && !labels.includes(v)) out[labels[i]] = v;
  }
  return out;
}

/** Entity forms that make a registration a business's (any other value is unknown). */
export const NE_BUSINESS_ENTITIES = /^(?:(?:s |c |professional |non-?profit )?corporation|limited liability company|llc|limited liability partnership|llp|limited partnership|general partnership|partnership|joint venture|trust|association)$/i;

export function conregHit(id: string, d: Record<string, string>, matchedOn: LicenseHit["matchedOn"]): LicenseHit | null {
  const name = clean(d["Contractor/Subcontractor Name"]);
  if (!name) return null;
  const corp = clean(d["Corporation Name"]);
  const tail = (v: string | undefined) => escapeRegExp(v ?? "");
  const street = clean(d["Address"]?.replace(new RegExp(`\\s*${d["City"] ? tail(d["City"]) : "@@"},?\\s*${tail(d["State"])}\\s*${tail(d["Zip"])}$`, "i"), ""));
  // A sole proprietor registered under their own name is a person, not a business name.
  const person = /sole/i.test(d["Business Entity"] ?? "") && !looksLikeBusiness(name) && !corp ? name : null;
  return {
    state: "NE", source: "Nebraska DOL contractor registrations", sourceUrl: `${CONREG}/Contractor/Details/${id}`,
    businessName: person ? null : corp && corp.toUpperCase() !== name.toUpperCase() ? `${name} (${corp})` : name,
    licenseNumber: clean(d["Registration Number"]), licenseType: "Contractor registration",
    specialty: [d["Business Entity"], d["Sales Tax Option"] ? `sales tax option ${d["Sales Tax Option"]}` : null, d["Number of Employees"] ? `${d["Number of Employees"]} employees` : null].filter(Boolean).join("; ") || null,
    status: d["Worker's Compensation Status"] ? `Registered; workers' compensation: ${d["Worker's Compensation Status"]}` : "Registered",
    principal: person, city: [clean(d["City"]), clean(d["State"])].filter(Boolean).join(", ") || null,
    expires: usDate(d["Registration Expiration"]), matchedOn,
    address: joinAddr(street, d["City"], d["State"], d["Zip"]), phone: clean(d["Telephone"]), people: person ? [{ name: person, role: "Sole proprietor" }] : [],
    // The registration's own "Business Entity" says who holds it (round 2, decisions 2 and 3): a sole proprietorship is
    // the person's, whatever name it trades under; a listed entity form a business; anything else, or none given,
    // unknown (round 3, decision 3).
    holder: entityHolder(d["Business Entity"], { business: NE_BUSINESS_ENTITIES, individual: /sole/i }),
  };
}

/** Detail pages opened per search: a politeness cap, noted when hit. */
const CONREG_DETAILS = 12;

async function conregHits(searches: Record<string, string>[], matchedOn: LicenseHit["matchedOn"]): Promise<LicenseHit[]> {
  const ids: string[] = [];
  let fullPage = false;
  for (const f of searches) {
    const found = await conregSearch(f);
    if (found.length >= CONREG_PAGE) fullPage = true;
    for (const id of found) if (!ids.includes(id)) ids.push(id);
  }
  const out: LicenseHit[] = [];
  let failed = 0;
  for (const id of ids.slice(0, CONREG_DETAILS)) {
    const res = await politeFetch(`${CONREG}/Contractor/Details/${id}`, {}, { minDelayMs: 1200 });
    // politeFetch throws on 401/403 (the host is then blocked); any other HTTP error is one page, counted and noted.
    if (!res.ok) { failed++; await res.body?.cancel().catch(() => undefined); continue; }
    const h = conregHit(id, parseConregDetail(await res.text()), matchedOn);
    if (h) out.push(h);
  }
  return withNote(out, [
    ids.length > CONREG_DETAILS ? capNote(CONREG_DETAILS, ids.length, "registrations") : fullPage ? capNote(ids.length, null, "registrations (the search's first page)") : null,
    failed ? `${failed} registration page(s) could not be read (HTTP error)` : null,
  ].filter(Boolean).join("; "));
}

const SUFFIX = /\b(INC|INCORPORATED|LLC|L L C|CO|CORP|CORPORATION|COMPANY|LTD|LC|PLLC|LLP)\b\.?/gi;
const stripSuffix = (n: string) => clean(n.replace(/[.,]/g, " ").replace(SUFFIX, " ")) ?? n;

const NE_CONREG: LiveLicenseSearch = {
  source: "Nebraska DOL contractor registrations", sourceUrl: `${CONREG}/Search`,
  // A person is searched as a sole proprietor registered under their own name (the name field takes either).
  search: async (name, kind) => kind === "person"
    ? conregHits([{ ContractorCorpName: name.trim() }], "principal").then((r) => withNote(r.filter((h) => h.principal), noteOf(r)))
    : conregHits([{ ContractorCorpName: stripSuffix(name) }, { DBAName: stripSuffix(name) }], "business"),
  searchBy: async (q: IdQuery) => {
    if (q.type === "license") return conregHits([{ RegistrationNumber: q.value.trim() }], "license");
    if (q.type === "phone") { const d = q.value.replace(/\D/g, "").slice(-10); return d.length === 10 ? conregHits([{ PhoneNumber: d }], "phone") : null; }
    return null;
  },
};

// ── NE State Electrical Division (Tyler State Regulatory Central public search) ──────────────────────────────
const SRC = "https://nesedprod.state-reg-central.tylerapp.com";
const SRC_SEARCH_SITE = "https://nesedprod-search.state-reg-central.tylerapp.com";
type SrcResult = { id: string; title: string | null; subtitle: string | null; details: { label: string; values: (string | null)[] }[] | null; chips?: { items?: { label: string }[] } | null };

let token: { value: string; until: number } | null = null;
/** The anonymous public-search token the search page itself requests (no account; five minutes). */
async function srcToken(): Promise<string> {
  if (token && Date.now() < token.until) return token.value;
  const res = await politeFetch(`${SRC}/portal/api/auth/token`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }, { minDelayMs: 1000 });
  if (!res.ok) throw new Error(`Nebraska electrical search token returned HTTP ${res.status}`);
  const j = await res.json() as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("Nebraska electrical search gave no token");
  token = { value: j.access_token, until: Date.now() + Math.max(30, (j.expires_in ?? 60) - 30) * 1000 };
  return token.value;
}

async function srcSearch(lookup: string): Promise<SrcResult[]> {
  const res = await politeFetch(`${SRC}/licensing/api/endpoints/v1/portal/search`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await srcToken()}` },
    body: JSON.stringify({ appliedFilters: null, highlight: "true", lookupString: lookup, rows: SRC_ROWS, start: 0, type: "credential" }),
  }, { minDelayMs: 1200 });
  if (!res.ok) throw new Error(`Nebraska electrical search returned HTTP ${res.status}`);
  const j = await res.json() as { results?: SrcResult[] };
  if (!Array.isArray(j.results)) throw new Error("Nebraska electrical search returned an unexpected payload");
  return withNote(j.results, j.results.length >= SRC_ROWS ? capNote(SRC_ROWS, null, "credentials the search returned") : null);
}
const SRC_ROWS = 50;

/** "MILANUK, MARCUS J" → "MARCUS J MILANUK". */
const flip = (v: string | null) => { const m = v?.match(/^([^,]+),\s*(.+)$/); return m ? clean(`${m[2]} ${m[1]}`) : clean(v); };

export function srcHit(r: SrcResult, matchedOn: LicenseHit["matchedOn"]): LicenseHit | null {
  const cred = r.details?.find((d) => d.label === "Credential Details")?.values ?? [];
  const contact = r.details?.find((d) => d.label === "Primary Contact Information")?.values ?? [];
  const who = flip(r.title);
  if (!who || !cred[0]) return null;
  // Credential Details: type, number, status, expiration; a pending application has no number ("Pending").
  const pending = cred[1] === "Pending";
  const cityState = clean(contact[3]);
  return {
    state: "NE", source: "Nebraska State Electrical Division licenses", sourceUrl: `${SRC_SEARCH_SITE}/search/${r.id}/detail`,
    businessName: null, licenseNumber: pending ? null : clean(cred[1]), licenseType: clean(cred[0]), specialty: null,
    status: pending ? [clean("Application pending"), clean(cred[2])].filter(Boolean).join("; ") : clean(cred[2]),
    principal: who, city: clean(cityState?.replace(/\s+\d{5}(-\d{4})?$/, "")), expires: pending ? null : usDate(cred[3]),
    matchedOn, address: joinAddr(contact[1], contact[2], cityState), people: [{ name: who, role: clean(cred[0]) }],
    holder: "individual", // electrical credentials are issued to people
  };
}

/** Address-search rows kept only when their address really is the query's (house number, street, ZIP). */
export const neAddressHits = (rows: SrcResult[], query: string): LicenseHit[] =>
  rows.filter((r) => chipped(r, "Address")).map((r) => srcHit(r, "address")).filter((h): h is LicenseHit => !!h && addressMatches(query, h.address));

const chipped = (r: SrcResult, label: string) => (r.chips?.items ?? []).some((c) => c.label === label);

const NE_ELECTRICAL: LiveLicenseSearch = {
  source: "Nebraska State Electrical Division licenses", sourceUrl: SRC_SEARCH_SITE,
  search: async (name, kind) => {
    if (kind === "company") return []; // credentials are issued to people; the search has no business-name field
    const w = name.replace(/[",]/g, " ").trim().split(/\s+/);
    if (w.length < 2) return [];
    // The search is a phrase match on "Last, First" when quoted (unquoted it matches any field).
    const rows = await srcSearch(`"${w[w.length - 1]}, ${w[0]}"`);
    return withNote(rows.filter((r) => chipped(r, "Name")).map((r) => srcHit(r, "principal")).filter((h): h is LicenseHit => !!h), noteOf(rows));
  },
  searchBy: async (q) => {
    if (q.type === "license") {
      const want = q.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const rows = await srcSearch(q.value.trim());
      return withNote(rows.filter((r) => chipped(r, "Credential Number")).map((r) => srcHit(r, "license"))
        .filter((h): h is LicenseHit => !!h && (h.licenseNumber ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") === want), noteOf(rows));
    }
    if (q.type === "address") {
      const street = q.value.split(",")[0].replace(/"/g, "").trim();
      const rows = await srcSearch(`"${street}"`);
      // The phrase search is loose: only records whose address is the one asked for are kept.
      return withNote(neAddressHits(rows, q.value), noteOf(rows));
    }
    return null;
  },
  // No business-name search: a company is "not searched", never "0 found" (round 2, decision 8).
  kinds: ["person"],
};

// ── Employee Classification Act: contractors with unpaid fines (PDF) ─────────────────────────────────────────
const ECA_PAGE = "https://dol.nebraska.gov/LaborStandards/Contractors/Overview";

const NE_ECA: BulkSource = {
  id: "ne-eca-unpaid", state: "NE", label: "Nebraska DOL contractors with unpaid Employee Classification Act fines", pageUrl: ECA_PAGE,
  everyHours: 24 * 7, minRows: 25, companiesOnly: true, category: "wage", // 36 on 2026-10-15
  load: async function* () {
    // The file's link changes when it is replaced; find it on the overview page by its label.
    const page = await politeFetch(ECA_PAGE, {}, { minDelayMs: 1500 });
    if (!page.ok) throw new Error(`Nebraska ECA page returned HTTP ${page.status}`);
    const href = (await page.text()).match(/href="([^"]+)"[^>]*>\s*Contractors with Unpaid Fines for ECA Violations/i)?.[1];
    if (!href) throw new Error("Nebraska ECA page has no unpaid-fines link");
    const path = await download(new URL(href, ECA_PAGE).toString());
    let rows;
    try { rows = pdfTable(await fs.readFile(path), ["Business Name", "Address", "City", "State", "Zip", "DBA"]); } finally { await fs.rm(path, { force: true }); }
    for (const { cells: c } of rows) {
      const listed = clean(c["business name"]), trade = clean(c.dba);
      // Companies only (FCRA): a person's own name is dropped, keeping the trade name when there is one.
      const name = listed && looksLikeBusiness(listed) ? listed : trade && trade !== listed ? trade : null;
      if (!name) continue;
      const dba = name === listed ? trade : null;
      const address = joinAddr(c.address, c.city, c.state, c.zip);
      yield {
        kind: "enforcement", business: [name, dba].filter(Boolean).join(" "), person: null, keys: { addresses: [address] },
        hit: {
          state: "NE", source: "Nebraska DOL contractors with unpaid Employee Classification Act fines", sourceUrl: ECA_PAGE, category: "wage",
          name: dba ? `${name} / ${dba}` : name, id: null, date: null, endDate: null,
          status: "Listed as having an unpaid fine for an Employee Classification Act violation", city: clean(c.city),
          detail: "The Employee Classification Act covers misclassifying construction workers as independent contractors.",
          amount: null, adverse: true, address, phone: null, licenseNumber: null,
        },
      };
    }
  },
};

export const pack: StatePack = {
  state: "NE",
  checked: "2026-10-15",
  liveLicenses: [NE_CONREG, NE_ELECTRICAL],
  bulk: [NE_ECA],
  noStatewideGcLicense:
    "Nebraska does not license general contractors statewide; contractors register with the Department of Labor (searched above), and electricians are licensed by the State Electrical Division",
  blocked: [
    "Nebraska State Electrical Division 'Licensee List Orders' (nebraska.gov/sed/lists): paid lists",
    "Nebraska Secretary of State corporation search (nebraska.gov/sos/corp/corpsearch.cgi): reCAPTCHA",
  ],
};
