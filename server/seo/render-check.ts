/**
 * Rendering check (Site audit): each chosen page is fetched twice — once as plain HTML, the way our own crawler and
 * a simple bot read it, and once in a browser with JavaScript run — and the two visits are put side by side: words,
 * links, title, main heading, plus how long the browser visit took. What is reported is what these two visits saw.
 * Neither is Googlebot, and nothing here measures what Google renders or indexes; the page says so.
 * A run takes about half a minute, so it runs in the background and is saved before it is charged.
 */
import { z } from "zod";
import { pool } from "../db";
import { request, assertOk } from "./dataforseo";
import { withBudget } from "./budget";
import { publicNote } from "./public-errors";
import { pageKey } from "@shared/seo-page-key";

export const RENDER_MAX_PAGES = 10;
/** Measured 2026-10-08: plain fetch $0.00015, browser fetch $0.0051. */
export const RENDER_PLAIN_USD = 0.00015, RENDER_BROWSER_USD = 0.0051;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
/** What is held while `pages` pages are checked — and the most the customer can be charged for them. */
export const renderEstimateUsd = (pages: number) => round6(pages * (RENDER_PLAIN_USD + RENDER_BROWSER_USD) * 1.2);
export const RENDER_STALE_MINUTES = 8;
export const renderDeps = { request, retryMs: 2000 };

export const renderInput = z.object({ urls: z.array(z.string().max(500)).min(1).max(RENDER_MAX_PAGES) }).strict();
const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");
const onSite = (host: string, domain: string) => { const h = bare(host), site = bare(domain); return h === site || h.endsWith(`.${site}`); };
/**
 * One address a check may fetch, or null: plain http(s) on the site itself or a sub-domain of it, on the standard
 * port, with no user name or password in it and not a bare IP address. The fragment is dropped. The fetch itself is
 * made by the data source from its own network, never from ours; what it answered is checked again afterwards
 * (a visit that ended on another site is not compared).
 */
export function renderUrl(raw: unknown, domain: string): string | null {
  if (typeof raw !== "string" || raw.length > 500) return null;
  let u: URL; try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password || u.port) return null;
  if (/^[\d.]+$/.test(u.hostname) || u.hostname.includes(":") || !u.hostname.includes(".")) return null;
  if (!onSite(u.hostname, domain)) return null;
  u.hash = "";
  return u.toString();
}
function renderUrlsAll(list: readonly unknown[], domain: string): string[] {
  const out: string[] = [];
  for (const raw of list) { const s = renderUrl(raw, domain); if (s && !out.includes(s)) out.push(s); }
  return out;
}
/** The pages to check: each once, at most RENDER_MAX_PAGES. */
export const renderUrls = (list: readonly unknown[], domain: string): string[] => renderUrlsAll(list, domain).slice(0, RENDER_MAX_PAGES);
/**
 * Pages to offer, at most twelve: one from each section of the site in turn (the first part of the path), so the
 * offer is not twelve pages built from the same template. The order given (nearest the home page first) is kept within a section.
 */
export function renderSuggestions(list: readonly string[], domain: string, max = 12): string[] {
  const sections = new Map<string, string[]>();
  for (const u of renderUrlsAll(list, domain)) { const x = new URL(u), k = `${x.hostname}/${x.pathname.split("/")[1] ?? ""}`; (sections.get(k) ?? sections.set(k, []).get(k)!).push(u); }
  const out: string[] = [], queues = [...sections.values()];
  for (let i = 0; out.length < max && queues.some((q) => q.length > i); i++) for (const q of queues) if (q[i] && out.length < max) out.push(q[i]);
  return out;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown, max = 300): string | null => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);

