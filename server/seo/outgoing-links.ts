/**
 * Site Audit → Outgoing links: the other websites a site links to, from the newest crawl's saved pages — which ones,
 * from how many of its pages, with what link text — and which of the links the crawl checked answered with an error.
 * Free: read from sitescan_jobs.state.
 *
 * What it rests on, and what it does not claim: the crawl reads each page's HTML (a link added by JavaScript is not
 * seen); it keeps up to 2,000 links a page; it does not record a link's own rel ("nofollow", "sponsored"); and it
 * checks only a sample of the addresses it did not crawl (up to 40), so "answered an error" is about those checked
 * — an unchecked link is "not checked", never "fine".
 */
import { pool } from "../db";
import { auditDomainKey } from "./audit";
import { linksMeasurable, type RawPage } from "./audit-pages";

export const OUTGOING_DOMAINS = 500, OUTGOING_EXAMPLES = 3;
export type OutPage = { url: string; status: number; links: string[]; evidence?: { target: string; anchor: string }[] };
export type LinkCheck = { url: string; status: number | null };
export type LinkedDomain = {
  domain: string; /** Pages of the site that link to it. */ pages: number; /** Links to it in all (a page linking twice counts twice). */ links: number;
  /** A few of the links: from which page, to which address, on what words. */ examples: { from: string; to: string; anchor: string | null }[];
  /** Of its addresses the crawl checked: how many, and how many answered an error (or no answer). */ checked: number; broken: number;
};
/**
 * What a checked address's answer says: "gone" (404/410), "error" (5xx), "refused" (401/403/429 — many sites refuse
 * automated checks; a person may well see the page), "no_answer" (no response). Only the first two are called broken.
 */
export type Answer = "gone" | "error" | "refused" | "no_answer";
export const answerOf = (s: number | null): Answer | null => (s === null ? "no_answer" : s === 404 || s === 410 ? "gone" : s >= 500 ? "error" : s === 401 || s === 403 || s === 429 ? "refused" : s >= 400 ? "error" : null);
export type BrokenOutgoing = { to: string; status: number | null; answer: Answer; /** Pages that link to it (up to 5) and how many in all. */ from: string[]; fromCount: number };
export type OutgoingLinks = {
  linksMeasured: boolean; pagesRead: number; domains: number; links: number;
  linkedDomains: LinkedDomain[]; /** More linked websites than are listed. */ more: number;
  broken: BrokenOutgoing[]; /** External addresses the crawl checked (a sample), and how many links point at addresses it did not. */ checkedAddresses: number; uncheckedLinks: number;
};

const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; } };
/** A link counts as outgoing when its host is neither the site's nor a sub-domain of it. */
const own = (host: string, site: string) => host === site || host.endsWith(`.${site}`);
/** Broken = gone or a server error. A refusal or no answer is listed apart: it says nothing certain about the page. */
const broken = (s: number | null) => { const a = answerOf(s); return a === "gone" || a === "error"; };

