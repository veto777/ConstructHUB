/**
 * Rendering check (Site audit): each chosen page is fetched twice — once as plain HTML, the way our own
 * crawler and a simple bot see it, and once in a real browser with JavaScript run, the way Google's
 * renderer sees it — and the two are put side by side: words, links, title, main heading, plus how long
 * the rendered page took. A page whose words or links only exist after JavaScript is one where a crawl
 * of the HTML alone under-reports; that is said per page, with the numbers.
 * A run takes about half a minute, so it runs in the background and is saved before it is charged.
 */
import { z } from "zod";
import { pool } from "../db";
import { request, assertOk, safeHttpUrl, type DfsTask } from "./dataforseo";
import { withBudget } from "./budget";
import { publicNote } from "./public-errors";

export const RENDER_MAX_PAGES = 10;
/** Measured 2026-10-08: plain fetch $0.00015, browser fetch $0.0051. */
export const RENDER_PLAIN_USD = 0.00015, RENDER_BROWSER_USD = 0.0051;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
/** What is held while `pages` pages are checked. The customer pays for the fetches that returned. */
export const renderEstimateUsd = (pages: number) => round6(pages * (RENDER_PLAIN_USD + RENDER_BROWSER_USD) * 1.2);
export const RENDER_STALE_MINUTES = 8;
export const renderDeps = { request, retryMs: 2000 };

export const renderInput = z.object({ urls: z.array(z.string().max(2000)).min(1).max(RENDER_MAX_PAGES) }).strict();
/** The pages to check: web addresses on the site itself (or a sub-domain of it), each once, without fragments. */
export const renderUrls = (list: readonly string[], domain: string): string[] => renderUrlsAll(list, domain).slice(0, RENDER_MAX_PAGES);
function renderUrlsAll(list: readonly string[], domain: string): string[] {
  const site = domain.toLowerCase().replace(/^www\./, ""), out: string[] = [];
  for (const raw of list) {
    const safe = safeHttpUrl(raw);
    if (!safe) continue;
    let u: URL; try { u = new URL(safe); } catch { continue; }
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== site && !host.endsWith(`.${site}`)) continue;
    u.hash = "";
    const s = u.toString();
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Pages to offer, at most twelve: one from each section of the site in turn (the first part of the path), so the
 * offer is not twelve pages built from the same template. The order given (nearest the home page first) is kept within a section.
 */
export function renderSuggestions(list: readonly string[], domain: string, max = 12): string[] {
  const sections = new Map<string, string[]>();
  for (const u of renderUrlsAll(list, domain)) { const k = new URL(u).pathname.split("/")[1] ?? ""; (sections.get(k) ?? sections.set(k, []).get(k)!).push(u); }
  const out: string[] = [], queues = [...sections.values()];
  for (let i = 0; out.length < max && queues.some((q) => q.length > i); i++) for (const q of queues) if (q[i] && out.length < max) out.push(q[i]);
  return out;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown, max = 300): string | null => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);

