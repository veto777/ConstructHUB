/**
 * Shared helpers for the g5 states (OH, MI, IN, IL, WI, MN): two licensing vendors whose public pages are ASP.NET
 * WebForms, plus small file readers. Every endpoint below was opened and used live on 2026-10-15 (no login, no
 * CAPTCHA, robots.txt allows the paths); nothing here works around a block.
 *
 *   Accela Citizen Access (aca-prod.accela.com/<AGENCY>): the public "Search for Licensee" form has a
 *     "Download results" link. Searching one license type with no name and pressing it makes the server prepare the
 *     whole result set; GET Export2CSV.ashx in the same session then returns it as CSV (the page's own JS does this
 *     in a hidden iframe: Scripts/ACCELAGRIDVIEW_JS.js, ExportCSV). Used for Michigan LARA and the City of Indianapolis.
 *   Tyler eLicense (elicenseN.com.ohio.gov/Lookup): "Generate Roster(s)" → "Download Roster(s)" →
 *     FileDownload.aspx?Idnt=<roster>&Type=Comma (Lookup/Lookup.js, OpenFileDownloadWindow). Used for the Ohio
 *     Construction Industry Licensing Board and the Ohio State Fire Marshal's free rosters.
 *   .xlsx: read with Info-ZIP `unzip -p` (already used by ../../bulk-sources.ts), shared strings and the first sheet.
 */
