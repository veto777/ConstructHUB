/**
 * A minimal PDF text extractor for the plain, table-shaped lists some agencies publish only as PDF (Excel and
 * Access "Save as PDF" output). It reads each page's text runs with their positions, so a caller can rebuild rows
 * and columns. No dependency: zlib (FlateDecode) is the only filter supported, and fonts are decoded through their
 * ToUnicode map when they have one, else as WinAnsi (Windows-1252). Anything it cannot decode is skipped, never
 * guessed; callers check row counts against a floor, so a layout this can't read fails loudly.
 */
import { inflateSync } from "node:zlib";

export type TextRun = { page: number; x: number; y: number; size: number; text: string };

type PdfVal = number | string | boolean | null | PdfName | PdfRef | PdfVal[] | { [k: string]: PdfVal } | Uint8Array;
class PdfName { constructor(readonly name: string) {} }
class PdfRef { constructor(readonly num: number) {} }
type Dict = { [k: string]: PdfVal };

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set("()<>[]{}/%".split("").map((c) => c.charCodeAt(0)));

/** A tokenizer/parser over PDF object syntax (dicts, arrays, names, strings, numbers, refs). */
class Lexer {
  pos = 0;
  constructor(readonly b: Uint8Array) {}
  private skip() {
    for (;;) {
      while (this.pos < this.b.length && WS.has(this.b[this.pos])) this.pos++;
      if (this.b[this.pos] === 0x25) { while (this.pos < this.b.length && this.b[this.pos] !== 0x0a && this.b[this.pos] !== 0x0d) this.pos++; continue; }
      return;
    }
  }
  /** The next token: a value, or an operator/keyword as { op }. */
  next(): PdfVal | { op: string } | undefined {
    this.skip();
    const b = this.b;
    if (this.pos >= b.length) return undefined;
    const c = b[this.pos];
    if (c === 0x2f) { // /Name
      let s = ""; this.pos++;
      while (this.pos < b.length && !WS.has(b[this.pos]) && !DELIM.has(b[this.pos])) {
        if (b[this.pos] === 0x23 && this.pos + 2 < b.length) { s += String.fromCharCode(parseInt(String.fromCharCode(b[this.pos + 1], b[this.pos + 2]), 16)); this.pos += 3; }
        else s += String.fromCharCode(b[this.pos++]);
      }
      return new PdfName(s);
    }
    if (c === 0x28) return this.literal();
    if (c === 0x3c) {
      if (b[this.pos + 1] === 0x3c) { this.pos += 2; return this.dict(); }
      return this.hex();
    }
    if (c === 0x5b) { this.pos++; const arr: PdfVal[] = []; for (;;) { this.skip(); if (b[this.pos] === 0x5d) { this.pos++; return arr; } const v = this.value(); if (v === undefined) return arr; arr.push(v); } }
    if (c === 0x3e && b[this.pos + 1] === 0x3e) { this.pos += 2; return { op: ">>" }; }
    if (c === 0x5d || c === 0x7b || c === 0x7d) { this.pos++; return { op: String.fromCharCode(c) }; }
    let s = "";
    while (this.pos < b.length && !WS.has(b[this.pos]) && !DELIM.has(b[this.pos])) s += String.fromCharCode(b[this.pos++]);
    if (!s) { this.pos++; return { op: String.fromCharCode(c) }; }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return Number(s);
    if (s === "true" || s === "false") return s === "true";
    if (s === "null") return null;
    return { op: s };
  }
  /** A value, folding "n g R" into a reference. */
  value(): PdfVal | undefined {
    const v = this.next();
    if (v && typeof v === "object" && "op" in (v as object)) return undefined;
    if (typeof v === "number" && Number.isInteger(v)) {
      const save = this.pos;
      const g = this.next();
      if (typeof g === "number") { const r = this.next(); if (r && typeof r === "object" && (r as { op?: string }).op === "R") return new PdfRef(v); }
      this.pos = save;
    }
    return v as PdfVal;
  }
  private dict(): Dict {
    const d: Dict = {};
    for (;;) {
      const k = this.next();
      if (!k || (typeof k === "object" && (k as { op?: string }).op === ">>")) return d;
      if (!(k instanceof PdfName)) continue;
      const v = this.value();
      if (v === undefined) return d;
      d[k.name] = v;
    }
  }
  private literal(): Uint8Array {
    const b = this.b, out: number[] = [];
    let depth = 0; this.pos++;
    while (this.pos < b.length) {
      const c = b[this.pos++];
      if (c === 0x5c) {
        const n = b[this.pos++];
        const map: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c };
        if (n in map) out.push(map[n]);
        else if (n >= 0x30 && n <= 0x37) { let o = n - 0x30; for (let i = 0; i < 2 && b[this.pos] >= 0x30 && b[this.pos] <= 0x37; i++) o = o * 8 + (b[this.pos++] - 0x30); out.push(o & 0xff); }
        else if (n === 0x0d) { if (b[this.pos] === 0x0a) this.pos++; }
        else if (n !== 0x0a) out.push(n);
        continue;
      }
      if (c === 0x28) depth++;
      if (c === 0x29) { if (depth === 0) break; depth--; }
      out.push(c);
    }
    return Uint8Array.from(out);
  }
  private hex(): Uint8Array {
    this.pos++;
    let s = "";
    while (this.pos < this.b.length && this.b[this.pos] !== 0x3e) { const ch = String.fromCharCode(this.b[this.pos++]); if (/[0-9a-fA-F]/.test(ch)) s += ch; }
    this.pos++;
    if (s.length % 2) s += "0";
    return Uint8Array.from(s.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
  }
}

