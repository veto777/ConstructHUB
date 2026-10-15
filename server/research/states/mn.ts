/**
 * Minnesota, checked live 2026-10-15.
 *
 *   mn-dli              DLI license and registration exports (secure.doli.state.mn.us/ccld/data, rebuilt nightly, linked
 *                       from dli.mn.gov/license-and-registration-lookup): residential building contractors, remodelers,
 *                       roofers and qualifying people; electrical, plumbing, high-pressure piping, elevator and water
 *                       conditioning licenses; construction contractor registrations; mechanical contractor bonds;
 *                       manufactured-home manufacturers and dealers. Every status, past and present.
 *   mn-dli-flagged      The same exports' Enforcement_Action column: business licenses DLI flags with an enforcement
 *                       action (value 1), as discipline records (companies only).
 *   mn-dli-orders       DLI enforcement actions (consent orders, cease-and-desist orders, licensing orders and penalties),
 *                       the residential-building-contractor, electrical and plumbing year-to-date PDFs linked from the three
 *                       enforcement-actions pages, current year and the two before (companies only).
 *   mn-debarred         Office of State Procurement suspended/debarred vendors (mn.gov/admin/osp; companies only). mn.gov's
 *                       robots.txt asks for visits between 00:00 and 12:00 GMT, so it loads only in those hours.
 *
 * Not loaded: the Boiler (boiler operating engineers), Building Officials and Continuing Education exports.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import { politeFetch } from "../http";
import { decodeEntities } from "../bulk-sources";
import { clean, csvRecords, download, usDate, type BulkHit } from "../bulk";
import { adverseFrom, hasEnded } from "../adverse";
import { looksLikeBusiness } from "./lib/business-name";
import type { StatePack } from "./types";

const run = promisify(execFile);

const DLI_LOOKUP = "https://www.dli.mn.gov/license-and-registration-lookup";
const DLI_DATA = "https://secure.doli.state.mn.us/ccld/data/MNDLILicRegCertExport_";
const DLI_FILES = [
  "Residential_Contractors", "Electrical", "Plumbing", "High_Pressure_Piping", "Elevator", "Water_Conditioning",
  "Contractor_Registrations", "Mechanical_Contractor_Bond", "Manufactured_Structures",
];

/** "VOLUNTARY TERMINATION" and "Voluntary Termination" are the same status in DLI's files: one casing. */
const titleCase = (v: string | null) => v && v.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** Every row of every DLI file, with the file it came from (a component of the load: round 2, decision 10). */
async function* dliRows(): AsyncIterable<Record<string, string> & { __file?: string }> {
  for (const f of DLI_FILES) {
    const path = await download(`${DLI_DATA}${f}.csv`);
    try { for await (const r of csvRecords(path)) yield Object.assign(r, { __file: f }); } finally { await fs.rm(path, { force: true }); }
  }
}

