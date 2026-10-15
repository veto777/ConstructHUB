/**
 * Idaho. Checked live 2026-10-15.
 *
 *   ID Secretary of State business entities: the Secretary of State's public business search (sosbiz.idaho.gov,
 *     its JSON API; robots.txt allows it), with status and standing as published (Active-Existing, Inactive-Forfeited,
 *     Good Standing, ...). Companies only.
 *
 * Idaho's contractor registration and its electrical, plumbing, HVAC and public-works licenses are all kept by DOPL in
 * eDOPL (edopl.idaho.gov), whose robots.txt disallows every path, including its public license search and its
 * exportable "Public License List Search". Nothing there is used; see `blocked`.
 */
import type { EnforcementHit } from "@shared/research-reports";
import { politeFetch } from "../../scrapers/polite-fetch";
import { tokens } from "../licenses";
import { clean, usDate } from "../bulk";
import type { LiveEnforcementSearch, StatePack } from "./types";

const SOS_SEARCH_PAGE = "https://sosbiz.idaho.gov/search/business";
const SOS_API = "https://sosbiz.idaho.gov/api/Records/businesssearch";

const hasAll = (name: string, v: string | null | undefined) => { const want = tokens(name); const have = new Set(tokens(v ?? "")); return want.length > 0 && want.every((w) => have.has(w)); };

export type IdSosRow = { TITLE?: (string | null)[]; RECORD_NUM?: string | null; FILING_DATE?: string | null; STATUS?: string | null; STANDING?: string | null };

/** "BOISE ROOFING LLC (556603)" → "BOISE ROOFING LLC". */
export function idSosHit(r: IdSosRow): EnforcementHit {
  const status = clean(r.STATUS), standing = clean(r.STANDING);
  return {
    state: "ID", source: "Idaho Secretary of State business entities", sourceUrl: SOS_SEARCH_PAGE,
    category: "business_status", name: clean(r.TITLE?.[0]?.replace(/\s*\(\d+\)\s*$/, "")), id: clean(r.RECORD_NUM), date: usDate(r.FILING_DATE), endDate: null,
    status: [status ? `Secretary of State status: ${status}` : null, standing ? `standing: ${standing}` : null].filter(Boolean).join(", ") || null,
    city: null, detail: clean(r.TITLE?.[1]), amount: null,
    adverse: /forfeit|revoked/i.test(status ?? "") ? true : null,
  };
}

async function searchIdSos(name: string): Promise<EnforcementHit[]> {
  const q = name.replace(/\s+/g, " ").trim();
  if (q.length < 3) return [];
  const res = await politeFetch(SOS_API, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json", referer: SOS_SEARCH_PAGE },
    body: JSON.stringify({ SEARCH_VALUE: q, STARTS_WITH_YN: true, CRA_SEARCH_YN: false, ACTIVE_ONLY_YN: false, FILING_DATE: { start: null, end: null } }),
  }, { minDelayMs: 1500 });
  if (!res.ok) throw new Error(`Idaho Secretary of State returned HTTP ${res.status}`);
  const data = await res.json().catch(() => null) as { rows?: Record<string, IdSosRow> } | null;
  if (!data || typeof data !== "object") throw new Error("Idaho Secretary of State returned an unexpected payload");
  return Object.values(data.rows ?? {}).map(idSosHit).filter((h) => hasAll(name, h.name));
}

const liveEnforcement: LiveEnforcementSearch[] = [
  { source: "Idaho Secretary of State business entities", scope: "Every business entity and assumed business name on the Secretary of State's register (names that start with the search)", category: "business_status", search: searchIdSos },
];

export const pack: StatePack = {
  state: "ID",
  checked: "2026-10-15",
  liveEnforcement,
  blocked: [
    "DOPL eDOPL license search and Public License List Search (edopl.idaho.gov): robots.txt disallows every path; this covers contractor registration, electrical, plumbing, HVAC and public works contractor licenses and their discipline",
  ],
};
