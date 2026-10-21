/**
 * Small, dependency-free helpers for the rate adapters: an HTTP getter, a CSV
 * parser and an .xlsx reader (zip central directory + zlib inflateRaw — no
 * spreadsheet package in this repo, and the refresh bundle runs on the server).
 */
import { inflateRawSync } from "node:zlib";
import type { FetchCtx } from "./types";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function makeFetchCtx(opts: { timeoutMs?: number } = {}): FetchCtx {
  const get = async (url: string): Promise<Buffer> => {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
  return { get, getText: async (url) => (await get(url)).toString("utf8") };
}

/** RFC 4180-ish CSV → rows of strings. Handles quotes, doubled quotes and CRLF. */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Entries of a zip archive (stored or deflated), by name. */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip central directory");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const xmlUnescape = (s: string) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&amp;/g, "&");

const colIndex = (ref: string) => {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/**
 * Read an .xlsx workbook → { sheetName: rows of cell strings }. Numbers come back
 * as their stored text ("0.0920"), shared and inline strings as text. Dates stay
 * as Excel serial numbers (see excelSerialToIso).
 */
export function readXlsx(buf: Buffer): Record<string, string[][]> {
  const z = unzip(buf);
  const text = (n: string) => z.get(n)?.toString("utf8") ?? "";
  const shared: string[] = [];
  for (const si of text("xl/sharedStrings.xml").match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    shared.push(xmlUnescape((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
  }
  const wb = text("xl/workbook.xml");
  const rels = text("xl/_rels/workbook.xml.rels");
  const relTarget = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/Id="([^"]+)"/)?.[1];
    const target = m[0].match(/Target="([^"]+)"/)?.[1];
    if (id && target) relTarget.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }
  const out: Record<string, string[][]> = {};
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlUnescape(m[0].match(/name="([^"]*)"/)?.[1] ?? "");
    const rid = m[0].match(/r:id="([^"]+)"/)?.[1] ?? "";
    const target = relTarget.get(rid);
    if (!target) continue;
    const xml = text(`xl/${target}`);
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
        const t = attrs.match(/t="([^"]+)"/)?.[1];
        const body = c[2] ?? "";
        let v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        if (t === "s") v = shared[Number(v)] ?? "";
        else if (t === "inlineStr") v = (body.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((x) => x.replace(/<[^>]+>/g, "")).join("");
        v = xmlUnescape(v);
        const idx = ref ? colIndex(ref) : row.length;
        while (row.length < idx) row.push("");
        row[idx] = v;
      }
      rows.push(row);
    }
    out[name] = rows;
  }
  return out;
}

/** Excel serial date → YYYY-MM-DD (1900 date system). */
export function excelSerialToIso(serial: number): string {
  return new Date(Math.round((serial - 25569) * 86_400_000)).toISOString().slice(0, 10);
}

/** "BELLINGHAM" / "bellingham" → "Bellingham"; keeps "McX", hyphens and apostrophes sensible. */
export function titleCase(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
    .replace(/(^|[\s\-/(.'])([a-z])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c) => "Mc" + c.toUpperCase())
    .replace(/'S\b/g, "'s");
}

/** Parse "9.2", "9.2%", ".0920", "0.092" into a percent number. `fraction` says the source writes 0.092 for 9.2%. */
export function toPct(raw: string, fraction: boolean): number {
  const n = Number(String(raw).replace(/[%"\s,]/g, ""));
  if (!Number.isFinite(n)) return NaN;
  return Math.round((fraction ? n * 100 : n) * 10_000) / 10_000;
}
