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
import { USER_AGENT, rateLimitHost, sleep } from "../scrapers/polite-fetch";
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { tokens } from "./licenses";

export type BulkHit =
  | { kind: "license"; hit: LicenseHit; business: string | null; person: string | null }
  | { kind: "enforcement"; hit: EnforcementHit; business: string | null; person: string | null };

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
`;

let ready: Promise<void> | null = null;
export function bulkSchemaReady(): Promise<void> {
  ready ??= pool.query(DDL).then(() => undefined).catch((err) => { ready = null; throw err; });
  return ready;
}

/** Index words: "b:" for a business name, "p:" for a person, so a company search never matches an officer's surname. */
export function indexWords(business: string | null, person: string | null): string[] {
  const out = new Set<string>();
  for (const w of tokens(business ?? "")) out.add(`b:${w}`);
  for (const w of tokens(person ?? "")) out.add(`p:${w}`);
  return Array.from(out);
}

const BATCH = 2000;

/** Download, parse and swap in one source. Returns the row count. */
export async function loadSource(src: BulkSource): Promise<number> {
  await bulkSchemaReady();
  await pool.query(`INSERT INTO research_bulk_sources (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [src.id]);
  await pool.query(`UPDATE research_bulk_sources SET attempted_at = now() WHERE id = $1`, [src.id]);
  const { rows: [cur] } = await pool.query(`SELECT generation FROM research_bulk_sources WHERE id = $1`, [src.id]);
  const gen = Number(cur.generation) + 1;
  await pool.query(`DELETE FROM research_bulk_rows WHERE source = $1 AND generation = $2`, [src.id, gen]);
  let n = 0;
  let batch: { words: string[]; hit: unknown }[] = [];
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
      const words = indexWords(h.business, h.person);
      if (!words.length) continue;
      batch.push({ words, hit: { k: h.kind, h: h.hit } });
      n++;
      if (batch.length >= BATCH) await flush();
    }
    await flush();
    if (n < src.minRows) throw new Error(`only ${n} rows (expected at least ${src.minRows}); kept the previous load`);
  } catch (err: any) {
    await pool.query(`DELETE FROM research_bulk_rows WHERE source = $1 AND generation = $2`, [src.id, gen]);
    await pool.query(`UPDATE research_bulk_sources SET error = $2 WHERE id = $1`, [src.id, String(err?.message ?? err).slice(0, 500)]);
    throw err;
  }
  await pool.query(`UPDATE research_bulk_sources SET generation = $2, row_count = $3, loaded_at = now(), error = NULL WHERE id = $1`, [src.id, gen, n]);
  await pool.query(`DELETE FROM research_bulk_rows WHERE source = $1 AND generation <> $2`, [src.id, gen]);
  return n;
}

export type BulkStatus = { loaded: boolean; rows: number; loadedAt: string | null; error: string | null };

export async function sourceStatus(id: string): Promise<BulkStatus> {
  await bulkSchemaReady();
  const { rows: [r] } = await pool.query(`SELECT row_count, loaded_at, error FROM research_bulk_sources WHERE id = $1`, [id]);
  return { loaded: !!r?.loaded_at, rows: Number(r?.row_count ?? 0), loadedAt: r?.loaded_at ? new Date(r.loaded_at).toISOString() : null, error: r?.error ?? null };
}

export type StoredHit = { kind: "license"; hit: LicenseHit } | { kind: "enforcement"; hit: EnforcementHit };

/** Hits in one source where every word of the name is a word of the business name (company) or the person (person). */
export async function searchBulk(src: BulkSource, name: string, kind: "person" | "company", limit = 500): Promise<{ hits: StoredHit[]; status: BulkStatus }> {
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

// ── Download + parse helpers ──────────────────────────────────────────────────────────────────────────────────

/** Download a file to a temp path (large files: streamed, a generous timeout). The caller deletes it. */
export async function download(url: string, init: RequestInit = {}, timeoutMs = 20 * 60_000): Promise<string> {
  await rateLimitHost(url, 2000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers ?? {});
    if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
    const res = await fetch(url, { ...init, headers, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
    const path = join(tmpdir(), `ch-bulk-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try { await pipeline(Readable.fromWeb(res.body as any), createWriteStream(path)); }
    catch (err) { await fs.rm(path, { force: true }); throw err; }
    return path;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A plain HTTPS request with only the headers given (fetch() always adds browser-style Sec-Fetch headers, which some
 * agency firewalls reject on form posts). Follows no redirects; the caller reads the body.
 */
export function plainRequest(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const body = opts.body ?? null;
    const req = httpsRequest(url, {
      method: opts.method ?? "GET",
      headers: { "user-agent": USER_AGENT, ...(opts.headers ?? {}), ...(body != null ? { "content-length": String(Buffer.byteLength(body)) } : {}) },
      timeout: opts.timeoutMs ?? 60_000,
    }, resolve);
    req.on("timeout", () => req.destroy(new Error(`timed out: ${url}`)));
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
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

/** RFC 4180 rows from a file (quoted fields may hold the delimiter, quotes and newlines). */
export async function* csvRows(path: string, delimiter = ","): AsyncIterable<string[]> {
  const head = await fs.open(path).then(async (fh) => { const b = Buffer.alloc(1 << 20); const { bytesRead } = await fh.read(b, 0, b.length, 0); await fh.close(); return b.subarray(0, bytesRead); });
  const dec = decoderFor(head);
  let field = "", row: string[] = [], inQ = false, pendingQ = false;
  for await (const chunk of createReadStream(path)) {
    const s = dec.decode(chunk as Buffer, { stream: true });
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQ) {
        if (pendingQ) {
          pendingQ = false;
          if (c === '"') { field += '"'; continue; }
          inQ = false; // closing quote; fall through to handle c unquoted
        } else if (c === '"') { pendingQ = true; continue; }
        else { field += c; continue; }
      }
      if (c === '"' && field === "") { inQ = true; continue; }
      if (c === delimiter) { row.push(field); field = ""; continue; }
      if (c === "\n") { row.push(field.endsWith("\r") ? field.slice(0, -1) : field); yield row; row = []; field = ""; continue; }
      field += c;
    }
  }
  if (pendingQ) inQ = false;
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
    for (const src of sources) {
      const { rows: [r] } = await pool.query(`SELECT loaded_at, attempted_at FROM research_bulk_sources WHERE id = $1`, [src.id]);
      const due = (t: Date | null, hours: number) => !t || Date.now() - new Date(t).getTime() > hours * 3600_000;
      // A failed source waits 6 hours before the next try; a loaded one waits its full interval.
      if (!due(r?.loaded_at ?? null, src.everyHours) || !due(r?.attempted_at ?? null, src.utcHours ? 1 : 6)) continue;
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