import { execFile } from "node:child_process";
import { promises as fs, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { politeFetch } from "../../../scrapers/polite-fetch";
import { decodeEntities } from "../../bulk-sources";

const run = promisify(execFile);

/** A tiny cookie jar for one ASP.NET session (fetch() keeps no cookies). */
export class Session {
  private jar = new Map<string, string>();
  constructor(private minDelayMs = 2000, private timeoutMs = 10 * 60_000) {}

  private keep(res: Response) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    if (this.jar.size) headers.set("cookie", Array.from(this.jar, ([k, v]) => `${k}=${v}`).join("; "));
    const res = await politeFetch(url, { ...init, headers }, { minDelayMs: this.minDelayMs, timeoutMs: this.timeoutMs, retries: 1 });
    this.keep(res);
    return res;
  }

  async text(url: string, init: RequestInit = {}): Promise<string> {
    const res = await this.request(url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  }

  async post(url: string, form: URLSearchParams, referer = url): Promise<string> {
    return this.text(url, { method: "POST", body: form.toString(), headers: { "content-type": "application/x-www-form-urlencoded", referer } });
  }

  /** Stream a response body to a temp file (the caller deletes it). */
  async save(url: string, referer: string): Promise<{ path: string; type: string }> {
    const res = await this.request(url, { headers: { referer } });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
    const path = join(tmpdir(), `ch-g5-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try { await pipeline(Readable.fromWeb(res.body as any), createWriteStream(path)); }
    catch (err) { await fs.rm(path, { force: true }); throw err; }
    return { path, type: res.headers.get("content-type") ?? "" };
  }
}

/** Hidden and text inputs of an ASP.NET form, as a browser would post them. */
export function formInputs(html: string): URLSearchParams {
  const form = new URLSearchParams();
  for (const m of Array.from(html.matchAll(/<input[^>]*>/g))) {
    const tag = m[0];
    const name = tag.match(/name="([^"]+)"/)?.[1];
    const type = (tag.match(/type="([^"]+)"/)?.[1] ?? "text").toLowerCase();
    if (!name || !["hidden", "text", "tel"].includes(type)) continue;
    form.set(decodeEntities(name), decodeEntities(tag.match(/value="([^"]*)"/)?.[1] ?? ""));
  }
  return form;
}

// ── Accela Citizen Access licensee export ────────────────────────────────────────────────────────────────────
const ACA = "https://aca-prod.accela.com";
const P = "ctl00$PlaceHolderMain$refLicenseeSearchForm$";

/** The public licensee search page of one Accela agency (what a reader can open). */
export const accelaLookupUrl = (agency: string) => `${ACA}/${agency}/GeneralProperty/PropertyLookUp.aspx?isLicensee=Y`;

/** Every licensee of one license type, as the CSV the "Download results" link serves. Returns a temp file path. */
export async function accelaExport(agency: string, licenseType: string): Promise<string> {
  const url = accelaLookupUrl(agency);
  const s = new Session();
  const page = await s.text(url);
  if (!page.includes("btnNewSearch")) throw new Error(`${agency}: the licensee search form has changed`);
  const search = formInputs(page);
  search.set("__EVENTTARGET", "ctl00$PlaceHolderMain$btnNewSearch");
  search.set("__EVENTARGUMENT", "");
  search.set("ctl00$PlaceHolderMain$ddlSearchType", "2"); // "Search for Licensee"
  search.set(`${P}ddlLicenseType`, licenseType);
  const results = await s.post(url, search);
  const exportBtn = results.match(/__doPostBack\(&#39;([^&]*gdvRefLicenseeListtop4btnExport)&#39;/)?.[1];
  if (!exportBtn) {
    if (/no records found|returned no results/i.test(results)) throw new Error(`${agency}: no licensees of type ${licenseType}`);
    throw new Error(`${agency}: no result list for ${licenseType}`);
  }
  const exp = formInputs(results);
  exp.set("__EVENTTARGET", exportBtn);
  exp.set("__EVENTARGUMENT", "");
  exp.set("ctl00$PlaceHolderMain$ddlSearchType", "2");
  exp.set(`${P}ddlLicenseType`, licenseType);
  await s.post(url, exp);
  const file = await s.save(`${ACA}/${agency}/Export2CSV.ashx?flag=${Date.now() % 10_000}`, url);
  if (!/csv/i.test(file.type)) { await fs.rm(file.path, { force: true }); throw new Error(`${agency}: the export sent ${file.type || "no file"} for ${licenseType}`); }
  return file.path;
}

// ── Tyler eLicense rosters (Ohio) ────────────────────────────────────────────────────────────────────────────
/**
 * Generate and download free rosters. `select` reads the form page and names the roster groups to tick (their
 * ckbRoster indexes) and any criteria fields a group needs (license types). Returns one temp CSV per roster, with its name.
 */
export async function tylerRosters(base: string, select: (page: string) => { boxes: number[]; extra?: [string, string][] }): Promise<{ name: string; path: string }[]> {
  const s = new Session(2000);
  const gen = `${base}/Lookup/GenerateRoster.aspx`;
  const page = await s.text(gen);
  const form = new URLSearchParams();
  for (const m of Array.from(page.matchAll(/<input[^>]*type="hidden"[^>]*>/g))) {
    const name = m[0].match(/name="([^"]+)"/)?.[1];
    if (name) form.set(decodeEntities(name), decodeEntities(m[0].match(/value="([^"]*)"/)?.[1] ?? ""));
  }
  const { boxes, extra = [] } = select(page);
  if (!boxes.length) throw new Error(`no roster group found on ${gen}`);
  for (const i of boxes) {
    if (!page.includes(`ctl00$MainContentPlaceHolder$ckbRoster${i}`)) throw new Error(`roster group ${i} is gone from ${gen}`);
    form.set(`ctl00$MainContentPlaceHolder$ckbRoster${i}`, "on");
  }
  for (const [k, v] of extra) form.append(k, v);
  form.set("ctl00$MainContentPlaceHolder$btnRosterContinue", "Continue");
  const list = await s.post(gen, form, gen);
  const rosters = Array.from(list.matchAll(/RosterIdnt="(\d+)"[\s\S]*?<\/td><td>([^<]*)<\/td><td[^>]*>([^<]*)<\/td><td[^>]*>([^<]*)<\/td>/g))
    .map((m) => ({ id: m[1], name: decodeEntities(m[2]).trim(), status: m[4].trim() }));
  if (!rosters.length) throw new Error(`no roster ready at ${base}`);
  const out: { name: string; path: string }[] = [];
  try {
    for (const r of rosters) {
      if (!/ready/i.test(r.status)) throw new Error(`roster ${r.name} is "${r.status}"`);
      const file = await s.save(`${base}/Lookup/FileDownload.aspx?Idnt=${r.id}&Type=Comma`, `${base}/Lookup/DownloadRoster.aspx`);
      out.push({ name: r.name, path: file.path });
    }
  } catch (err) {
    for (const f of out) await fs.rm(f.path, { force: true });
    throw err;
  }
  return out;
}

/** Roster group labels on a GenerateRoster page, by checkbox index (the label is the text after the box). */
export function rosterGroups(page: string): { index: number; label: string }[] {
  const out: { index: number; label: string }[] = [];
  const re = /name="ctl00\$MainContentPlaceHolder\$ckbRoster(\d+)"[^>]*\/>([\s\S]*?)(?=name="ctl00\$MainContentPlaceHolder\$ckbRoster\d+"|btnRosterContinue)/g;
  for (const m of Array.from(page.matchAll(re))) {
    const label = decodeEntities(m[2].replace(/<[^>]*$/, "").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    out.push({ index: Number(m[1]), label });
  }
  return out;
}

// ── .xlsx ────────────────────────────────────────────────────────────────────────────────────────────────────
const xmlText = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ""));

/** Column letters → 0-based index ("A" → 0, "AB" → 27). */
const colIndex = (ref: string) => ref.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** The rows of the first worksheet as strings (numbers as written in the file, e.g. date serials). */
export async function xlsxRows(path: string): Promise<string[][]> {
  const read = async (member: string) => {
    try { return (await run("unzip", ["-p", path, member], { maxBuffer: 256 << 20 })).stdout; }
    catch { return ""; }
  };
  const shared = Array.from((await read("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g))
    .map((m) => Array.from(m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((t) => xmlText(t[1])).join(""));
  const sheet = await read("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("no first worksheet in the .xlsx");
  const rows: string[][] = [];
  for (const r of Array.from(sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g))) {
    const row: string[] = [];
    for (const c of Array.from(r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g))) {
      const body = c[3] ?? "";
      let v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
      if (/t="s"/.test(c[2])) v = shared[Number(v)] ?? "";
      else v = xmlText(v);
      row[colIndex(c[1])] = v;
    }
    rows.push(Array.from(row, (v) => v ?? ""));
  }
  return rows;
}

/** An Excel date serial (1900 date system) → YYYY-MM-DD; anything else → null. */
export function excelDate(v: string | null | undefined): string | null {
  const n = Number(v);
  if (!v || !Number.isFinite(n) || n < 20_000 || n > 80_000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000).toISOString().slice(0, 10);
}
