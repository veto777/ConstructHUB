/**
 * The bulk-file sources (./bulk.ts) by state. Each one was opened and parsed live on 2026-10-14: file URLs, column
 * layouts and status codes are the publishers' own (CLAUDE.md: never fabricate government data). A row a source
 * can't name is skipped, never guessed.
 *
 *   FL  DBPR construction (CILB) and electrical (ECLB) licensees, daily extracts
 *   FL  DBPR public complaints (licensed and unlicensed activity, construction + electrical), 2010 to today
 *   FL  DFS Workers' Comp stop-work orders, 2004 to today (one full pull of the public query form a day)
 *   FL  Sunbiz federal tax liens against corporations and partnerships (the state's public SFTP)
 *   TX  TSBPE plumbing licensee lists (daily)
 *   CA  CSLB license master + personnel (daily), with suspensions and disciplinary bonds as enforcement
 *   CA  DCA licensees: engineers/surveyors/geologists, architects, landscape architects, structural pest control
 *   CA  DIR certified electricians and electrician trainees
 *   CA  DIR Labor Commissioner public-works debarments
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { USER_AGENT, rateLimitHost } from "../scrapers/polite-fetch";
import { clean, csvRecords, csvRows, download, lines, plainRequest, saveResponse, usDate, type BulkHit, type BulkSource } from "./bulk";

const run = promisify(execFile);

async function* fromFile<T>(path: string, fn: (p: string) => AsyncIterable<T>): AsyncIterable<T> {
  try { yield* fn(path); } finally { await fs.rm(path, { force: true }); }
}

/** The single member of a zip, extracted to a temp file (Info-ZIP reads Deflate64, which Sunbiz uses). */
async function unzipTo(zip: string, member?: string): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), "ch-unzip-"));
  try {
    await run("unzip", ["-q", "-o", zip, ...(member ? [member] : []), "-d", dir], { maxBuffer: 1 << 20 });
    const files = await fs.readdir(dir);
    if (!files.length) throw new Error("empty zip");
    const out = join(tmpdir(), `ch-bulk-${Date.now()}-${files[0]}`);
    await fs.rename(join(dir, files[0]), out);
    return out;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(zip, { force: true });
  }
}

const person = (last: string | null, first: string | null, middle?: string | null, suffix?: string | null) =>
  clean([first, middle, last, suffix].filter(Boolean).join(" "));
/** "LAST, FIRST M" → "FIRST M LAST". */
const flipName = (v: string | null) => {
  const m = v?.match(/^([^,]+),\s*(.+)$/);
  return m ? clean(`${m[2]} ${m[1]}`) : clean(v);
};
const lic = (h: Omit<LicenseHit, "matchedOn">, business: string | null, personName: string | null): BulkHit =>
  ({ kind: "license", hit: { ...h, matchedOn: business ? "business" : "principal" }, business, person: personName });
const enf = (h: EnforcementHit, business: string | null): BulkHit => ({ kind: "enforcement", hit: h, business, person: null });

// ── Florida DBPR licensee extracts ───────────────────────────────────────────────────────────────────────────
const FL_CILB_PAGE = "https://www2.myfloridalicense.com/construction-industry/public-records/";
const FL_ECLB_PAGE = "https://www2.myfloridalicense.com/electrical-contractors/public-records/";

const FL_OCCUPATIONS: Record<string, string> = {
  CGC: "Certified General Contractor", CBC: "Certified Building Contractor", CRC: "Certified Residential Contractor",
  CCC: "Certified Roofing Contractor", CFC: "Certified Plumbing Contractor", CAC: "Certified Air Conditioning Contractor",
  CMC: "Certified Mechanical Contractor", CPC: "Certified Pool/Spa Contractor", CSC: "Certified Sheet Metal Contractor",
  CUC: "Certified Underground Utility Contractor", CVC: "Certified Solar Contractor", SCC: "Certified Specialty Contractor",
  PCC: "Certified Pollutant Storage Contractor",
  RG: "Registered General Contractor", RB: "Registered Building Contractor", RR: "Registered Residential Contractor",
  RC: "Registered Roofing Contractor", RF: "Registered Plumbing Contractor", RA: "Registered Air Conditioning Contractor",
  RM: "Registered Mechanical Contractor", RP: "Registered Pool/Spa Contractor", RS: "Registered Sheet Metal Contractor",
  RU: "Registered Underground Utility Contractor", RX: "Registered Specialty Contractor", RQ: "Registered Precision Tank Tester",
  QB: "Construction business (qualified)", FRO: "Financially responsible officer",
  EC: "Certified Electrical Contractor", ER: "Registered Electrical Contractor", EF: "Certified Alarm System Contractor I",
  EG: "Certified Alarm System Contractor II", ES: "Certified Specialty Electrical Contractor",
};
const FL_PRIMARY: Record<string, string> = { C: "Current", P: "Probation", S: "Suspended" };
const FL_SECONDARY: Record<string, string> = { A: "Active", I: "Inactive" };