/** Pure. `site` is the site's bare host. Only pages that loaded (2xx) count as linking. */
export function outgoingLinks(pages: readonly OutPage[], checks: readonly LinkCheck[], site: string): OutgoingLinks {
  const loaded = pages.filter((p) => p.status >= 200 && p.status < 300);
  const checked = new Map(checks.filter((c) => typeof c?.url === "string").map((c) => [c.url, c.status] as const));
  const byDomain = new Map<string, { pages: Set<string>; links: number; examples: LinkedDomain["examples"]; urls: Set<string> }>();
  const fromOf = new Map<string, Set<string>>();
  let total = 0;
  for (const p of loaded) {
    const anchors = new Map<string, string>();
    for (const e of Array.isArray(p.evidence) ? p.evidence : []) if (e?.target && !anchors.has(e.target)) anchors.set(e.target, String(e.anchor ?? "").slice(0, 120));
    for (const l of Array.isArray(p.links) ? p.links : []) {
      if (typeof l !== "string") continue;
      const h = hostOf(l);
      if (!h || own(h, site) || !/^https?:/i.test(l)) continue;
      total++;
      const d = byDomain.get(h) ?? byDomain.set(h, { pages: new Set(), links: 0, examples: [], urls: new Set() }).get(h)!;
      d.links++; d.pages.add(p.url); d.urls.add(l);
      if (d.examples.length < OUTGOING_EXAMPLES && !d.examples.some((x) => x.from === p.url)) d.examples.push({ from: p.url, to: l, anchor: anchors.get(l) || null });
      (fromOf.get(l) ?? fromOf.set(l, new Set()).get(l)!).add(p.url);
    }
  }
  const list = [...byDomain.entries()].map(([domain, d]) => {
    const urls = [...d.urls], chk = urls.filter((u) => checked.has(u));
    return { domain, pages: d.pages.size, links: d.links, examples: d.examples, checked: chk.length, broken: chk.filter((u) => broken(checked.get(u)!)).length };
  }).sort((a, b) => b.pages - a.pages || b.links - a.links || a.domain.localeCompare(b.domain));
  const externalUrls = [...fromOf.keys()];
  // Every checked address whose answer was not an ordinary page: broken ones first, then refused / no answer.
  const brokenList = externalUrls.filter((u) => checked.has(u) && answerOf(checked.get(u)!) !== null)
    .map((u) => ({ to: u, status: checked.get(u)!, answer: answerOf(checked.get(u)!)!, from: [...fromOf.get(u)!].slice(0, 5), fromCount: fromOf.get(u)!.size }))
    .sort((a, b) => Number(broken(b.status)) - Number(broken(a.status)) || b.fromCount - a.fromCount || a.to.localeCompare(b.to));
  return {
    linksMeasured: linksMeasurable(pages.map((p) => ({ url: p.url, status: p.status, links: p.links } as RawPage))), pagesRead: loaded.length,
    domains: list.length, links: total, linkedDomains: list.slice(0, OUTGOING_DOMAINS), more: Math.max(0, list.length - OUTGOING_DOMAINS),
    broken: brokenList, checkedAddresses: externalUrls.filter((u) => checked.has(u)).length,
    uncheckedLinks: externalUrls.filter((u) => !checked.has(u)).reduce((n, u) => n + fromOf.get(u)!.size, 0),
  };
}

const HOST_SQL = `regexp_replace(regexp_replace(lower(url), '^https?://(www\\.)?', ''), '[/:?#].*$', '')`;
const arr = (expr: string, n: number) => `CASE WHEN jsonb_typeof(${expr})='array' THEN COALESCE((SELECT jsonb_agg(l) FROM jsonb_array_elements(${expr}) WITH ORDINALITY x(l, n) WHERE n <= ${n}), '[]'::jsonb) ELSE '[]'::jsonb END`;
const PAGES_SQL = `COALESCE((SELECT jsonb_agg(jsonb_build_object('url', p->>'url',
    'status', CASE WHEN jsonb_typeof(p->'status')='number' AND (p->>'status')::numeric BETWEEN 0 AND 999 THEN (p->>'status')::numeric::int ELSE 0 END,
    'links', ${arr("p->'links'", 2000)}, 'evidence', ${arr("p->'linkEvidence'", 2000)}))
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'pages')='array' THEN state->'pages' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(p, ord)
 WHERE jsonb_typeof(p)='object' AND p->>'url' IS NOT NULL AND ord <= 1000), '[]'::jsonb)`;

/** null = no finished crawl of the site yet. */
export async function siteOutgoingLinks(userId: number, site: { id: number; domain: string }): Promise<(OutgoingLinks & { jobId: string; scannedAt: string | null }) | null> {
  const { rows: [job] } = await pool.query(
    `SELECT id, completed_at, ${PAGES_SQL} AS pages, CASE WHEN jsonb_typeof(state->'linkChecks')='array' THEN state->'linkChecks' ELSE '[]'::jsonb END AS checks
       FROM sitescan_jobs WHERE user_id=$1 AND status='completed' AND jsonb_typeof(report)='object' AND ${HOST_SQL}=$2 ORDER BY completed_at DESC LIMIT 1`,
    [userId, auditDomainKey(site.domain)]);
  if (!job) return null;
  return { ...outgoingLinks(job.pages as OutPage[], job.checks as LinkCheck[], auditDomainKey(site.domain)), jobId: job.id, scannedAt: job.completed_at ? new Date(job.completed_at).toISOString() : null };
}