/** "Addr1 Addr2, City, ST Zip" as DLI publishes it; null when there is no street line. */
export const mnAddress = (r: Record<string, string>): string | null => {
  const street = clean([r.Addr1, r.Addr2].map((v) => clean(v)).filter(Boolean).join(" "));
  return street ? clean([street, clean(r.City), [clean(r.St), clean(r.Zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ")) : null;
};

export function mnLicense(r: Record<string, string>): BulkHit | null {
  const name = clean(r.Name);
  if (!name) return null;
  const isBusiness = /^business$/i.test(r.Bus_Pers?.trim() ?? "");
  const dba = clean(r.DBA_Name);
  const st = clean(r.St);
  const address = mnAddress(r), phone = clean(r.Phone_No);
  return {
    kind: "license",
    hit: {
      state: "MN", source: "Minnesota DLI licenses and registrations", sourceUrl: DLI_LOOKUP,
      businessName: isBusiness ? [name, dba ? `dba ${dba}` : null].filter(Boolean).join(" ") : dba,
      licenseNumber: clean(r.Lic_Number), licenseType: clean(r.License_Subtype) ?? clean(r.License_Type), specialty: clean(r.License_Type),
      status: titleCase(clean(r.Status)), principal: isBusiness ? null : name,
      city: [clean(r.City), st && st !== "MN" ? st : null].filter(Boolean).join(", ") || null, expires: usDate(r.Exp_Date),
      matchedOn: isBusiness || dba ? "business" : "principal",
      address, phone, ...(isBusiness ? {} : { people: [{ name, role: clean(r.License_Subtype) }] }),
      // DLI's own Bus_Pers column says who holds it; a person's DBA doesn't make it a business's (round 2, decision 2).
      holder: isBusiness ? "business" : clean(r.Bus_Pers) ? "individual" : null,
    },
    business: isBusiness ? [name, dba].filter(Boolean).join(" ") : dba, person: isBusiness ? null : name,
    keys: { licenses: [r.Lic_Number], phones: [phone], addresses: [address] },
  };
}

async function* dliLicenses(): AsyncIterable<BulkHit> {
  for await (const r of dliRows()) { const h = mnLicense(r); if (h) yield { ...h, component: r.__file }; }
}

async function* dliFlagged(): AsyncIterable<BulkHit> {
  for await (const r of dliRows()) {
    if (!/^business$/i.test(r.Bus_Pers?.trim() ?? "") || r.Enforcement_Action?.trim() !== "1") continue;
    const name = clean(r.Name);
    if (!name) continue;
    const dba = clean(r.DBA_Name);
    const status = titleCase(clean(r.Status));
    yield {
      kind: "enforcement",
      hit: {
        state: "MN", source: "Minnesota DLI licenses flagged with an enforcement action", sourceUrl: DLI_LOOKUP, category: "discipline",
        name: [name, dba].filter(Boolean).join(" / "), id: clean(r.Lic_Number), date: null, endDate: null,
        status: status ? `License status: ${status}` : null, city: clean(r.City),
        detail: `DLI's license data marks this ${clean(r.License_Subtype) ?? "license"} (${clean(r.Lic_Number) ?? "no number"}) with an enforcement action; the orders are on DLI's enforcement-actions pages`,
        // The license's own status is the only outcome this file gives: revoked/suspended is adverse, anything else unknown.
        amount: null, adverse: adverseFrom(status, { adverse: /revoked|suspended/i }) ? true : null,
        address: mnAddress(r), phone: clean(r.Phone_No), licenseNumber: clean(r.Lic_Number),
      },
      business: [name, dba].filter(Boolean).join(" "), person: null,
      keys: { licenses: [r.Lic_Number], phones: [r.Phone_No], addresses: [mnAddress(r)] },
    };
  }
}

// ── DLI enforcement-action PDFs ──────────────────────────────────────────────────────────────────────────────
const DLI_ORDER_PAGES = [
  "https://www.dli.mn.gov/business/residential-contractors/residential-building-contractor-enforcement-actions",
  "https://www.dli.mn.gov/business/electrical-contractors/electrical-enforcement-actions",
  "https://www.dli.mn.gov/business/plumbing-contractors/plumbing-enforcement-actions",
];
const DLI_ORDERS_PAGE = "https://www.dli.mn.gov/workers/homeowners/file-complaint-and-view-enforcement-actions";

/** A respondent caption that names a business (the PDFs also list individuals alone, who are skipped: FCRA). */
const BUSINESS = /\b(LLC|L\.L\.C\.?|INC\.?|INCORPORATED|CORP\.?|CORPORATION|CO\.|COMPANY|LTD\.?|LLP|PLLC|LP|DBA|D\/B\/A)(?=$|[\s,.)])|\b(construction|roofing|exteriors|restoration|builders?|remodel\w*|renovations?|contracting|contractors?|services?|electric\w*|plumbing|heating|mechanical|solutions|enterprises|group|painting|handyman|properties|siding|design)\b/i;
// ("Homes" is left out: it is a surname too. Audit 2026-10-15, decision 5.)

/** Adverse from an order's own text (audit 2026-10-15, decision 2); null when the text names no sanction. */
export const mnOrderAdverse = (order: string): boolean | null =>
  adverseFrom(order, { adverse: /revoke|revocation|suspend|censure|cease and desist|monetary penalty|\bfine|deni(?:ed|al)/i });

export type MnOrder = { name: string; location: string | null; order: string; date: string | null; amount: number | null; cases: string | null; licenses: string[] };

/** The entries of one enforcement-actions PDF, from `pdftotext -layout` text. */
export function parseMnOrders(text: string): MnOrder[] {
  const out: MnOrder[] = [];
  let header: string[] = [], bullets: string[] = [], started = false, lastWasHeader = false;
  const flush = () => {
    if (header.length && bullets.length) {
      const caption = header.join(" ");
      const licenses = Array.from(new Set(Array.from(caption.matchAll(/\b([A-Z]{2}\d{5,})\b/g)).map((m) => m[1])));
      const name = clean(caption.replace(/\s*\((?:[A-Z]{2}\d{5,})\)/g, "").replace(/\s+[–-]\s+[A-Z]{2}\d{5,}(?:\s*(?:and|,)\s*[A-Z]{2}\d{5,})*\s*$/, ""));
      const cases = bullets.find((b) => /^[A-Z]{2,4}\d{4}-\d+/.test(b)) ?? null;
      const rest = bullets.filter((b) => b !== cases);
      const [location, ...orders] = rest.length > 1 ? rest : [null, ...rest];
      const order = clean(orders.join("; "));
      if (name && order && BUSINESS.test(name)) {
        const dates = Array.from(order.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)).map((m) => m[1]);
        const pen = order.match(/\$([\d,]+(?:\.\d{2})?)\s+monetary penalty/i)?.[1];
        out.push({ name, location: clean(location), order, date: usDate(dates[dates.length - 1]), amount: pen ? Number(pen.replace(/,/g, "")) : null, cases: clean(cases), licenses });
      }
    }
    header = []; bullets = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\f/g, "");
    if (!started) { if (/^For more information/i.test(line.trim())) started = true; continue; }
    if (!line.trim()) { lastWasHeader = false; continue; }
    if (/Enforcement Actions\s+\d+\s*$/.test(line)) { lastWasHeader = false; continue; } // page footer
    const t = line.trim();
    if (t.startsWith("•")) { bullets.push(t.replace(/^•\s*/, "")); lastWasHeader = false; continue; }
    if (/^\s/.test(line)) { if (bullets.length) bullets[bullets.length - 1] += ` ${t}`; continue; } // wrapped bullet
    // A caption line (flush left): a new entry, or the wrapped second line of the caption just before it.
    if (lastWasHeader && !bullets.length) { header.push(t); continue; }
    flush();
    if (/\s[–-]\s*see\s/i.test(t)) { lastWasHeader = false; continue; } // "Name – see Other Name" cross-reference
    header = [t];
    lastWasHeader = true;
  }
  flush();
  return out;
}

async function pdfText(path: string): Promise<string> {
  try { return (await run("pdftotext", ["-layout", path, "-"], { maxBuffer: 64 << 20, timeout: 120_000 })).stdout; }
  catch (err: any) { throw new Error(err?.code === "ENOENT" ? "pdftotext (poppler-utils) is not installed" : String(err?.message ?? err)); }
}

async function* dliOrders(): AsyncIterable<BulkHit> {
  const seen = new Set<string>();
  const thisYear = new Date().getUTCFullYear();
  for (const page of DLI_ORDER_PAGES) {
    const res = await politeFetch(page, {}, { minDelayMs: 1500 });
    if (!res.ok) throw new Error(`${page} returned HTTP ${res.status}`);
    const html = await res.text();
    const pdfs = Array.from(new Set(Array.from(html.matchAll(/href="([^"]+\.pdf)"/gi)).map((m) => new URL(decodeEntities(m[1]), page).toString())))
      .filter((u) => { const y = Number(u.match(/(20\d{2})/)?.[1]); return y >= thisYear - 2 && y <= thisYear; });
    if (!pdfs.length) throw new Error(`no enforcement PDF linked from ${page}`);
    for (const url of pdfs) {
      const path = await download(url);
      let text: string;
      try { text = await pdfText(path); } finally { await fs.rm(path, { force: true }); }
      for (const o of parseMnOrders(text)) {
        const key = `${o.name}|${o.cases ?? o.date}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const kind = o.order.match(/^([^:;]{3,80}?):/)?.[1] ?? null;
        yield {
          kind: "enforcement",
          hit: {
            state: "MN", source: "Minnesota DLI enforcement actions (residential building, electrical, plumbing)", sourceUrl: url,
            category: "discipline", name: o.name, id: o.cases, date: o.date, endDate: null, status: clean(kind) ?? "Order issued",
            city: o.location, detail: `${o.order.slice(0, 900)}${/consent/i.test(kind ?? "") ? " (DLI: a consent order is not a finding of fact or admission of guilt)" : ""}`,
            // From the order's own words: revoked, censured, cease and desist, a monetary penalty, … (a consent order
            // with none of these, or a dismissal, is not marked adverse).
            amount: o.amount, adverse: mnOrderAdverse(o.order), licenseNumber: o.licenses.join(", ") || null,
          },
          business: o.name, person: null, keys: { licenses: o.licenses },
        };
      }
    }
  }
}

// ── Office of State Procurement suspended/debarred vendors ───────────────────────────────────────────────────
const MN_DEBAR = "https://mn.gov/admin/osp/government/suspended-debarred/";

type MnDebarred = { name: string; owner: string | null; city: string | null; address: string | null; fields: Record<string, string> };
export function parseMnDebarred(html: string): MnDebarred[] {
  const text = (s: string) => clean(decodeEntities(s.replace(/<[^>]+>/g, " ")));
  const out: MnDebarred[] = [];
  for (const m of Array.from(html.matchAll(/toggleDiv\('(\d+)'\)">([^<]+)<\/a>[\s\S]*?<div id="\1"[^>]*>([\s\S]*?)<\/table>/g))) {
    const name = text(m[2]);
    // Individuals: FCRA, companies only (the list marks most "…, an individual"; a bare personal name counts as one too).
    if (!name || /,\s*an individual\b/i.test(name) || !looksLikeBusiness(name)) continue;
    const fields: Record<string, string> = {};
    let owner: string | null = null;
    const lines: string[] = [];
    for (const row of Array.from(m[3].matchAll(/<tr>([\s\S]*?)<\/tr>/g))) {
      const cells = Array.from(row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => text(c[1]) ?? "");
      if (cells.length === 2) fields[cells[0].replace(/:$/, "")] = cells[1];
      else if (cells[0]?.startsWith("Owner/Officer:")) owner = clean(cells[0].replace(/^Owner\/Officer:/, ""));
      else if (cells[0]) lines.push(cells[0]);
    }
    const cityLine = lines.find((l) => /,\s*[A-Z]{2}\b/.test(l)) ?? null;
    const street = lines.filter((l) => l !== cityLine && !/^,?$/.test(l.trim()));
    const address = street.length && cityLine ? clean(`${street.join(" ")}, ${cityLine}`) : null;
    out.push({ name, owner, city: cityLine ? clean(cityLine.replace(/\s+\d{5}(-\d{4})?$/, "")) : null, address, fields });
  }
  return out;
}

/** One listed vendor as a report record; null when it lists no suspension or debarment date. */
export function mnDebarHit(v: MnDebarred, today = new Date().toISOString().slice(0, 10)): BulkHit | null {
  const f = v.fields;
  const debarred = usDate(f["Debarment Date"]), debarEnd = usDate(f["Debarment End Date"]);
  const susp = usDate(f["Suspension Date"]), suspEnd = usDate(f["Suspension End Date"]);
  const end = debarred ? debarEnd : suspEnd;
  const what = debarred ? "Debarred" : susp ? "Suspended" : null;
  if (!what) return null;
  return {
    kind: "enforcement",
    hit: {
      state: "MN", source: "Minnesota suspended and debarred vendors (Office of State Procurement)", sourceUrl: MN_DEBAR,
      category: "debarment", name: v.name, id: null, date: debarred ?? susp, endDate: end,
      status: end && end < today ? `${what}; period ended ${end}` : what, city: v.city,
      detail: [clean(f["Cause of Suspension or Debarment"]), debarred && susp ? `Suspended ${susp} to ${suspEnd ?? "?"} before the debarment` : null].filter(Boolean).join(". ") || null,
      // A debarment or suspension whose period is over is not adverse today; one still running is.
      amount: null, adverse: hasEnded(end, today) ? false : true, address: v.address,
    },
    business: v.name, person: null, keys: { addresses: [v.address] },
  };
}

async function* mnDebarred(): AsyncIterable<BulkHit> {
  const res = await politeFetch(MN_DEBAR, {}, { minDelayMs: 2000 });
  if (!res.ok) throw new Error(`debarment page returned HTTP ${res.status}`);
  for (const v of parseMnDebarred(await res.text())) { const h = mnDebarHit(v); if (h) yield h; }
}

export const pack: StatePack = {
  state: "MN",
  checked: "2026-10-15",
  bulk: [
    { id: "mn-dli", state: "MN", label: "Minnesota DLI licenses and registrations", pageUrl: DLI_LOOKUP, everyHours: 24, minRows: 170_000, load: dliLicenses },
    { id: "mn-dli-flagged", state: "MN", label: "Minnesota DLI licenses flagged with an enforcement action", pageUrl: DLI_LOOKUP, everyHours: 24, minRows: 1_900,
      load: dliFlagged, companiesOnly: true, category: "discipline" },
    { id: "mn-dli-orders", state: "MN", label: "Minnesota DLI enforcement actions (residential building, electrical, plumbing)", pageUrl: DLI_ORDERS_PAGE,
      everyHours: 24 * 7, minRows: 480, load: dliOrders, companiesOnly: true, category: "discipline" },
    // 20 of 44 names on 2026-10-15 read as businesses (bare personal names such as "Jacob Roy" are left out, and so are
    // a few organizations without a business word); the floor sits under that.
    { id: "mn-debarred", state: "MN", label: "Minnesota suspended and debarred vendors (Office of State Procurement)", pageUrl: MN_DEBAR,
      everyHours: 24, minRows: 15, load: mnDebarred, companiesOnly: true, category: "debarment", utcHours: [6, 7, 8, 9, 10, 11] },
  ],
  blocked: [
    "DLI license lookup (ims.dli.mn.gov): not needed, the same data is the nightly export loaded above",
    "DLI workers' compensation stop-work orders: no published list found on dli.mn.gov",
  ],
};