function flLicenseLoader(url: string, label: string, page: string): () => AsyncIterable<BulkHit> {
  return async function* () {
    for await (const r of fromFile(await download(url), (p) => csvRows(p))) {
      if (r.length < 21) continue;
      const occ = r[1].trim();
      if (/^(PVDR|CRS\d*)$/.test(occ)) continue; // course providers and courses
      const name = clean(r[2]), dba = /^INDIVIDUAL$/i.test(r[3].trim()) ? null : clean(r[3]);
      const isBusiness = occ === "QB";
      const status = [FL_PRIMARY[r[13].trim()] ?? clean(r[13]), FL_SECONDARY[r[14].trim()] ?? clean(r[14])].filter(Boolean).join(", ") || null;
      const hit = {
        state: "FL", source: label, sourceUrl: page,
        businessName: isBusiness ? name : dba, licenseNumber: clean(r[20]) ?? clean(r[12]),
        licenseType: FL_OCCUPATIONS[occ] ?? occ, specialty: clean(r[4]), status,
        principal: isBusiness ? null : flipName(name), city: clean(r[8]), expires: usDate(r[17]),
      };
      yield lic(hit, isBusiness ? [name, dba].filter(Boolean).join(" ") || null : dba, isBusiness ? null : name);
    }
  };
}

// ── Florida DBPR public complaints ───────────────────────────────────────────────────────────────────────────
const FL_COMPLAINTS_PAGE = "https://www2.myfloridalicense.com/unlicensed-activity-public-records/";
const FL_ADVERSE = /final order|citation filed|cease (&|and) desist|rf claim granted|revok|suspen/i;
const FL_NOT_ADVERSE = /no violation|insufficient evidence|duplicate|no jurisdiction|withdrawn|closed.*no action|no probable cause/i;

function flComplaintsLoader(): AsyncIterable<BulkHit> {
  const files = [
    "https://www2.myfloridalicense.com/sto/file_download/extracts/unlicensed_2021_current.csv",
    "https://www2.myfloridalicense.com/sto/file_download/extracts/unlicensed_2010_current.csv",
  ];
  return (async function* () {
    for (const url of files) {
      for await (const r of fromFile(await download(url), (p) => csvRows(p))) {
        if (r.length < 15 || !/^0[68]/.test(r[0])) continue; // construction (06xx) and electrical (08xx) only
        const name = clean(r[1]);
        if (!name) continue;
        // DBPR puts DBA names in the address lines; a line with no digits is a name, not a street.
        const dbas = [r[3], r[4], r[5]].map(clean).filter((v): v is string => !!v && !/\d/.test(v));
        const disposition = clean(r[13]);
        const discipline = clean(r[15]?.replace(/;$/, "").replace(/;/g, "; ").replace(/,/g, " on "));
        yield enf({
          state: "FL", source: "Florida DBPR complaints (construction and electrical)", sourceUrl: FL_COMPLAINTS_PAGE,
          category: "complaint", name: [name, ...dbas].join(" / "), id: clean(r[10]), date: usDate(r[12]), endDate: usDate(r[14]),
          status: disposition, city: clean(r[6]),
          detail: [clean(r[11]), clean(r[9]), discipline ? `Discipline: ${discipline}` : null].filter(Boolean).join(". ") || null,
          amount: null, adverse: disposition ? (FL_ADVERSE.test(disposition) ? true : FL_NOT_ADVERSE.test(disposition) ? false : null) : null,
        }, [name, ...dbas].join(" "));
      }
    }
  })();
}

