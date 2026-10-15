/**
 * Washington, beyond the original L&I contractor-license dataset (../licenses.ts) and the AG complaints (../records.ts).
 * Every source below was opened and searched live on 2026-10-15; field names, statuses and RCW meanings are L&I's own.
 *
 *   Live license search:
 *     L&I Verify: electrician, plumber and elevator certificates (tradespeople), secure.lni.wa.gov/verify, by name
 *       (the contractor-license dataset on data.wa.gov has businesses only; tradespeople are only in Verify); and any
 *       L&I license, registration or certificate by its number (Verify's own license-number search), with the
 *       business's address, phone and owners/governing people. A tradesperson's address is never kept (a home).
 *   Live enforcement (companies only; each fact carries the business's license number, address and phone):
 *     L&I Verify business details, per matching contractor or employer:
 *       - contractor-registration, electrical and plumbing infractions/citations ("Violations"), with RCW and penalty
 *       - lawsuits against the contractor's bond or savings account filed in superior court ("Summons")
 *       - L&I tax warrants for unpaid workers' comp premiums, filed in superior court ("Warrants")
 *       - registration suspensions (bond or insurance lapses, late renewal) ("Lapses")
 *   Bulk (companies only; indexed by license number too; the lists publish no address or phone):
 *     L&I debarred contractors (not allowed to bid on public works): prevailing wage, contractor registration,
 *       electrical, plumbing, elevator and industrial-insurance law (secure.lni.wa.gov/debarandstrike), daily
 *     L&I contractor strikes (the step before debarment) under the same laws, daily
 *
 * Not used: DOSH (WISHA) safety inspections from Verify (federal OSHA data in ../records.ts covers state-plan
 * inspections); the bond-impaired flag on data.wa.gov bzff-4fmt (the same lawsuits come from Verify with amounts).
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { clean } from "../bulk";
import type { BulkHit, BulkSource } from "../bulk";
import type { LiveEnforcementSearch, LiveLicenseSearch, StatePack } from "./types";
import { adverseFrom, hasEnded } from "../adverse";
import { capNote, noteOf, withNote } from "../notes";
import { normLicense, type IdQuery } from "../identifiers";
import { anyDay, flip, money, nameMatches, postJson, usd } from "./lib/g8-common";

const VERIFY = "https://secure.lni.wa.gov/verify/";
const VERIFY_SEARCH = "https://secure.lni.wa.gov/verify/Controller.aspx/Search";
const VERIFY_DETAILS = "https://secure.lni.wa.gov/verify/Controller.aspx/GetBusinessDetails";
const DEBAR_PAGE = "https://secure.lni.wa.gov/debarandstrike/ContractorDebarList.aspx";
const STRIKE_PAGE = "https://secure.lni.wa.gov/debarandstrike/ContractorStrikeList.aspx";

type VerifyRow = {
  Ubi: string | null; LicenseId: string | null; ViolationId: string | null; BusinessName: string | null; Status: string | null;
  ContractorGroup: string | null; ContractorType: string | null; City: string | null; State: string | null;
};

/** Verify's search returns at most this many rows (one page). */
const VERIFY_PAGE = 100;

