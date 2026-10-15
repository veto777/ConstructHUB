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
 *
 * Every search goes through a LicenseFinder, so the logic here runs against fakes in tests (xref.test.ts) and against
 * the registry's real sources in the runner. Work is capped per subject; whatever a cap leaves out is said in the notes.
 */
import type { EnforcementHit, LicenseHit, RecordSource, RelatedTie, ResearchSubjectInput } from "@shared/research-reports";
import { RELATED_TIES } from "@shared/research-reports";
import { describeId, normLicense, normPhone, addressKeys, type IdQuery } from "./identifiers";
import { tokens, wholeWordMatch } from "./licenses";

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

export type FinderResult = { licenses: LicenseHit[]; enforcement: EnforcementHit[] };

/** One searchable source in one state. */
export type LicenseFinder = {
  state: string;
  label: string;
  /** An enforcement file (companies only): searched by identifier for a company subject, never for a person. */
  companiesOnly?: boolean;
  /** Hits must already be whole-word matches of the name (`searched: false` when the source wasn't available). */
  byName?: (name: string, kind: "person" | "company") => Promise<{ hits: LicenseHit[]; searched: boolean; note: string }>;
  byId?: (q: IdQuery) => Promise<FinderResult>;
};

/** Searches state enforcement records for one business (records.ts searchEnforcement in the runner). */
export type EnforcementSearch = (name: string) => Promise<{ hits: EnforcementHit[]; sources: RecordSource[] }>;

// ── Matching ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Every word of the name is a word of ONE person on the record (the bulk index can match words from two people). */
export function personNamed(name: string, hit: Pick<LicenseHit, "principal" | "people">): boolean {
  const want = tokens(name);
  if (!want.length) return false;
  return [hit.principal, ...(hit.people ?? []).map((p) => p.name)].some((v) => { const have = new Set(tokens(v ?? "")); return want.every((w) => have.has(w)); });
}

/**
 * A stricter person check for the cross-reference hop, where a name is all that links two licenses: a middle initial
 * on the name must agree ("Douglas W Smith" is not "Douglas C Smith" or "Douglas Lyle Smith"; plain "Douglas Smith" is
 * still a candidate). The report says that a link by name alone may be a different person.
 */
