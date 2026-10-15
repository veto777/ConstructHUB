/**
 * District of Columbia. Checked live 2026-10-15.
 *
 * Licenses (bulk):
 *   dc-bbl  DLCP Basic Business Licenses for construction: General Contractor/Construction Manager, Home Improvement
 *           Contractor, Home Improvement Salesperson and Asbestos Abatement Business endorsements, every status
 *           (DC GIS open data, maps2.dcgis.dc.gov FEEDS/DCRA FeatureServer/0, the "Basic Business Licenses" dataset
 *           on opendata.dc.gov). Carries the owner and registered-agent names, premises and billing addresses.
 *
 * Enforcement (companies only):
 *   dc-ocp-excluded  DC Office of Contracting and Procurement Excluded Parties List: current and past exclusions of
 *                    companies (the page's individual tables are left out)
 */
import { promises as fs } from "node:fs";
import type { EnforcementHit } from "@shared/research-reports";
import { USER_AGENT, politeFetch, rateLimitHost } from "../../scrapers/polite-fetch";
import { clean, type BulkHit } from "../bulk";
import { decodeEntities } from "../bulk-sources";
import type { StatePack } from "./types";

// ── DLCP Basic Business Licenses (ArcGIS FeatureServer) ─────────────────────────────────────────────────────────
const BBL_PAGE = "https://opendata.dc.gov/datasets/DCGIS::basic-business-licenses";
const BBL_LAYER = "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/0";
const BBL_WHERE = "BUSINESSACTIVITY LIKE 'General Contractor%' OR BUSINESSACTIVITY IN ('Home Improvement Contractor','Home Improvement Salesperson','Asbestos Abatement Business')";
const BBL_FIELDS = ["OBJECTID", "CUSTOMERNUMBER", "LICENSESTATUS", "LICENSEENDDATE", "BUSINESSACTIVITY", "PREMISEADDRESS", "BILLINGADDRESS", "ENTITYNAME",
  "ENTITYTRADENAME", "ENTITYTYPE", "BUSINESSOWNERFIRSTNAME", "BUSINESSOWNERMIDDLENAME", "BUSINESSOWNERLASTNAME", "AGENTFIRSTNAME", "AGENTMIDDLENAME", "AGENTLASTNAME", "AGENTENTITY"];

type Attrs = Record<string, string | number | null>;
const a = (r: Attrs, k: string) => clean(r[k] == null ? null : String(r[k]));
const epochDay = (v: unknown) => (typeof v === "number" && v > 0 ? new Date(v).toISOString().slice(0, 10) : null);
/** "1219 KENYON ST NW, WASHINGTON, DC, 20010, USA" → "1219 KENYON ST NW, WASHINGTON, DC 20010". */
const dcAddress = (v: string | null) => clean(v?.replace(/,\s*USA$/i, "").replace(/,\s*(\d{5}(-\d{4})?)$/, " $1") ?? null);

