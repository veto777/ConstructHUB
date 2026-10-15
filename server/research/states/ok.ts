/**
 * Oklahoma. Every source here was opened and read live on 2026-10-15; field names, statuses and their labels are
 * the Construction Industries Board's own (CLAUDE.md: never fabricate government data).
 *
 *   CIB roofing contractor registrations (verify.cib.hbesystems.com, the board's "Verify Roofing" lookup, linked
 *     from verifyroofing.cib.ok.gov), bulk, daily: every registration the lookup's own JSON API returns
 *     (/api/roofing/search, paged), with status, registration number, expiration date (renewalDate, labelled
 *     "Expiration Date" on the lookup), company, DBA, address, phone, the person named on the registration and the
 *     commercial endorsement.
 *   Department of Labor (ODOL) alarm, locksmith and fire sprinkler licenses, bulk, weekly: the two lists the Licensing
 *     Division links from its "Verify Licenses" page as PDFs (ReportLab), "Active Alarm Licenses - Companies" and
 *     "- Individuals" (the list of 2026-10-08: 749 companies, 4,772 individuals). Each row: license number, name,
 *     industries served (companies) or endorsements (individuals; the codes are expanded with the legend printed at
 *     the top of the same PDF) and expiration date. The lists publish no address, phone or city. The PDF links carry
 *     their date, so each load reads the current links from the page.
 */
import type { LicenseHit } from "@shared/research-reports";
import { inflateSync } from "node:zlib";
import { politeFetch } from "../http";
import { clean, usDate, type BulkHit, type BulkSource } from "../bulk";
import { jsLayoutText, pdfText, textLines } from "./lib/a3-pdf";
import type { StatePack } from "./types";

const VERIFY_PAGE = "https://verifyroofing.cib.ok.gov/roofing/search";
const API = "https://verify.cib.hbesystems.com/api/roofing";
const PAGE_SIZE = 1000;

type Reg = Record<string, unknown>;
const s = (v: unknown) => clean(v == null ? null : String(v));

