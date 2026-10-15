/**
 * The "ARLS" public license portal that three North Carolina boards run (checked live 2026-10-15): the General
 * Contractors board (portal.nclbgc.org), the Electrical Contractors board (arls-public.ncbeec.org) and the Plumbing,
 * Heating & Fire Sprinkler Contractors board (public.nclicensing.org). Each has the same public endpoints, with no
 * CAPTCHA and no robots.txt (404):
 *
 *   POST /Public/_Search/                     the search form (company name "contains", or first + last name)
 *   GET  /Public/_ShowAccountDetails/?key=…   one license or qualifier: contact, number, type, dates, status, classes
 *   GET  /Public/_ShowAccountQualifiers/?key= the qualifiers (responsible people) on a license
 *   GET  <board's public-matters path>?key=…  "Disciplinary Action (2022-present)": case #, date, order document
 *
 * Field labels are the portal's own. A field a board doesn't show (the plumbing board shows no status) is null.
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { politeFetch, sleep } from "../../http";
import { usDate } from "../../bulk";
import { tokens } from "../../licenses";
import { addressMatches, normLicense, normPhone, type IdQuery } from "../../identifiers";
import { hasAllWords, htmlText } from "./g3-common";

export type ArlsBoard = {
  state: string;
  /** What the report calls the license source. */
  source: string;
  base: string;
  /** The search form's class select: the boards name it differently. */
  classField: "ClassificationDefinitionIdnt" | "AccountDefinitionIdnt";
  /** Shown as the license type when the portal says only "License". */
  licenseLabel: string;
  /** The board's public-matters endpoint, when it has one whose layout was seen live. */
  mattersPath?: string;
  /** The search form has a separate qualifier-number box (NCLBGC). */
  qualifierField?: boolean;
  /** The board shows a license's people as "Classification Holders" and has no qualifiers list. */
  noQualifiers?: boolean;
};

export type ArlsRow = { key: string; account: string; notActive: boolean; type: string | null; owner: string | null };

/** Rows of a search result (the portal's AccountSearchTable). */
export function parseArlsSearch(html: string): ArlsRow[] {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  const out: ArlsRow[] = [];
  for (const m of Array.from(body.matchAll(/<tr>([\s\S]*?)<\/tr>/g))) {
    const key = m[1].match(/Show(?:Account|Enforcement)Details\(\s*'([^']+)'\s*\)/)?.[1];
    const cells = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => c[1]);
    if (!key || cells.length < 3) continue;
    out.push({
      key, account: htmlText(cells[0].match(/<a [^>]*>([^<]*)<\/a>/)?.[1]) ?? "", notActive: /License Not Active/i.test(cells[0]),
      // "Name AKA: Other Name Other Name": the names, once each, joined like other multi-name records.
      type: htmlText(cells[1]), owner: ownerNames(htmlText(cells[cells.length - 1])),
    });
  }
  return out;
}

const ownerNames = (v: string | null): string | null => {
  if (!v || !/\bAKA:/.test(v)) return v;
  const [first, rest] = v.split(/\s*\bAKA:\s*/, 2);
  const names = [first.trim()];
  // The AKA list is the other names run together; the first name repeated is dropped.
  let r = rest.trim();
  while (r.startsWith(first.trim())) r = r.slice(first.trim().length).trim();
  if (r) names.push(r);
  return names.join(" / ");
};

export type ArlsDetails = {
  fields: Record<string, string | null>;
  classifications: string[];
  holders: string[];
  qualifierFor: { licensee: string | null; license: string | null; status: string | null }[];
};

