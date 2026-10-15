/**
 * Bulk state records for research reports: official files a state publishes as downloads, not as a search API
 * (Florida DBPR licensee and complaint extracts, California CSLB's license master, Texas plumbing board lists, …).
 * Each source is downloaded on a schedule, parsed into report hits and indexed by the words of its names, so a
 * report searches it in milliseconds instead of downloading it per order.
 *
 * A load replaces a source in one step: rows are written under a new generation and the source's current
 * generation is switched only after the whole file parsed and passed its row-count floor, so a cut-off download
 * never replaces good data with half of it. A source that has never loaded is reported as not searched.
 *
 * Every source is listed in ./bulk-sources.ts with the date it was checked live (CLAUDE.md: never fabricate).
 */
import { createWriteStream, createReadStream, promises as fs } from "node:fs";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pool } from "../db";
import { USER_AGENT, fetchWithDeadline, guard, isHtmlType, noteResponse, refuseChallengeBody, sleep, withRun } from "./http";
import type { EnforcementCategory, EnforcementHit, LicenseHit } from "@shared/research-reports";
import { tokens } from "./licenses";
import { addressMatches, idWords, queryWords, type IdKeys, type IdQuery } from "./identifiers";
import { capNote } from "./notes";
import { isIndividual, privateHit, privateKeys } from "./privacy";
import { looksLikeBusiness } from "./states/lib/business-name";

/**
 * One record of a file. `business` and `person` are the names it is found by; `people` adds everyone else the
 * record names (officers, qualifiers), searched like `person`; `keys` are its license numbers, phones and street
 * addresses (./identifiers.ts), so a report can find it by those and cross-reference related records.
 */
export type BulkHit =
  | { kind: "license"; hit: LicenseHit; business: string | null; person: string | null; people?: (string | null)[]; keys?: IdKeys; component?: string }
  | { kind: "enforcement"; hit: EnforcementHit; business: string | null; person: string | null; people?: (string | null)[]; keys?: IdKeys; component?: string };
/*
 * `component`: for a source built from several files (VA's boards, MI's and IN's license types, OH's rosters, …),
 * which file the row came from. Each component's count is kept in facets, and the 70% rule applies to it alone
 * (round 2, decision 10).
 */

export type BulkSource = {
  id: string;
  state: string;
  /** What the report calls it. */
  label: string;
  /** The official page a reader can open. */
  pageUrl: string;
  /** Hours between refreshes. */
  everyHours: number;
  /** Fewer rows than this means the download was cut off or the layout changed: keep the previous load. */
  minRows: number;
  /** Yields every hit in the source. */
  load: () => AsyncIterable<BulkHit>;
  /** Only start a load in these UTC hours (a server that is slow by day). */
  utcHours?: number[];
  /** Searched for companies only (enforcement records are; FCRA). */
  companiesOnly?: boolean;
  /** An enforcement file's kind of record (the category its hits carry). Optional; the coverage page guesses from the label without it. */
  category?: EnforcementCategory;
  /**
   * The source's row shape version (round 4, decision 11). Raise it when the rows change on purpose (CSLB: one row per
   * license instead of one per person). Each successful load stores the shape it was made under (row_shape); the first
   * load under a higher shape is not measured against the old baseline, and becomes the new one. Once only: the next
   * load is compared under the 70% rule as usual. Absent is 0.
   */
  rowShape?: number;
  /**
   * For a license row stored before HOLDER_VERSION (round 4, decision 3): the holder by the source's current rule, from
   * the publisher fields the stored row kept. Without it (or when the stored fields don't say), an older row's holder
   * is null: city, state and ZIP only, until the source reloads.
   */
  legacyHolder?: (h: LicenseHit) => LicenseHit["holder"];
  /**
   * For an enforcement row stored before PAYLOAD_VERSION: the source's current rule on who a record is about, run on
   * what was stored (null drops it). Without it, an older row is kept only when its name reads as a business.
   */
  legacyEnforcement?: (h: EnforcementHit, storedVersion: number) => EnforcementHit | null;
  /**
   * The payload version from which this source's enforcement rows follow its current rule (default
   * ENFORCEMENT_RULE_VERSION). A source whose subject rule changed raises it, and only its older rows are re-read.
   */
  enforcementRuleVersion?: number;
};

const DDL = `
CREATE TABLE IF NOT EXISTS research_bulk_sources (
  id text PRIMARY KEY,
  generation integer NOT NULL DEFAULT 0,
  row_count integer NOT NULL DEFAULT 0,
  loaded_at timestamptz,
  attempted_at timestamptz,
  error text
);
CREATE TABLE IF NOT EXISTS research_bulk_rows (
  source text NOT NULL,
  generation integer NOT NULL,
  words text[] NOT NULL,
  hit jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS research_bulk_rows_words ON research_bulk_rows USING gin (words);
CREATE INDEX IF NOT EXISTS research_bulk_rows_source ON research_bulk_rows (source, generation);
ALTER TABLE research_bulk_sources ADD COLUMN IF NOT EXISTS facets jsonb;
ALTER TABLE research_bulk_sources ADD COLUMN IF NOT EXISTS key_version integer NOT NULL DEFAULT 0;
ALTER TABLE research_bulk_sources ADD COLUMN IF NOT EXISTS row_shape integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS research_bulk_jobs (
  name text PRIMARY KEY,
  done_at timestamptz NOT NULL DEFAULT now(),
  detail jsonb
);
`;

