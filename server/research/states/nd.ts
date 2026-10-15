/**
 * North Dakota. Every source below was opened and searched live on 2026-10-15; field names, statuses and codes are
 * the publishers' own (CLAUDE.md: never fabricate government data).
 *
 *   live  ND Secretary of State contractor licenses (FirstStop public JSON: every class A-D license, active and
 *         inactive, with its WSI (workers' comp), Job Service and business standing, address and phone).
 *   live  ND State Electrical Board: "Find a Licensed Contractor" and "Lookup a Licensed or Registered Electrician".
 *   live  ND State Plumbing Board license lookup (plumbers, sewer and water, water conditioning; the board's JSON).
 *   live  ND Secretary of State business entity status (FirstStop business search; status and standing), companies.
 *
 * North Dakota licenses general contractors statewide through the Secretary of State (the first source).
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { clean, usDate } from "../bulk";
import { politeFetch } from "../http";
import type { LiveEnforcementSearch, LiveLicenseSearch, StatePack } from "./types";
import { htmlText, isoDay } from "./lib/g6-common";

// ── ND Secretary of State FirstStop ──────────────────────────────────────────────────────────────────────────
const FS = "https://firststop.sos.nd.gov";
type FsRow = { ID: number; TITLE: string[]; RECORD_NUM: string | null; STATUS: string | null; STANDING: string | null; FILING_DATE: string | null };
type FsDetail = { DRAWER_DETAIL_LIST?: { LABEL: string; VALUE: string | null }[] };

async function fsJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await politeFetch(`${FS}${path}`, {
    method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined,
    // The site's own app sends "authorization: undefined" for anonymous calls; detail calls fail without it.
    headers: { "content-type": "application/json", accept: "application/json", authorization: "undefined", referer: `${FS}/search` },
  }, { minDelayMs: 1100 });
  if (!res.ok) throw new Error(`ND Secretary of State returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function fsSearch(kind: "contractor" | "business", value: string): Promise<FsRow[]> {
  const r = await fsJson<{ rows?: Record<string, FsRow> }>(`/api/Records/${kind}search`, { SEARCH_VALUE: value, STARTS_WITH_YN: false, ACTIVE_ONLY_YN: false });
  return Object.values(r?.rows ?? {});
}

const detailMap = (d: FsDetail): Record<string, string> =>
  Object.fromEntries((d.DRAWER_DETAIL_LIST ?? []).map((x) => [x.LABEL, clean(x.VALUE?.replace(/\s*\n\s*/g, ", ")) ?? ""]));

async function fsDetail(kind: "contractor" | "business", id: number): Promise<Record<string, string>> {
  try { return detailMap(await fsJson<FsDetail>(`/api/FilingDetail/${kind}/${id}/false`)); } catch { return {}; }
}

const fsPage = (kind: string) => `${FS}/search/${kind}`;

export function ndContractorHit(r: FsRow, d: Record<string, string>, matchedOn: LicenseHit["matchedOn"]): LicenseHit {
  const [name, cls] = r.TITLE ?? [];
  const klass = clean(cls?.split(/\s+-\s+/)[0]);
  const standing = ["Standing - WSI", "Standing - Job Service", "Standing - Business", "Standing - Other"]
    .filter((k) => d[k]).map((k) => `${k.replace("Standing - ", "")} standing ${d[k].toLowerCase()}`);
  return {
    state: "ND", source: "North Dakota Secretary of State contractor licenses", sourceUrl: fsPage("contractor"),
    businessName: clean(name), licenseNumber: clean(d["License Num"]) ?? clean(cls?.split(/\s+-\s+/)[1]),
    licenseType: klass ? `Contractor license, ${klass}` : "Contractor license", specialty: null,
    status: [clean(r.STATUS), clean(r.STANDING), ...standing].filter(Boolean).join("; ") || null, principal: null,
    city: clean(d["Mailing Address"]?.match(/(?:^|,)\s*([^,]+),\s*[A-Z]{2}\s+\d{5}/)?.[1]), expires: usDate(d["Renewal Date"]),
    matchedOn, address: clean(d["Mailing Address"]), phone: clean(d["Business Phone"]), people: [],
  };
}

async function ndContractors(value: string, matchedOn: LicenseHit["matchedOn"], keep: (r: FsRow) => boolean): Promise<LicenseHit[]> {
  const rows = (await fsSearch("contractor", value)).filter(keep).slice(0, 15);
  const out: LicenseHit[] = [];
  for (const r of rows) out.push(ndContractorHit(r, await fsDetail("contractor", r.ID), matchedOn));
  return out;
}