const latin = (b: Uint8Array, a = 0, z = b.length) => { let s = ""; for (let i = a; i < z; i++) s += String.fromCharCode(b[i]); return s; };

type Obj = { dict: PdfVal; stream?: Uint8Array };

function decodeStream(dict: Dict, raw: Uint8Array): Uint8Array {
  const f = dict.Filter;
  const filters = Array.isArray(f) ? f : f ? [f] : [];
  let data = raw;
  for (const x of filters) {
    if (!(x instanceof PdfName) || x.name !== "FlateDecode") throw new Error(`unsupported PDF filter ${(x as PdfName)?.name}`);
    data = inflateSync(data);
  }
  return data;
}

/** Every object of the file: plain objects and those packed in object streams. */
function readObjects(buf: Uint8Array): Map<number, Obj> {
  const objs = new Map<number, Obj>();
  const text = latin(buf);
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const lx = new Lexer(buf);
    lx.pos = m.index + m[0].length;
    const dict = lx.value();
    if (dict === undefined) continue;
    const save = lx.pos;
    const kw = lx.next();
    let stream: Uint8Array | undefined;
    if (kw && typeof kw === "object" && (kw as { op?: string }).op === "stream") {
      let s = lx.pos;
      if (buf[s] === 0x0d) s++;
      if (buf[s] === 0x0a) s++;
      const len = (dict as Dict).Length;
      let e = typeof len === "number" && latin(buf, s + len, Math.min(buf.length, s + len + 12)).includes("endstream") ? s + len : text.indexOf("endstream", s);
      if (e < 0) continue;
      if (typeof len !== "number") { while (e > s && (buf[e - 1] === 0x0a || buf[e - 1] === 0x0d)) e--; }
      try { stream = decodeStream(dict as Dict, buf.subarray(s, e)); } catch { stream = undefined; }
      re.lastIndex = e;
    } else lx.pos = save;
    objs.set(Number(m[1]), { dict, stream });
  }
  for (const [, o] of Array.from(objs)) {
    const d = o.dict as Dict;
    if (!o.stream || !(d?.Type instanceof PdfName) || d.Type.name !== "ObjStm") continue;
    const n = Number(d.N), first = Number(d.First);
    const head = new Lexer(o.stream.subarray(0, first));
    const pairs: [number, number][] = [];
    for (let i = 0; i < n; i++) { const a = head.next(), b = head.next(); if (typeof a === "number" && typeof b === "number") pairs.push([a, b]); }
    for (const [num, off] of pairs) {
      if (objs.has(num)) continue;
      const lx = new Lexer(o.stream);
      lx.pos = first + off;
      const v = lx.value();
      if (v !== undefined) objs.set(num, { dict: v });
    }
  }
  return objs;
}

type Font = { twoByte: boolean; map: Map<number, string> | null };

function parseCMap(data: Uint8Array): Map<number, string> {
  const s = latin(data), map = new Map<number, string>();
  const hexStr = (h: string) => { let out = ""; for (let i = 0; i + 4 <= h.length; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return out; };
  for (const block of Array.from(s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)))
    for (const m of Array.from(block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g))) map.set(parseInt(m[1], 16), hexStr(m[2]));
  for (const block of Array.from(s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)))
    for (const m of Array.from(block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g))) {
      const a = parseInt(m[1], 16), z = parseInt(m[2], 16);
      if (m[4]) { const base = parseInt(m[4], 16); for (let c = a; c <= z && c - a < 65536; c++) map.set(c, String.fromCharCode(base + (c - a))); }
      else { const list = Array.from((m[5] ?? "").matchAll(/<([0-9a-fA-F]+)>/g)); list.forEach((x, i) => map.set(a + i, hexStr(x[1]))); }
    }
  return map;
}