/** One account's details page: label/value pairs, active classifications, classification holders, "Qualifier for". */
export function parseArlsDetails(html: string): ArlsDetails {
  const fields: Record<string, string | null> = {};
  for (const m of Array.from(html.matchAll(/<div class="display-label">([\s\S]*?)<\/div>\s*<div class="display-field"[^>]*>([\s\S]*?)<\/div>/g))) {
    const k = htmlText(m[1]);
    if (k && !(k in fields)) fields[k] = k === "Address" ? m[2] : htmlText(m[2]);
  }
  const legend = (name: string) => html.match(new RegExp(`<legend>${name}</legend>([\\s\\S]*?)</fieldset>`))?.[1] ?? "";
  const classes = legend("Active Classifications").match(/<div class="display-field"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  const holders = legend("Classification Holders").match(/<div class="display-field"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  const qualifierFor = Array.from(legend("Qualifier for").matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g))
    .map((r) => ({ licensee: htmlText(r[1]), license: htmlText(r[2]), status: htmlText(r[3]) }));
  return {
    fields,
    classifications: classes.split(/<br\s*\/?>/i).map(htmlText).filter((v): v is string => !!v),
    holders: holders.split(/<br\s*\/?>/i).map(htmlText).filter((v): v is string => !!v),
    qualifierFor,
  };
}

/** Qualifier names on a license (the qualifiers table: Name, Qualifier #, Status). */
export function parseArlsQualifiers(html: string): { name: string; number: string | null; status: string | null }[] {
  const out: { name: string; number: string | null; status: string | null }[] = [];
  for (const r of Array.from(html.matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g))) {
    const name = htmlText(r[1]);
    if (!name || /^name$/i.test(name)) continue;
    out.push({ name, number: htmlText(r[2]), status: htmlText(r[3]) });
  }
  return out;
}

/** Disciplinary-action rows (case #, date, document link) from a public-matters fragment. */
export function parseArlsMatters(html: string, base: string): { caseNo: string | null; date: string | null; doc: string | null; heading: string | null }[] {
  const heading = htmlText(html.match(/<legend>([\s\S]*?)<\/legend>/)?.[1]);
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  return Array.from(body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)).map((m) => {
    const cells = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => c[1]);
    const href = m[1].match(/href="([^"]+)"/)?.[1];
    return {
      caseNo: htmlText(cells[0]), date: usDate(htmlText(cells[1])),
      doc: href ? new URL(href.replace(/&#39;/g, "'").replace(/&amp;/g, "&"), base).toString() : null, heading,
    };
  }).filter((r) => r.caseNo || r.date);
}

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * GET/POST with the polite limiter (one request per 3 s per board). public.nclicensing.org drops some connections and
 * portal.nclbgc.org answers HTTP 400 for a minute or two after a burst (seen 2026-10-15): both are retried, slowly.
 */
async function arlsText(url: string, init: RequestInit = {}): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(attempt * 45_000);
    try {
      const res = await politeFetch(url, { ...init, headers: { "x-requested-with": "XMLHttpRequest", ...(init.headers ?? {}) } }, { minDelayMs: 3000 });
      if (res.ok) return await res.text();
      last = new Error(`${new URL(url).host} returned HTTP ${res.status}`);
      if (res.status !== 400) throw last;
    } catch (err) {
      last = err;
      if (/HTTP (?!400)\d/.test(String((err as Error)?.message))) throw err;
    }
  }
  throw last;
}

const cache = new Map<string, { at: number; rows: Promise<ArlsRow[]> }>();

type SearchFields = Partial<Record<"AccountNumber" | "QualifierAccountNumber" | "CompanyName" | "FirstName" | "LastName" | "PhoneNumber" | "streetAddress", string>>;