export type RenderSide = {
  status: number | null;
  /** Where the visit ended, when the source says (it can differ from the address asked for). */ finalUrl: string | null;
  /** false = the answer carried no page measurements at all (so a missing title is "not reported", not "none"). */ measured: boolean;
  words: number | null; internalLinks: number | null; externalLinks: number | null; images: number | null; title: string | null; h1: string | null;
};
/** One fetch, read. null when the fetch returned no page. Pure. */
export function parseSide(item: any): RenderSide | null {
  if (!item || typeof item !== "object") return null;
  const m = item.meta && typeof item.meta === "object" ? item.meta : null;
  return {
    status: num(item.status_code), finalUrl: text(item.url, 500), measured: !!m && (num(m.content?.plain_text_word_count) !== null || num(m.internal_links_count) !== null),
    words: num(m?.content?.plain_text_word_count), internalLinks: num(m?.internal_links_count), externalLinks: num(m?.external_links_count), images: num(m?.images_count),
    title: text(m?.title), h1: text(Array.isArray(m?.htags?.h1) ? m.htags.h1[0] : null),
  };
}
/** Problems the rendered fetch reports, in plain words. Only real problems: the source's many neutral facts are left out. */
export const RENDER_PROBLEMS: Record<string, string> = {
  high_loading_time: "Slow to load", high_waiting_time: "The server is slow to answer", has_render_blocking_resources: "Files that hold up the first paint",
  no_title: "No title", no_description: "No description", no_h1_tag: "No main heading", duplicate_title_tag: "More than one title tag", duplicate_meta_tags: "Duplicate meta tags",
  no_image_alt: "Images without alt text", low_content_rate: "Very little text for the size of the page", large_page_size: "Very large page", is_broken: "The page is broken", is_4xx_code: "Page not found (4xx)", is_5xx_code: "Server error (5xx)",
  no_doctype: "No doctype", https_to_http_links: "Links from https to http", has_misspelling: "Spelling mistakes", deprecated_html_tags: "Outdated HTML tags", canonical_to_broken: "Canonical points to a broken page", canonical_to_redirect: "Canonical points to a redirect",
  is_orphan_page: "No links to this page", has_links_to_redirects: "Links to redirects", frame: "Uses frames", flash: "Uses Flash", lorem_ipsum: "Placeholder text left in",
};
/** more = the browser visit saw clearly more than the HTML; less = clearly less; same = both measured and close; unknown = not comparable. */
export type RenderVerdict = "same" | "more" | "less" | "unknown";
export type RenderRow = {
  url: string; plain: RenderSide | null; rendered: RenderSide | null;
  /** Milliseconds, from the browser fetch: when the biggest thing on screen was painted, when the page could be used, when it finished loading. */
  timing: { lcp: number | null; interactive: number | null; loaded: number | null } | null;
  problems: string[];
  verdict: RenderVerdict; /** In words, with the numbers that led to it. */ why: string;
};
const okStatus = (s: RenderSide) => s.status !== null && s.status >= 200 && s.status < 300;
const said = (s: RenderSide) => (s.status === null ? "answered without a status" : `answered ${s.status}`);
/**
 * What the two visits of one page show. Compared only when BOTH were answered successfully (2xx), BOTH say where they
 * ended, that is the very same address on the site (nothing folded together: http and https, "www", a last slash are
 * different addresses until shown otherwise), and both reported their measurements. A blocked visit, an error page,
 * a redirect elsewhere on one side, or a visit that does not say where it ended is "could not be compared", never a
 * finding about JavaScript. "More" / "less": half as many words again
 * (and at least 100) or half as many own-site links again (and at least 10) one way or the other, or a title or main
 * heading present on one side only. "Same" needs both words and links measured on both sides. Pure.
 */