const CP1252 = new TextDecoder("windows-1252");

function decodeText(bytes: Uint8Array, font: Font | undefined): string {
  if (font?.twoByte) {
    let s = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) { const code = (bytes[i] << 8) | bytes[i + 1]; const ch = font.map?.get(code); if (ch) s += ch; }
    return s;
  }
  if (font?.map) { let s = ""; for (const c of Array.from(bytes)) s += font.map.get(c) ?? CP1252.decode(Uint8Array.of(c)); return s; }
  return CP1252.decode(bytes);
}

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const ID: M = [1, 0, 0, 1, 0, 0];

/** Interpret one content stream: every text-showing operator becomes a run at its position. */
export function contentRuns(content: Uint8Array, fonts: Map<string, Font>, page = 1): TextRun[] {
  const runs: TextRun[] = [];
  const lx = new Lexer(content);
  let ops: PdfVal[] = [];
  let ctm: M = ID; const stack: M[] = [];
  let tm: M = ID, tlm: M = ID, leading = 0, font: Font | undefined, size = 1;
  const emit = (t: string) => {
    const text = t.replace(/\s+/g, " ");
    if (!text.trim()) return;
    const m = mul(tm, ctm);
    runs.push({ page, x: Math.round(m[4] * 100) / 100, y: Math.round(m[5] * 100) / 100, size: Math.abs(size * (tm[3] || 1)), text });
  };
  for (;;) {
    const t = lx.next();
    if (t === undefined) break;
    if (!(t && typeof t === "object" && "op" in (t as object) && !(t instanceof PdfName) && !(t instanceof Uint8Array) && !Array.isArray(t))) { ops.push(t as PdfVal); continue; }
    const op = (t as { op: string }).op;
    const n = (i: number) => Number(ops[i] ?? 0);
    switch (op) {
      case "q": stack.push(ctm); break;
      case "Q": ctm = stack.pop() ?? ID; break;
      case "cm": ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], ctm); break;
      case "BT": tm = tlm = ID; break;
      case "Tf": font = fonts.get((ops[0] as PdfName)?.name ?? ""); size = n(1); break;
      case "TL": leading = n(0); break;
      case "Tm": tm = tlm = [n(0), n(1), n(2), n(3), n(4), n(5)]; break;
      case "Td": tm = tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm); break;
      case "TD": leading = -n(1); tm = tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm); break;
      case "T*": tm = tlm = mul([1, 0, 0, 1, 0, -leading], tlm); break;
      case "Tj": if (ops[0] instanceof Uint8Array) emit(decodeText(ops[0], font)); break;
      case "'": tm = tlm = mul([1, 0, 0, 1, 0, -leading], tlm); if (ops[0] instanceof Uint8Array) emit(decodeText(ops[0], font)); break;
      case "\"": tm = tlm = mul([1, 0, 0, 1, 0, -leading], tlm); if (ops[2] instanceof Uint8Array) emit(decodeText(ops[2], font)); break;
      case "TJ": {
        let s = "";
        for (const part of (Array.isArray(ops[0]) ? ops[0] : [])) {
          if (part instanceof Uint8Array) s += decodeText(part, font);
          else if (typeof part === "number" && part < -250) s += " "; // a wide gap inside one run is a space
        }
        emit(s);
        break;
      }
      case "BI": { // inline image: skip to EI
        const text = latin(content, lx.pos);
        const e = text.search(/\sEI\s/);
        lx.pos += e >= 0 ? e + 4 : text.length;
        break;
      }
    }
    ops = [];
  }
  return runs;
}