export type RenderSide = { status: number | null; words: number | null; internalLinks: number | null; externalLinks: number | null; images: number | null; title: string | null; h1: string | null };
/** One fetch, read. null when the fetch returned no page. Pure. */
export function parseSide(item: any): RenderSide | null {
  if (!item || typeof item !== "object") return null;
  const m = item.meta ?? {};
  return {
    status: num(item.status_code), words: num(m.content?.plain_text_word_count), internalLinks: num(m.internal_links_count), externalLinks: num(m.external_links_count), images: num(m.images_count),
    title: text(m.title), h1: text(Array.isArray(m.htags?.h1) ? m.htags.h1[0] : null),
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
export type RenderVerdict = "same" | "needs_js" | "unknown";
export type RenderRow = {
  url: string; plain: RenderSide | null; rendered: RenderSide | null;
  /** Milliseconds, from the browser fetch: when the biggest thing on screen was painted, when the page could be used, when it finished loading. */
  timing: { lcp: number | null; interactive: number | null; loaded: number | null } | null;
  problems: string[];
  verdict: RenderVerdict; /** In words, with the numbers that led to it. */ why: string;
};
/**
 * Does the page depend on JavaScript for what a search engine reads? "needs_js" when the rendered page has at least
 * half as many words again (and 100 more), or half as many internal links again (and 10 more), than the plain HTML —
 * or when title or main heading only exist once rendered. Unknown when either fetch is missing. Pure.
 */
export function renderVerdict(plain: RenderSide | null, rendered: RenderSide | null): { verdict: RenderVerdict; why: string } {
  if (!plain || !rendered) return { verdict: "unknown", why: !plain && !rendered ? "Neither fetch returned the page." : !plain ? "The plain fetch did not return the page, so there is nothing to compare the rendered page with." : "The browser fetch did not return the page, so what Google's renderer sees is not known." };
  const reasons: string[] = [];
  const more = (a: number | null, b: number | null, ratio: number, floor: number) => a !== null && b !== null && b - a >= floor && b >= a * ratio;
  if (more(plain.words, rendered.words, 1.5, 100)) reasons.push(`${plain.words} words in the HTML, ${rendered.words} once JavaScript has run`);
  if (more(plain.internalLinks, rendered.internalLinks, 1.5, 10)) reasons.push(`${plain.internalLinks} links to the site's own pages in the HTML, ${rendered.internalLinks} once rendered`);
  if (!plain.title && rendered.title) reasons.push("the title only exists once rendered");
  if (!plain.h1 && rendered.h1) reasons.push("the main heading only exists once rendered");
  if (reasons.length) return { verdict: "needs_js", why: `Depends on JavaScript: ${reasons.join("; ")}.` };
  return { verdict: "same", why: `Much the same either way: ${plain.words ?? "?"} words and ${plain.internalLinks ?? "?"} own-site links in the HTML, ${rendered.words ?? "?"} and ${rendered.internalLinks ?? "?"} once rendered.` };
}
/** Pure: one page's row from its two fetches (the items the source returned, or null). */
export function buildRenderRow(url: string, plainItem: any, renderedItem: any): RenderRow {
  const plain = parseSide(plainItem), rendered = parseSide(renderedItem);
  const t = renderedItem?.page_timing;
  const checks = renderedItem?.checks && typeof renderedItem.checks === "object" ? renderedItem.checks : {};
  return {
    url, plain, rendered,
    timing: rendered && t ? { lcp: num(t.largest_contentful_paint), interactive: num(t.time_to_interactive), loaded: num(t.dom_complete) } : null,
    problems: Object.keys(RENDER_PROBLEMS).filter((k) => checks[k] === true).map((k) => RENDER_PROBLEMS[k]),
    ...renderVerdict(plain, rendered),
  };
}
export type RenderResult = { rows: RenderRow[]; summary: { pages: number; needsJs: number; same: number; unknown: number }; fetchedAt: string };
export const summariseRender = (rows: RenderRow[]) => ({ pages: rows.length, needsJs: rows.filter((r) => r.verdict === "needs_js").length, same: rows.filter((r) => r.verdict === "same").length, unknown: rows.filter((r) => r.verdict === "unknown").length });

/** Fetch every page both ways, three pages at a time. A fetch that fails leaves its side unknown and is not the customer's to pay for; if nothing at all returned, the run fails. */
export async function fetchRender(urls: string[]): Promise<{ data: RenderResult; costUsd: number; customerUsd: number; costUnknown: false }> {
  let known = 0, customerUsd = 0, unknownUsd = 0, next = 0, got = 0;
  let firstError: unknown = null;
  const rows: RenderRow[] = new Array(urls.length);
  /** One fetch. A fetch that failed and was certainly not billed (the source said so, or refused it) is tried once more. */
  const one = async (url: string, js: boolean): Promise<any> => {
    for (let attempt = 1; ; attempt++) {
      try {
        const task: DfsTask = assertOk(await renderDeps.request("POST", "/on_page/instant_pages", [{ url, enable_javascript: js, enable_browser_rendering: js }]), { treatNoResultsAsEmpty: true });
        const cost = typeof task.cost === "number" ? task.cost : 0;
        const item = (task.result?.[0] as any)?.items?.[0] ?? null;
        known += cost;
        if (item) { customerUsd += cost; got++; return item; }
        // Answered, but with no page: not the customer's to pay for. Free answers are asked for once more.
        console.warn(`[seo] rendering check: the ${js ? "browser" : "plain"} fetch returned no page (attempt ${attempt})`);
        if (cost > 0 || attempt >= 2) return null;
      } catch (e: any) {
        firstError ??= e;
        const reported = typeof e?.costUsd === "number" ? e.costUsd : 0;
        known += reported;
        console.warn(`[seo] rendering check: the ${js ? "browser" : "plain"} fetch failed (${e?.code ?? "error"}, attempt ${attempt})`);
        // A fetch whose cost we never learned may still have been billed: allow for it in our own figure, and do not buy it twice.
        const maybeBilled = e?.code === "timeout" || (e?.code === "upstream" && !(reported > 0));
        if (maybeBilled) unknownUsd += js ? RENDER_BROWSER_USD : RENDER_PLAIN_USD;
        if (maybeBilled || reported > 0 || attempt >= 2 || e?.code === "auth" || e?.code === "not_configured") return null;
      }
      await new Promise((r) => setTimeout(r, renderDeps.retryMs));
    }
  };
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= urls.length) return;
      const [plain, rendered] = await Promise.all([one(urls[i], false), one(urls[i], true)]);
      rows[i] = buildRenderRow(urls[i], plain, rendered);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, urls.length) }, worker));
  const costUsd = round6(known + unknownUsd);
  if (!got) throw Object.assign(new Error((firstError as any)?.message ?? "The pages could not be fetched."), { costUsd, costUnknown: false, cause: firstError });
  return { data: { rows, summary: summariseRender(rows), fetchedAt: new Date().toISOString() }, costUsd, customerUsd: round6(customerUsd), costUnknown: false };
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
export async function runRender(userId: number, runId: number, urls: string[], label: string): Promise<RenderResult> {
  const out = await withBudget(userId, renderEstimateUsd(urls.length), async () => {
    const o = await fetchRender(urls);
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