/**
 * The format of a load's identifier keys. Version 2 (round 2, decision 2): phone and street keys only for a license
 * a business holds. A source loaded under an older version is refreshed first, and until then its "a:"/"t:" keys are
 * not searched (they may be an individual's home address or phone).
 */
export const KEY_VERSION = 3;
/*
 * Version 3 (round 3, decisions 2–4): holders only from the publisher's listed values, and a Florida complaint about
 * an individual's DBA without an address key. Older loads' phone and address keys stay blocked until they reload.
 */

/**
 * The rules a stored row was written under (round 3, decision 4). Every read runs the row sanitizers whatever the
 * version (privacy, status words, discipline removal for individuals); a row from before this version also has its
 * enforcement subject checked again (BulkSource.legacyEnforcement, or the business-name rule), since the rule that
 * let it in has changed. Raise it when a classifier changes.
 */
export const PAYLOAD_VERSION = 5;
/*
 * Version 4 (round 4, decision 4): a Florida DBA needs a DBA marker, and entity abbreviations count only as the
 * name's last word. Older complaint rows are re-read by flLegacyComplaint.
 * Version 5 (A10, decision 3): FL personal name forms (suffixes, compound surnames, "might be a person") are never a
 * business. Only FL complaints re-reads its version-4 rows (its enforcementRuleVersion is 5).
 */

/** The version from which an enforcement row is current for a source that sets no enforcementRuleVersion of its own. */
export const ENFORCEMENT_RULE_VERSION = 4;

/**
 * The payload version from which a stored license row's `holder` is today's rule (round 3's publisher-only holders).
 * An older row's holder is recomputed by BulkSource.legacyHolder, or else null (round 4, decision 3).
 */
export const HOLDER_VERSION = 3;

/** A new load needs strictly more than this share of the baseline (overall and per component), or it is kept out. */
export const MIN_SHARE_OF_PREVIOUS = 0.7;

let ready: Promise<void> | null = null;
export function bulkSchemaReady(): Promise<void> {
  ready ??= pool.query(DDL).then(() => undefined).catch((err) => { ready = null; throw err; });
  return ready;
}

/**
 * Index words: "b:" for a business name, "p:" for a person, so a company search never matches an officer's surname;
 * plus the identifier keys of ./identifiers.ts ("l:", "t:", "a:", "z:"). A person search matches when every word of
 * the name is a "p:" word of the record, so with several people on one record the words could come from two of them:
 * the runner re-checks each hit against the person names it carries.
 */
export function indexWords(business: string | null, person: string | null, people?: (string | null)[], keys?: IdKeys): string[] {
  const out = new Set<string>();
  for (const w of tokens(business ?? "")) out.add(`b:${w}`);
  for (const p of [person, ...(people ?? [])]) for (const w of tokens(p ?? "")) out.add(`p:${w}`);
  for (const k of idWords(keys)) out.add(k);
  return Array.from(out);
}

const BATCH = 2000;

/**
 * The keys a row is indexed by: the pack's own, plus the license number, phone and address the hit itself carries
 * (a source that forgot `keys` is still found by its license number; audit 2026-10-15). An individual's row (no
 * business) gets no phone or street keys, and its hit keeps city, state and ZIP only (decision 4).
 */
export function rowKeys(h: BulkHit): { hit: LicenseHit | EnforcementHit; keys: IdKeys | undefined } {
  const individual = h.kind === "license" ? isIndividual(h.hit) : !h.business && !h.hit.name;
  const hit = h.kind === "license" && individual ? privateHit(h.hit) : h.hit;
  const own: IdKeys = {
    licenses: [...(h.keys?.licenses ?? []), h.hit.licenseNumber ?? null],
    phones: [...(h.keys?.phones ?? []), h.hit.phone ?? null],
    addresses: [...(h.keys?.addresses ?? []), h.hit.address ?? null],
  };
  return { hit, keys: privateKeys(own, individual) };
}

/**
 * The 70% rule (round 2, decision 10; round 3, decision 12): a load with no more than MIN_SHARE_OF_PREVIOUS of the
 * baseline's rows, or a component with no more than that share of its baseline count (or missing), is not swapped
 * in. Null when the load may stand.
 */
export function shortfall(n: number, components: Record<string, number>, base: Baseline | null): string | null {
  if (!base || base.rows <= 0) return null;
  if (n <= base.rows * MIN_SHARE_OF_PREVIOUS) return `${n} rows, baseline ${base.rows}`;
  const short = Object.entries(base.components ?? {}).filter(([c, m]) => m > 0 && (components[c] ?? 0) <= m * MIN_SHARE_OF_PREVIOUS)
    .map(([c, m]) => `${c}: ${components[c] ?? 0} rows, baseline ${m}`);
  return short.length ? short.join("; ") : null;
}

