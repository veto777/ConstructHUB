/**
 * Golden subjects for the acceptance run (../research-acceptance.ts), taken from each state's own published data,
 * never invented:
 *
 *   (a) company:     a business holding an active license (holder "business" as the publisher says, standing words only);
 *   (b) enforcement: a company with a real enforcement or discipline record (a state enforcement file or dataset, a
 *                    business license's published discipline, a live enforcement search, or AG complaints);
 *   (c) person:      one individual license holder (holder "individual", or the person named on the license).
 *
 * Statewide sources are tried before city and county ones; within each, loaded bulk files (read from the scratch
 * database, no download), then Socrata datasets (a few sample rows, read back through the source's own code), then
 * live lookups (one search for a common word). A state where nothing usable is published gets an explicit null with
 * the reason, plus its pack's `blocked` notes.
 */
import { pool } from "../../server/db";
import { readRow, sourceStatus, type BulkSource } from "../../server/research/bulk";
import { searchLicenses, searchLicensesBy, sodaRows, type LicenseSource } from "../../server/research/licenses";
import { complaintSourcesFor, searchComplaints } from "../../server/research/records";
import { allBulkSourcesFor, allLicenseSourcesFor, liveLicenseSearchesFor } from "../../server/research/registry";
import { searchSodaEnforcement, searchStateEnforcement } from "../../server/research/state-records";
import { disciplineRecord, standingStatus } from "../../server/research/privacy";
import { nameMatches } from "../../server/research/xref";
import { STATE_PACKS } from "../../server/research/states";
import { LOCAL_BULK, LOCAL_LICENSES, LOCAL_LIVE, LOCAL_LIVE_ENFORCEMENT, LOCAL_ENFORCEMENT } from "../../server/research/states/local";
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import type { LiveEnforcementSearch, LiveLicenseSearch } from "../../server/research/states/types";
import type { SodaEnforcement } from "../../server/research/state-records";

export type SubjectRole = "company" | "enforcement" | "person";

/** What the report must contain for the subject to count as found. */
export type Expected =
  | { kind: "license"; source: string; licenseNumber: string | null; businessName: string | null; person?: string; matchedOn: "business" | "principal" }
  | { kind: "enforcement"; source: string; id: string | null; name: string | null; category: EnforcementHit["category"] }
  | { kind: "complaint"; source: string; id: string | null; business: string | null };

export type Golden = {
  role: SubjectRole;
  /** The name a customer would type (a "LAST, FIRST" person name is turned around). */
  name: string;
  kind: "company" | "person";
  /** The registry source it was taken from (label), and how. */
  source: string;
  sourceId: string;
  from: string;
  /** The record's own id (license number, case number, complaint id). */
  recordId: string | null;
  expected: Expected;
  picked: string;
};
export type GoldenSlot = Golden | { role: SubjectRole; null: true; reason: string; blocked?: string[] };
export type StateSubjects = { state: string; picked: string; subjects: GoldenSlot[] };

const today = () => new Date().toISOString().slice(0, 10);
const local = new Set<unknown>([...LOCAL_BULK, ...LOCAL_LICENSES, ...Object.values(LOCAL_LIVE).flat(), ...LOCAL_ENFORCEMENT, ...Object.values(LOCAL_LIVE_ENFORCEMENT).flat()]);
const statewideFirst = <T>(list: T[]): T[] => [...list.filter((x) => !local.has(x)), ...list.filter((x) => local.has(x))];

/** An active standing (the status a business license must show to be golden). */
const ACTIVE = /^(active|current|clear|valid|issued|licensed|registered|renewed|(?:in )?good standing)\b/i;
const isActive = (h: LicenseHit) => !!h.status && ACTIVE.test(h.status) && !/inactive/i.test(h.status);

/** "SMITH, JOHN A" → "JOHN A SMITH": what a customer types. */
export function typedName(name: string): string {
  const t = name.replace(/\s+/g, " ").trim();
  const m = t.match(/^([^,]+),\s*([^,]+?)(?:,\s*(JR|SR|II|III|IV)\.?)?$/i);
  return m ? `${m[2]} ${m[1]}${m[3] ? ` ${m[3]}` : ""}`.trim() : t;
}
/** Names a customer could plausibly type: letters, 2+ words, not a placeholder. */
const usableName = (n: string | null | undefined): n is string =>
  !!n && /[A-Za-z]{2}/.test(n) && n.trim().split(/\s+/).length >= 2 && n.length <= 110 && !/^(n\/?a|none|unknown|escrow|test)\b/i.test(n.trim());