const words = (v: string) => v.toUpperCase().split(/[^A-Z0-9&']+/).filter((w) => w.length >= 2);
const hasAllWords = (name: string, title: string | null | undefined) => { const t = new Set(words(title ?? "")); return words(name).every((w) => t.has(w)); };

const ND_CONTRACTORS: LiveLicenseSearch = {
  source: "North Dakota Secretary of State contractor licenses", sourceUrl: fsPage("contractor"),
  search: async (name, kind) => kind === "person" ? [] : ndContractors(name.trim(), "business", (r) => hasAllWords(name, r.TITLE?.[0])),
};

const ND_SOS_STATUS: LiveEnforcementSearch = {
  source: "North Dakota Secretary of State business entity status", scope: "Every business filing, active and inactive",
  category: "business_status", search: async (name) => {
    const rows = (await fsSearch("business", name.trim())).filter((r) => hasAllWords(name, r.TITLE?.[0])).slice(0, 10);
    const out: EnforcementHit[] = [];
    for (const r of rows) {
      const d = await fsDetail("business", r.ID);
      const standing = ["Standing - AR", "Standing - RA", "Standing - Other"].filter((k) => d[k]).map((k) => `${k.replace("Standing - ", "")} standing ${d[k].toLowerCase()}`);
      out.push({
        state: "ND", source: "North Dakota Secretary of State business entity status", sourceUrl: fsPage("business"), category: "business_status",
        name: clean(r.TITLE?.[0]), id: clean(r.RECORD_NUM), date: usDate(r.FILING_DATE), endDate: usDate(d["Inactive Date"]),
        status: [clean(r.STATUS), clean(r.STANDING)].filter(Boolean).join("; ") || null, city: null,
        detail: [clean(r.TITLE?.[1]), ...standing, d["Formed In"] ? `Formed in ${d["Formed In"]}` : null, d["Registered Agent"] ? `Registered agent: ${d["Registered Agent"]}` : null].filter(Boolean).join(". ") || null,
        // Adverse only when the status itself says revoked or forfeited (the publisher's word).
        amount: null, adverse: /revok|forfeit/i.test(r.STATUS ?? "") ? true : null, address: clean(d["Principal Address"]) ?? clean(d["Mailing Address"]), phone: null, licenseNumber: null,
      });
    }
    return out;
  },
};

// ── ND State Electrical Board ────────────────────────────────────────────────────────────────────────────────
const SEB = "https://www.ndseb.com/search-1";
const SEB_CONTRACTOR = `${SEB}/find-a-licensed-contractor/`;
const SEB_ELECTRICIAN = `${SEB}/lookup-a-licensedorregistered-electrician/`;

async function sebPost(url: string, fields: Record<string, string>): Promise<string> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set("action", "Find");
  const res = await politeFetch(url, { method: "POST", body: form }, { minDelayMs: 1200 });
  if (!res.ok) throw new Error(`ND State Electrical Board returned HTTP ${res.status}`);
  const html = await res.text();
  if (!/name="searchlicenses"/.test(html)) throw new Error("ND State Electrical Board returned an unexpected page");
  return html;
}

/** Rows of the board's results table, cells as text (none: no table). */
export function sebRows(html: string): string[][] {
  const table = html.match(/<table[^>]*class="searchlicensestable"[^>]*>([\s\S]*?)<\/table>/)?.[1];
  if (!table) return [];
  return Array.from(table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)).map((r) => Array.from(r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => htmlText(c[1].replace(/<span class="hide">[\s\S]*?<\/span>/g, "")) ?? "")).filter((r) => r.length);
}

const contractorHit = (c: string[], matchedOn: LicenseHit["matchedOn"]): LicenseHit => ({
  state: "ND", source: "North Dakota State Electrical Board licensed contractors", sourceUrl: SEB_CONTRACTOR,
  businessName: clean(c[1]), licenseNumber: null, licenseType: "Electrical contractor", specialty: null,
  status: "Listed by the board's licensed-contractor search", principal: clean(c[0]), city: clean(c[2]), expires: null, matchedOn,
  people: c[0] ? [{ name: c[0], role: "Master electrician" }] : [],
});

const electricianHit = (c: string[], matchedOn: LicenseHit["matchedOn"]): LicenseHit => {
  const [type, status] = (c[2] ?? "").split(/\s+-\s+/);
  return {
    state: "ND", source: "North Dakota State Electrical Board electricians", sourceUrl: SEB_ELECTRICIAN,
    businessName: null, licenseNumber: clean(c[1]), licenseType: clean(type), specialty: null, status: clean(status) ?? null,
    principal: clean(c[0]), city: null, expires: usDate(c[3]), matchedOn, people: c[0] ? [{ name: c[0], role: clean(type) }] : [],
  };
};

const SUFFIX = /\b(INC|INCORPORATED|LLC|L L C|CO|CORP|CORPORATION|COMPANY|LTD|LC|PLLC|LLP)\b\.?/gi;
const stripSuffix = (n: string) => clean(n.replace(/[.,]/g, " ").replace(SUFFIX, " ")) ?? n;

