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
import { USER_AGENT, fetchWithDeadline, guard, noteResponse, sleep, withRun } from "./http";
import type { EnforcementCategory, EnforcementHit, LicenseHit } from "@shared/research-reports";
import { tokens } from "./licenses";
import { addressMatches, idWords, queryWords, type IdKeys, type IdQuery } from "./identifiers";
import { capNote } from "./notes";
import { isIndividual, privateHit, privateKeys } from "./privacy";

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
`;

/**
 * The format of a load's identifier keys. Version 2 (round 2, decision 2): phone and street keys only for a license
 * a business holds. A source loaded under an older version is refreshed first, and until then its "a:"/"t:" keys are
 * not searched (they may be an individual's home address or phone).
 */
export const KEY_VERSION = 2;
/** A new load with fewer rows than this share of the previous one (or of one component's) is kept out as an error. */
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
 * The 70% rule (round 2, decision 10): a load under MIN_SHARE_OF_PREVIOUS of the previous generation's rows, or a
 * component under that share of its previous count (or missing), is not swapped in. Null when the load may stand.
 */
export function shortfall(n: number, components: Record<string, number>, prev: { rows: number; components?: Record<string, number> | null } | null): string | null {
  if (!prev || prev.rows <= 0) return null;
  if (n < prev.rows * MIN_SHARE_OF_PREVIOUS) return `${n} rows, previous ${prev.rows}`;
  const short = Object.entries(prev.components ?? {}).filter(([c, m]) => m > 0 && (components[c] ?? 0) < m * MIN_SHARE_OF_PREVIOUS)
    .map(([c, m]) => `${c}: ${components[c] ?? 0} rows, previous ${m}`);
  return short.length ? short.join("; ") : null;
}

/** Download, parse and swap in one source. Returns the row count. */
export async function loadSource(src: BulkSource): Promise<number> {
  return withRun(() => loadSourceRun(src));
}

async function loadSourceRun(src: BulkSource): Promise<number> {
  await bulkSchemaReady();
  await pool.query(`INSERT INTO research_bulk_sources (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [src.id]);
  await pool.query(`UPDATE research_bulk_sources SET attempted_at = now() WHERE id = $1`, [src.id]);
  const { rows: [cur] } = await pool.query(`SELECT generation, row_count, loaded_at, facets FROM research_bulk_sources WHERE id = $1`, [src.id]);
  const gen = Number(cur.generation) + 1;
  const prev = cur.loaded_at ? { rows: Number(cur.row_count ?? 0), components: (cur.facets?.components ?? null) as Record<string, number> | null } : null;
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
      batch.push({ words, hit: { k: h.kind, h: hit } });
      n++;
      if (batch.length >= BATCH) await flush();
    }
    await flush();
    if (n < src.minRows) throw new Error(`only ${n} rows (expected at least ${src.minRows}); kept the previous load`);
    const short = shortfall(n, components, prev);
    if (short) throw new Error(`${short}: under ${Math.round(MIN_SHARE_OF_PREVIOUS * 100)}% of the previous load; kept the previous load`);
  } catch (err: any) {
    await pool.query(`DELETE FROM research_bulk_rows WHERE source = $1 AND generation = $2`, [src.id, gen]);
    await pool.query(`UPDATE research_bulk_sources SET error = $2 WHERE id = $1`, [src.id, String(err?.message ?? err).slice(0, 500)]);
    throw err;
  }
  const facets = { prefixes: Array.from(prefixes).sort(), kinds: Array.from(kinds).sort(), ...(Object.keys(components).length ? { components } : {}) };
  await pool.query(`UPDATE research_bulk_sources SET generation = $2, row_count = $3, loaded_at = now(), error = NULL, facets = $4, key_version = $5 WHERE id = $1`,
    [src.id, gen, n, JSON.stringify(facets), KEY_VERSION]);
  await pool.query(`DELETE FROM research_bulk_rows WHERE source = $1 AND generation <> $2`, [src.id, gen]);
  return n;
}

export type BulkStatus = { loaded: boolean; rows: number; loadedAt: string | null; error: string | null; keyVersion: number };

export async function sourceStatus(id: string): Promise<BulkStatus> {
  await bulkSchemaReady();
  const { rows: [r] } = await pool.query(`SELECT row_count, loaded_at, error, key_version FROM research_bulk_sources WHERE id = $1`, [id]);
  return { loaded: !!r?.loaded_at, rows: Number(r?.row_count ?? 0), loadedAt: r?.loaded_at ? new Date(r.loaded_at).toISOString() : null, error: r?.error ?? null, keyVersion: Number(r?.key_version ?? 0) };
}

export type StoredHit = { kind: "license"; hit: LicenseHit } | { kind: "enforcement"; hit: EnforcementHit };

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
  return { hits: rows.map((r) => ({ kind: r.hit.k, hit: r.hit.h })), status };
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
    return { hits: rows.map((r) => ({ kind: r.hit.k, hit: r.hit.h })), status, ...(rows.length >= limit ? { note: capNote(limit, null, "records") } : {}) };
  }
  const hits: StoredHit[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < BULK_ADDRESS_CANDIDATES; offset += PAGE) {
    const { rows } = await pool.query(sql, [src.id, want, PAGE, offset]);
    for (const r of rows) {
      const h: StoredHit = { kind: r.hit.k, hit: r.hit.h };
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
  await guard(url, opts.minDelayMs ?? 1000);
  const res = await new Promise<IncomingMessage>((resolve, reject) => {
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
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
  // A 401/403 blocks the host for every caller; a Retry-After sets its cooldown.
  try { noteResponse(url, res.statusCode ?? 0, res.headers["retry-after"] as string | undefined); }
  catch (err) { res.resume(); throw err; }
  return res;
}

export async function readText(res: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of res) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Stream a plainRequest response to a temp file (the caller deletes it). */
export async function saveResponse(res: IncomingMessage): Promise<string> {
  if ((res.statusCode ?? 0) >= 400) { res.resume(); throw new Error(`HTTP ${res.statusCode}`); }
  const path = join(tmpdir(), `ch-bulk-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try { await pipeline(res, createWriteStream(path)); }
  catch (err) { await fs.rm(path, { force: true }); throw err; }
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
  const dec = decoderFor(head);
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
  for await (const chunk of createReadStream(path)) {
    const s = dec.decode(chunk as Buffer, { stream: true });
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
  let header: string[] | null = null;
  for await (const r of csvRows(path, delimiter)) {
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
    const ordered = [...sources.filter(stale), ...sources.filter((s) => !stale(s))];
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