export function renderVerdict(plain: RenderSide | null, rendered: RenderSide | null, domain?: string): { verdict: RenderVerdict; why: string } {
  const unknown = (why: string) => ({ verdict: "unknown" as const, why });
  if (!plain || !rendered) return unknown(!plain && !rendered ? "Neither fetch returned the page." : !plain ? "The plain fetch did not return the page, so there is nothing to compare the browser visit with." : "The browser fetch did not return the page, so there is nothing to compare the HTML with.");
  if (!okStatus(plain) || !okStatus(rendered)) return unknown(`The plain fetch was ${said(plain)} and the browser fetch was ${said(rendered)}. Only two successful answers can be compared — a redirect, an error page or a visit that was blocked says nothing about JavaScript.`);
  const a = pageKey(plain.finalUrl), b = pageKey(rendered.finalUrl);
  if (!a || !b) return unknown("One of the visits did not say which address it ended on, so it is not known that the two saw the same page.");
  if (domain && (!onSite(new URL(a).hostname, domain) || !onSite(new URL(b).hostname, domain))) return unknown("One of the visits ended on another website, so the two are not compared.");
  if (a !== b) return unknown(`The two visits ended on different addresses (${a} and ${b}), so they are not compared.`);
  if (!plain.measured || !rendered.measured) return unknown("One of the visits came back without word or link counts, so there is nothing to compare.");
  const more: string[] = [], less: string[] = [];
  const gap = (a: number | null, b: number | null, floor: number) => (a === null || b === null ? 0 : b - a >= floor && b >= a * 1.5 ? 1 : a - b >= floor && a >= b * 1.5 ? -1 : 0);
  const w = gap(plain.words, rendered.words, 100), l = gap(plain.internalLinks, rendered.internalLinks, 10);
  if (w) (w > 0 ? more : less).push(`${plain.words} words in the HTML, ${rendered.words} in the browser visit`);
  if (l) (l > 0 ? more : less).push(`${plain.internalLinks} link${plain.internalLinks === 1 ? "" : "s"} to the site's own pages in the HTML, ${rendered.internalLinks} in the browser visit`);
  if (!plain.title && rendered.title) more.push("a title in the browser visit and none in the HTML");
  if (plain.title && !rendered.title) less.push("a title in the HTML and none in the browser visit");
  if (!plain.h1 && rendered.h1) more.push("a main heading in the browser visit and none in the HTML");
  if (plain.h1 && !rendered.h1) less.push("a main heading in the HTML and none in the browser visit");
  if (more.length) return { verdict: "more", why: `More once JavaScript had run: ${more.join("; ")}.${less.length ? ` Also less: ${less.join("; ")}.` : ""}` };
  if (less.length) return { verdict: "less", why: `Less once JavaScript had run: ${less.join("; ")}.` };
  if (plain.words === null || rendered.words === null || plain.internalLinks === null || rendered.internalLinks === null)
    return unknown("Only part of the page was measured on one of the visits (words or links are missing), so it is not called the same.");
  return { verdict: "same", why: `Much the same in both visits: ${plain.words} words and ${plain.internalLinks} own-site links in the HTML, ${rendered.words} and ${rendered.internalLinks} in the browser visit.` };
}
/** Pure: one page's row from its two fetches (the items the source returned, or null). */
export function buildRenderRow(url: string, plainItem: any, renderedItem: any, domain?: string): RenderRow {
  const plain = parseSide(plainItem), rendered = parseSide(renderedItem);
  const t = renderedItem?.page_timing;
  const checks = renderedItem?.checks && typeof renderedItem.checks === "object" ? renderedItem.checks : {};
  // Timings and problems are the requested page's only when the browser visit succeeded AND ended on this site.
  const ended = rendered ? pageKey(rendered.finalUrl) : null;
  const usable = !!rendered && okStatus(rendered) && !!ended && (!domain || onSite(new URL(ended).hostname, domain));
  return {
    url, plain, rendered,
    timing: usable && t ? { lcp: num(t.largest_contentful_paint), interactive: num(t.time_to_interactive), loaded: num(t.dom_complete) } : null,
    problems: usable ? Object.keys(RENDER_PROBLEMS).filter((k) => checks[k] === true).map((k) => RENDER_PROBLEMS[k]) : [],
    ...renderVerdict(plain, rendered, domain),
  };
}
export type RenderSummary = { pages: number; more: number; less: number; same: number; unknown: number };
export type RenderResult = { rows: RenderRow[]; summary: RenderSummary; fetchedAt: string };
export const summariseRender = (rows: RenderRow[]): RenderSummary => ({ pages: rows.length, more: rows.filter((r) => r.verdict === "more").length, less: rows.filter((r) => r.verdict === "less").length, same: rows.filter((r) => r.verdict === "same").length, unknown: rows.filter((r) => r.verdict === "unknown").length });