// ── Florida stop-work orders (DFS Division of Workers' Compensation) ─────────────────────────────────────────
const FL_SWO = "https://dwcdataportal.fldfs.com/SWOquery.aspx";

/** Hidden + text inputs and selected options of an ASP.NET form, as the browser would post them. */
function formFields(html: string): URLSearchParams {
  const form = new URLSearchParams();
  for (const m of Array.from(html.matchAll(/<input[^>]*>/g))) {
    const tag = m[0];
    const name = tag.match(/name="([^"]+)"/)?.[1];
    const type = (tag.match(/type="([^"]+)"/)?.[1] ?? "text").toLowerCase();
    if (!name || !["hidden", "text"].includes(type)) continue;
    form.set(name, decodeEntities(tag.match(/value="([^"]*)"/)?.[1] ?? ""));
  }
  for (const m of Array.from(html.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g))) {
    const opt = m[2].match(/<option[^>]*selected[^>]*value="([^"]*)"/) ?? m[2].match(/<option[^>]*value="([^"]*)"/);
    form.set(m[1], opt ? decodeEntities(opt[1]) : "");
  }
  return form;
}

export function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

const cookieOf = (res: Response) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

async function* flStopWorkLoader(): AsyncIterable<BulkHit> {
  await rateLimitHost(FL_SWO, 2000);
  const page = await fetch(FL_SWO, { headers: { "user-agent": USER_AGENT } });
  if (!page.ok) throw new Error(`stop-work query page returned HTTP ${page.status}`);
  const html = await page.text();
  const form = formFields(html);
  form.set("ctl00$ContentPlaceHolder1$txtEmployerName", ""); // blank: every order since 2004
  form.set("ctl00$ContentPlaceHolder1$btnSearch", "Search");
  const path = await download(FL_SWO, {
    method: "POST", body: form.toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", referer: FL_SWO, ...(cookieOf(page) ? { cookie: cookieOf(page) } : {}) },
  });
  try {
    const body = await fs.readFile(path, "utf8");
    const span = (row: string, field: string) => clean(decodeEntities(row.match(new RegExp(`_In_${field}_\\d+"[^>]*>([^<]*)<`))?.[1] ?? ""));
    for (const m of Array.from(body.matchAll(/<tr>\s*<td[\s\S]*?<\/tr>/g))) {
      const row = m[0];
      const name = span(row, "EMP_NAME");
      if (!name) continue;
      const ended = span(row, "DateEnded"), reinstated = span(row, "Reinstated");
      const endDate = usDate(ended);
      // "Reinstated": the employer defaulted on its penalty payment agreement and the order is back in force.
      const back = usDate(reinstated);
      const status = back ? `Reinstated ${back} after a defaulted payment agreement` : endDate ? `Ended ${endDate}` : "Not ended";
      yield enf({
        state: "FL", source: "Florida stop-work orders (Division of Workers' Compensation)", sourceUrl: FL_SWO,
        category: "stop_work", name, id: null, date: usDate(span(row, "DateServed")), endDate, status,
        city: [span(row, "City"), span(row, "County")].filter(Boolean).join(", ") || null, detail: span(row, "Reason"), amount: null, adverse: true,
      }, name);
    }
  } finally {
    await fs.rm(path, { force: true });
  }
}

// ── Florida Sunbiz federal tax liens ─────────────────────────────────────────────────────────────────────────
const SUNBIZ_SFTP = "sftp://sftp.floridados.gov/~/doc/quarterly/flr";
const SUNBIZ_PAGE = "https://dos.fl.gov/sunbiz/other-services/data-downloads/";