export function bblHit(r: Attrs): BulkHit | null {
  const entity = a(r, "ENTITYNAME"), trade = a(r, "ENTITYTRADENAME");
  if (!entity && !trade) return null;
  const owner = clean([a(r, "BUSINESSOWNERFIRSTNAME"), a(r, "BUSINESSOWNERMIDDLENAME"), a(r, "BUSINESSOWNERLASTNAME")].filter(Boolean).join(" "));
  const agent = clean([a(r, "AGENTFIRSTNAME"), a(r, "AGENTMIDDLENAME"), a(r, "AGENTLASTNAME")].filter(Boolean).join(" "));
  const sole = /sole proprietor/i.test(a(r, "ENTITYTYPE") ?? "");
  const premises = dcAddress(a(r, "PREMISEADDRESS")), billing = dcAddress(a(r, "BILLINGADDRESS"));
  const people = [
    ...(owner ? [{ name: owner, role: "Business owner" }] : []),
    ...(agent ? [{ name: agent, role: "Registered agent" }] : []),
  ];
  const license = a(r, "CUSTOMERNUMBER");
  return {
    kind: "license",
    hit: {
      state: "DC", source: "DC DLCP basic business licenses (construction)", sourceUrl: BBL_PAGE,
      businessName: [entity, trade && trade !== entity ? trade : null].filter(Boolean).join(" / ") || null,
      licenseNumber: license, licenseType: a(r, "BUSINESSACTIVITY")?.replace(/\s*\(A, B, C,$/, " (A, B, C, D)") ?? null,
      specialty: a(r, "ENTITYTYPE"), status: a(r, "LICENSESTATUS"), principal: owner ?? (sole ? entity : null),
      city: premises?.split(",").slice(-2).join(",").trim() ?? null, expires: epochDay(r.LICENSEENDDATE),
      matchedOn: "business", address: premises ?? billing, people,
    },
    business: [entity, trade].filter(Boolean).join(" "), person: owner ?? (sole ? entity : null), people: [agent],
    keys: { licenses: [license], addresses: [premises, billing] },
  };
}

async function* bblLoader(): AsyncIterable<BulkHit> {
  const pageSize = 2000;
  for (let offset = 0; offset < 200_000; offset += pageSize) {
    const q = new URLSearchParams({ where: BBL_WHERE, outFields: BBL_FIELDS.join(","), orderByFields: "OBJECTID", resultOffset: String(offset), resultRecordCount: String(pageSize), returnGeometry: "false", f: "json" });
    const res = await politeFetch(`${BBL_LAYER}/query?${q}`, { headers: { accept: "application/json" } }, { minDelayMs: 1500, retries: 3, timeoutMs: 120_000 });
    if (!res.ok) throw new Error(`DC business licenses returned HTTP ${res.status}`);
    const body = await res.json() as { features?: { attributes: Attrs }[]; exceededTransferLimit?: boolean; error?: { message?: string } };
    if (body.error || !Array.isArray(body.features)) throw new Error(`DC business licenses: ${body.error?.message ?? "unexpected payload"}`);
    for (const f of body.features) { const h = bblHit(f.attributes); if (h) yield h; }
    if (body.features.length < pageSize && !body.exceededTransferLimit) break;
  }
}

// ── DC OCP Excluded Parties List ────────────────────────────────────────────────────────────────────────────────
const OCP = "https://ocp.dc.gov/page/excluded-parties-list";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** "May 8, 2026" (the first date when a cell lists several) → 2026-05-08. */
export function longDate(v: string | null): string | null {
  const m = v?.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  const mo = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0;
  return m && mo ? `${m[3]}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

export function parseOcpExcluded(html: string): { past: boolean; name: string; address: string | null; from: string | null; to: string | null; agency: string | null; reason: string | null }[] {
  const plain = (v: string) => clean(decodeEntities(v.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/[​‌‍﻿]/g, ""));
  const out: ReturnType<typeof parseOcpExcluded> = [];
  let past = false;
  let last = 0;
  for (const m of Array.from(html.matchAll(/<table[\s\S]*?<\/table>/g))) {
    if (/PAST EXCLUDED PARTIES/i.test(html.slice(last, m.index))) past = true;
    last = (m.index ?? 0) + m[0].length;
    const rows = Array.from(m[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)).map((r) => Array.from(r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)).map((c) => plain(c[1])));
    const head = rows[0]?.map((h) => (h ?? "").toLowerCase()) ?? [];
    if (!/name of company/.test(head[0] ?? "")) continue; // individuals' tables: companies only
    const col = (re: RegExp) => head.findIndex((h) => re.test(h));
    const iAddr = col(/address/), iFrom = col(/action date/), iTo = col(/expiration|termination/), iAgency = col(/agency/), iReason = col(/reason/);
    for (const r of rows.slice(1)) {
      const name = r[0];
      if (!name) continue;
      out.push({ past, name, address: iAddr >= 0 ? r[iAddr] ?? null : null, from: iFrom >= 0 ? longDate(r[iFrom] ?? null) : null,
        to: iTo >= 0 ? longDate(r[iTo] ?? null) : null, agency: iAgency >= 0 ? r[iAgency] ?? null : null, reason: iReason >= 0 ? r[iReason] ?? null : null });
    }
  }
  return out;
}

async function* ocpLoader(): AsyncIterable<BulkHit> {
  await rateLimitHost(OCP, 1500);
  const res = await fetch(OCP, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`DC OCP excluded parties page returned HTTP ${res.status}`);
  for (const r of parseOcpExcluded(await res.text())) {
    const hit: EnforcementHit = {
      state: "DC", source: "DC OCP excluded parties list", sourceUrl: OCP, category: "debarment", name: r.name, id: null,
      date: r.from, endDate: r.to, status: r.past ? "Past exclusion (no longer excluded)" : "Excluded from District contracts",
      city: null, detail: [r.agency ? `Action by ${r.agency}` : null, r.reason].filter(Boolean).join(": ") || null,
      amount: null, adverse: true, address: r.address,
    };
    yield { kind: "enforcement", hit, business: r.name, person: null, keys: { addresses: [r.address] } };
  }
}

export const pack: StatePack = {
  state: "DC",
  checked: "2026-10-15",
  bulk: [
    { id: "dc-bbl", state: "DC", label: "DC DLCP basic business licenses (construction)", pageUrl: BBL_PAGE, everyHours: 24, minRows: 25_000, load: bblLoader },
    { id: "dc-ocp-excluded", state: "DC", label: "DC OCP excluded parties list", pageUrl: OCP, everyHours: 24 * 7, minRows: 35, load: ocpLoader, companiesOnly: true },
  ],
  blocked: [
    "DC DLCP occupational and professional license search (govservices.dcra.dc.gov/oplaportal; electricians, plumbers, HVAC and other Board of Industrial Trades licenses): requires an Okta login",
    "DC DLCP corporations registry (corponline.dlcp.dc.gov / boss.dc.gov): reCAPTCHA in the app",
    "DC Superior Court eAccess (eaccess.dccourts.gov): did not answer from our network (connection timed out, 2026-10-15); no bulk data or API",
    "DC DGS excluded parties list (construction): its page has no list or file in the HTML; the OCP excluded parties list (used) is the District-wide one",
  ],
};