/**
 * Fetch every page both ways, three pages at a time. A fetch that fails leaves its side unknown and is not the
 * customer's to pay for; if nothing at all returned, the run fails. A fetch is asked for a second time ONLY when the
 * source said in so many words that the first cost nothing (it refused the request, or the task carries a cost of
 * exactly 0) — a failure whose cost we do not know may have been billed, so it is allowed for and not repeated.
 * The customer is never charged more than the figure they were shown (renderEstimateUsd).
 */
export async function fetchRender(urls: string[], domain?: string, /** Asked before each page: true = the run was closed meanwhile, so nothing more is fetched. */ stopped?: () => Promise<boolean>): Promise<{ data: RenderResult; costUsd: number; customerUsd: number; costUnknown: false }> {
  let known = 0, customerUsd = 0, unknownUsd = 0, next = 0, got = 0;
  let firstError: unknown = null, halted = false;
  const rows: RenderRow[] = new Array(urls.length);
  const one = async (url: string, js: boolean): Promise<any> => {
    const allow = () => { unknownUsd += js ? RENDER_BROWSER_USD : RENDER_PLAIN_USD; };
    for (let attempt = 1; ; attempt++) {
      let resp: any;
      try { resp = await renderDeps.request("POST", "/on_page/instant_pages", [{ url, enable_javascript: js, enable_browser_rendering: js }]); }
      catch (e: any) {
        // No answer at all (timed out, cut off, refused sign-in): whether it was billed is not known.
        firstError ??= e;
        console.warn(`[seo] rendering check: the ${js ? "browser" : "plain"} fetch failed (${e?.code ?? "error"}, attempt ${attempt})`);
        if (typeof e?.costUsd === "number" && e.costUsd > 0) known += e.costUsd; else if (e?.code !== "auth" && e?.code !== "not_configured") allow();
        return null;
      }
      const task = resp?.tasks?.[0];
      // Refused before any task was made: nothing was bought.
      const refused = !resp || resp.status_code !== 20000 || !task;
      const cost: number | null = refused ? 0 : typeof task.cost === "number" && Number.isFinite(task.cost) ? task.cost : null;
      const item = !refused && task.status_code === 20000 ? (task.result?.[0] as any)?.items?.[0] ?? null : null;
      if (cost === null) allow(); else known += cost;
      if (item) { customerUsd += cost ?? 0; got++; return item; }
      try { assertOk(resp, { treatNoResultsAsEmpty: true }); } catch (e) { firstError ??= e; }
      console.warn(`[seo] rendering check: the ${js ? "browser" : "plain"} fetch returned no page (attempt ${attempt}, cost ${cost === null ? "not stated" : cost})`);
      if (cost !== 0 || attempt >= 2) return null;
      await new Promise((r) => setTimeout(r, renderDeps.retryMs));
    }
  };
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= urls.length) return;
      // A run closed as interrupted cannot be saved or charged any more: stop buying fetches for it.
      if (halted || (stopped && i > 0 && await stopped().catch(() => false))) { halted = true; rows[i] = buildRenderRow(urls[i], null, null, domain); continue; }
      const [plain, rendered] = await Promise.all([one(urls[i], false), one(urls[i], true)]);
      rows[i] = buildRenderRow(urls[i], plain, rendered, domain);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, urls.length) }, worker));
  const costUsd = round6(known + unknownUsd);
  if (!got) throw Object.assign(new Error((firstError as any)?.message ?? "The pages could not be fetched."), { costUsd, costUnknown: false, cause: firstError });
  return { data: { rows, summary: summariseRender(rows), fetchedAt: new Date().toISOString() }, costUsd, customerUsd: Math.min(round6(customerUsd), renderEstimateUsd(urls.length)), costUnknown: false };
}

// ── Saved runs ──────────────────────────────────────────────────────────────