export type Baseline = { rows: number; components?: Record<string, number> | null };

/**
 * What the next load is measured against (round 3, decision 12): the last load that passed and was not reduced,
 * kept in facets.baseline. A load that passes with fewer rows than the baseline (or a component with fewer) leaves
 * that number as it was, so a run of small cuts can't walk the baseline down. A key-format change doesn't reset it;
 * only a higher row shape does (round 4, decision 11): when the source declares a shape above the one the stored load
 * was made under, there is no baseline for this one load, which then becomes the baseline under the new shape.
 */
export function baselineOf(prev: { rows: number; loadedAt: Date | string | null; facets: any; rowShape?: number } | null, declaredShape = 0): Baseline | null {
  if (!prev?.loadedAt) return null;
  if (declaredShape > (prev.rowShape ?? 0)) return null;
  const b = prev.facets?.baseline as Baseline | undefined;
  return b?.rows ? b : { rows: prev.rows, components: (prev.facets?.components ?? null) as Record<string, number> | null };
}

/** The baseline after a load that passed: each number the larger of the old baseline's and this load's. */
export function nextBaseline(n: number, components: Record<string, number>, base: Baseline | null): Baseline {
  const out: Record<string, number> = { ...(base?.components ?? {}) };
  for (const [c, m] of Object.entries(components)) out[c] = Math.max(out[c] ?? 0, m);
  return { rows: Math.max(base?.rows ?? 0, n), ...(Object.keys(out).length ? { components: out } : {}) };
}

/** Download, parse and swap in one source. Returns the row count. */
export async function loadSource(src: BulkSource): Promise<number> {
  return withRun(() => loadSourceRun(src));
}