const personOf = (h: LicenseHit): string | null => {
  const people = [h.principal, ...(h.people ?? []).map((p) => p.name)].filter(usableName);
  return people.length ? typedName(people[0]) : null;
};

/**
 * A business with an active license. `statusless`: the source publishes no status at all (a list of current
 * licenses), so a listed record is taken as current. A record without a number is matched by name and source.
 */
const companyLicense = (src: string, sourceId: string, from: string, h: LicenseHit, statusless = false): Golden | null => {
  // The publisher's holder when it says (an old load or a source that doesn't say: null, "not an individual").
  if (h.holder === "individual" || !usableName(h.businessName) || !(isActive(h) || (statusless && !h.status))) return null;
  // What a customer types: the legal name, without a "dba" trade name the publisher joined onto it.
  const name = h.businessName.split(" / ")[0].split(/\s+d\/?b\/?a\b\.?\s+/i)[0].trim();
  if (!usableName(name) || !nameMatches(name, "company", h)) return null;
  return { role: "company", name, kind: "company", source: src, sourceId, from: statusless && !h.status ? `${from} (the publisher lists no status: a list of current licenses)` : from, recordId: h.licenseNumber,
    expected: { kind: "license", source: h.source, licenseNumber: h.licenseNumber, businessName: name, matchedOn: "business" }, picked: today() };
};
const personLicense = (src: string, sourceId: string, from: string, h: LicenseHit): Golden | null => {
  if (h.holder === "business") return null;
  const name = personOf(h);
  if (!name) return null;
  return { role: "person", name, kind: "person", source: src, sourceId, from, recordId: h.licenseNumber,
    expected: { kind: "license", source: h.source, licenseNumber: h.licenseNumber, businessName: h.businessName, person: name, matchedOn: "principal" }, picked: today() };
};
const enforcementOf = (src: string, sourceId: string, from: string, e: EnforcementHit): Golden | null => {
  if (!usableName(e.name) || e.category === "business_status") return null;
  // What a customer types: the first name listed, without an address the publisher wrote into the name field.
  const name = e.name.split(" / ")[0].replace(/,\s*\d.*$/, "").trim();
  if (!usableName(name)) return null;
  return { role: "enforcement", name, kind: "company", source: src, sourceId, from, recordId: e.id,
    expected: { kind: "enforcement", source: e.source, id: e.id, name: e.name, category: e.category }, picked: today() };
};

// ── Bulk files (read from the database the run will search) ──────────────────────────────────────────────────────

async function bulkRows(src: BulkSource, where: string, n = 60): Promise<{ k: "license" | "enforcement"; h: any; v?: number }[]> {
  const { rows } = await pool.query(
    `SELECT r.hit FROM research_bulk_rows r JOIN research_bulk_sources s ON s.id = r.source AND s.generation = r.generation
     WHERE r.source = $1 AND ${where} ORDER BY random() LIMIT ${n}`, [src.id]);
  return rows.map((r) => r.hit);
}

async function fromBulk(src: BulkSource, role: SubjectRole): Promise<Golden | null> {
  const st = await sourceStatus(src.id);
  if (!st.loaded) return null;
  const from = `bulk file ${src.id}, loaded ${st.loadedAt?.slice(0, 10)}`;
  if (role === "enforcement") {
    if (src.companiesOnly) {
      for (const row of await bulkRows(src, `r.hit->>'k' = 'enforcement' AND r.hit->'h'->>'name' IS NOT NULL`)) {
        const s = readRow(src, row);
        if (s?.kind !== "enforcement") continue;
        const g = enforcementOf(src.label, src.id, from, s.hit);
        if (g) return g;
      }
      return null;
    }
    // A business license whose published discipline becomes an enforcement record (round 2, decision 1).
    for (const row of await bulkRows(src, `r.hit->>'k' = 'license' AND coalesce(r.hit->'h'->>'discipline', '') <> ''`)) {
      const s = readRow(src, row);
      if (s?.kind !== "license") continue;
      const e = disciplineRecord(s.hit);
      const g = e && enforcementOf(src.label, src.id, `${from} (discipline on a business license)`, e);
      if (g && usableName(s.hit.businessName)) return { ...g, name: s.hit.businessName!.split(" / ")[0].trim() };
    }
    return null;
  }
  if (src.companiesOnly) return null;
  const where = role === "company"
    ? `r.hit->>'k' = 'license' AND r.hit->'h'->>'businessName' IS NOT NULL AND coalesce(r.hit->'h'->>'matchedOn', 'business') = 'business'`
    : `r.hit->>'k' = 'license' AND (r.hit->'h'->>'principal' IS NOT NULL OR jsonb_array_length(coalesce(r.hit->'h'->'people', '[]')) > 0)`;
  const hits = (await bulkRows(src, where, 200)).map((row) => readRow(src, row)).flatMap((s) => (s?.kind === "license" ? [s.hit] : []));
  const statusless = hits.length > 0 && hits.every((h) => !h.status);
  for (const h of hits) {
    const g = role === "company" ? companyLicense(src.label, src.id, from, h, statusless) : personLicense(src.label, src.id, from, h);
    if (g) return g;
  }
  return null;
}