/** The server's host keys, pinned (ssh-keyscan 2026-10-14): curl's libssh checks them against $HOME/.ssh/known_hosts. */
const SUNBIZ_HOST_KEYS = [
  "sftp.floridados.gov ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIFRdq4ekBu4hkT7QRm+frcyLZFQZplBp63gRcEm0Kwq",
  "sftp.floridados.gov ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCcqcmLnzD8ophR/Ox+GUXEeg/UbNw5ghGtUxKgXz9vLY9z8KFn5e9HtjOeCF9UldrcMn1uece49dYGRqOI2Xo7pDH7B3vTqH9l1QPes8rM7WK4+mpAeV5Isct+VpL6bSJyHd5wOCKWVtszeTTQUdXzDlPR6sJweHWu/4e7z1UiCJtjEYac1nK4H7dX3ZZCJ10SzvMwA/DbHOojEhKTJIwk0RdD/umSM2fa+WSw0Oi+CD9g/lKuFGzEn0OLYj5x7IQrVfcDLIYpBUuBEoDxvpnMx8Cf+SSgOsyZvgSx/70AZO8lzs+PqC2xzn2lKyiFnCYtUuQFb78U8gM7d/UaOe5x",
  "sftp.floridados.gov ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEoTyT4Kp6MNXcKhRwwN5Je/j7HAwtWvhXKT41h0x8l0SWEuPnh0QfhMHXMMhxvAItK5y/CoUZBTeO8aVmGJ/TE=",
].join("\n");

/** Sunbiz's public SFTP login is published on its data-downloads page (it is not a secret). */
async function sunbizFile(file: string): Promise<string> {
  const home = await fs.mkdtemp(join(tmpdir(), "ch-sftp-"));
  const out = join(tmpdir(), `ch-sunbiz-${Date.now()}-${file}`);
  try {
    await fs.mkdir(join(home, ".ssh"), { mode: 0o700 });
    await fs.writeFile(join(home, ".ssh", "known_hosts"), `${SUNBIZ_HOST_KEYS}\n`);
    await run("curl", ["-sS", "--fail", "--max-time", "900", "-u", "Public:PubAccess1845!", "-o", out, `${SUNBIZ_SFTP}/${file}`],
      { maxBuffer: 1 << 20, env: { ...process.env, HOME: home } });
    return out;
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

async function* flTaxLiensLoader(): AsyncIterable<BulkHit> {
  // Filings: document number → filed date, status, expiration.
  const filings = new Map<string, { filed: string | null; status: string | null; expires: string | null }>();
  const ymd = (v: string) => { const m = v.trim().match(/^(\d{2})(\d{2})(\d{4})$/); return m && +m[3] >= 1990 && +m[3] <= 2100 && +m[1] >= 1 && +m[1] <= 12 ? `${m[3]}-${m[1]}-${m[2]}` : null; };
  for await (const l of fromFile(await unzipTo(await sunbizFile("flrf.zip")), (p) => lines(p))) {
    if (l.length < 30) continue;
    filings.set(l.slice(0, 12).trim(), { filed: ymd(l.slice(12, 20)), status: clean(l.slice(30, 31)), expires: ymd(l.slice(48, 56)) });
  }
  for await (const l of fromFile(await unzipTo(await sunbizFile("flrd.zip")), (p) => lines(p))) {
    if (l.length < 190) continue;
    const doc = l.slice(1, 13).trim();
    const name = clean(l.slice(13, 68));
    if (!name || l.slice(68, 69) !== "C") continue; // corporations and partnerships only, not people
    const f = filings.get(doc);
    yield enf({
      state: "FL", source: "Florida federal tax liens on businesses (Sunbiz)", sourceUrl: SUNBIZ_PAGE,
      category: "tax_lien", name, id: doc, date: f?.filed ?? null, endDate: f?.expires ?? null,
      status: f?.status === "A" ? "Active" : f?.status ?? null, city: clean(`${l.slice(157, 185)} ${l.slice(185, 187)}`),
      detail: "Federal tax lien filed with the Florida Department of State (no amount is published)", amount: null, adverse: true,
    }, name);
  }
}

// ── Texas TSBPE plumbing licensees ───────────────────────────────────────────────────────────────────────────
const TSBPE_PAGE = "https://tsbpe.texas.gov/free-licensee-list/";
const BROWSER_UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) ConstructHUB research bot (support@constructhub.us)" };
const TSBPE_LISTS: { url: string; type: string; zip?: boolean }[] = [
  { url: "https://tsbpe.texas.gov/download-csv/RMP/", type: "Responsible Master Plumber" },
  { url: "https://tsbpe.texas.gov/download-csv/MP/", type: "Master Plumber" },
  { url: "https://tsbpe.texas.gov/download-csv/TP/", type: "Tradesman Plumber-Limited" },
  { url: "https://tsbpe.texas.gov/download-csv/PI/", type: "Plumbing Inspector" },
  { url: "https://tsbpe.texas.gov/wp-content/uploads/2015/03/JP.csv.zip", type: "Journeyman Plumber", zip: true },
  { url: "https://tsbpe.texas.gov/wp-content/uploads/2015/03/PA.csv.zip", type: "Plumber's Apprentice", zip: true },
];

async function* txPlumbingLoader(): AsyncIterable<BulkHit> {
  for (const list of TSBPE_LISTS) {
    let path = await download(list.url, { headers: BROWSER_UA });
    if (list.zip) path = await unzipTo(path);
    for await (const r of fromFile(path, (p) => csvRecords(p))) {
      const who = person(clean(r.LAST_NAME), clean(r.FIRST_NAME), clean(r.MIDDLE_NAME), clean(r.SUFFIX));
      const company = clean(r.PLUMB_COMPANY);
      if (!who && !company) continue;
      const hit = {
        state: "TX", source: "Texas State Board of Plumbing Examiners licensees", sourceUrl: TSBPE_PAGE,
        businessName: company, licenseNumber: clean(r.LICENSE_NBR), licenseType: list.type, specialty: null,
        status: clean(r.LIC_STATUS), principal: who, city: clean(r.CITY) ?? (clean(r.COUNTY) ? `${clean(r.COUNTY)} County` : null),
        expires: usDate(r.EXPIRATION_DTE),
      };
      yield { kind: "license", hit: { ...hit, matchedOn: company ? "business" : "principal" }, business: company, person: who };
    }
  }
}

// ── California CSLB public data portal ───────────────────────────────────────────────────────────────────────
const CSLB = "https://www.cslb.ca.gov/onlineservices/dataportal/ContractorList";

/**
 * One CSLB file. The portal's CSV links end in a redirect to DownLoadFile.ashx (checked 2026-10-14), which serves the
 * file directly. Retried: CSLB answers 503 when busy and cuts slow downloads off (a short file then fails the row
 * floor and the previous load stays).
 */
async function cslbFile(file: "MasterLicenseData" | "PersonnelData"): Promise<string> {
  const url = `https://www.cslb.ca.gov/OnlineServices/DataPortal/DownLoadFile.ashx?fName=${file}&type=C`;
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await rateLimitHost(url, 2000);
      const res = await plainRequest(url, { timeoutMs: 10 * 60_000 });
      if (!/text\/csv/i.test(String(res.headers["content-type"] ?? ""))) { res.resume(); throw new Error(`CSLB sent ${res.headers["content-type"] ?? "no file"} (HTTP ${res.statusCode})`); }
      return await saveResponse(res);
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 60_000 * (attempt + 1)));
    }
  }
  throw last;
}