export function samePerson(name: string, hit: Pick<LicenseHit, "principal" | "people">): boolean {
  const words = (v: string) => v.toUpperCase().split(/[^A-Z0-9']+/).filter(Boolean);
  const initials = words(name).filter((w) => w.length === 1);
  const full = tokens(name);
  if (!full.length) return false;
  return [hit.principal, ...(hit.people ?? []).map((p) => p.name)].some((v) => {
    const have = words(v ?? "");
    if (!full.every((w) => have.includes(w))) return false;
    const rest = have.filter((w) => !full.includes(w));
    return initials.every((i) => rest.some((w) => w[0] === i));
  });
}

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
  return kind === "company" ? wholeWordMatch(name, { businessName: hit.businessName, principal: null }) : personNamed(name, hit);
}

// ── Dedupe ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** State + normalized license number; records without a number fall back to their source and names. */
export function licenseKey(h: LicenseHit): string {
  const n = normLicense(h.licenseNumber);
  return n ? `${h.state}|${n}` : `${h.state}|${h.source}|${tokens(h.businessName ?? "").join(" ")}|${tokens(h.principal ?? "").join(" ")}`;
}

const nameWords = (h: LicenseHit) => new Set([...tokens(h.businessName ?? ""), ...tokens(h.principal ?? ""), ...(h.people ?? []).flatMap((p) => tokens(p.name))]);
/** Two records with one key are one license unless their names have nothing in common (two boards reusing a number). */
function sameLicense(a: LicenseHit, b: LicenseHit): boolean {
  if (licenseKey(a) !== licenseKey(b)) return false;
  const wa = nameWords(a), wb = nameWords(b);
  if (!wa.size || !wb.size) return true;
  return Array.from(wa).some((w) => wb.has(w));
}

/** Fill what one copy lacks from the other (address, phone, people), keeping the first copy's source and match. */
function merge(into: LicenseHit, other: LicenseHit): void {
  into.address ??= other.address;
  into.phone ??= other.phone;
  into.city ??= other.city;
  into.expires ??= other.expires;
  if (other.people?.length) {
    const have = new Set((into.people ?? []).map((p) => tokens(p.name).join(" ")));
    into.people = [...(into.people ?? []), ...other.people.filter((p) => !have.has(tokens(p.name).join(" ")))];
  }
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
  const k = addressKeys(q.value);
  return k.length ? k.join(" ") : null;
}

/** One identifier across every finder. A finder that fails is noted, never counted as "nothing found". */
export async function searchById(finders: LicenseFinder[], q: IdQuery, kind: "person" | "company"): Promise<{ licenses: LicenseHit[]; enforcement: EnforcementHit[]; searched: number; failed: string[] }> {
  const licenses: LicenseHit[] = [], enforcement: EnforcementHit[] = [], failed: string[] = [];
  let searched = 0;
  for (const f of finders) {
    if (!f.byId || (f.companiesOnly && kind === "person")) continue;
    try {
      const r = await f.byId(q);
      searched++;
      licenses.push(...r.licenses.map((h) => ({ ...h, matchedOn: q.type })));
      enforcement.push(...r.enforcement);
    } catch (err: any) {
      failed.push(`${f.label}: ${String(err?.message ?? err).slice(0, 120)}`);
    }
  }
  return { licenses, enforcement, searched, failed };
}

export type CustomerIdResult = {
  licenses: LicenseHit[]; enforcement: EnforcementHit[];
  searches: { query: string; found: number; note: string }[]; searchedIds: Set<string>; used: number; notes: string[];
};

/**
 * The identifiers the customer gave, each searched in every finder. The licenses found are the subject's own
 * (matchedOn says which identifier found them). Enforcement records found this way are kept for a company only, and
 * carry the identifier as their tie, since the customer, not the record, links them to the name.
 */
export async function searchCustomerIds(finders: LicenseFinder[], ids: IdQuery[], kind: "person" | "company"): Promise<CustomerIdResult> {
  const out: CustomerIdResult = { licenses: [], enforcement: [], searches: [], searchedIds: new Set(), used: 0, notes: [] };
  for (const q of ids) {
    const key = idKey(q);
    if (!key || out.searchedIds.has(key)) continue;
    if (out.used >= MAX_ID_SEARCHES) { out.notes.push(`${describeId(q)} was not searched (limit of ${MAX_ID_SEARCHES} identifier searches per name).`); continue; }
    out.searchedIds.add(key);
    out.used++;
    const r = await searchById(finders, q, kind);
    out.licenses.push(...r.licenses);
    const via = `found by the ${q.type === "license" ? "license number" : q.type} you gave (${q.value})`;
    if (kind === "company") out.enforcement.push(...r.enforcement.map((e) => ({ ...e, relatedTie: q.type, relatedVia: via })));
    else if (r.enforcement.length) out.notes.push(`${r.enforcement.length} enforcement record(s) carrying ${describeId(q)} are not shown: enforcement records are searched for companies only.`);
    out.searches.push({
      query: describeId(q), found: r.licenses.length + (kind === "company" ? r.enforcement.length : 0),
      note: [`${r.searched} source(s) searched`, ...r.failed.map((f) => `could not search ${f}`)].join("; "),
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
    const fresh = r.licenses.filter((h) => !own.find(h));
    const ref = licenseRef(c.from);
    const spread = new Set([...fresh.map((h) => bizKey(h.businessName ?? h.principal ?? "")), ...r.enforcement.map((e) => bizKey(e.name ?? ""))].filter(Boolean)).size;
    if (spread > MAX_BUSINESSES_PER_TIE) {
      notes.push(`${describeId(c.q)} (on ${ref}) is shared by ${spread} businesses, so it doesn't tie any one of them to this name; they are left out.`);
      continue;
    }
    const tie: RelatedTie = c.q.type;
    const via = c.q.type === "license" ? `lists the same license number as ${ref}`
      : c.q.type === "phone" ? `same phone as ${ref}, ${describeId(c.q).replace(/^phone /, "")}`
      : `same address as ${ref}, ${c.q.value}`;
    for (const h of fresh) addRelated(h, tie, via);
    if (subject.kind === "company") for (const e of r.enforcement) addEnforcement(e, tie, via);
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
  if (hops.length > MAX_NAME_HOPS) notes.push(`${hops.length - MAX_NAME_HOPS} more name(s) on these records were not searched: ${hops.slice(MAX_NAME_HOPS).map((h) => h.name).join(", ")} (limit of ${MAX_NAME_HOPS} per name).`);
  for (const hop of hops.slice(0, MAX_NAME_HOPS)) {
    const found: LicenseHit[] = [];
    for (const f of finders) {
      if (!f.byName || f.companiesOnly) continue;
      try { found.push(...(await f.byName(hop.name, hop.kind)).hits.filter((h) => hop.kind === "person" ? samePerson(hop.name, h) : nameMatches(hop.name, hop.kind, h))); }
      catch (err: any) { notes.push(`Could not search "${hop.name}" in ${f.label}: ${String(err?.message ?? err).slice(0, 120)}`); }
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

  // 3. State enforcement for the related businesses, strongest tie first.
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
  if (subject.kind === "person") for (const h of ownList) consider(h.businessName, "business", `${subject.name} is named on its ${licenseRef(h)}`);
  for (const h of related.list) consider(h.businessName, h.relatedTie ?? "address", (h.relatedVia ?? "").replace(/this license/g, h.licenseNumber ? `its license ${h.licenseNumber}` : "its license"));
  const ranked = Array.from(businesses.values()).sort((a, b) => STRENGTH[b.tie] - STRENGTH[a.tie] || b.ties - a.ties || a.name.localeCompare(b.name));
  if (ranked.length > MAX_RELATED_BUSINESSES) notes.push(`State enforcement records were searched for the ${MAX_RELATED_BUSINESSES} most closely tied businesses; not for ${ranked.slice(MAX_RELATED_BUSINESSES).map((b) => b.name).join(", ")}.`);
  for (const b of ranked.slice(0, MAX_RELATED_BUSINESSES)) {
    try {
      // Also without "Inc"/"LLC": agencies often file a record under the bare name. The exact-name check follows.
      const names = Array.from(new Set([b.name, businessCore(b.name)].filter((n) => tokens(n).length)));
      const r = { hits: [] as EnforcementHit[] };
      for (const n of names) r.hits.push(...(await x.enforcementSearch(n)).hits);
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
