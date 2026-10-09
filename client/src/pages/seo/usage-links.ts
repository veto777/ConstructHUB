/**
 * Usage → where each lookup was spent: the page a ledger row opens (usage.tsx), read from the words the ledger kept.
 * A pure module (no React), so the server's tests can run it.
 */
import { seoLinks } from "./links";
import type { SeoSite } from "./shell";

/**
 * The page a lookup was made on, read from the words the ledger kept for it (server/seo/*: the labels given to
 * withBudget). A label that names a site opens that site's page; one that names none opens the page for the
 * account's only site, or nothing when there are several (a guess would be a wrong page). A label naming a domain that
 * is no longer one of the account's sites opens nothing for the lookups only a site has (a snapshot, a gap): the
 * explorer's live report of that domain is not what was bought.
 */
export function spentOn(what: string, sites: SeoSite[]): string | null {
  const byDomain = (d: string) => sites.find((s) => s.domain.toLowerCase() === d.toLowerCase()) ?? null;
  const only = sites.length === 1 ? sites[0] : null;
  let m: RegExpExecArray | null;
  if ((m = /^Site Explorer report — (\S+)/.exec(what))) return seoLinks.explorer(m[1]);
  if ((m = /^Keyword (?:overview|ideas) — (.+)$/.exec(what))) return seoLinks.keywords(m[1]);
  if ((m = /^Rank check — .* for (\S+) \(/.exec(what))) { const s = byDomain(m[1]); return s ? seoLinks.rankTracker(s.id) : null; }
  if ((m = /^Search volumes — .* for (\S+)$/.exec(what))) { const s = byDomain(m[1]); return s ? seoLinks.rankTracker(s.id) : null; }
  if ((m = /^Backlink snapshot — (\S+) \(/.exec(what))) { const s = byDomain(m[1]); return s ? seoLinks.backlinks(s.id) : null; }
  if ((m = /^Keyword snapshot — (\S+) \(/.exec(what))) { const s = byDomain(m[1]); return s ? seoLinks.alerts({ site: s.id }) : null; }
  if ((m = /^Competitor gap — (\S+) vs (\S+)$/.exec(what))) { const s = byDomain(m[1]); return s ? seoLinks.competitors(s.id, { competitor: m[2] }) : null; }
  // Site explorer's own comparisons: the gap of the first site against the others.
  if ((m = /^Content gap — (\S+) vs /.exec(what))) return seoLinks.explorer(m[1], "contentGap");
  if ((m = /^Link intersect — (\S+) vs /.exec(what))) return seoLinks.explorer(m[1], "linkIntersect");
  if (/^Batch analysis — /.test(what)) return seoLinks.batch();
  if ((m = /^Content explorer — "(.+)"/.exec(what))) return seoLinks.content(m[1]);
  // The rendering check of one site's pages: its tab in Site audit.
  if ((m = /^Rendering check — ([^\s,]+),/.exec(what))) { const s = byDomain(m[1]); return s ? seoLinks.audit(s.id, { tab: "rendering" }) : null; }
  // AI mentions of any website: the box on the AI visibility page shows the saved result (any site's page will do).
  if ((m = /^AI mentions — (\S+) \((Google AI Overviews|ChatGPT)\)$/.exec(what))) { const s = byDomain(m[1]) ?? only ?? sites[0]; return s ? seoLinks.ai(s.id, { mentions: m[1], platform: m[2] === "ChatGPT" ? "chat_gpt" : "google" }) : null; }
  if ((m = /^Mentions — (\S+) \(link check/.exec(what))) { const s = byDomain(m[1]); return s ? seoLinks.mentions(s.id) : null; }
  if (/^Refresh list — /.test(what)) return seoLinks.keywords("", { view: "lists" });
  if (/^Local grid — /.test(what)) return only ? seoLinks.localGrid(only.id) : null;
  // A question asked of the assistants: its site (newer rows name it) and, for a monthly question, its id; otherwise its
  // first 90 characters, which the AI page opens as the one saved question that begins with them.
  if ((m = /^AI visibility — "(.*)" \(([^()]*)\)(?: for (\S+))?$/.exec(what))) {
    const s = (m[3] ? byDomain(m[3]) : null) ?? (m[3] ? null : only);
    if (!s) return null;
    const id = /monthly #(\d+)$/.exec(m[2]);
    return id ? seoLinks.ai(s.id, { question: Number(id[1]) }) : seoLinks.ai(s.id, { prompt: m[1] });
  }
  if ((m = /^Mentions watch — "(.+)"$/.exec(what))) { const s = sites.find((x) => (x.businessName ?? "").trim().toLowerCase() === m![1].trim().toLowerCase()) ?? only; return s ? seoLinks.mentions(s.id) : null; }
  if (/^Mentions( watch)? — /.test(what)) return only ? seoLinks.mentions(only.id) : null;
  // Round 3: the six paid kinds the ledger used to leave as words.
  // Directories: the site and the competitors compared, in the order the comparison was saved under ("none": alone).
  // A second try names the sites it retried and, on newer rows, the whole comparison ("… (second try for a, b)"); an
  // older second try names no comparison, so it opens nothing.
  if ((m = /^Directories — (.+?)( \(second try(?: for (.+))?\))?$/.exec(what))) {
    const list = (m[2] ? m[3] : m[1])?.split(", ").filter(Boolean) ?? [];
    if (!list.length) return null;
    return seoLinks.explorer(list[0], "directories", { rivals: list.slice(1).join(",") || "none" });
  }
  if ((m = /^Service-area planner — (\S+) \(/.exec(what))) { const s = byDomain(m[1]); return s ? seoLinks.servicePlanner(s.id) : null; }
  if ((m = /^Opportunities — (\S+)$/.exec(what))) return seoLinks.explorer(m[1], "opportunities");
  // The label keeps how many keywords, not which: the page it was made on.
  if (/^Bulk keyword analysis — /.test(what)) return seoLinks.keywords("", { view: "bulk" });
  // One page of a Site explorer / Keywords explorer table: "<the table's name> — <domain or keyword>".
  if ((m = /^(.+?) — (.+)$/.exec(what))) {
    if (Object.prototype.hasOwnProperty.call(REPORT_VIEWS, m[1])) return seoLinks.explorer(m[2], REPORT_VIEWS[m[1]]);
    if (Object.prototype.hasOwnProperty.call(IDEA_TABLES, m[1])) return seoLinks.keywords(m[2], { table: IDEA_TABLES[m[1]] });
  }
  return null;
}

/**
 * The report tables as the ledger names them (server/seo/routes.ts REPORT_NAMES: "<name> — <target>") and the Site
 * explorer view each opens (explorer.tsx's menu keys). The test checks every name the server writes is here.
 */
const REPORT_VIEWS: Record<string, string> = {
  "Organic keywords": "keywords", "Paid keywords": "paidKeywords", "Top pages": "pages", "Organic competitors": "competitors", Backlinks: "backlinks", "New backlinks": "newBacklinks",
  "Lost backlinks": "lostBacklinks", "Broken backlinks": "brokenBacklinks", "Referring domains": "referringDomains", Anchors: "anchors", "Best pages by links": "bestByLinks", "Referring IPs": "referringIps",
  "Sites with similar links": "linkCompetitors", Subdomains: "subdomains", Ads: "ads",
};
/** Keywords explorer's idea tables (a keyword's, not a site's): the `table` each opens. */
const IDEA_TABLES: Record<string, string> = { "Matching terms": "matchingTerms", "Related terms": "relatedTerms", Questions: "questions" };