const CSLB_DISCIPLINE = /susp|probation|pending case|cit|judgement|judgment|disc|revok|arb/i;

async function* caCslbLoader(): AsyncIterable<BulkHit> {
  const byLicense = new Map<string, { name: string | null; status: string | null; city: string | null; expires: string | null; classes: string | null }>();
  for await (const r of fromFile(await cslbFile("MasterLicenseData"), (p) => csvRecords(p))) {
    const no = clean(r.LicenseNo);
    const name = clean(r.BusinessName);
    if (!no || !name) continue;
    const primary = clean(r.PrimaryStatus), secondary = clean(r.SecondaryStatus);
    const status = [primary, secondary].filter(Boolean).join("; ") || null;
    const classes = clean(r["Classifications(s)"]?.replace(/\|\s*/g, ", "));
    const expires = usDate(r.ExpirationDate);
    byLicense.set(no, { name, status, city: clean(r.City), expires, classes });
    const soleOwner = clean(r.FullBusinessName); // sole owners: "FIRST MIDDLE LAST"
    const isPerson = /sole owner/i.test(r.BusinessType ?? "");
    const businessNames = [name, clean(r["BUS-NAME-2"])].filter(Boolean).join(" ");
    yield {
      kind: "license",
      hit: {
        state: "CA", source: "California CSLB contractor licenses", sourceUrl: CSLB, businessName: name, licenseNumber: no,
        licenseType: clean(r.BusinessType) ? `Contractor license (${clean(r.BusinessType)})` : "Contractor license",
        specialty: classes ? `Classes ${classes}` : null, status, principal: isPerson ? soleOwner : null, city: clean(r.City), expires,
        matchedOn: "business",
      },
      business: businessNames, person: isPerson ? soleOwner ?? name : null,
    };
    // A suspension, probation, pending case or disciplinary bond is a CSLB enforcement fact on the license itself.
    const bond = clean(r.DBCaseNo);
    if ((primary && primary !== "CLEAR" && CSLB_DISCIPLINE.test(primary)) || (secondary && CSLB_DISCIPLINE.test(secondary)) || bond) {
      const amount = Number(r.DBAmount);
      yield enf({
        state: "CA", source: "California CSLB license status (suspensions, probation, pending cases, disciplinary bonds)", sourceUrl: CSLB,
        category: "discipline", name, id: no, date: usDate(r.LastUpdate), endDate: null, status,
        city: clean(r.City),
        detail: [bond ? `Disciplinary bond ${clean(r.DBNumber) ?? ""} for case ${bond}${clean(r.DBBondReason) ? ` (${clean(r.DBBondReason)})` : ""}` : null,
          `License ${no}`].filter(Boolean).join(". "),
        amount: Number.isFinite(amount) && amount > 0 ? amount : null,
        adverse: primary && primary !== "CLEAR" ? true : null,
      }, businessNames);
    }
  }
  // Personnel: officers, RMOs and RMEs on each license. Their name finds the license (a person search).
  for await (const r of fromFile(await cslbFile("PersonnelData"), (p) => csvRecords(p))) {
    if (!/principal/i.test(r["Name-TP"] ?? "")) continue;
    const no = clean(r["LIC-NO"]);
    const raw = clean(r.Name); // "LAST FIRST MIDDLE"
    if (!no || !raw) continue;
    const m = byLicense.get(no);
    const [last, ...rest] = raw.split(" ");
    const titles = (r["EMP-Titl-CDE"] ?? "").split("|").map((t) => t.trim()).filter(Boolean);
    const ends = (r["DIS-ASSN-DT"] ?? "").split("|").map((t) => t.trim());
    const current = titles.filter((_, i) => !ends[i]);
    yield {
      kind: "license",
      hit: {
        state: "CA", source: "California CSLB contractor licenses (personnel)", sourceUrl: CSLB,
        businessName: m?.name ?? null, licenseNumber: no, licenseType: "Contractor license",
        specialty: [current.length ? current.join(", ") : titles.length ? `Formerly ${titles.join(", ")}` : null, m?.classes ? `Classes ${m.classes}` : null].filter(Boolean).join(". ") || null,
        status: m?.status ?? "Not in the current license list", principal: clean(`${rest.join(" ")} ${last}`), city: m?.city ?? null,
        expires: m?.expires ?? null, matchedOn: "principal",
      },
      business: null, person: raw,
    };
  }
}

