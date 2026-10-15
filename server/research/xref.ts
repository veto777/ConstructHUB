/**
 * Search by anything, and cross-reference (owner order 2026-10-15: "a huge selling point for buyers").
 *
 *   1. Identifier search: every license source in the order's states is searched by each license number, phone and
 *      street address the customer gave (Socrata datasets through searchLicensesBy, bulk files through searchBulkBy,
 *      state lookups through searchBy). Those records are the subject's own, found by the identifier.
 *   2. Cross-reference, one hop: from the subject's own licenses we collect the license numbers, phones, addresses,
 *      business names and people, search again by those, and keep the new records as *related*, each with the tie
 *      that links it (relatedVia), e.g. "same phone as license CGC1512345". A related record is never presented as
 *      the subject's own.
 *        - a person: the businesses on their licenses, and those businesses' other licenses;
 *        - a company: the people on its licenses, and the other businesses they hold licenses for.
 *   3. State enforcement for the related businesses (up to 5, strongest ties first), each hit marked with its tie.
 *      For a company subject only: a person never gets enforcement records, not even through a related business
 *      (FCRA; audit 2026-10-15, decision 1).
 *
 * A license found only by an identifier the customer gave (its name doesn't match the subject) is not the
 * subject's own: it is listed as related, "matched by the phone you gave", and the common-tie limit applies to it.
 * A source that could not search an identifier (a file not loaded yet, a lookup that can't search by it) is
 * reported as not searched, never as "searched, 0 found".
 *
 * Every search goes through a LicenseFinder, so the logic here runs against fakes in tests (xref.test.ts) and against
 * the registry's real sources in the runner. Work is capped per subject; whatever a cap leaves out is said in the notes.
 */
import type { EnforcementHit, LicenseHit, RecordSource, RelatedTie, ResearchSubjectInput } from "@shared/research-reports";
import { RELATED_TIES } from "@shared/research-reports";
import { addressMatch, describeId, normLicense, normPhone, parseAddress, streetKey, type IdQuery } from "./identifiers";
import { companyNamed, nameWords, personMatches, tokens, wholeWordMatch } from "./licenses";

/** Identifier searches per subject: the customer's own and the cross-reference hop together. */
export const MAX_ID_SEARCHES = 25;
/** Name searches in the hop (people on a company's licenses, businesses on a person's). */
export const MAX_NAME_HOPS = 8;
/** Related businesses whose state enforcement records are searched. */
export const MAX_RELATED_BUSINESSES = 5;
/**
 * A tie shared by more businesses than this is not a tie: a shared office building, an answering service, a
 * franchise phone line or a common name. Its results are left out and the notes say so.
 */
export const MAX_BUSINESSES_PER_TIE = 12;

/**
 * What one finder found for one identifier. `searched: false` means it could not search it (a file not loaded yet, a
 * lookup that can't search by that kind of identifier): reported as "not searched" with `note`, never as 0 found.
 */
export type FinderResult = { licenses: LicenseHit[]; enforcement: EnforcementHit[]; searched?: boolean; note?: string };

/** One searchable source in one state. */
export type LicenseFinder = {
  state: string;
  label: string;
  /** An enforcement file (companies only): searched by identifier for a company subject, never for a person. */
  companiesOnly?: boolean;
  /** Hits must already be whole-word matches of the name (`searched: false` when the source wasn't available). */
  byName?: (name: string, kind: "person" | "company") => Promise<{ hits: LicenseHit[]; searched: boolean; note: string; capped?: string | null }>;
  /** `searched: false` (with a note) when it could not search that identifier. */
  byId?: (q: IdQuery) => Promise<FinderResult>;
};

/** Searches state enforcement records for one business (records.ts searchEnforcement in the runner). */
export type EnforcementSearch = (name: string) => Promise<{ hits: EnforcementHit[]; sources: RecordSource[] }>;

// ── Matching ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The name is ONE person on the record, a middle initial agreeing when both give one (the bulk index can match words from two people). */
export function personNamed(name: string, hit: Pick<LicenseHit, "principal" | "people">): boolean {
  return [hit.principal, ...(hit.people ?? []).map((p) => p.name)].some((v) => personMatches(name, v));
}