// ── Socrata license datasets (sample rows, read back through the source's own search) ─────────────────────────────

const field = (f: unknown): string | null => (Array.isArray(f) ? f[0] ?? null : typeof f === "string" ? f : null);

async function fromSoda(src: LicenseSource, role: SubjectRole): Promise<Golden | null> {
  if (role === "enforcement") return null;
  const lic = field(src.fields.licenseNumber);
  if (!lic) return null;
  const need = [lic, role === "company" ? field(src.fields.businessName) : field(src.personField as unknown) ?? field(src.fields.principal)].filter(Boolean);
  if (need.length < 2 && !(role === "person" && src.principals)) return null;
  const base = need.map((f) => `${f} IS NOT NULL`).join(" AND ") + (src.filter ? ` AND (${src.filter})` : "");
  const status = field(src.fields.status);
  const active = status && role === "company" ? ` AND (${["ACTIVE", "CURRENT", "CLEAR", "VALID", "ISSUED", "LICENSED"].map((w) => `upper(${status}) like '${w}%'`).join(" OR ")})` : "";
  let rows: Record<string, unknown>[] = [];
  // An active-status sample where the dataset's status is text, else any rows; a random page, then the first.
  for (const [where, offset] of [[base + active, Math.floor(Math.random() * 2000)], [base + active, 0], [base, Math.floor(Math.random() * 2000)], [base, 0]] as [string, number][]) {
    rows = await sodaRows(src.url, where, 8, src.source, ":id", offset).catch(() => []);
    if (rows.length) break;
  }
  for (const row of rows) {
    const n = String(row[lic] ?? "").trim();
    if (!n) continue;
    const hits = (await searchLicensesBy(src, { type: "license", value: n })) ?? [];
    for (const h of hits) {
      const g = role === "company" ? companyLicense(src.source, src.datasetUrl, `Socrata dataset ${src.datasetUrl}, row ${n}`, h, !status)
        : personLicense(src.source, src.datasetUrl, `Socrata dataset ${src.datasetUrl}, row ${n}`, h);
      if (g) return g;
    }
  }
  return null;
}

// ── Live lookups (one search for a common word) ──────────────────────────────────────────────────────────────────

/** Common words to search a live lookup with, in turn, until one gives a usable record (some need a full name). */
const COMMON = { company: ["Construction", "Electric", "Plumbing"], person: ["Smith", "John Smith", "Michael Johnson"] } as const;

async function fromLive(src: LiveLicenseSearch, role: SubjectRole): Promise<Golden | null> {
  if (role === "enforcement") return null;
  const kind = role === "company" ? "company" : "person";
  if (src.kinds && !src.kinds.includes(kind)) return null;
  for (const q of COMMON[kind]) {
    const hits = await src.search(q, kind);
    const statusless = hits.length > 0 && hits.every((h) => !h.status);
    for (const h of hits) {
      const g = role === "company" ? companyLicense(src.source, src.sourceUrl, `live lookup, search "${q}"`, h, statusless)
        : personLicense(src.source, src.sourceUrl, `live lookup, search "${q}"`, h);
      if (g) return g;
    }
  }
  return null;
}

async function fromSodaEnforcement(src: SodaEnforcement): Promise<Golden | null> {
  const r = await searchSodaEnforcement(src, "Construction", () => true);
  for (const e of r) { const g = enforcementOf(src.source, src.datasetUrl, `Socrata dataset ${src.datasetUrl}, search "Construction"`, e); if (g) return g; }
  return null;
}
async function fromLiveEnforcement(src: LiveEnforcementSearch): Promise<Golden | null> {
  const r = await src.search("Construction");
  for (const e of r) { const g = enforcementOf(src.source, src.source, `live search "Construction"`, e); if (g) return g; }
  return null;
}