/** Verify's own search (ranked, any word); the caller keeps only rows that really name the subject. */
async function verifySearch(name: string, cat: "Name" | "LicenseId" = "Name"): Promise<VerifyRow[]> {
  const text = name.replace(cat === "Name" ? /[^A-Za-z0-9&' -]/g : /[^A-Za-z0-9*]/g, " ").replace(/\s+/g, " ").trim();
  if (text.length < 2) return [];
  const dto = { pageNumber: 0, SearchType: 2, SortColumn: "Rank", SortOrder: "desc", pageSize: VERIFY_PAGE, ContractorTypeFilter: [], SessionID: "", SAW: "", [cat]: text, searchCat: cat, searchText: text, firstSearch: 1 };
  const body = await postJson<{ d?: { SearchResult?: VerifyRow[] } }>(VERIFY_SEARCH, { dtoSrch: dto }, "L&I Verify");
  if (!Array.isArray(body.d?.SearchResult)) throw new Error("L&I Verify returned an unexpected payload");
  const rows = body.d!.SearchResult!;
  return rows.length >= VERIFY_PAGE ? withNote(rows, `Verify returned its limit of ${VERIFY_PAGE} results for this search (best-ranked first); less relevant ones are not checked`) : rows;
}

async function verifyDetails(ubi: string, license: string, violation: string): Promise<any> {
  const body = await postJson<{ d?: { IsSuccess?: boolean; ReturnValue?: any } }>(VERIFY_DETAILS, { ubi, license, irlVilationId: violation, isSecured: "" }, "L&I Verify details");
  if (!body.d?.IsSuccess || !body.d.ReturnValue?.Contractor) throw new Error("L&I Verify details returned an unexpected payload");
  return body.d.ReturnValue;
}

const detailUrl = (r: { ubi?: string | null; lic?: string | null; vio?: string | null }) =>
  r.vio ? `${VERIFY}Violation.aspx?VIO=${encodeURIComponent(r.vio)}`
    : `${VERIFY}Detail.aspx?${[r.ubi ? `UBI=${encodeURIComponent(r.ubi)}` : null, r.lic ? `LIC=${encodeURIComponent(r.lic)}` : null].filter(Boolean).join("&")}`;

const MAX_DETAILS = 10;

// ── Tradesperson certificates (people), and any L&I license by its number ────────────────────────────────────
/** The street address a Verify record publishes (tradespeople have city/state/ZIP only). */
const verifyAddress = (c: any) => [clean(c.Address1), clean(c.Address2), clean(c.City), clean(c.State), clean(c.Zip)].filter(Boolean).join(" ") || null;
const verifyPhone = (c: any) => clean(c.PhoneNumber);

/** One Verify license record as a report hit; owners and governing people come from the record itself. */
export function verifyLicenseHit(details: any, row: VerifyRow | null, matchedOn: LicenseHit["matchedOn"]): LicenseHit {
  const c = details.Contractor ?? {};
  const isTrades = !clean(c.UbiNumber);
  const people = new Map<string, string | null>();
  for (const o of c.BusinesOwners ?? []) { const n = flip(clean(o.Name)); if (n) people.set(n, clean(o.RoleDescription)); }
  for (const g of details.Employer?.EmployerGoverningPerson ?? []) {
    const n = clean(`${g.FirstName ?? ""} ${g.LastName ?? ""}`);
    if (n && !Array.from(people.keys()).some((k) => nameMatches(n, k))) people.set(n, "Governing person (workers' comp account)");
  }
  const name = clean(c.BusinessName) ?? row?.BusinessName ?? null;
  return {
    state: "WA", source: isTrades ? "Washington L&I tradesperson certificates (Verify)" : "Washington L&I licenses (Verify)",
    sourceUrl: detailUrl({ ubi: clean(c.UbiNumber), lic: clean(c.LicenseNumber) ?? row?.LicenseId }),
    businessName: isTrades ? null : name, licenseNumber: clean(c.LicenseNumber) ?? row?.LicenseId ?? null,
    licenseType: clean(c.LicenseType) ?? clean(row?.ContractorType),
    specialty: [c.SpecialtyName1, c.SpecialtyName2].map((v: unknown) => clean(v as string)).filter((v) => v && v !== "UNUSED").join(", ") || null,
    status: clean(c.StatusDescription) ?? clean(row?.Status), principal: isTrades ? flip(name) : (people.size ? Array.from(people.keys())[0] : null),
    city: [clean(c.City) ?? clean(row?.City), clean(c.State) ?? clean(row?.State)].filter(Boolean).join(", ") || null,
    expires: anyDay(c.ExpirationDate), matchedOn,
    // A tradesperson's address is a home address: only a business's address is kept.
    address: isTrades ? null : verifyAddress(c), phone: isTrades ? null : verifyPhone(c),
    people: Array.from(people, ([n, role]) => ({ name: n, role })),
  };
}

async function searchTradespeople(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  if (kind !== "person") return []; // businesses: the data.wa.gov contractor dataset (../licenses.ts)
  const all = await verifySearch(name);
  const rows = all.filter((r) => !r.Ubi && r.LicenseId && nameMatches(name, r.BusinessName, flip(r.BusinessName)));
  const hits: LicenseHit[] = [];
  // The search row's status is often just "View Details"; the detail record has the certificate's own status and dates.
  for (const r of rows.slice(0, MAX_TRADES)) hits.push(verifyLicenseHit(await verifyDetails("", r.LicenseId!, ""), r, "principal"));
  return withNote(withNote(hits, noteOf(all)), rows.length > MAX_TRADES ? capNote(MAX_TRADES, rows.length, "certificates") : null);
}

/** Detail records read per search (each is one more request to L&I). */
const MAX_TRADES = 15, MAX_BY_LICENSE = 5;

/** Verify searches license, registration and certificate numbers itself (its "LicenseId" search). */
async function searchByLicense(q: IdQuery): Promise<LicenseHit[] | null> {
  if (q.type !== "license") return null; // Verify has no phone or street-address search
  const want = normLicense(q.value);
  if (!want) return null;
  const rows = (await verifySearch(q.value.trim(), "LicenseId")).filter((r) => r.LicenseId && normLicense(r.LicenseId) === want);
  const hits: LicenseHit[] = [];
  for (const r of rows.slice(0, MAX_BY_LICENSE)) hits.push(verifyLicenseHit(await verifyDetails(r.Ubi ?? "", r.LicenseId!, ""), r, "license"));
  return withNote(hits, rows.length > MAX_BY_LICENSE ? capNote(MAX_BY_LICENSE, rows.length, "records") : null);
}

// ── Verify enforcement facts (companies) ─────────────────────────────────────────────────────────────────────
const SRC_INFRACTIONS = "Washington L&I contractor, electrical and plumbing infractions";
const SRC_BOND_SUITS = "Washington superior-court lawsuits against contractor bonds (L&I)";
const SRC_WARRANTS = "Washington L&I tax warrants (unpaid workers' comp premiums)";
const SRC_LAPSES = "Washington L&I contractor registration suspensions";

export function verifyEnforcement(details: any, businessName: string, url: string): EnforcementHit[] {
  const c = details.Contractor ?? {};
  const name = clean(c.BusinessName) ?? businessName;
  const city = [clean(c.City), clean(c.State)].filter(Boolean).join(", ") || null;
  const base = { state: "WA", sourceUrl: url, name, address: verifyAddress(c), phone: verifyPhone(c), licenseNumber: clean(c.LicenseNumber) };
  const out: EnforcementHit[] = [];
  for (const v of c.Violations ?? []) {
    const status = clean(v.StatusDescription);
    const due = money(v.ViolationAmountDue);
    out.push({
      ...base, source: SRC_INFRACTIONS, category: "discipline", id: clean(v.InfractionId), date: anyDay(v.IssueDate), endDate: null,
      status: status ? `Infraction: ${status}` : "Infraction issued", city: clean(v.CityName) ?? city,
      detail: [clean(v.ItemTypeDescription), clean(v.Description), clean(v.RcwCode), money(v.ViolationAmount) ? `penalty ${usd(money(v.ViolationAmount))}` : null,
        due ? `${usd(due)} due` : null].filter(Boolean).join(". ").slice(0, 800) || null,
      // From the infraction's own status: dismissed/vacated → false; "Satisfied"/"Not Satisfied"/paid/final → true; no
      // status, or one still open to appeal → null (audit 2026-10-15, decision 2).
      amount: money(v.ViolationAmount), adverse: adverseFrom(status, { adverse: /satisf|paid|final|upheld|affirm|due|collect/i }),
    });
  }
  for (const s of c.Summons ?? []) {
    const status = clean(s.ComplaintStatus);
    const judgment = money(s.JudgmentAmount), paid = money(s.PaymentAmt);
    out.push({
      ...base, source: SRC_BOND_SUITS, category: "court_case", id: clean(s.CauseNumber), date: anyDay(s.ComplaintDate),
      endDate: anyDay(s.JudgmentDate) ?? anyDay(s.DismissalDate), status: status ? `Lawsuit against the ${clean(s.LienTableName) ?? "bond"}: ${status}` : "Lawsuit against the bond",
      city: clean(s.CountyName) ? `${clean(s.CountyName)} County Superior Court` : city,
      detail: [money(s.ComplaintAmt) ? `Claimed ${usd(money(s.ComplaintAmt))}` : null, judgment ? `judgment ${usd(judgment)}` : null,
        paid ? `paid ${usd(paid)}${clean(s.PaidBy) ? ` by ${clean(s.PaidBy)}` : ""}${anyDay(s.PaymentDate) ? ` on ${anyDay(s.PaymentDate)}` : ""}` : null,
        anyDay(s.DismissalDate) ? `dismissed ${anyDay(s.DismissalDate)}` : null].filter(Boolean).join(", ") || null,
      amount: money(s.ComplaintAmt), adverse: judgment || paid ? true : anyDay(s.DismissalDate) ? false : null,
    });
  }
  for (const w of c.Warrants ?? []) {
    const status = clean(w.StatusDescription);
    out.push({
      ...base, source: SRC_WARRANTS, category: "tax_lien", id: clean(w.TaxWarrantNumber) ?? clean(w.CauseNumber), date: anyDay(w.ComplaintDate) ?? anyDay(w.JudgmentDate),
      endDate: anyDay(w.PaymentDate) ?? anyDay(w.DismissalDate), status: status ? `Tax warrant: ${status}` : "Tax warrant filed",
      city: clean(w.CountyName) ? `${clean(w.CountyName)} County` : city,
      detail: [`State tax warrant filed by ${clean(w.PlaintiffName) ?? "L&I"}`, clean(w.CauseNumber) ? `superior court cause ${clean(w.CauseNumber)}` : null,
        money(w.ComplaintAmount) ? `amount ${usd(money(w.ComplaintAmount))}` : null, money(w.PaymentAmount) ? `paid ${usd(money(w.PaymentAmount))}` : null].filter(Boolean).join(", "),
      // A tax warrant filed in superior court is adverse unless its status says it was dismissed or withdrawn.
      amount: money(w.ComplaintAmount), adverse: adverseFrom(status) === false ? false : true,
    });
  }
  for (const l of c.Lapses ?? []) {
    const why = clean(l.LapseDesccription);
    const back = anyDay(l.ReInstatementDate);
    out.push({
      ...base, source: SRC_LAPSES, category: "business_status", id: clean(c.LicenseNumber), date: anyDay(l.LapseDate), endDate: back,
      status: `Registration suspended${why ? `: ${why}` : ""}${back ? `, reinstated ${back}` : ""}`, city, detail: clean(c.LicenseType), amount: null, adverse: null,
    });
  }
  return out;
}

async function searchVerifyEnforcement(name: string): Promise<EnforcementHit[]> {
  const seen = new Set<string>();
  const targets: { ubi: string; lic: string; vio: string; name: string }[] = [];
  const found = await verifySearch(name);
  for (const r of found) {
    if (!r.Ubi && !r.ViolationId) continue; // tradespeople: not a company
    if (!nameMatches(name, r.BusinessName)) continue;
    const key = r.ViolationId ? `V${r.ViolationId}` : `${r.Ubi}|${r.LicenseId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ ubi: r.ViolationId ? "" : r.Ubi ?? "", lic: r.ViolationId ? "" : r.LicenseId ?? "", vio: r.ViolationId ?? "", name: r.BusinessName ?? name });
  }
  const out: EnforcementHit[] = [];
  for (const t of targets.slice(0, MAX_DETAILS)) {
    const details = await verifyDetails(t.ubi, t.lic, t.vio);
    out.push(...verifyEnforcement(details, t.name, detailUrl({ ubi: t.ubi, lic: t.lic, vio: t.vio })));
  }
  // The same lawsuit or warrant shows on every license of one UBI: keep one of each.
  const keys = new Set<string>();
  const hits = out.filter((h) => { const k = `${h.source}|${h.id}|${h.date}|${h.status}`; if (keys.has(k)) return false; keys.add(k); return true; });
  return withNote(withNote(hits, noteOf(found)), targets.length > MAX_DETAILS ? capNote(MAX_DETAILS, targets.length, "matching licenses and violations (their records were read)") : null);
}

const verifyLicenses: LiveLicenseSearch = { source: "Washington L&I tradesperson certificates (Verify)", sourceUrl: VERIFY, search: searchTradespeople, searchBy: searchByLicense };

const verifyEnforcementSearches: LiveEnforcementSearch[] = [{
  source: "Washington L&I Verify (infractions, bond lawsuits, tax warrants, suspensions)",
  scope: "Contractor-registration, electrical and plumbing infractions; superior-court lawsuits against contractor bonds; L&I tax warrants; registration suspensions",
  search: searchVerifyEnforcement,
}];

// ── Debarred contractors and strikes (bulk) ──────────────────────────────────────────────────────────────────
/** L&I's own RCW descriptions from the lists' filter (ContractorDebarList.aspx/GetRCW, 2026-10-15). */
const RCW: Record<string, string> = {
  "18.106.400": "Plumbing work without a plumbing contractor license",
  "18.27.200": "Not registering, or falsely registering, as a contractor",
  "19.28.041": "Electrical work without a valid electrical contractor license",
  "19.28.420": "Telecommunications work without a valid telecommunications contractor license",
  "39.12": "Prevailing wage law (code missing from the available documentation)",
  "39.12.050": "Failure to file, or false filing of, prevailing wage forms",
  "39.12.065": "Failure to pay the prevailing rate of pay",
  "49.04": "Apprenticeship violations found by the Washington State Apprenticeship and Training Council",
  "49.105.040": "Fire-resistant material applied by an uncertified applicator",
  "51.48.020(1)": "Misreporting industrial insurance hours or premiums",
  "51.48.103": "Failure to obtain a certificate of industrial insurance coverage",
  "70.87.240": "Elevator contractor violation",
};
const rcwText = (code: string | null) => (code ? `RCW ${code}${RCW[code] ? `: ${RCW[code]}` : ""}` : null);

type PageResult = { iTotalDisplayRecords?: number; aaData?: Record<string, string>[]; IsSuccess?: boolean };

/**
 * Every row of one of the two L&I list tables. Pages are 1-based; 250 rows a page (the server takes about 7 s a page
 * whatever its size, and refuses 500).
 */
const PAGE = 250;
async function* lniList(url: string, extra: Record<string, string>): AsyncIterable<Record<string, string>> {
  for (let page = 1, total = Infinity; (page - 1) * PAGE < total; page++) {
    const body = await postJson<{ d?: string }>(url, {
      Echo: page, PageNumber: page, RowspPage: PAGE, OrderByColumn: "co_name", OrderType: "asc",
      co_name: "", ubi_num: "", license_id: "", principals: "", rcw_code: "", ...extra,
    }, "L&I list", 2000);
    const d: PageResult = JSON.parse(body.d ?? "{}");
    if (d.IsSuccess === false || !Array.isArray(d.aaData)) throw new Error("L&I list returned an unexpected payload");
    total = Number(d.iTotalDisplayRecords ?? 0);
    if (!d.aaData.length) break;
    yield* d.aaData;
  }
}

/** Enforcement rows carry the license number the list names (the lists publish no address or phone). */
const enf = (h: EnforcementHit, business: string, license: string | null): BulkHit =>
  ({ kind: "enforcement", hit: { ...h, licenseNumber: license }, business, person: null, keys: { licenses: [license] } });

/** A listed debarment is adverse while it runs: past its end date it has ended, unless the status says it lasts "until" something. */
export function debarAdverse(status: string | null, ends: string | null, today = new Date().toISOString().slice(0, 10)): boolean {
  if (adverseFrom(status) === false) return false;
  return !(hasEnded(ends, today) && !/until|permanent/i.test(status ?? ""));
}

async function* debarredLoader(): AsyncIterable<BulkHit> {
  const today = new Date().toISOString().slice(0, 10);
  for await (const r of lniList(`${DEBAR_PAGE}/GetDebarList`, { status_code: "", debar_begin_date: "", debar_end_date: "", penalty_due_flg: "", wage_due_flg: "" })) {
    const name = clean(r.co_name);
    if (!name) continue;
    const related = clean(r.related_business);
    const ends = anyDay(r.debar_end_date);
    const owed = [r.penalty_due_flg === "Yes" ? "penalties due" : null, r.wage_due_flg === "Yes" ? "wages due" : null].filter(Boolean).join(" and ");
    yield enf({
      state: "WA", source: "Washington L&I debarred contractors (public works)", sourceUrl: DEBAR_PAGE, category: "debarment",
      name: related ? `${name} / ${related}` : name, id: clean(r.license_id) ?? clean(r.ubi_num), date: anyDay(r.debar_begin_date), endDate: ends,
      // L&I's own status when the row has one; otherwise from the row's own end date (not inferred from anything else).
      status: clean(r.status_desc) ?? (hasEnded(ends, today) ? "Debarment period over" : "Debarred"), city: null,
      detail: [rcwText(clean(r.rcw_code)), owed ? `L&I lists ${owed}` : null, clean(r.ubi_num) ? `UBI ${clean(r.ubi_num)}` : null].filter(Boolean).join(". ") || null,
      // A debarment whose period is over is not adverse today (audit 2026-10-15, decision 2), unless L&I's own status
      // keeps it running past the end date ("Debarred Until Penalties Paid", "Permanent Debarment").
      amount: null, adverse: debarAdverse(clean(r.status_desc), ends, today),
    }, [name, related].filter(Boolean).join(" "), clean(r.license_id));
  }
}

async function* strikesLoader(): AsyncIterable<BulkHit> {
  for await (const r of lniList(`${STRIKE_PAGE}/GetStrikeList`, { effective_date_start: "", effective_date_end: "" })) {
    const name = clean(r.co_name);
    if (!name) continue;
    const related = clean(r.related_business);
    const code = clean(r.rcw_code);
    yield enf({
      state: "WA", source: "Washington L&I contractor strikes", sourceUrl: STRIKE_PAGE,
      category: code && /^(39\.12|49\.04)/.test(code) ? "wage" : "discipline",
      name: related ? `${name} / ${related}` : name, id: clean(r.license_id) ?? clean(r.ubi_num), date: anyDay(r.effective_date), endDate: null,
      status: "Strike issued (two or more strikes in five years may lead to debarment)", city: null,
      detail: [rcwText(code), clean(r.ubi_num) ? `UBI ${clean(r.ubi_num)}` : null].filter(Boolean).join(". ") || null,
      amount: null, adverse: true,
    }, [name, related].filter(Boolean).join(" "), clean(r.license_id));
  }
}

const bulk: BulkSource[] = [
  { id: "wa-lni-debarred", state: "WA", label: "Washington L&I debarred contractors (public works)", pageUrl: DEBAR_PAGE, everyHours: 24, minRows: 450,
    load: debarredLoader, companiesOnly: true },
  { id: "wa-lni-strikes", state: "WA", label: "Washington L&I contractor strikes", pageUrl: STRIKE_PAGE, everyHours: 24, minRows: 13_500,
    load: strikesLoader, companiesOnly: true },
];

export const pack: StatePack = {
  state: "WA",
  checked: "2026-10-15",
  liveLicenses: [verifyLicenses],
  liveEnforcement: verifyEnforcementSearches,
  bulk,
  blocked: [
    "L&I Verify 'Download all debarment data' (DownloadData.aspx) answers HTTP 500 to a plain request; the same list is read page by page from the list's own JSON endpoint instead",
  ],
};