// ── California DCA licensee files (Box) ──────────────────────────────────────────────────────────────────────
const DCA_PAGE = "https://www.dca.ca.gov/consumers/public_info/index.html";
const DCA_BOARDS: { folder: string; label: string }[] = [
  { folder: "72556212335", label: "California Board for Professional Engineers, Land Surveyors, and Geologists" },
  { folder: "72554906673", label: "California Architects Board" },
  { folder: "72555389228", label: "California Landscape Architects Technical Committee" },
  { folder: "72555272087", label: "California Structural Pest Control Board" },
];

async function* caDcaLoader(): AsyncIterable<BulkHit> {
  for (const board of DCA_BOARDS) {
    await rateLimitHost("https://www.dca.ca.gov/", 1500);
    const token = (await (await fetch("https://www.dca.ca.gov/boxToken/getToken", { headers: { "user-agent": USER_AGENT } })).text()).trim();
    if (!token || /\s|</.test(token)) throw new Error("DCA did not return a Box token");
    const auth = { authorization: `Bearer ${token}`, "user-agent": USER_AGENT };
    await rateLimitHost("https://api.box.com/", 1000);
    const items = await (await fetch(`https://api.box.com/2.0/folders/${board.folder}/items?limit=1000`, { headers: auth })).json() as { entries?: { id: string; name: string; type: string }[] };
    const data = (items.entries ?? []).filter((e) => e.type === "file" && /_Data\d+\.(xls|txt|csv)$/i.test(e.name));
    if (!data.length) throw new Error(`no data file in DCA folder ${board.folder}`);
    for (const file of data) {
      for await (const r of fromFile(await download(`https://api.box.com/2.0/files/${file.id}/content`, { headers: auth }), (p) => csvRecords(p, "\t"))) {
        const isOrg = (r["Indiv/Org"] ?? "").trim().toUpperCase() === "O";
        const orgOrLast = clean(r["Org/Last Name"]);
        if (!orgOrLast) continue;
        const who = isOrg ? null : person(orgOrLast, clean(r["First Name"]), clean(r["Middle Name"]), clean(r.Suffix));
        const dt = (v: string | undefined) => usDate(v?.replace(/-/g, "/"));
        yield {
          kind: "license",
          hit: {
            state: "CA", source: board.label, sourceUrl: DCA_PAGE, businessName: isOrg ? orgOrLast : null,
            licenseNumber: clean(r["License Number"]), licenseType: clean(r["License Type"]), specialty: clean(r["Speciality Code"]),
            status: clean(r["License Status"]), principal: who, city: clean(r.City), expires: dt(r["Expiration Date"]),
            matchedOn: isOrg ? "business" : "principal",
          },
          business: isOrg ? orgOrLast : null, person: who,
        };
      }
    }
  }
}