const INTERRUPTED = "The check was interrupted before it finished. You were not charged.";
export const RENDER_SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS seo_render_runs (
     id serial PRIMARY KEY,
     user_id integer NOT NULL,
     site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
     status text NOT NULL DEFAULT 'running',
     urls jsonb NOT NULL DEFAULT '[]'::jsonb,
     result jsonb,
     error text,
     cost_usd numeric NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS seo_render_runs_site ON seo_render_runs(site_id, created_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS seo_render_runs_active ON seo_render_runs(site_id) WHERE status='running'`,
];
const closeStale = (siteId: number) =>
  pool.query(`UPDATE seo_render_runs SET status='failed', error=$2 WHERE site_id=$1 AND status='running' AND created_at < now() - interval '${RENDER_STALE_MINUTES} minutes'`, [siteId, INTERRUPTED]);
/** Open a run. One at a time per site (the database's rule): a run already going comes back with `existing`. */
export async function beginRender(userId: number, siteId: number, urls: string[]): Promise<{ id: number; existing: boolean }> {
  await closeStale(siteId);
  const { rows: [row] } = await pool.query(`INSERT INTO seo_render_runs(user_id, site_id, urls) VALUES($1,$2,$3) ON CONFLICT (site_id) WHERE status='running' DO NOTHING RETURNING id`, [userId, siteId, JSON.stringify(urls)]);
  if (row) return { id: row.id, existing: false };
  const { rows: [running] } = await pool.query("SELECT id FROM seo_render_runs WHERE site_id=$1 AND user_id=$2 AND status='running' ORDER BY id DESC LIMIT 1", [siteId, userId]);
  if (!running) throw new Error("Could not start the check.");
  return { id: running.id, existing: true };
}
export async function finishRender(id: number, result: RenderResult, costUsd: number): Promise<boolean> {
  const { rowCount } = await pool.query("UPDATE seo_render_runs SET status='done', result=$2, cost_usd=$3 WHERE id=$1 AND status='running'", [id, JSON.stringify(result), costUsd]);
  return (rowCount ?? 0) > 0;
}
export async function failRender(id: number, message: string): Promise<void> {
  await pool.query("UPDATE seo_render_runs SET status='failed', error=$2 WHERE id=$1 AND status='running'", [id, message.slice(0, 300)]);
}
export type RenderRun = { id: number; status: "running" | "done" | "failed"; urls: string[]; result: RenderResult | null; error: string | null; at: string };
const toRun = (r: any): RenderRun => ({ id: r.id, status: r.status, urls: Array.isArray(r.urls) ? r.urls : [], result: r.status === "done" ? r.result ?? null : null, error: r.status === "failed" ? publicNote(r.error, "The check could not be completed.") ?? "The check could not be completed." : null, at: new Date(r.created_at).toISOString() });
/** The newest run of a site (running, done or failed), or null. */
export async function latestRender(userId: number, siteId: number): Promise<RenderRun | null> {
  await closeStale(siteId);
  const { rows: [row] } = await pool.query("SELECT * FROM seo_render_runs WHERE site_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 1", [siteId, userId]);
  return row ? toRun(row) : null;
}
export async function getRender(userId: number, siteId: number, runId: number): Promise<RenderRun | null> {
  await closeStale(siteId);
  const { rows: [row] } = await pool.query("SELECT * FROM seo_render_runs WHERE id=$1 AND site_id=$2 AND user_id=$3", [runId, siteId, userId]);
  return row ? toRun(row) : null;
}

/** One run, start to finish: fetched, SAVED, and only then charged. A run that cannot be saved is not the customer's to pay for. */
export async function runRender(userId: number, runId: number, urls: string[], label: string, domain?: string): Promise<RenderResult> {
  const out = await withBudget(userId, renderEstimateUsd(urls.length), async () => {
    const o = await fetchRender(urls, domain, async () => { const { rows: [r] } = await pool.query("SELECT status FROM seo_render_runs WHERE id=$1", [runId]); return r?.status !== "running"; });
    let saved = false, lastError: unknown = null;
    for (let attempt = 1; attempt <= 3 && !saved; attempt++) {
      try { saved = await finishRender(runId, o.data, o.costUsd); if (!saved) break; }
      catch (e) { lastError = e; await new Promise((r) => setTimeout(r, 500 * attempt)); }
    }
    if (!saved) throw Object.assign(new Error(`rendering check ${runId} could not be saved: ${(lastError as any)?.message ?? "it is no longer running"}`), { costUsd: o.costUsd, costUnknown: false, notSaved: true });
    return o;
  }, { label });
  return out.data;
}