// ── One state ─────────────────────────────────────────────────────────────────────────────────────────────────────

const ROLE_WORDS: Record<SubjectRole, string> = {
  company: "a business holding an active license", enforcement: "a company with an enforcement or discipline record", person: "an individual license holder",
};

export async function pickState(state: string, log: (m: string) => void = () => undefined): Promise<StateSubjects> {
  const pack = STATE_PACKS.find((p) => p.state === state);
  const bulk = statewideFirst(allBulkSourcesFor(state));
  const soda = statewideFirst(allLicenseSourcesFor(state));
  const live = statewideFirst(liveLicenseSearchesFor(state));
  const subjects: GoldenSlot[] = [];
  for (const role of ["company", "enforcement", "person"] as SubjectRole[]) {
    let g: Golden | null = null;
    const tried: string[] = [];
    const attempt = async (label: string, fn: () => Promise<Golden | null>) => {
      if (g) return;
      tried.push(label);
      try { g = await fn(); } catch (err: any) {
        const msg = String(err?.message ?? err).slice(0, 200);
        tried[tried.length - 1] = `${label} (search failed: ${msg})`;
        log(`${state} ${role}: ${label} failed: ${msg}`);
      }
    };
    if (role === "enforcement") {
      // Enforcement files first (a real record), then discipline on business licenses, then live searches, then complaints.
      for (const b of bulk.filter((x) => x.companiesOnly)) await attempt(b.id, () => fromBulk(b, role));
      for (const b of bulk.filter((x) => !x.companiesOnly)) await attempt(`${b.id} (discipline)`, () => fromBulk(b, role));
      for (const e of statewideFirst([...(pack?.enforcement ?? []), ...LOCAL_ENFORCEMENT.filter((x) => x.state === state)])) await attempt(e.source, () => fromSodaEnforcement(e));
      for (const e of statewideFirst([...(pack?.liveEnforcement ?? []), ...(LOCAL_LIVE_ENFORCEMENT[state] ?? [])])) await attempt(e.source, () => fromLiveEnforcement(e));
      // The original tables' live enforcement (TX TDLR orders, TCEQ, …), through the report's own search.
      await attempt(`${state} original enforcement`, async () => {
        const r = await searchStateEnforcement("Construction", state, () => true);
        for (const e of r.hits) { const x = enforcementOf(e.source, e.source, `live search "Construction"`, e); if (x) return x; }
        return null;
      });
      for (const c of complaintSourcesFor(state)) await attempt(c.source, async () => {
        for (const h of await searchComplaints(c, "Construction")) {
          if (!usableName(h.business)) continue;
          return { role, name: h.business.trim(), kind: "company", source: c.source, sourceId: c.datasetUrl, from: `Socrata dataset ${c.datasetUrl}, search "Construction"`,
            recordId: h.id, expected: { kind: "complaint", source: c.source, id: h.id, business: h.business }, picked: today() } as Golden;
        }
        return null;
      });
    } else {
      // Statewide sources of every type before any city or county one; within each, files, Socrata, live lookups.
      const tiers: { local: boolean; label: string; fn: () => Promise<Golden | null> }[] = [
        ...bulk.filter((x) => !x.companiesOnly).map((b) => ({ local: local.has(b), label: b.id, fn: () => fromBulk(b, role) })),
        ...soda.map((x) => ({ local: local.has(x), label: x.source, fn: () => fromSoda(x, role) })),
        ...live.map((x) => ({ local: local.has(x), label: x.source, fn: () => fromLive(x, role) })),
      ];
      for (const t of [...tiers.filter((x) => !x.local), ...tiers.filter((x) => x.local)]) await attempt(t.label, t.fn);
    }
    if (g) { log(`${state} ${role}: "${(g as Golden).name}" from ${(g as Golden).source}`); subjects.push(g); continue; }
    const reason = !tried.length
      ? `No registered source publishes ${ROLE_WORDS[role]} for ${state}`
      : `No usable record of ${ROLE_WORDS[role]} found in: ${tried.join("; ")}`;
    log(`${state} ${role}: null (${reason})`);
    subjects.push({ role, null: true, reason, ...(pack?.blocked?.length ? { blocked: pack.blocked } : {}) });
  }
  return { state, picked: today(), subjects };
}

export const isGolden = (s: GoldenSlot): s is Golden => !("null" in s);
export { standingStatus };