// ── California DIR certified electricians ────────────────────────────────────────────────────────────────────
const DIR_ECU_PAGE = "https://data.ca.gov/dataset/dir-electrician-certification-unit-ecu";
const DIR_ECU_FILES: { resource: string; type: string }[] = [
  { resource: "291bacb8-2fdb-4d9c-a330-113781ce2f59", type: "Certified Electrician" },
  { resource: "f0b9e36d-32be-408d-8dd9-4d539becfdc8", type: "Electrician Trainee" },
];

async function* caElectriciansLoader(): AsyncIterable<BulkHit> {
  for (const f of DIR_ECU_FILES) {
    // CKAN's datastore dump: the whole resource as CSV with a header row.
    for await (const r of fromFile(await download(`https://data.ca.gov/datastore/dump/${f.resource}`), (p) => csvRecords(p))) {
      const raw = clean(r.ELECTRICIAN_NAME);
      if (!raw) continue;
      const who = flipName(raw);
      yield {
        kind: "license",
        hit: {
          state: "CA", source: "California DIR electrician certification", sourceUrl: DIR_ECU_PAGE, businessName: null,
          licenseNumber: clean(r.CERTIFICATE_NUMBER), licenseType: f.type, specialty: null, status: null, principal: who,
          city: clean(r.ZIP_CODE) ? `ZIP ${clean(r.ZIP_CODE)}` : null, expires: clean(r.EXPIRATION_DATE)?.slice(0, 10) ?? null, matchedOn: "principal",
        },
        business: null, person: raw,
      };
    }
  }
}

// ── California Labor Commissioner public-works debarments ────────────────────────────────────────────────────
const DLSE_DEBAR = "https://www.dir.ca.gov/dlse/debar.html";

