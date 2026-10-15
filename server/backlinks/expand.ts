/**
 * Expansion: organisations link to their own kind. A chamber lists the chambers around it, a home builders association
 * its sister chapters, a directory other directories, a newspaper its sister papers. Each source the media inbox sorted
 * as a chamber, trade association, listing directory or newspaper has its found page, home page and up to two
 * links / resources / chapters pages read, and the other sites they link to that name themselves as one of those
 * become new candidates (vetted like any search result). Free: our own requests. Every candidate is a real link on a
 * real page; none is guessed.
 */
import * as cheerio from "cheerio";
import type { BacklinkKind } from "@shared/backlinks";
import { isExcluded, normalizeDomain } from "./discover";
import { vetDeps } from "./vet";

/** What a linked site says it is (its link text or host), as a Backlinks kind. Chambers and associations are "directory". */
const RELATED: { re: RegExp; kind: BacklinkKind }[] = [
  { re: /chamber|\bcoc\b|economic development|business alliance|downtown association/, kind: "directory" },
  { re: /home ?builders|builders? (association|exchange)|\bhba\b|\bbia\b|\bnari\b|\bagc\b|\babc\b|\bneca\b|\bphcc\b|\bacca\b|\bsmacna\b|\bnrca\b|contractors? association|remodelers|roofing (contractors )?association|plumbing.*association|electrical contractors/, kind: "directory" },
  { re: /business directory|local directory|yellow ?pages|business listings|find a (contractor|pro|business)/, kind: "citation" },
  { re: /\b(gazette|herald|tribune|courier|chronicle|sentinel|observer|examiner|newspaper|daily news|weekly|news ?paper|times|journal|ledger|dispatch|bulletin|inquirer|press)\b/, kind: "editorial" },
];
/** Pages of an organisation that list other organisations. */
const LIST_PAGE = /\b(links|resources|chapters|local associations|affiliates|partner organi[sz]ations|sister|related sites|our (papers|publications|newspapers)|regional chambers|find a chapter)\b/;
export const MAX_EXPAND_PAGES = 4;

export type RelatedSite = { domain: string; url: string; kind: BacklinkKind; label: string };

/** Other sites a page links to that name themselves as a chamber, association, directory or newspaper. */
export function relatedSites(html: string, pageUrl: string, domain: string): RelatedSite[] {
  const $ = cheerio.load(html || "");
  const out = new Map<string, RelatedSite>();
  $("a[href]").each((_, a) => {
    let abs: URL;
    try { abs = new URL(String($(a).attr("href")), pageUrl); } catch { return; }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
    const host = normalizeDomain(abs.href);
    const base = domain.split(".").slice(-2).join(".");
    if (!host || host === domain || host.endsWith(`.${base}`) || host === base || isExcluded(host) || out.has(host)) return;
    const label = `${$(a).text()} ${$(a).attr("title") ?? ""} ${host.replace(/[.-]/g, " ")}`.toLowerCase().replace(/\s+/g, " ").trim();
    const hit = RELATED.find((r) => r.re.test(label));
    if (hit) out.set(host, { domain: host, url: `${abs.protocol}//${abs.host}/`, kind: hit.kind, label: label.slice(0, 120) });
  });
  return [...out.values()];
}

/** Same-site pages that list other organisations. */
export function listPages(html: string, pageUrl: string, domain: string): string[] {
  const $ = cheerio.load(html || "");
  const out = new Set<string>();
  $("a[href]").each((_, a) => {
    let abs: URL;
    try { abs = new URL(String($(a).attr("href")), pageUrl); } catch { return; }
    const host = normalizeDomain(abs.href);
    if (!host || (host !== domain && !host.endsWith(`.${domain}`))) return;
    if (LIST_PAGE.test(`${$(a).text()} ${decodeURIComponent(abs.pathname).replace(/[-_/]+/g, " ")}`.toLowerCase())) { abs.hash = ""; out.add(abs.href); }
  });
  return [...out];
}

/** Read up to MAX_EXPAND_PAGES pages of one source; the related sites they link to. */
export async function expandSource(domain: string, discoveredUrl: string | null): Promise<{ sites: RelatedSite[]; pagesRead: number }> {
  const seen = new Set<string>();
  const sites = new Map<string, RelatedSite>();
  let pagesRead = 0;
  const queue = [discoveredUrl ?? "", `https://${domain}/`].filter(Boolean);
  for (let i = 0; i < queue.length && pagesRead < MAX_EXPAND_PAGES; i++) {
    const url = queue[i];
    if (seen.has(url)) continue;
    seen.add(url);
    pagesRead++;
    const page = await vetDeps.fetch(url).catch(() => null);
    if (!page || page.status >= 400 || !page.body) continue;
    for (const s of relatedSites(page.body, page.url || url, domain)) if (!sites.has(s.domain)) sites.set(s.domain, s);
    // Links / chapters pages found on the first two pages are read next.
    if (i < 2) for (const p of listPages(page.body, page.url || url, domain).slice(0, 2)) if (!queue.includes(p)) queue.push(p);
  }
  return { sites: [...sites.values()], pagesRead };
}