export function roofingHit(r: Reg): BulkHit | null {
  const company = s(r.company_name);
  const dba = s(r.company_trade);
  const person = clean([s(r.person_firstName), s(r.person_middleName), s(r.person_lastName)].filter(Boolean).join(" "));
  if (!company && !person) return null;
  const street = [s(r.company_address1), s(r.company_address2)].filter(Boolean).join(" ");
  const address = [street, s(r.company_city), [s(r.company_state), s(r.company_zipcode)].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
  const number = s(r.licenseNumber);
  const hit: LicenseHit = {
    state: "OK", source: "Oklahoma Construction Industries Board roofing contractor registrations", sourceUrl: VERIFY_PAGE,
    businessName: [company, dba ? `DBA ${dba}` : null].filter(Boolean).join(" ") || null, licenseNumber: number,
    licenseType: s(r.tradeName), specialty: r.commercialEndorsement === true ? "Commercial endorsement" : null,
    status: s(r.statusName), principal: person, city: [s(r.company_city), s(r.company_state)].filter(Boolean).join(", ") || null,
    expires: s(r.renewalDate)?.slice(0, 10) ?? null, matchedOn: company ? "business" : "principal",
    address, phone: s(r.company_telephone), people: person ? [{ name: person, role: null }] : [],
  };
  return { kind: "license", hit, business: [company, dba].filter(Boolean).join(" ") || null, person, keys: { licenses: [number], phones: [hit.phone], addresses: [address] } };
}

/** The /count answer: a whole number, or the load stops (NaN would let the paging guard pass with nothing read). */
export function roofingTotal(text: string): number {
  const t = text.trim();
  if (!/^\d+$/.test(t) || Number(t) <= 0) throw new Error(`CIB roofing count returned an unexpected answer: ${t.slice(0, 60)}`);
  return Number(t);
}

async function* okRoofing(): AsyncIterable<BulkHit> {
  const countRes = await politeFetch(`${API}/count`, { headers: { accept: "application/json" } }, { minDelayMs: 2000 });
  if (!countRes.ok) throw new Error(`CIB roofing count returned HTTP ${countRes.status}`);
  const total = roofingTotal(await countRes.text());
  const seen = new Set<string>();
  for (let offset = 0; offset < total + PAGE_SIZE; offset += PAGE_SIZE) {
    const res = await politeFetch(`${API}/search?limit=${PAGE_SIZE}&offset=${offset}`, { headers: { accept: "application/json" } }, { minDelayMs: 2000, timeoutMs: 120_000 });
    if (!res.ok) throw new Error(`CIB roofing search returned HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("CIB roofing search returned an unexpected payload");
    const before = seen.size;
    for (const r of rows as Reg[]) {
      const id = String(r.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const h = roofingHit(r);
      if (h) yield h;
    }
    // A short page ends the list; a full page with nothing new means the API ignored the offset (checked below).
    if (rows.length < PAGE_SIZE || seen.size === before) break;
  }
  if (seen.size < total * 0.95) throw new Error(`CIB roofing paging returned ${seen.size} of ${total} registrations`);
}

// ── ODOL alarm, locksmith and fire sprinkler licenses (PDF lists) ────────────────────────────────────────────────
const ODOL_PAGE = "https://oklahoma.gov/labor/safety-and-health/safety-standards/alarm-locksmith-fire-sprinkler-service/licensing-requirements.html";
type OdolKind = "Companies" | "Individuals";

/** The current PDF of one list, as linked from the ODOL page (the file name carries the list's date). */
async function odolPdfUrl(kind: OdolKind): Promise<string> {
  const res = await politeFetch(ODOL_PAGE, {}, { minDelayMs: 1500 });
  if (!res.ok) throw new Error(`ODOL licensing page returned HTTP ${res.status}`);
  const html = await res.text();
  const href = Array.from(html.matchAll(/href="([^"]+\.pdf)"/gi)).map((m) => m[1]).find((h) => new RegExp(`Active_Alarm_Licenses_${kind}`, "i").test(h));
  if (!href) throw new Error(`no "Active Alarm Licenses - ${kind}" PDF linked from ${ODOL_PAGE}`);
  return new URL(href, ODOL_PAGE).toString();
}

/**
 * The ODOL PDFs wrap each page's text in ASCII85 over Flate. The JS reader (./lib/g6-pdf.ts) reads Flate only, so
 * for the fallback path each such stream is decoded from ASCII85 and re-written as a plain Flate stream (pdftotext
 * reads the original). Streams it can't decode are left as they were.
 */
export function unwrapAscii85(buf: Uint8Array): Uint8Array {
  const text = Buffer.from(buf).toString("latin1");
  const out = text.replace(/\/Filter\s*\[\s*\/ASCII85Decode\s*\/FlateDecode\s*\]([^>]*?)>>\s*stream\r?\n([\s\S]*?)~>\s*endstream/g, (whole, rest: string, body: string) => {
    try {
      const raw = ascii85(body);
      inflateSync(raw); // only rewrite a stream that really is Flate inside
      return `/Filter/FlateDecode${rest.replace(/\/Length\s+\d+/, `/Length ${raw.length}`)}>>stream\n${raw.toString("latin1")}\nendstream`;
    } catch { return whole; }
  });
  return Buffer.from(out, "latin1");
}

function ascii85(s: string): Buffer {
  const chars = s.replace(/\s+/g, "").replace(/^<~/, "");
  const out: number[] = [];
  let group: number[] = [];
  const flush = (n: number) => {
    let v = 0;
    for (const c of group) v = v * 85 + c;
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...bytes.slice(0, n));
  };
  for (const ch of chars) {
    if (ch === "z" && !group.length) { out.push(0, 0, 0, 0); continue; }
    const c = ch.charCodeAt(0) - 33;
    if (c < 0 || c > 84) throw new Error("not ASCII85");
    group.push(c);
    if (group.length === 5) { flush(4); group = []; }
  }
  if (group.length) { const n = group.length - 1; while (group.length < 5) group.push(84); flush(n); }
  return Buffer.from(out);
}

export type OdolRow = { license: string; name: string; served: string | null; expires: string | null };

/**
 * Rows of one ODOL list from its layout text (pdftotext or the JS reader). A row starts with the license number and
 * ends with the expiration date; a name or an industries list that wraps continues on the next lines, in the same
 * column. Page headers ("License #") and footers ("Page N") are skipped. `stated` is the list's own count.
 */
export function parseOdolList(text: string): { rows: OdolRow[]; stated: number | null; legend: Map<string, string> } {
  const lines = textLines(text);
  const stated = Number(text.match(/\|\s*([\d,]+)\s+active\b/i)?.[1]?.replace(/,/g, "")) || null;
  const legend = new Map<string, string>();
  const rows: OdolRow[] = [];
  let cur: (OdolRow & { servedCol: number; raw?: string; rawNameTail?: string; rawServedTail?: string }) | null = null;
  const cutRows: { row: OdolRow; raw: string; nameTail: string; tail: string }[] = [];
  let headerServedCol = Infinity; // where the header prints "Industries Served" / "Endorsements"
  const push = () => {
    if (!cur) return;
    const row = { license: cur.license, name: cur.name, served: cur.served, expires: cur.expires };
    rows.push(row);
    if (cur.raw !== undefined) cutRows.push({ row, raw: cur.raw, nameTail: cur.rawNameTail ?? "", tail: cur.rawServedTail ?? "" });
    cur = null;
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const h = line.match(/^\s*License #\s.*?(Industries Served|Endorsements)\s/i);
    if (h) { headerServedCol = line.indexOf(h[1]); push(); continue; }
    const m = line.match(/^(\s*)([A-Z]{1,3}\d+)\s{2,}(.+?)\s+(\d{2}[-/]\d{2}[-/]\d{4})\s*$/);
    if (m) {
      push();
      const start = m[1].length + m[2].length;
      const middle = line.slice(start, line.lastIndexOf(m[4])).replace(/\s+$/, "");
      const parts = middle.trim().split(/\s{2,}/);
      let name = parts[0].trim(), served: string | null = parts.slice(1).join(" ").trim() || null;
      let servedCol = served ? line.indexOf(parts[1], start + middle.indexOf(parts[0]) + parts[0].length) : Infinity;
      if (!served && headerServedCol < line.length && start < headerServedCol) {
        // The name runs up to the industries column with one space or none (the JS reader's layout): cut at the
        // header's column, on the nearest word boundary to its left.
        let cut = headerServedCol;
        for (let k = 0; k < 4; k++) if (line[headerServedCol - k - 1] === " ") { cut = headerServedCol - k; break; }
        const left = line.slice(start, cut).trim(), right = line.slice(cut, line.lastIndexOf(m[4])).trim();
        if (left && right) { name = left; served = right; servedCol = cut; }
        cur = { license: m[2], name, served, expires: usDate(m[4].replace(/-/g, "/")), servedCol, raw: middle.trim() };
        continue;
      }
      if (servedCol === Infinity) servedCol = headerServedCol;
      cur = { license: m[2], name, served, expires: usDate(m[4].replace(/-/g, "/")), servedCol };
      continue;
    }
    if (!rows.length && !cur) {
      // Before the first row: the legend ("AC = Electronic Access Control", "-T = Technician", …), two per line.
      for (const piece of t.split(/\s{2,}/)) { const lm = piece.match(/^(\S.*?)\s=\s(.+)$/); if (lm) legend.set(lm[1].trim(), lm[2].trim()); }
      continue;
    }
    if (/\bPage \d+\s*$/.test(t) || /^(Active Alarm Licenses|Oklahoma Department of Labor|List current as of)/i.test(t)) { push(); continue; }
    if (!cur) continue;
    // A wrapped line: each piece belongs to the name column or the industries column by where it starts.
    const c: OdolRow & { servedCol: number; raw?: string; rawNameTail?: string; rawServedTail?: string } = cur;
    for (const piece of Array.from(line.matchAll(/\S+(?:\s\S+)*/g))) {
      const col = piece.index ?? 0;
      if (col + 2 < c.servedCol) { c.name = `${c.name} ${piece[0]}`; if (c.raw !== undefined) c.rawNameTail = `${c.rawNameTail ?? ""} ${piece[0]}`; }
      else { c.served = c.served ? `${c.served} ${piece[0]}` : piece[0]; if (c.raw !== undefined) c.rawServedTail = `${c.rawServedTail ?? ""} ${piece[0]}`; }
    }
  }
  push();
  repairCuts(rows, cutRows);
  return { rows, stated, legend };
}

/**
 * Rows whose name and industries touched on the line (the JS reader's layout, where a column cut can fall inside a
 * word): re-split at the earliest point from which the rest of the line reads as a list of industries the same PDF
 * uses on at least three other rows. A row that can't be re-split this way keeps the column cut.
 */
function repairCuts(rows: OdolRow[], cut: { row: OdolRow; raw: string; nameTail: string; tail: string }[]): void {
  if (!cut.length) return;
  const counts = new Map<string, number>();
  for (const r of rows) for (const i of (r.served ?? "").split(/;\s*/)) if (i) counts.set(i, (counts.get(i) ?? 0) + 1);
  const vocab = new Set(Array.from(counts).filter(([, n]) => n >= 3).map(([i]) => i));
  const isList = (v: string) => { const items = v.split(/;\s*/).map((x) => x.trim()).filter(Boolean); return items.length > 0 && items.every((x) => vocab.has(x)); };
  for (const c of cut) {
    const whole = `${c.raw}${c.tail}`.replace(/\s+/g, " ");
    for (let i = 1; i < c.raw.length; i++) {
      const at = c.raw[i], before = c.raw[i - 1];
      if (!/[A-Z]/.test(at) || !(before === " " || /[a-z]/.test(before))) continue; // a word start, or glued after a lowercase letter
      const rest = whole.slice(i).trim();
      if (isList(rest)) { c.row.name = `${c.raw.slice(0, i).trim()}${c.nameTail}`.replace(/\s+/g, " ").trim(); c.row.served = rest; break; }
    }
  }
}

/** "FS-M; LS-T" → "Fire Sprinkler (Manager); Locksmith (Technician)", with the legend printed in the same PDF. */
export function expandEndorsements(codes: string | null, legend: Map<string, string>): string | null {
  if (!codes) return null;
  return codes.split(/;\s*/).map((raw) => {
    const c = raw.trim();
    const whole = legend.get(c) ?? legend.get(c.replace(/-/g, " "));
    if (whole) return whole; // "90 Day TRAINEE", "CCTV-RSA" (the legend's "CCTV RSA")
    const dash = c.indexOf("-");
    if (dash < 0) return c;
    const type = legend.get(c.slice(0, dash)), suf = c.slice(dash + 1);
    const sufName = legend.get(`-${suf}`) ?? legend.get(suf);
    return type ? `${type} (${sufName ?? suf})` : c; // a code the legend doesn't print stays as printed
  }).join("; ");
}

const flipName = (v: string) => { const m = v.match(/^([^,]+),\s*(.+)$/); return clean(m ? `${m[2]} ${m[1]}` : v) ?? v; };

function odolLoader(kind: OdolKind): () => AsyncIterable<BulkHit> {
  return async function* () {
    const url = await odolPdfUrl(kind);
    const res = await politeFetch(url, {}, { minDelayMs: 1500, timeoutMs: 120_000 });
    if (!res.ok) throw new Error(`ODOL ${kind} PDF returned HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    let { text, via } = await pdfText(buf);
    if (via === "js") text = jsLayoutText(unwrapAscii85(buf));
    const { rows, stated, legend } = parseOdolList(text);
    if (stated && rows.length < stated * 0.95) throw new Error(`read ${rows.length} of the ${stated} licenses the ${kind} list states (${via})`);
    for (const r of rows) {
      const company = kind === "Companies";
      const person = company ? null : flipName(r.name);
      const hit: LicenseHit = {
        state: "OK", source: `Oklahoma Department of Labor alarm, locksmith and fire sprinkler licenses (${company ? "companies" : "individuals"})`,
        sourceUrl: ODOL_PAGE, businessName: company ? r.name : null, licenseNumber: r.license,
        licenseType: company ? "Alarm, locksmith or fire sprinkler company license" : "Alarm, locksmith or fire sprinkler individual license",
        specialty: company ? r.served : expandEndorsements(r.served, legend), status: "Active (on the Department of Labor's list of active licenses)",
        principal: person, city: null, expires: r.expires, matchedOn: company ? "business" : "principal",
        address: null, phone: null, people: person ? [{ name: person, role: null }] : [],
      };
      yield { kind: "license", hit, business: company ? r.name : null, person, keys: { licenses: [r.license] } };
    }
  };
}

const BULK: BulkSource[] = [
  {
    id: "ok-cib-roofing", state: "OK", label: "Oklahoma Construction Industries Board roofing contractor registrations",
    pageUrl: VERIFY_PAGE, everyHours: 24, minRows: 4200, load: okRoofing,
  },
  {
    id: "ok-odol-alarm-companies", state: "OK", label: "Oklahoma Department of Labor alarm, locksmith and fire sprinkler licenses (companies)",
    pageUrl: ODOL_PAGE, everyHours: 24 * 7, minRows: 520, load: odolLoader("Companies"),
  },
  {
    id: "ok-odol-alarm-individuals", state: "OK", label: "Oklahoma Department of Labor alarm, locksmith and fire sprinkler licenses (individuals)",
    pageUrl: ODOL_PAGE, everyHours: 24 * 7, minRows: 3300, load: odolLoader("Individuals"),
  },
];

export const pack: StatePack = {
  state: "OK",
  checked: "2026-10-15",
  bulk: BULK,
  noStatewideGcLicense:
    "Oklahoma does not license general contractors statewide; the Construction Industries Board licenses electrical, plumbing and mechanical trades and registers roofing contractors",
  blocked: [
    "CIB electrical, plumbing and mechanical license search (cibverify.ok.gov GL Suite licensee search, still the link on oklahoma.gov/cib 'Are they licensed?'): answered HTTP 503 with Retry-After 3600 for over an hour early on 2026-10-15 (tower1 and vb11); retried 2026-10-15 06:47Z and 06:53Z: port 443 refused the connection from tower1 and vb11, and plain http answered HTTP 503. The board's newer verify.cib.hbesystems.com app searches roofing and CEUs only",
    "CIB disciplinary actions: the board's site (oklahoma.gov/cib) publishes no list or file of orders",
    "data.ok.gov: no CIB, contractor, debarment or business-entity dataset newer than 2019",
  ],
};