const ND_ELECTRICAL: LiveLicenseSearch = {
  source: "North Dakota State Electrical Board", sourceUrl: SEB_ELECTRICIAN,
  search: async (name, kind) => {
    if (kind === "company") {
      // Business names match from the start.
      let rows = sebRows(await sebPost(SEB_CONTRACTOR, { LastName: "", BusinessName: stripSuffix(name), Town: "" }));
      if (!rows.length && stripSuffix(name).includes(" ") && stripSuffix(name).split(" ")[0].length >= 4) rows = sebRows(await sebPost(SEB_CONTRACTOR, { LastName: "", BusinessName: stripSuffix(name).split(" ")[0], Town: "" }));
      return rows.map((c) => contractorHit(c, "business"));
    }
    const last = name.trim().split(/\s+/).pop() ?? "";
    if (last.length < 2) return [];
    const masters = sebRows(await sebPost(SEB_CONTRACTOR, { LastName: last, BusinessName: "", Town: "" })).map((c) => contractorHit(c, "principal"));
    const people = sebRows(await sebPost(SEB_ELECTRICIAN, { LastName: last, LicenseNum: "" })).map((c) => electricianHit(c, "principal"));
    return [...people, ...masters];
  },
  searchBy: async (q) => {
    const n = q.type === "license" ? q.value.replace(/\D/g, "") : "";
    if (n.length < 4 || n.length > 5) return []; // the board's form takes the 4 or 5 digit number
    return sebRows(await sebPost(SEB_ELECTRICIAN, { LastName: "", LicenseNum: n })).map((c) => electricianHit(c, "license"))
      .filter((h) => (h.licenseNumber ?? "").replace(/\D/g, "") === n);
  },
};

// ── ND State Plumbing Board ──────────────────────────────────────────────────────────────────────────────────
const PLB_API = "https://members.ndplumbingboard.gov/api/licenses/search";
const PLB_PAGE = "https://www.ndplumbingboard.gov/licensing-license-lookup";
type PlbRow = { id: string; licenseHolderName: string | null; licenseNum: string | null; issueDate: string | null; validUntil: string | null; licenseType?: { name?: string } | null; licenseLevel?: { title?: string; name?: string } | null };

async function plbSearch(filter: string, validOnly: boolean): Promise<PlbRow[]> {
  const u = new URL(PLB_API);
  u.searchParams.set("filter", filter); u.searchParams.set("typeId", "0"); u.searchParams.set("skip", "0"); u.searchParams.set("take", "100"); u.searchParams.set("validOnly", String(validOnly));
  const res = await politeFetch(u.toString(), { headers: { accept: "application/json" } }, { minDelayMs: 1100 });
  if (!res.ok) throw new Error(`ND State Plumbing Board returned HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error("ND State Plumbing Board returned an unexpected payload");
  return rows;
}

async function plbHits(filter: string, matchedOn: LicenseHit["matchedOn"]): Promise<LicenseHit[]> {
  const all = await plbSearch(filter, false);
  if (!all.length) return [];
  // The lookup's own "valid only" filter marks which licenses the board counts as current.
  const valid = new Set((await plbSearch(filter, true)).map((r) => r.id));
  return all.map((r) => ({
    state: "ND", source: "North Dakota State Plumbing Board licenses", sourceUrl: PLB_PAGE,
    businessName: null, licenseNumber: clean(r.licenseNum), licenseType: clean(r.licenseType?.name),
    specialty: clean(r.licenseLevel?.title ?? r.licenseLevel?.name), status: valid.has(r.id) ? "Valid" : "Not valid (not in the board's current-license list)",
    principal: clean(r.licenseHolderName), city: null, expires: isoDay(r.validUntil), matchedOn,
    people: r.licenseHolderName ? [{ name: r.licenseHolderName, role: clean(r.licenseType?.name) }] : [],
  }));
}

const ND_PLUMBING: LiveLicenseSearch = {
  source: "North Dakota State Plumbing Board licenses", sourceUrl: PLB_PAGE,
  search: async (name, kind) => {
    if (kind === "company") return []; // the board licenses individuals
    // The filter matches the whole name as typed ("Alex Johnson").
    return name.trim().length < 3 ? [] : plbHits(name.trim(), "principal");
  },
  searchBy: async (q) => q.type === "license" && q.value.trim().length >= 3
    ? (await plbHits(q.value.trim(), "license")).filter((h) => (h.licenseNumber ?? "").toUpperCase() === q.value.trim().toUpperCase())
    : [],
};

export const pack: StatePack = {
  state: "ND",
  checked: "2026-10-15",
  liveLicenses: [ND_CONTRACTORS, ND_ELECTRICAL, ND_PLUMBING],
  liveEnforcement: [ND_SOS_STATUS],
  blocked: [
    "ND Secretary of State bulk lists: contractor and business lists are sold through 'Data List Requests'; only registered agents and lobbyists are free",
    "ND Secretary of State contractor search takes a name or SOS control number only, so contractor licenses can't be searched by license number",
    "ND State Electrical Board contractor search returns name, business and city only (no license number or dates)",
  ],
};