async function* caDebarmentsLoader(): AsyncIterable<BulkHit> {
  await rateLimitHost(DLSE_DEBAR, 1500);
  const res = await fetch(DLSE_DEBAR, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`debarment page returned HTTP ${res.status}`);
  const html = await res.text();
  const text = (s: string) => clean(decodeEntities(s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")));
  const today = new Date().toISOString().slice(0, 10);
  for (const m of Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g))) {
    const cells = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => c[1]);
    if (cells.length < 2) continue;
    const who = text(cells[0]), period = text(cells[1]);
    if (!who || !period || /name of contractor/i.test(who)) continue;
    const dates = Array.from(period.matchAll(/(\d{1,2}\/\d{1,2}\/\d{4})/g)).map((d) => usDate(d[1]));
    const from = dates[0] ?? null, to = dates[1] ?? null;
    const pdf = cells[1].match(/href="([^"]+\.pdf)"/i)?.[1];
    const stayed = /stay/i.test(period);
    yield enf({
      state: "CA", source: "California Labor Commissioner public-works debarments", sourceUrl: pdf ? new URL(pdf, DLSE_DEBAR).toString() : DLSE_DEBAR,
      category: "debarment", name: who.replace(/\s*CSLB License Number:.*$/i, ""), id: who.match(/License Number:\s*(\d+)/i)?.[1] ?? null,
      date: from, endDate: to,
      status: stayed ? "Stayed by a court (see decision)" : to && to < today ? "Debarment period over" : "Debarred",
      city: null, detail: period, amount: null, adverse: true,
    }, who);
  }
}

// ── The list ─────────────────────────────────────────────────────────────────────────────────────────────────
export const BULK_SOURCES: BulkSource[] = [
  { id: "fl-cilb", state: "FL", label: "Florida DBPR construction licenses (CILB)", pageUrl: FL_CILB_PAGE, everyHours: 24, minRows: 200_000,
    load: flLicenseLoader("https://www2.myfloridalicense.com/sto/file_download/extracts//CONSTRUCTIONLICENSE_1.csv", "Florida DBPR construction licenses (CILB)", FL_CILB_PAGE) },
  { id: "fl-eclb", state: "FL", label: "Florida DBPR electrical licenses (ECLB)", pageUrl: FL_ECLB_PAGE, everyHours: 24, minRows: 15_000,
    load: flLicenseLoader("https://www2.myfloridalicense.com/sto/file_download/extracts/lic08el.csv", "Florida DBPR electrical licenses (ECLB)", FL_ECLB_PAGE) },
  { id: "fl-dbpr-complaints", state: "FL", label: "Florida DBPR complaints (construction and electrical)", pageUrl: FL_COMPLAINTS_PAGE, everyHours: 24, minRows: 15_000,
    load: flComplaintsLoader, companiesOnly: true },
  { id: "fl-stop-work", state: "FL", label: "Florida stop-work orders (Division of Workers' Compensation)", pageUrl: FL_SWO, everyHours: 24, minRows: 40_000,
    load: flStopWorkLoader, companiesOnly: true },
  { id: "fl-tax-liens", state: "FL", label: "Florida federal tax liens on businesses (Sunbiz)", pageUrl: SUNBIZ_PAGE, everyHours: 24 * 7, minRows: 15_000,
    load: flTaxLiensLoader, companiesOnly: true },
  { id: "tx-tsbpe", state: "TX", label: "Texas State Board of Plumbing Examiners licensees", pageUrl: TSBPE_PAGE, everyHours: 24, minRows: 20_000,
    load: txPlumbingLoader },
  // CSLB streams slowly in the daytime and cuts downloads off at about 150 s: fetch it in the small hours, Pacific time.
  { id: "ca-cslb", state: "CA", label: "California CSLB contractor licenses", pageUrl: CSLB, everyHours: 20, minRows: 400_000, utcHours: [9, 10, 11, 12, 13],
    load: caCslbLoader },
  { id: "ca-dca", state: "CA", label: "California DCA licensees (engineers, architects, pest control)", pageUrl: DCA_PAGE, everyHours: 24 * 7, minRows: 100_000,
    load: caDcaLoader },
  { id: "ca-electricians", state: "CA", label: "California DIR electrician certification", pageUrl: DIR_ECU_PAGE, everyHours: 24 * 7, minRows: 40_000,
    load: caElectriciansLoader },
  { id: "ca-debarments", state: "CA", label: "California Labor Commissioner public-works debarments", pageUrl: DLSE_DEBAR, everyHours: 24, minRows: 20,
    load: caDebarmentsLoader, companiesOnly: true },
];

export const bulkSourcesFor = (state: string) => BULK_SOURCES.filter((s) => s.state === state);