/** Every text run of every page, in page order. */
export function pdfTextRuns(buf: Uint8Array): TextRun[] {
  if (latin(buf, 0, 5) !== "%PDF-") throw new Error("not a PDF");
  const objs = readObjects(buf);
  const get = (v: PdfVal | undefined): PdfVal | undefined => (v instanceof PdfRef ? objs.get(v.num)?.dict : v);
  const fontCache = new Map<number, Font>();
  const fontOf = (ref: PdfVal): Font => {
    const num = ref instanceof PdfRef ? ref.num : -1;
    if (num >= 0 && fontCache.has(num)) return fontCache.get(num)!;
    const d = (get(ref) ?? {}) as Dict;
    const twoByte = d.Subtype instanceof PdfName && d.Subtype.name === "Type0";
    const tu = d.ToUnicode instanceof PdfRef ? objs.get(d.ToUnicode.num)?.stream : undefined;
    const f: Font = { twoByte, map: tu ? parseCMap(tu) : null };
    if (num >= 0) fontCache.set(num, f);
    return f;
  };
  // Pages in document order: walk the page tree from the catalog.
  const roots = Array.from(objs.values()).filter((o) => { const d = o.dict as Dict; return d && d.Type instanceof PdfName && d.Type.name === "Catalog"; });
  const pages: Dict[] = [];
  const walk = (node: PdfVal | undefined, inherited: Dict | undefined, depth = 0) => {
    const d = get(node) as Dict | undefined;
    if (!d || depth > 50) return;
    const res = (get(d.Resources) as Dict | undefined) ?? inherited;
    if (d.Type instanceof PdfName && d.Type.name === "Pages") for (const k of (get(d.Kids) as PdfVal[]) ?? []) walk(k, res, depth + 1);
    else pages.push({ ...d, Resources: res ?? null });
  };
  for (const r of roots) walk((r.dict as Dict).Pages, undefined);
  const runs: TextRun[] = [];
  pages.forEach((p, i) => {
    const res = (p.Resources ?? {}) as Dict;
    const fontDict = (get(res.Font) ?? {}) as Dict;
    const fonts = new Map<string, Font>(Object.entries(fontDict).map(([k, v]) => [k, fontOf(v)]));
    const contents = get(p.Contents);
    const refs = Array.isArray(contents) ? contents : [p.Contents];
    const parts = refs.map((r) => (r instanceof PdfRef ? objs.get(r.num)?.stream : undefined)).filter((s): s is Uint8Array => !!s);
    const total = parts.reduce((a, s) => a + s.length + 1, 0);
    const all = new Uint8Array(total);
    let off = 0;
    for (const s of parts) { all.set(s, off); off += s.length; all[off++] = 0x0a; }
    runs.push(...contentRuns(all, fonts, i + 1));
  });
  return runs;
}

/** Runs grouped into visual lines (same page, baselines within `tol`), top to bottom, each sorted left to right. */
export function pdfLines(runs: TextRun[], tol = 2): TextRun[][] {
  const byPage = new Map<number, TextRun[]>();
  for (const r of runs) (byPage.get(r.page) ?? byPage.set(r.page, []).get(r.page)!).push(r);
  const out: TextRun[][] = [];
  for (const page of Array.from(byPage.keys()).sort((a, b) => a - b)) {
    const rs = byPage.get(page)!.slice().sort((a, b) => b.y - a.y || a.x - b.x);
    let line: TextRun[] = [];
    for (const r of rs) {
      if (line.length && Math.abs(line[0].y - r.y) > tol) { out.push(line.sort((a, b) => a.x - b.x)); line = []; }
      line.push(r);
    }
    if (line.length) out.push(line.sort((a, b) => a.x - b.x));
  }
  return out;
}

/** Cells of a line by column start positions (the header's x positions): runs left of the first start are dropped. */
export function toColumns(line: TextRun[], starts: number[], slack = 3): string[] {
  const cells = starts.map(() => "");
  for (const r of line) {
    let col = -1;
    for (let i = 0; i < starts.length; i++) if (r.x + slack >= starts[i]) col = i;
    if (col >= 0) cells[col] = (cells[col] ? cells[col] + " " : "") + r.text.trim();
  }
  return cells.map((c) => c.replace(/\s+/g, " ").trim());
}

/**
 * Rows of a table-shaped PDF as { header label → cell text }. A line whose runs include every label in `header`
 * is a header line and sets the columns (its runs' x positions) for the lines after it, so a list whose layout
 * shifts from page to page (a repeated header with new positions) is read with the right columns throughout.
 * Lines before the first header are skipped.
 */
export function pdfTable(buf: Uint8Array, header: string[]): { page: number; y: number; cells: Record<string, string> }[] {
  const want = header.map((h) => h.toLowerCase());
  const out: { page: number; y: number; cells: Record<string, string> }[] = [];
  let cols: { label: string; x: number }[] | null = null;
  for (const line of pdfLines(pdfTextRuns(buf))) {
    const texts = line.map((r) => r.text.trim().toLowerCase());
    if (want.every((w) => texts.some((t) => t === w || t.endsWith(" " + w)))) {
      const labelOf = (t: string) => want.find((w) => t === w) ?? want.find((w) => t.endsWith(" " + w) && !want.includes(t)) ?? t;
      cols = line.map((r) => ({ label: labelOf(r.text.trim().toLowerCase()), x: r.x }));
      continue;
    }
    if (!cols) continue;
    // Runs left of the first column (a city printed a little left of its header) belong to the first column.
    const starts = cols.map((c, i) => (i === 0 ? -Infinity : c.x));
    const cells = toColumns(line, starts);
    out.push({ page: line[0].page, y: line[0].y, cells: Object.fromEntries(cols.map((c, i) => [c.label, cells[i]])) });
  }
  return out;
}