async function loadSourceRun(src: BulkSource): Promise<number> {
  await bulkSchemaReady();
  await pool.query(`INSERT INTO research_bulk_sources (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [src.id]);
  await pool.query(`UPDATE research_bulk_sources SET attempted_at = now() WHERE id = $1`, [src.id]);
  const { rows: [cur] } = await pool.query(`SELECT generation, row_count, loaded_at, facets, key_version, row_shape FROM research_bulk_sources WHERE id = $1`, [src.id]);
  const gen = Number(cur.generation) + 1;
  // Measured against the last load that passed, whatever key format it was made under (round 3, decision 12), unless
  // the source's row shape is newer than the stored load's (round 4, decision 11).
  const shape = src.rowShape ?? 0;
  const base = baselineOf(cur.loaded_at ? { rows: Number(cur.row_count ?? 0), loadedAt: cur.loaded_at, facets: cur.facets, rowShape: Number(cur.row_shape ?? 0) } : null, shape);
  await pool.query(`DELETE FROM research_bulk_rows WHERE source = $1 AND generation = $2`, [src.id, gen]);
  let n = 0;
  let batch: { words: string[]; hit: unknown }[] = [];
  // What the whole load is indexed by ("b:", "p:", "l:", "t:", "a:") and the kinds of its records, for the coverage page.
  const prefixes = new Set<string>(), kinds = new Set<string>();
  const components: Record<string, number> = {};
  const flush = async () => {
    if (!batch.length) return;
    await pool.query(
      `INSERT INTO research_bulk_rows (source, generation, words, hit)
       SELECT $1, $2, w.words, w.hit FROM jsonb_to_recordset($3::jsonb) AS w(words text[], hit jsonb)`,
      [src.id, gen, JSON.stringify(batch)],
    );
    batch = [];
  };
  try {
    for await (const h of src.load()) {
      const { hit, keys } = rowKeys(h);
      const words = indexWords(h.business, h.person, h.people, keys);
      if (!words.length) continue;
      for (const w of words) prefixes.add(w.slice(0, 2));
      kinds.add(h.kind === "license" ? "license" : (h.hit as EnforcementHit).category ?? "other");
      if (h.component) components[h.component] = (components[h.component] ?? 0) + 1;
      batch.push({ words, hit: { k: h.kind, h: hit, v: PAYLOAD_VERSION } });
      n++;
      if (batch.length >= BATCH) await flush();
    }
    await flush();
    if (n < src.minRows) throw new Error(`only ${n} rows (expected at least ${src.minRows}); kept the previous load`);
    const short = shortfall(n, components, base);
    if (short) throw new Error(`${short}: not more than ${Math.round(MIN_SHARE_OF_PREVIOUS * 100)}% of the last full load; kept the previous load`);
  } catch (err: any) {
    await pool.query(`DELETE FROM research_bulk_rows WHERE source = $1 AND generation = $2`, [src.id, gen]);
    await pool.query(`UPDATE research_bulk_sources SET error = $2 WHERE id = $1`, [src.id, String(err?.message ?? err).slice(0, 500)]);
    throw err;
  }
  const facets = { prefixes: Array.from(prefixes).sort(), kinds: Array.from(kinds).sort(), ...(Object.keys(components).length ? { components } : {}), baseline: nextBaseline(n, components, base) };
  await pool.query(`UPDATE research_bulk_sources SET generation = $2, row_count = $3, loaded_at = now(), error = NULL, facets = $4, key_version = $5, row_shape = $6 WHERE id = $1`,
    [src.id, gen, n, JSON.stringify(facets), KEY_VERSION, shape]);
  await pool.query(`DELETE FROM research_bulk_rows WHERE source = $1 AND generation <> $2`, [src.id, gen]);
  return n;
}

/** One pass of purgeLegacyKeys reads this many table pages at a time (a TID range scan: about 2,000 rows, no sort). */
const PURGE_PAGES = 200;
/** Bump to run the purge again under a newer rule. */
export const PURGE_JOB = "purge-legacy-contact-keys-v1";

/**
 * The phone and street keys ("t:", "a:") of stored rows that today's rules don't allow, removed from the index once,
 * whether or not their source ever reloads (A10, decision 5): a license row whose holder is not a business by today's
 * rule (readStored: the stored holder from before HOLDER_VERSION is recomputed by the source's legacyHolder, or else
 * unknown), and an enforcement row that its source's current subject rule drops or strips of its address. The row
 * itself stays (it is still found by name or license number, and read through readStored); only those keys go.
 *
 * Done in place: one pass over the table's pages, PURGE_PAGES pages per read (a TID range scan), an UPDATE of the affected rows only
 * (no copy of the table, no VACUUM FULL; autovacuum reclaims the old row versions). Recorded in research_bulk_jobs, so
 * it runs once. `sources` gives each row's legacy hooks by source id (a source no longer listed has none).
 */
export async function purgeLegacyKeys(sources: BulkSource[], log = (m: string) => console.log(`[research-bulk] ${m}`)): Promise<{ scanned: number; purged: number; bySource: Record<string, number> } | null> {
  await bulkSchemaReady();
  const { rows: done } = await pool.query(`SELECT 1 FROM research_bulk_jobs WHERE name = $1`, [PURGE_JOB]);
  if (done.length) return null;
  const byId = new Map(sources.map((s) => [s.id, s]));
  // The table's pages as they are now: a row the purge rewrites lands at the end, already without those keys.
  const { rows: [size] } = await pool.query(`SELECT (pg_relation_size('research_bulk_rows') / current_setting('block_size')::bigint)::bigint AS pages`);
  const pages = Number(size?.pages ?? 0);
  let scanned = 0, purged = 0;
  const bySource: Record<string, number> = {};
  for (let page = 0; page < pages; page += PURGE_PAGES) {
    const { rows } = await pool.query(
      `SELECT ctid::text AS tid, source, words, hit FROM research_bulk_rows WHERE ctid >= $1::tid AND ctid < $2::tid`,
      [`(${page},0)`, `(${page + PURGE_PAGES},0)`],
    );
    scanned += rows.length;
    const updates: { ctid: string; words: string[] }[] = [];
    for (const r of rows) {
      const contact = (r.words as string[]).filter((w) => w.startsWith("a:") || w.startsWith("t:"));
      if (!contact.length) continue;
      const read = readStored(byId.get(r.source) ?? {}, r.hit);
      if (read?.keysSafe) continue;
      updates.push({ ctid: r.tid, words: (r.words as string[]).filter((w) => !w.startsWith("a:") && !w.startsWith("t:")) });
      bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    }
    if (updates.length) {
      await pool.query(
        // "ctid = ANY" keeps it a TID scan of those rows only.
        `UPDATE research_bulk_rows r SET words = u.words FROM jsonb_to_recordset($1::jsonb) AS u(ctid text, words text[])
         WHERE r.ctid = ANY($2::tid[]) AND r.ctid = u.ctid::tid`,
        [JSON.stringify(updates), updates.map((u) => u.ctid)],
      );
      purged += updates.length;
    }
    await sleep(20);
  }
  await pool.query(`INSERT INTO research_bulk_jobs (name, detail) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`, [PURGE_JOB, JSON.stringify({ scanned, purged, bySource })]);
  log(`purged phone/address keys of ${purged} stored row(s) that today's rules don't allow (${scanned} scanned)`);
  return { scanned, purged, bySource };
}

export type BulkStatus = { loaded: boolean; rows: number; loadedAt: string | null; error: string | null; keyVersion: number };

export async function sourceStatus(id: string): Promise<BulkStatus> {
  await bulkSchemaReady();
  const { rows: [r] } = await pool.query(`SELECT row_count, loaded_at, error, key_version FROM research_bulk_sources WHERE id = $1`, [id]);
  return { loaded: !!r?.loaded_at, rows: Number(r?.row_count ?? 0), loadedAt: r?.loaded_at ? new Date(r.loaded_at).toISOString() : null, error: r?.error ?? null, keyVersion: Number(r?.key_version ?? 0) };
}

export type StoredHit = { kind: "license"; hit: LicenseHit } | { kind: "enforcement"; hit: EnforcementHit };

/**
 * A stored row as a search may return it (round 3, decision 4), for every generation, whenever it was loaded: a
 * license gets the privacy and status rules again (an individual's or unknown holder's street, phone and
 * disciplinary words removed, its discipline dropped); an enforcement row stored under an older PAYLOAD_VERSION has
 * its subject checked again by the source's current rule, or else dropped unless its name reads as a business.
 * A license row stored before HOLDER_VERSION doesn't keep the holder it was stored with (round 4, decision 3): it gets
 * the source's current rule on the stored fields (legacyHolder), or null.
 */
export function readRow(src: Pick<BulkSource, "legacyEnforcement" | "legacyHolder" | "enforcementRuleVersion">, row: { k: "license" | "enforcement"; h: any; v?: number }): StoredHit | null {
  return readStored(src, row)?.stored ?? null;
}

/**
 * readRow, plus whether the row's phone and address keys are still safe to match (round 4, decision 3): a license
 * only when its holder is a business by today's rule, an enforcement record only when it is current or its subject
 * check left its address as stored. A key stored under an older rule never matches otherwise, whether or not the
 * source has reloaded since.
 */
export function readStored(src: Pick<BulkSource, "legacyEnforcement" | "legacyHolder" | "enforcementRuleVersion">, row: { k: "license" | "enforcement"; h: any; v?: number }): { stored: StoredHit; keysSafe: boolean } | null {
  const v = row.v ?? 0;
  if (row.k === "license") {
    const stored = row.h as LicenseHit;
    const h = v >= HOLDER_VERSION ? stored : { ...stored, holder: src.legacyHolder ? src.legacyHolder(stored) ?? null : null };
    const p = privateHit(h);
    const keysSafe = !isIndividual(p);
    if (keysSafe || p.discipline === undefined) return { stored: { kind: "license", hit: p }, keysSafe };
    const { discipline: _d, ...rest } = p;
    return { stored: { kind: "license", hit: rest as LicenseHit }, keysSafe };
  }
  const h = row.h as EnforcementHit;
  if (v >= (src.enforcementRuleVersion ?? ENFORCEMENT_RULE_VERSION)) return { stored: { kind: "enforcement", hit: h }, keysSafe: true };
  const fixed = src.legacyEnforcement ? src.legacyEnforcement(h, v) : (h.name ?? "").split(/\s+\/\s+|;/).some((n) => looksLikeBusiness(n)) ? h : null;
  return fixed ? { stored: { kind: "enforcement", hit: fixed }, keysSafe: (fixed.address ?? null) === (h.address ?? null) && (fixed.phone ?? null) === (h.phone ?? null) } : null;
}

const readRows = (src: BulkSource, rows: { hit: any }[]): StoredHit[] => rows.map((r) => readRow(src, r.hit)).filter((h): h is StoredHit => !!h);
/** Rows found by a phone or address key: only those whose keys are still safe by today's rules (readStored). */
const readKeyed = (src: BulkSource, rows: { hit: any }[]): StoredHit[] => rows.map((r) => readStored(src, r.hit)).filter((r) => !!r?.keysSafe).map((r) => r!.stored);

/** Rows a name search reads from one file (past this, the report says it is showing the first ones). */
export const BULK_LIMIT = 500;
/** Rows an identifier search reads from one file. */
export const BULK_ID_LIMIT = 200;

/** Hits in one source where every word of the name is a word of the business name (company) or the person (person). */
export async function searchBulk(src: BulkSource, name: string, kind: "person" | "company", limit = BULK_LIMIT): Promise<{ hits: StoredHit[]; status: BulkStatus }> {
  const status = await sourceStatus(src.id);
  if (!status.loaded) return { hits: [], status };
  const want = tokens(name).map((w) => `${kind === "company" ? "b" : "p"}:${w}`);
  if (!want.length) return { hits: [], status };
  const { rows } = await pool.query(
    `SELECT r.hit FROM research_bulk_rows r JOIN research_bulk_sources s ON s.id = r.source AND s.generation = r.generation
     WHERE r.source = $1 AND r.words @> $2::text[] LIMIT $3`,
    [src.id, want, limit],
  );
  return { hits: readRows(src, rows), status };
}

/** Index candidates an address search reads, at most, before the re-check (past it the note says so). */
export const BULK_ADDRESS_CANDIDATES = 5000;

/**
 * Hits in one source that carry this license number, phone or street address. An address search re-checks every
 * candidate (house number + first street word) against the whole address, and the limit applies after that re-check,
 * so a page of candidates from another town can't hide the right one; when the candidates themselves run past
 * BULK_ADDRESS_CANDIDATES the note says so. A load made under an older key format is not searched by phone or
 * address (`stale`): its keys may be an individual's.
 */
export async function searchBulkBy(src: BulkSource, q: IdQuery, limit = BULK_ID_LIMIT): Promise<{ hits: StoredHit[]; status: BulkStatus; note?: string; stale?: boolean }> {
  const status = await sourceStatus(src.id);
  // An address is searched by house number and street word; the ZIP is checked on the hit (not every file has one).
  const want = queryWords(q).filter((w) => !w.startsWith("z:"));
  if (!status.loaded || !want.length) return { hits: [], status };
  if (q.type !== "license" && status.keyVersion < KEY_VERSION) return { hits: [], status, stale: true };
  const sql = `SELECT r.hit FROM research_bulk_rows r JOIN research_bulk_sources s ON s.id = r.source AND s.generation = r.generation
     WHERE r.source = $1 AND r.words @> $2::text[] ORDER BY r.ctid LIMIT $3 OFFSET $4`;
  if (q.type !== "address") {
    const { rows } = await pool.query(sql, [src.id, want, limit, 0]);
    return { hits: q.type === "license" ? readRows(src, rows) : readKeyed(src, rows), status, ...(rows.length >= limit ? { note: capNote(limit, null, "records") } : {}) };
  }
  const hits: StoredHit[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < BULK_ADDRESS_CANDIDATES; offset += PAGE) {
    const { rows } = await pool.query(sql, [src.id, want, PAGE, offset]);
    for (const h of readKeyed(src, rows)) {
      if (addressMatches(q.value, h.hit.address)) hits.push(h);
      if (hits.length >= limit) return { hits, status, note: capNote(limit, null, "records at this address") };
    }
    if (rows.length < PAGE) return { hits, status };
  }
  return { hits, status, note: `only the first ${BULK_ADDRESS_CANDIDATES} records with this house number and street word were checked; there are more` };
}

// ── Download + parse helpers ──────────────────────────────────────────────────────────────────────────────────

/** Download a file to a temp path (large files: streamed, a generous timeout; redirects followed hop by hop, each guarded). The caller deletes it. */
export async function download(url: string, init: RequestInit = {}, timeoutMs = 20 * 60_000): Promise<string> {
  const res = await fetchWithDeadline(url, init, timeoutMs, 2000);
  if (!res.ok || !res.body) { await res.body?.cancel().catch(() => undefined); throw new Error(`HTTP ${res.status} for ${url}`); }
  const path = join(tmpdir(), `ch-bulk-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try { await pipeline(Readable.fromWeb(res.body as any), createWriteStream(path)); }
  catch (err) { await fs.rm(path, { force: true }); throw err; }
  return path;
}

/**
 * A plain HTTPS request with only the headers given (fetch() always adds browser-style Sec-Fetch headers, which some
 * agency firewalls reject on form posts). Follows no redirects; the caller reads the body.
 */
export async function plainRequest(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number; totalMs?: number; minDelayMs?: number } = {}): Promise<IncomingMessage> {
  // This request's own turn (round 4, finding 12): released once, when the headers are in or the request failed. A turn
  // held past its limit aborts the request while it still waits for headers; the body is bounded by totalMs.
  const turn = await guard(url, opts.minDelayMs ?? 1000);
  const res = await new Promise<IncomingMessage>((resolve, reject) => {
    let onAbort = () => {};
    const settle = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => { turn.signal.removeEventListener("abort", onAbort); turn.release(); fn(...a); };
    resolve = settle(resolve); reject = settle(reject);
    const body = opts.body ?? null;
    const totalMs = opts.totalMs ?? 30 * 60_000;
    const req = httpsRequest(url, {
      method: opts.method ?? "GET",
      headers: { "user-agent": USER_AGENT, ...(opts.headers ?? {}), ...(body != null ? { "content-length": String(Buffer.byteLength(body)) } : {}) },
      timeout: opts.timeoutMs ?? 60_000,
    }, (res) => {
      // The socket timeout only catches silence; this deadline covers the whole response, body included.
      const total = setTimeout(() => res.destroy(new Error(`response not finished in ${Math.round(totalMs / 1000)}s: ${url}`)), totalMs);
      (total as { unref?: () => void }).unref?.();
      res.once("close", () => clearTimeout(total));
      resolve(res);
    });
    req.on("timeout", () => req.destroy(new Error(`timed out: ${url}`)));
    onAbort = () => req.destroy(new Error(`no response before the host's turn ended: ${url}`));
    if (turn.signal.aborted) onAbort(); else turn.signal.addEventListener("abort", onAbort, { once: true });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
  // A 401/403 blocks the host for every caller; a Retry-After sets its cooldown.
  try { noteResponse(url, res.statusCode ?? 0, res.headers["retry-after"] as string | undefined); }
  catch (err) { res.resume(); throw err; }
  // The URL that answered, for the challenge check when the body is read (A10, finding 6).
  answeredUrl.set(res, url);
  return res;
}

const answeredUrl = new WeakMap<IncomingMessage, string>();
/** A 2xx HTML body from plainRequest checked for a bot challenge (blocks the host that answered, and throws). */
const checkPlainBody = (res: IncomingMessage, body: string) => {
  const url = answeredUrl.get(res);
  if (url && isHtmlType(String(res.headers["content-type"] ?? ""))) refuseChallengeBody(url, res.statusCode ?? 0, body);
};

export async function readText(res: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of res) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  checkPlainBody(res, text);
  return text;
}

/** Stream a plainRequest response to a temp file (the caller deletes it). */
export async function saveResponse(res: IncomingMessage): Promise<string> {
  if ((res.statusCode ?? 0) >= 400) { res.resume(); throw new Error(`HTTP ${res.statusCode}`); }
  const path = join(tmpdir(), `ch-bulk-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try { await pipeline(res, createWriteStream(path)); }
  catch (err) { await fs.rm(path, { force: true }); throw err; }
  // An HTML answer where a file was expected may be a bot challenge (A10, finding 6): its start is checked.
  if (answeredUrl.has(res) && isHtmlType(String(res.headers["content-type"] ?? ""))) {
    const head = await fs.open(path).then(async (fh) => { const b = Buffer.alloc(64 * 1024); const { bytesRead } = await fh.read(b, 0, b.length, 0); await fh.close(); return b.subarray(0, bytesRead).toString("utf8"); });
    try { checkPlainBody(res, head); } catch (err) { await fs.rm(path, { force: true }); throw err; }
  }
  // A cut-off chunked response can end "cleanly"; a Content-Length mismatch is the one check available.
  const want = Number(res.headers["content-length"]);
  if (want && (await fs.stat(path)).size !== want) { await fs.rm(path, { force: true }); throw new Error("download cut off"); }
  return path;
}

/** Decode: UTF-8, falling back to Windows-1252 when the bytes aren't valid UTF-8 (some DBPR files). */
function decoderFor(sample: Buffer): TextDecoder {
  try { new TextDecoder("utf-8", { fatal: true }).decode(sample.subarray(0, sample.length - 4)); return new TextDecoder("utf-8"); }
  catch { return new TextDecoder("windows-1252"); }
}

/** The longest field a CSV row may hold: past it the file is malformed (an unclosed quote swallowing the rest). */
export const MAX_CSV_FIELD = 1 << 20;
/** The longest record (all its fields together) and the most columns a CSV row may hold (round 2, decision 11). */
export const MAX_CSV_RECORD = 4 << 20;
export const MAX_CSV_COLUMNS = 2000;

/**
 * RFC 4180 rows from a file (quoted fields may hold the delimiter, quotes and newlines). A quote left open at the
 * end, a field over MAX_CSV_FIELD, a record over MAX_CSV_RECORD characters or MAX_CSV_COLUMNS columns throws (every
 * append is checked, escaped quotes included): the load keeps the previous data.
 */
export async function* csvRows(path: string, delimiter = ","): AsyncIterable<string[]> {
  const head = await fs.open(path).then(async (fh) => { const b = Buffer.alloc(1 << 20); const { bytesRead } = await fh.read(b, 0, b.length, 0); await fh.close(); return b.subarray(0, bytesRead); });
  yield* parseCsv(createReadStream(path) as AsyncIterable<Buffer>, decoderFor(head), delimiter);
}

/**
 * The same rows from a stream of bytes (a zip member read with `unzip -p`), so a large file is never written to disk.
 * The encoding is decided from the first megabyte, as for a file.
 */
export async function* csvRowsFrom(chunks: AsyncIterable<Buffer>, delimiter = ","): AsyncIterable<string[]> {
  const it = chunks[Symbol.asyncIterator]();
  const first: Buffer[] = [];
  let size = 0, done = false;
  while (size < 1 << 20) {
    const r = await it.next();
    if (r.done) { done = true; break; }
    first.push(r.value); size += r.value.length;
  }
  const head = Buffer.concat(first);
  async function* rest(): AsyncIterable<Buffer> {
    if (head.length) yield head;
    if (done) return;
    for (let r = await it.next(); !r.done; r = await it.next()) yield r.value;
  }
  yield* parseCsv(rest(), decoderFor(head.subarray(0, 1 << 20)), delimiter);
}

async function* parseCsv(chunks: AsyncIterable<Buffer>, dec: TextDecoder, delimiter: string): AsyncIterable<string[]> {
  let field = "", row: string[] = [], inQ = false, pendingQ = false, recordLen = 0;
  const add = (c: string) => {
    field += c;
    if (field.length > MAX_CSV_FIELD) throw new Error(`malformed CSV: a ${inQ ? "quoted " : ""}field runs past ${MAX_CSV_FIELD} characters`);
    if (++recordLen > MAX_CSV_RECORD) throw new Error(`malformed CSV: a record runs past ${MAX_CSV_RECORD} characters`);
  };
  const endField = () => {
    row.push(field); field = "";
    if (row.length > MAX_CSV_COLUMNS) throw new Error(`malformed CSV: a record has more than ${MAX_CSV_COLUMNS} columns`);
  };
  for await (const chunk of chunks) {
    const s = dec.decode(chunk, { stream: true });
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQ) {
        if (pendingQ) {
          pendingQ = false;
          if (c === '"') { add('"'); continue; }
          inQ = false; // closing quote; fall through to handle c unquoted
        } else if (c === '"') { pendingQ = true; continue; }
        else { add(c); continue; }
      }
      if (c === '"' && field === "") { inQ = true; continue; }
      if (c === delimiter) { endField(); recordLen++; continue; }
      if (c === "\n") { if (field.endsWith("\r")) field = field.slice(0, -1); endField(); yield row; row = []; recordLen = 0; continue; }
      add(c);
    }
  }
  if (pendingQ) inQ = false;
  if (inQ) throw new Error("malformed CSV: the file ends inside a quoted field (cut off?)");
  if (field !== "" || row.length) { row.push(field.replace(/\r$/, "")); yield row; }
}

/** Rows as objects keyed by the header row. */
export async function* csvRecords(path: string, delimiter = ","): AsyncIterable<Record<string, string>> {
  yield* recordsOf(csvRows(path, delimiter));
}

/** Rows of a stream as objects keyed by the header row (csvRowsFrom). */
export async function* csvRecordsFrom(chunks: AsyncIterable<Buffer>, delimiter = ","): AsyncIterable<Record<string, string>> {
  yield* recordsOf(csvRowsFrom(chunks, delimiter));
}

async function* recordsOf(rows: AsyncIterable<string[]>): AsyncIterable<Record<string, string>> {
  let header: string[] | null = null;
  for await (const r of rows) {
    if (!header) { header = r.map((h) => h.trim().replace(/^﻿/, "")); continue; }
    if (r.length === 1 && r[0] === "") continue;
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    yield o;
  }
}

/** Whole lines of a text file (fixed-width layouts). */
export async function* lines(path: string, encoding: "latin1" | "utf8" = "latin1"): AsyncIterable<string> {
  let rest = "";
  for await (const chunk of createReadStream(path, { encoding })) {
    const parts = (rest + chunk).split(/\r?\n/);
    rest = parts.pop() ?? "";
    for (const l of parts) yield l;
  }
  if (rest) yield rest;
}

/** MM/DD/YYYY (or M/D/YYYY) → YYYY-MM-DD; anything else → null. */
export function usDate(v: string | null | undefined): string | null {
  const m = v?.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!m || m[3] === "0000" || Number(m[3]) < 1900) return null;
  const [y, mo, d] = [Number(m[3]), Number(m[1]), Number(m[2])];
  // A month or day out of range ("13/40/2018") is not a date: null, never a made-up one.
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

export const clean = (v: string | null | undefined): string | null => { const t = v?.replace(/\s+/g, " ").trim(); return t ? t : null; };

// ── Schedule ──────────────────────────────────────────────────────────────────────────────────────────────────

let refreshing = false;
/** Load every source that is due, one at a time (files are large; the hosts are government servers). */
export async function refreshDueSources(sources: BulkSource[], log = (m: string) => console.log(`[research-bulk] ${m}`)): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    await bulkSchemaReady();
    const { rows: state } = await pool.query(`SELECT id, loaded_at, attempted_at, key_version FROM research_bulk_sources`);
    const byId = new Map(state.map((r) => [r.id as string, r]));
    // A load under an older key format is refreshed first, whatever its interval (round 2, decision 2).
    const stale = (src: BulkSource) => { const r = byId.get(src.id); return !!r?.loaded_at && Number(r.key_version ?? 0) < KEY_VERSION; };
    // A source with a download window that is open now goes first, so a long queue of other reloads can't push it
    // past its window (CSLB on 2026-10-15: reached at 12:52 UTC behind the key-format reloads, and cut off).
    const open = (src: BulkSource) => !!src.utcHours?.includes(new Date().getUTCHours());
    const ordered = [...sources.filter(open), ...sources.filter((s) => !open(s) && stale(s)), ...sources.filter((s) => !open(s) && !stale(s))];
    for (const src of ordered) {
      const r = byId.get(src.id);
      const due = (t: Date | null, hours: number) => !t || Date.now() - new Date(t).getTime() > hours * 3600_000;
      // A failed source waits 6 hours before the next try; a loaded one waits its full interval (an old key format: due now).
      if ((!stale(src) && !due(r?.loaded_at ?? null, src.everyHours)) || !due(r?.attempted_at ?? null, src.utcHours ? 1 : 6)) continue;
      if (src.utcHours && !src.utcHours.includes(new Date().getUTCHours())) continue;
      const t0 = Date.now();
      try {
        const n = await loadSource(src);
        log(`${src.id}: loaded ${n} rows in ${Math.round((Date.now() - t0) / 1000)}s`);
      } catch (err: any) {
        log(`${src.id}: load failed: ${String(err?.message ?? err).slice(0, 300)}`);
      }
      await sleep(5_000);
    }
  } finally {
    refreshing = false;
  }
}