/**
 * The person check for the cross-reference hop, where a name is all that links two licenses: a middle initial on
 * both names must agree ("Douglas W Smith" is not "Douglas C Smith" or "Douglas Lyle Smith"; plain "Douglas Smith"
 * is still a candidate). The report says that a link by name alone may be a different person.
 */
export const samePerson = personNamed;

const SUFFIXES = new Set(["INC", "INCORPORATED", "LLC", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED", "LP", "LLP", "PLLC", "PA", "PC", "THE"]);
/** A business name without punctuation, corporate suffixes or a trailing "DBA …": "D & S Electric, Inc." → "D S ELECTRIC". */
export function businessCore(name: string): string {
  const first = name.toUpperCase().replace(/^\s*(D\/?B\/?A:?|DOING BUSINESS AS)\s+/, "").split(/\b(?:D\/B\/A|DBA|DOING BUSINESS AS)\b/)[0];
  return first.replace(/L\.L\.C\./g, "LLC").replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter((w) => w && !SUFFIXES.has(w)).join(" ");
}
/**
 * The record names exactly this business (any of its " / "-separated names, suffixes aside). Enforcement records of a
 * related business are kept only on this match: a word match would tie "D & S Electric Inc" to every "… Electric Inc".
 */
export function businessNamed(business: string, recordName: string | null | undefined): boolean {
  const want = businessCore(business);
  if (!want) return false;
  return (recordName ?? "").split(/\s+\/\s+/).some((part) => businessCore(part) === want);
}

/** The re-check every name hit gets: the business name for a company, one named person for a person. */
export function nameMatches(name: string, kind: "person" | "company", hit: LicenseHit): boolean {
  return kind === "company" ? companyNamed(name, hit.businessName) : personNamed(name, hit);
}

// ── Dedupe ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One license: state, source (the issuing board), credential type and license number, so two boards' license 12345
 * never merge. A record without a number falls back to its full names (initials kept: "John A Smith" is not "John
 * B Smith"), city and street (audit 2026-10-15, decision 6; round 2, decision 7).
 */
export function licenseKey(h: LicenseHit): string {
  const n = normLicense(h.licenseNumber);
  const base = `${h.state}|${h.source}|${(h.licenseType ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()}`;
  return n ? `${base}|${n}` : `${base}||${nameWords(h.businessName ?? "").join(" ")}|${nameWords(h.principal ?? "").join(" ")}|${(h.city ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()}|${streetKey(h.address) ?? ""}`;
}

const nameWordsOf = (h: LicenseHit) => new Set([...businessCore(h.businessName ?? "").split(" "), ...tokens(h.principal ?? ""), ...(h.people ?? []).flatMap((p) => tokens(p.name))].filter(Boolean));
/** Two records with one key are one license unless their names (corporate suffixes aside) have nothing in common. */
function sameLicense(a: LicenseHit, b: LicenseHit): boolean {
  if (licenseKey(a) !== licenseKey(b)) return false;
  const wa = nameWordsOf(a), wb = nameWordsOf(b);
  if (!wa.size || !wb.size) return true;
  return Array.from(wa).some((w) => wb.has(w));
}

/** Fill what one copy lacks from the other (address, phone, people), keeping the first copy's source and match; everyone named on either copy is kept. */
function merge(into: LicenseHit, other: LicenseHit): void {
  into.address ??= other.address;
  into.phone ??= other.phone;
  into.city ??= other.city;
  into.expires ??= other.expires;
  // One person: the exact full name (normalized: case, punctuation, word order; initials kept) in the same role
  // (round 2, decision 7). A name without a role (a principal field) joins whoever has that exact name.
  const full = (n: string) => nameWords(n).sort().join(" ");
  const names = new Set<string>(), roles = new Set<string>();
  const note = (n: string, role: string | null) => { names.add(full(n)); if (role != null) roles.add(`${full(n)}|${role.toLowerCase()}`); };
  if (into.principal) note(into.principal, null);
  for (const p of into.people ?? []) note(p.name, p.role);
  const candidates = [...(other.people ?? []), ...(other.principal ? [{ name: other.principal, role: null }] : [])];
  const add = candidates.filter((p) => {
    const k = full(p.name);
    if (!k || (p.role == null ? names.has(k) : roles.has(`${k}|${p.role.toLowerCase()}`))) return false;
    note(p.name, p.role);
    return true;
  });
  if (add.length) into.people = [...(into.people ?? []), ...add];
  if (into.principal == null && other.principal) into.principal = other.principal;
  if (into.businessName == null && other.businessName) into.businessName = other.businessName;
}

/** A license list that drops copies of the same license from different sources (and the same source twice). */
export class LicenseSet {
  private byKey = new Map<string, LicenseHit[]>();
  readonly list: LicenseHit[] = [];
  /** The matching record already in the set, if any. */
  find(h: LicenseHit): LicenseHit | undefined { return this.byKey.get(licenseKey(h))?.find((x) => sameLicense(x, h)); }
  /** Adds the record, or merges it into its copy; true when it was new. */
  add(h: LicenseHit): boolean {
    const dup = this.find(h);
    if (dup) { merge(dup, h); return false; }
    const k = licenseKey(h);
    this.byKey.set(k, [...(this.byKey.get(k) ?? []), h]);
    this.list.push(h);
    return true;
  }
}

/** Enforcement records are one record when source, id and name agree. */
export const enforcementKey = (h: EnforcementHit) => `${h.state}|${h.source}|${h.id ?? ""}|${tokens(h.name ?? "").join(" ")}|${h.date ?? ""}`;

// ── Identifier search ──────────────────────────────────────────────────────────────────────────────────────────

/** The identifiers a subject carries, as queries (already normalized by the order schema). */
export function subjectIds(s: Pick<ResearchSubjectInput, "licenseNumbers" | "phones" | "addresses">): IdQuery[] {
  return [
    ...(s.licenseNumbers ?? []).map((value) => ({ type: "license" as const, value })),
    ...(s.phones ?? []).map((value) => ({ type: "phone" as const, value })),
    ...(s.addresses ?? []).map((value) => ({ type: "address" as const, value })),
  ];
}

/** The key that says two queries are the same search. */
export function idKey(q: IdQuery): string | null {
  if (q.type === "license") { const n = normLicense(q.value); return n ? `l:${n}` : null; }
  if (q.type === "phone") { const n = normPhone(q.value); return n ? `t:${n}` : null; }
  const p = parseAddress(q.value);
  return p ? `a:${streetKey(q.value)}|${p.city ?? ""}|${p.zip ?? ""}` : null;
}

/**
 * One identifier across every finder. A finder that fails, or can't search it, is noted ("failed", "skipped"),
 * never counted as "nothing found"; a search that stopped at a cap says so ("capped").
 */
export async function searchById(finders: LicenseFinder[], q: IdQuery, kind: "person" | "company"): Promise<{ licenses: LicenseHit[]; enforcement: EnforcementHit[]; searched: number; failed: string[]; skipped: string[]; capped: string[] }> {
  const licenses: LicenseHit[] = [], enforcement: EnforcementHit[] = [], failed: string[] = [], skipped: string[] = [], capped: string[] = [];
  let searched = 0;
  for (const f of finders) {
    if (f.companiesOnly && kind === "person") continue;
    // A source with no identifier search at all is listed as not searched (round 2, decision 8).
    if (!f.byId) { skipped.push(`${f.label} (can't search by ${q.type === "license" ? "license number" : q.type})`); continue; }
    try {
      const r = await f.byId(q);
      if (r.searched === false) { skipped.push(`${f.label}${r.note ? ` (${r.note})` : ""}`); continue; }
      searched++;
      if (r.note) capped.push(`${f.label}: ${r.note}`);
      licenses.push(...r.licenses.map((h) => ({ ...h, matchedOn: q.type })));
      enforcement.push(...r.enforcement);
    } catch (err: any) {
      failed.push(`${f.label}: ${String(err?.message ?? err).slice(0, 120)}`);
    }
  }
  return { licenses, enforcement, searched, failed, skipped, capped };
}

/** How a report says what an identifier search covered: "4 source(s) searched; not searched: …; could not search …". */
function coverageNote(r: { searched: number; failed: string[]; skipped: string[]; capped: string[] }): string {
  return [`${r.searched} source(s) searched`, ...r.capped, ...(r.skipped.length ? [`not searched: ${r.skipped.join(", ")}`] : []), ...r.failed.map((f) => `could not search ${f}`)].join("; ");
}

/** How many different businesses a set of records names (a tie that many share is no tie). */
const spreadOf = (licenses: LicenseHit[], enforcement: EnforcementHit[] = []) =>
  new Set([...licenses.map((h) => bizKey(h.businessName ?? h.principal ?? "")), ...enforcement.map((e) => bizKey(e.name ?? ""))].filter(Boolean)).size;

export type CustomerIdResult = {
  /** Records found by an identifier that also name the subject: the subject's own. */
  licenses: LicenseHit[];
  /** Records found only by the identifier (another name on them): related, "matched by the phone you gave". */
  matched: LicenseHit[];
  enforcement: EnforcementHit[];
  searches: { query: string; found: number; note: string; sourcesSearched?: number }[]; searchedIds: Set<string>; used: number; notes: string[];
};

/**
 * The identifiers the customer gave, each searched in every finder. A license that names the subject is the
 * subject's own (matchedOn says which identifier found it); one that names someone else is listed as matched by
 * the identifier, not as the subject's. Enforcement records found this way are kept for a company only, and carry
 * the identifier as their tie, since the customer, not the record, links them to the name. An identifier shared by
 * more than MAX_BUSINESSES_PER_TIE businesses ties none of them: those records are left out and the notes say so.
 */
export async function searchCustomerIds(finders: LicenseFinder[], ids: IdQuery[], subject: { name: string; kind: "person" | "company" }): Promise<CustomerIdResult> {
  const { kind } = subject;
  const out: CustomerIdResult = { licenses: [], matched: [], enforcement: [], searches: [], searchedIds: new Set(), used: 0, notes: [] };
  for (const q of ids) {
    const key = idKey(q);
    if (!key || out.searchedIds.has(key)) continue;
    if (out.used >= MAX_ID_SEARCHES) { out.notes.push(`${describeId(q)} was not searched (limit of ${MAX_ID_SEARCHES} identifier searches per name).`); continue; }
    out.searchedIds.add(key);
    out.used++;
    const r = await searchById(finders, q, kind);
    const named = r.licenses.filter((h) => nameMatches(subject.name, kind, h));
    const others = r.licenses.filter((h) => !nameMatches(subject.name, kind, h));
    const enforcement = kind === "company" ? r.enforcement : [];
    const via = `matched by the ${q.type === "license" ? "license number" : q.type} you gave (${q.value})`;
    const viaFor = (addr: string | null | undefined) => q.type === "address" && addressMatch(q.value, addr) !== "confirmed" ? `possible match (address): ${via}` : via;
    out.licenses.push(...named);
    const spread = spreadOf(others, enforcement);
    if (spread > MAX_BUSINESSES_PER_TIE) {
      out.notes.push(`${describeId(q)} is shared by ${spread} businesses, so it doesn't tie any one of them to this name; their records are left out.`);
    } else {
      out.matched.push(...others.map((h) => ({ ...h, relatedTie: q.type, relatedVia: viaFor(h.address), byYourIdentifier: true })));
      out.enforcement.push(...enforcement.map((e) => ({ ...e, relatedTie: q.type, relatedVia: viaFor(e.address), byYourIdentifier: true })));
    }
    if (kind === "person" && r.enforcement.length) out.notes.push(`${r.enforcement.length} enforcement record(s) carrying ${describeId(q)} are not shown: enforcement records are searched for companies only.`);
    out.searches.push({
      query: describeId(q),
      found: named.length + (spread > MAX_BUSINESSES_PER_TIE ? 0 : others.length + enforcement.length),
      note: coverageNote(r),
      // 0 sources searched: the report says "Not searched", never "0 found" (round 2, decision 8).
      sourcesSearched: r.searched,
    });
  }
  return out;
}

// ── Cross-reference ────────────────────────────────────────────────────────────────────────────────────────────

/** How a report names the record a tie starts from. */
export function licenseRef(h: LicenseHit): string {
  return h.licenseNumber ? `license ${h.licenseNumber}` : `the ${h.source} record for ${h.businessName ?? h.principal ?? "this name"}`;
}

const STRENGTH: Record<RelatedTie, number> = Object.fromEntries(RELATED_TIES.map((t, i) => [t, RELATED_TIES.length - i])) as Record<RelatedTie, number>;
const bizKey = (name: string) => businessCore(name) || name.toUpperCase().replace(/[^A-Z0-9&]+/g, " ").trim();
const distinctBusinesses = (hits: LicenseHit[]) => new Set(hits.map((h) => bizKey(h.businessName ?? h.principal ?? "")).filter(Boolean)).size;

export type XrefInput = {
  subject: { name: string; kind: "person" | "company" };
  /** The subject's own records (by name and by the customer's identifiers), deduped. */
  own: LicenseSet;
  finders: LicenseFinder[];
  /** Identifier keys already searched (the customer's), and how many searches the subject has used. */
  searchedIds: Set<string>;
  idSearchesUsed: number;
  /** The subject's own enforcement records, so the pass doesn't list them again as related. */
  ownEnforcement?: EnforcementHit[];
  enforcementSearch: EnforcementSearch;
  log?: (m: string) => void;
};

export type XrefResult = { related: LicenseHit[]; relatedEnforcement: EnforcementHit[]; notes: string[]; idSearches: number };

type Candidate = { q: IdQuery; key: string; from: LicenseHit };

/** The one-hop cross-reference pass for one subject. */
export async function crossReference(x: XrefInput): Promise<XrefResult> {
  const log = x.log ?? (() => undefined);
  const { subject, own, finders } = x;
  const notes: string[] = [];
  const related = new LicenseSet();
  const enforcementSeen = new Set<string>((x.ownEnforcement ?? []).map(enforcementKey));
  const relatedEnforcement: EnforcementHit[] = [];
  let idSearches = x.idSearchesUsed;
  const ownList = [...own.list];

  /** A record joins the related list unless it is one of the subject's own. */
  const addRelated = (h: LicenseHit, tie: RelatedTie, via: string) => {
    if (own.find(h)) return;
    const dup = related.find(h);
    if (dup) {
      // Keep the strongest tie; a second tie is worth saying.
      if (STRENGTH[tie] > STRENGTH[dup.relatedTie ?? "address"]) { dup.relatedTie = tie; dup.relatedVia = `${via}; ${dup.relatedVia}`; }
      else if (dup.relatedVia && !dup.relatedVia.includes(via)) dup.relatedVia = `${dup.relatedVia}; ${via}`;
      related.add(h);
      return;
    }
    related.add({ ...h, relatedTie: tie, relatedVia: via });
  };
  const addEnforcement = (h: EnforcementHit, tie: RelatedTie, via: string) => {
    const k = enforcementKey(h);
    if (enforcementSeen.has(k)) return;
    enforcementSeen.add(k);
    relatedEnforcement.push({ ...h, relatedTie: tie, relatedVia: via });
  };

  // 1. Identifiers on the subject's own records: license numbers first, then phones, then addresses.
  const cands: Candidate[] = [];
  const seen = new Set(x.searchedIds);
  const push = (q: IdQuery, from: LicenseHit) => { const key = idKey(q); if (key && !seen.has(key)) { seen.add(key); cands.push({ q, key, from }); } };
  for (const h of ownList) if (h.licenseNumber) push({ type: "license", value: h.licenseNumber }, h);
  for (const h of ownList) if (h.phone) push({ type: "phone", value: h.phone }, h);
  for (const h of ownList) if (h.address) push({ type: "address", value: h.address }, h);
  const budget = Math.max(0, MAX_ID_SEARCHES - idSearches);
  if (cands.length > budget) notes.push(`${cands.length - budget} more license number(s), phone(s) or address(es) on these records were not searched (limit of ${MAX_ID_SEARCHES} identifier searches per name).`);
  for (const c of cands.slice(0, budget)) {
    idSearches++;
    const r = await searchById(finders, c.q, subject.kind);
    for (const f of r.failed) notes.push(`Could not search ${describeId(c.q)} in ${f}`);
    if (r.skipped.length) notes.push(`${describeId(c.q)} was not searched in ${r.skipped.join(", ")}.`);
    for (const f of r.capped) notes.push(`${describeId(c.q)}: ${f}.`);
    const fresh = r.licenses.filter((h) => !own.find(h));
    const ref = licenseRef(c.from);
    const spread = spreadOf(fresh, subject.kind === "company" ? r.enforcement : []);
    if (spread > MAX_BUSINESSES_PER_TIE) {
      notes.push(`${describeId(c.q)} (on ${ref}) is shared by ${spread} businesses, so it doesn't tie any one of them to this name; they are left out.`);
      continue;
    }
    const tie: RelatedTie = c.q.type;
    const via = c.q.type === "license" ? `lists the same license number as ${ref}`
      : c.q.type === "phone" ? `same phone as ${ref}, ${describeId(c.q).replace(/^phone /, "")}`
      : `same address as ${ref}, ${c.q.value}`;
    // An address that agrees only as far as the shorter one goes is a possible match, and says so (round 2, decision 5).
    const viaFor = (addr: string | null | undefined) => c.q.type === "address" && addressMatch(c.q.value, addr) !== "confirmed" ? `possible match (address): ${via}` : via;
    for (const h of fresh) addRelated(h, tie, viaFor(h.address));
    if (subject.kind === "company") for (const e of r.enforcement) addEnforcement(e, tie, viaFor(e.address));
    else if (r.enforcement.length) notes.push(`${r.enforcement.length} enforcement record(s) carrying ${describeId(c.q)} are not shown: enforcement records are searched for companies only.`);
    log(`xref ${describeId(c.q)}: ${fresh.length} related license(s)`);
  }

  // 2. Names on the subject's own records: people for a company, businesses for a person (and other names a company trades under).
  type NameHop = { name: string; kind: "person" | "company"; from: LicenseHit; role: string | null };
  const hops: NameHop[] = [];
  const hopSeen = new Set<string>([bizKey(subject.name)]);
  const addHop = (name: string | null | undefined, kind: "person" | "company", from: LicenseHit, role: string | null) => {
    if (!name) return;
    const k = `${kind}:${bizKey(name)}`;
    if (tokens(name).length < 2 || hopSeen.has(bizKey(name)) || hopSeen.has(k)) return;
    // A person subject's own name as a business (a sole proprietor) is the subject, not a related business.
    if (kind === "company" && subject.kind === "person" && wholeWordMatch(subject.name, { businessName: name, principal: null })) return;
    hopSeen.add(k);
    hops.push({ name, kind, from, role });
  };
  for (const h of ownList) {
    if (subject.kind === "company") {
      addHop(h.principal, "person", h, h.people?.find((p) => bizKey(p.name) === bizKey(h.principal ?? ""))?.role ?? null);
      for (const p of h.people ?? []) addHop(p.name, "person", h, p.role);
      if (h.businessName && !wholeWordMatch(subject.name, { businessName: h.businessName, principal: null })) addHop(h.businessName, "company", h, null);
    } else {
      addHop(h.businessName, "company", h, null);
    }
  }
  const notSearched: string[] = [];
  if (hops.length > MAX_NAME_HOPS) notes.push(`${hops.length - MAX_NAME_HOPS} more name(s) on these records were not searched: ${hops.slice(MAX_NAME_HOPS).map((h) => h.name).join(", ")} (limit of ${MAX_NAME_HOPS} per name).`);
  for (const hop of hops.slice(0, MAX_NAME_HOPS)) {
    const found: LicenseHit[] = [];
    for (const f of finders) {
      if (!f.byName || f.companiesOnly) continue;
      try {
        const r = await f.byName(hop.name, hop.kind);
        if (!r.searched) { notSearched.push(`"${hop.name}" in ${f.label} (${r.note})`); continue; }
        // A search that stopped at a cap says so (round 2, decision 9).
        if (r.capped) notes.push(`"${hop.name}" in ${f.label}: ${r.capped}.`);
        found.push(...r.hits.filter((h) => hop.kind === "person" ? samePerson(hop.name, h) : nameMatches(hop.name, hop.kind, h)));
      } catch (err: any) { notes.push(`Could not search "${hop.name}" in ${f.label}: ${String(err?.message ?? err).slice(0, 120)}`); }
    }
    const fresh = found.filter((h) => !own.find(h));
    const ref = licenseRef(hop.from);
    if (hop.kind === "person" && distinctBusinesses(fresh) > MAX_BUSINESSES_PER_TIE) {
      notes.push(`"${hop.name}" (named on ${ref}) matches licenses of ${distinctBusinesses(fresh)} different businesses, too common a name to link them; they are left out.`);
      continue;
    }
    for (const h of fresh) {
      if (hop.kind === "person") {
        addRelated(h, "person", `${hop.name}${hop.role ? ` (${hop.role.toLowerCase()})` : ""} is named on both this license and ${ref}`);
      } else {
        addRelated(h, "business", subject.kind === "person"
          ? `held by ${hop.name}, the business on ${ref}, where ${subject.name} is named`
          : `held by ${hop.name}, a business name on ${ref}`);
      }
    }
    log(`xref "${hop.name}" (${hop.kind}): ${fresh.length} related license(s)`);
  }

  if (notSearched.length) notes.push(`Not searched: ${notSearched.join("; ")}.`);

  // 3. State enforcement for the related businesses, strongest tie first. Never for a person (FCRA, decision 1).
  const businesses = new Map<string, { name: string; tie: RelatedTie; via: string; ties: number }>();
  const consider = (name: string | null | undefined, tie: RelatedTie, via: string) => {
    if (!name) return;
    const k = bizKey(name);
    if (!k || k === bizKey(subject.name)) return;
    if (subject.kind === "company" && wholeWordMatch(subject.name, { businessName: name, principal: null })) return; // the subject itself, searched already
    if (subject.kind === "person" && wholeWordMatch(subject.name, { businessName: name, principal: null })) return; // a sole proprietor's own name (FCRA)
    const cur = businesses.get(k);
    if (!cur) businesses.set(k, { name, tie, via, ties: 1 });
    else { cur.ties++; if (STRENGTH[tie] > STRENGTH[cur.tie]) Object.assign(cur, { tie, via }); }
  };
  if (subject.kind === "company") for (const h of related.list) consider(h.businessName, h.relatedTie ?? "address", (h.relatedVia ?? "").replace(/this license/g, h.licenseNumber ? `its license ${h.licenseNumber}` : "its license"));
  const ranked = Array.from(businesses.values()).sort((a, b) => STRENGTH[b.tie] - STRENGTH[a.tie] || b.ties - a.ties || a.name.localeCompare(b.name));
  if (ranked.length > MAX_RELATED_BUSINESSES) notes.push(`State enforcement records were searched for the ${MAX_RELATED_BUSINESSES} most closely tied businesses; not for ${ranked.slice(MAX_RELATED_BUSINESSES).map((b) => b.name).join(", ")}.`);
  for (const b of ranked.slice(0, MAX_RELATED_BUSINESSES)) {
    try {
      // Also without "Inc"/"LLC": agencies often file a record under the bare name. The exact-name check follows.
      const names = Array.from(new Set([b.name, businessCore(b.name)].filter((n) => tokens(n).length)));
      const r = { hits: [] as EnforcementHit[] };
      const down = new Set<string>();
      for (const n of names) {
        const found = await x.enforcementSearch(n);
        r.hits.push(...found.hits);
        for (const src of found.sources) if (!src.searched) down.add(`${src.source} (${src.note})`);
      }
      if (down.size) notes.push(`For ${b.name}, not searched: ${Array.from(down).join("; ")}.`);
      const mine = r.hits.filter((e) => businessNamed(b.name, e.name));
      for (const e of mine) addEnforcement(e, b.tie, `a record of ${b.name}, which is tied to this name: ${b.via}`);
      log(`xref enforcement "${b.name}": ${mine.length} record(s) naming exactly this business (of ${r.hits.length} word matches)`);
    } catch (err: any) {
      notes.push(`Could not search enforcement records for ${b.name}: ${String(err?.message ?? err).slice(0, 120)}`);
    }
  }
  if (ranked.length) notes.unshift(`Related businesses checked for state enforcement records: ${ranked.slice(0, MAX_RELATED_BUSINESSES).map((b) => b.name).join(", ")}.`);

  const order = (t?: RelatedTie) => -STRENGTH[t ?? "address"];
  return {
    related: related.list.sort((a, b) => order(a.relatedTie) - order(b.relatedTie)),
    relatedEnforcement: relatedEnforcement.sort((a, b) => order(a.relatedTie) - order(b.relatedTie) || String(b.date ?? "").localeCompare(String(a.date ?? ""))),
    notes,
    idSearches,
  };
}