/** One search of the portal's form, cached for 10 minutes so a report's license and enforcement passes share it. */
function arlsPost(board: ArlsBoard, fields: SearchFields): Promise<ArlsRow[]> {
  const key = `${board.base}|${JSON.stringify(fields)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.rows;
  const form = new URLSearchParams({ [board.classField]: "", AccountNumber: "", ...(board.qualifierField ? { QualifierAccountNumber: "" } : {}), CompanyName: "", FirstName: "", LastName: "", PhoneNumber: "", streetAddress: "", PostalCode: "", City: "", StateCode: "" });
  for (const [k, v] of Object.entries(fields)) form.set(k, v ?? "");
  const rows = (async () => {
    const html = await arlsText(`${board.base}/Public/_Search/`, { method: "POST", body: form.toString(), headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" } });
    if (/No results found for search criteria/i.test(html)) return [];
    if (!/Search Results/i.test(html)) throw new Error(`${new URL(board.base).host} returned an unexpected page`);
    const seen = new Set<string>();
    return parseArlsSearch(html).filter((r) => !seen.has(r.key) && !!seen.add(r.key));
  })();
  rows.catch(() => cache.delete(key));
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

/** A name search: company name ("contains"), or a person's first and last word. */
export function arlsSearch(board: ArlsBoard, name: string, kind: "person" | "company"): Promise<ArlsRow[]> {
  const words = tokens(name);
  if (kind === "person" ? words.length < 2 : name.trim().length < 3) return Promise.resolve([]);
  return arlsPost(board, kind === "company" ? { CompanyName: name.trim().slice(0, 100) } : { FirstName: words[0], LastName: words[words.length - 1] });
}

const MAX_ACCOUNTS = 8;
const addressLines = (address: string | null | undefined): string[] =>
  (address ?? "").split(/<br\s*\/?>/i).map(htmlText).filter((v): v is string => !!v);
const cityOf = (address: string | null | undefined): string | null => {
  const last = addressLines(address).pop() ?? null;
  return last ? last.replace(/\s+\d{5}(-\d{4})?$/, "").trim() || null : null;
};

/** One account's details (and qualifiers) as a license hit. */
async function accountHit(board: ArlsBoard, row: ArlsRow, matchedOn: LicenseHit["matchedOn"]): Promise<LicenseHit & { lines?: string[] }> {
  const d = parseArlsDetails(await arlsText(`${board.base}/Public/_ShowAccountDetails/?key=${row.key}&Source=Search`));
  const f = d.fields;
  const isQualifier = !!f["Qualifier #"];
  const people: { name: string; role: string | null }[] = [];
  const add = (name: string | null | undefined, role: string) => { if (name && !people.some((p) => p.name === name)) people.push({ name, role }); };
  if (isQualifier) add(f.Name, "Qualifier");
  else {
    for (const h of d.holders) add(h.replace(/:.*$/, "").trim(), `Classification holder${h.includes(":") ? ` (${h.replace(/^[^:]*:\s*/, "")})` : ""}`);
    if (f.Company && f.Name) add(f.Name, "Contact");
    if (!board.noQualifiers) {
      const q = parseArlsQualifiers(await arlsText(`${board.base}/Public/_ShowAccountQualifiers/?key=${row.key}`));
      for (const x of q.filter((x) => !x.status || /active/i.test(x.status))) add(x.name, `Qualifier${x.number ? ` ${x.number}` : ""}`);
    }
  }
  const business = isQualifier ? d.qualifierFor.map((q) => q.licensee).filter(Boolean).join(" / ") || null : f.Company ?? f.Name ?? row.owner;
  const accountType = f["Account Type"];
  // The address block's first line can be an attention name (NCBEEC); the address is every line as published.
  const address = addressLines(f.Address).join(", ") || null;
  return {
    state: board.state, source: board.source, sourceUrl: `${board.base}/Public/Search`,
    businessName: business, licenseNumber: f["License #"] ?? f["Qualifier #"] ?? row.account,
    licenseType: isQualifier ? "Qualifier (responsible person on a license)" : !accountType || accountType === "License" ? board.licenseLabel : accountType,
    specialty: [d.classifications.join(", ") || null, f["License Limitation"] ? `Limitation: ${f["License Limitation"]}` : null,
      isQualifier && d.qualifierFor.length ? `Qualifier for ${d.qualifierFor.map((q) => `${q.licensee} (${q.license}${q.status ? `, ${q.status}` : ""})`).join("; ")}` : null].filter(Boolean).join(". ") || null,
    status: f.Status ?? (row.notActive ? "License not active" : null), principal: people.map((p) => p.name).join(", ") || null,
    city: cityOf(f.Address), expires: usDate(f["Expiration Date"]), matchedOn,
    address, phone: f.Phone ?? null, people, lines: addressLines(f.Address),
  };
}

/** License hits for a name on one board: the search, then the details (and qualifiers) of each matching account. */
export async function searchArlsLicenses(board: ArlsBoard, name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  const rows = await arlsSearch(board, name, kind);
  // A company must be the row's owner. A person search returns the licenses the person is on, often under the company's
  // name, so the person is checked in each account's details: rows already showing the person's name go first.
  const wanted = (kind === "company" ? rows.filter((r) => hasAllWords(name, r.owner))
    : [...rows.filter((r) => hasAllWords(name, r.owner)), ...rows.filter((r) => !hasAllWords(name, r.owner))]).slice(0, MAX_ACCOUNTS);
  const out: LicenseHit[] = [];
  for (const row of wanted) {
    const { lines: _lines, ...h } = await accountHit(board, row, kind === "company" ? "business" : "principal");
    if (kind === "person" && !(h.people ?? []).some((p) => hasAllWords(name, p.name))) continue;
    if (kind === "company" && !hasAllWords(name, h.businessName, row.owner)) continue;
    out.push(h);
  }
  return out;
}

/** License number ("L.03194", "Q.00290" or digits), phone or street address, checked again on each account's details. */
export async function searchArlsBy(board: ArlsBoard, q: IdQuery): Promise<LicenseHit[]> {
  let fields: SearchFields | null = null;
  if (q.type === "license") {
    const m = q.value.trim().toUpperCase().match(/^(?:(L|Q|QUAL\.L)\.?)?\s*0*(\d+)(?:-\d+)?$/);
    if (m) fields = m[1]?.startsWith("Q") && board.qualifierField ? { QualifierAccountNumber: m[2] } : { AccountNumber: m[2] };
  } else if (q.type === "phone") {
    const n = normPhone(q.value);
    if (n) fields = { PhoneNumber: n };
  } else {
    const street = q.value.split(",")[0].trim().slice(0, 50);
    if (/^\d+\s+\S/.test(street)) fields = { streetAddress: street };
  }
  if (!fields) return [];
  const rows = (await arlsPost(board, fields)).slice(0, MAX_ACCOUNTS);
  const out: LicenseHit[] = [];
  for (const row of rows) {
    const { lines = [], ...h } = await accountHit(board, row, q.type);
    // "L.03194" must be L.03194 (the electrical board has a U.03194); bare digits match any prefix.
    const want = normLicense(q.value) ?? "", have = normLicense(h.licenseNumber) ?? "";
    const ok = q.type === "license" ? (/^[A-Z]/.test(want) ? have === want : have.replace(/^[A-Z]+0*/, "") === want.replace(/^0*/, ""))
      : q.type === "phone" ? normPhone(h.phone) === normPhone(q.value)
      // The block can hold an attention line, a PO box and a street: any street line with the city line matches.
      : lines.slice(0, -1).some((l) => addressMatches(q.value, `${l}, ${lines[lines.length - 1]}`));
    if (ok) out.push(h);
  }
  return out;
}

/** Disciplinary actions on every license account whose name matches (companies only). */
export async function searchArlsMatters(board: ArlsBoard, name: string): Promise<EnforcementHit[]> {
  if (!board.mattersPath) return [];
  const rows = (await arlsSearch(board, name, "company")).filter((r) => hasAllWords(name, r.owner) && /^L\./.test(r.account)).slice(0, MAX_ACCOUNTS);
  const out: EnforcementHit[] = [];
  for (const row of rows) {
    const matters = parseArlsMatters(await arlsText(`${board.base}${board.mattersPath}?key=${row.key}`), board.base);
    for (const m of matters) {
      out.push({
        state: board.state, source: `${board.source}: disciplinary actions`, sourceUrl: m.doc ?? `${board.base}/Public/Search`, category: "discipline",
        name: row.owner, id: m.caseNo, date: m.date, endDate: null,
        status: `Disciplinary action, case ${m.caseNo ?? "(no number)"}; the board's order is the linked document`,
        city: null, detail: m.heading ? `Listed under "${m.heading}"` : null,
        amount: null, adverse: null, licenseNumber: row.account,
      });
    }
  }
  return out;
}
