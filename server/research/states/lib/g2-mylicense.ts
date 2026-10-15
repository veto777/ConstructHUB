/**
 * MyLicense "eLicense" verification sites (https://<agency>.mylicense.com/verification/), used by Massachusetts
 * OPSI (madpl) and the Massachusetts Department of Fire Services (madfs). Two things are done with them:
 *
 *   - download: the site's own free "Download File" of a search's results (a pipe-delimited text file, $0.00, no
 *     account), walked through the same four pages a browser shows (results → confirmation → file type → file);
 *   - search: the results grid of one search, read page by page (the site pages 40 rows at a time).
 *
 * Checked live 2026-10-15. robots.txt on madpl.mylicense.com and madfs.mylicense.com: none (404).
 */
import { FormSession, buttonValue, formFields, tableRows, textOf } from "./g2-aspnet";
import { withNote, type Noted } from "../../notes";

const actionOf = (html: string, base: string): string => {
  const a = html.match(/<form[^>]*action="([^"]*)"/i)?.[1];
  return a ? new URL(a.replace(/&amp;/g, "&"), base).toString() : base;
};

/** Run one search on the lookup page and return the results page. Fields are the form's own names (t_web_lookup__*). */
async function runSearch(s: FormSession, base: string, fields: Record<string, string>): Promise<{ html: string; url: string }> {
  const page = await s.text(base);
  const form = formFields(page.html);
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set("sch_button", buttonValue(page.html, "sch_button") ?? "Search");
  return s.text(actionOf(page.html, page.url), form, page.url);
}

/** The pipe-delimited download of one search (header row first); null when the search found no one. */
export async function myLicenseDownload(base: string, fields: Record<string, string>): Promise<string | null> {
  const s = new FormSession(1200, 10 * 60_000);
  const results = await runSearch(s, base, fields);
  // An empty result still shows the Download button, but the site errors on it: no detail link means no rows.
  if (!/Details\.aspx\?result=/.test(results.html)) return null;
  const dl = buttonValue(results.html, "btnBulkDownLoad");
  if (!dl) throw new Error(`no results to download for ${JSON.stringify(fields)}`);
  const f1 = formFields(results.html); f1.set("btnBulkDownLoad", dl);
  const confirm = await s.text(actionOf(results.html, results.url), f1, results.url);
  const f2 = formFields(confirm.html); f2.set("btnContinue", buttonValue(confirm.html, "btnContinue") ?? "Continue");
  const pref = await s.text(actionOf(confirm.html, confirm.url), f2, confirm.url);
  const f3 = formFields(pref.html); f3.set("filetype", "delimitedtext"); f3.set("sch_button", buttonValue(pref.html, "sch_button") ?? "Download");
  const { res } = await s.request(actionOf(pref.html, pref.url), f3, pref.url);
  if (!/attachment/i.test(res.headers.get("content-disposition") ?? "")) { await res.arrayBuffer().catch(() => undefined); throw new Error("the site did not send the file"); }
  return res.text();
}

/** Rows of a pipe-delimited download as objects keyed by its header. */
export function* pipeRecords(text: string): Iterable<Record<string, string>> {
  const lines = text.split(/\r?\n/);
  const header = (lines.shift() ?? "").split("|").map((h) => h.trim());
  if (!header.includes("license_no")) throw new Error("unexpected download layout");
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = line.split("|");
    const o: Record<string, string> = {};
    header.forEach((h, i) => { if (h) o[h] = (cells[i] ?? "").trim(); });
    yield o;
  }
}

export type MyLicenseRow = Record<string, string | null> & { name: string | null; detailUrl: string | null };

/** Parse one results page: each row keyed by the grid's own column headers. */
export function parseMyLicenseResults(html: string, base: string): MyLicenseRow[] {
  const rows = tableRows(html, "datagrid_results");
  const headerAt = rows.findIndex((r) => r.some((c) => /License\s*(#|Number)/i.test(textOf(c) ?? "")));
  if (headerAt < 0) return [];
  const header = rows[headerAt].map((c) => textOf(c) ?? "");
  const out: MyLicenseRow[] = [];
  for (const r of rows.slice(headerAt + 1)) {
    if (r.length !== header.length) continue;
    const href = r[0].match(/href="(Details\.aspx[^"]*)"/)?.[1];
    const row: MyLicenseRow = { name: textOf(r[0]), detailUrl: href ? new URL(href.replace(/&amp;/g, "&"), base).toString() : null };
    header.forEach((h, i) => { if (i > 0) row[h] = textOf(r[i]); });
    out.push(row);
  }
  return out;
}

/** The grid's page links: [postback target, page number] (a "..." link carries no number and counts as "more"). */
export function pageLinks(html: string): { target: string; page: number | null }[] {
  return Array.from(html.matchAll(/__doPostBack\(&#39;(datagrid_results\$_ctl\d+\$_ctl\d+)&#39;,&#39;&#39;\)"[^>]*>(\d+|\.\.\.)</g))
    .map((m) => ({ target: m[1], page: /^\d+$/.test(m[2]) ? Number(m[2]) : null }));
}

/**
 * Every results page of one search, up to `maxPages`. When the grid links pages beyond that, the rows come back with a
 * note saying the rest was not read (audit 2026-10-15, decision 9), never as if they were all.
 */
export async function myLicenseSearch(base: string, fields: Record<string, string>, maxPages = 5): Promise<Noted<MyLicenseRow>> {
  const s = new FormSession(1200);
  let page = await runSearch(s, base, fields);
  if (/There is an error with your input/i.test(page.html) && !/datagrid_results/.test(page.html)) throw new Error("the lookup rejected the search");
  const out = parseMyLicenseResults(page.html, page.url);
  let read = 1;
  for (let n = 2; n <= maxPages; n++) {
    // Page links: __doPostBack('datagrid_results$_ctl1$_ctlK','') whose text is the page number.
    const link = pageLinks(page.html).find((l) => l.page === n);
    if (!link) break;
    const form = formFields(page.html);
    form.set("__EVENTTARGET", link.target); form.set("__EVENTARGUMENT", "");
    page = await s.text(actionOf(page.html, page.url), form, page.url);
    out.push(...parseMyLicenseResults(page.html, page.url));
    read = n;
  }
  const more = pageLinks(page.html).some((l) => l.page == null || l.page > read);
  return withNote(out, more ? `read the first ${read} page(s) of results (${out.length} rows); the lookup had more pages, not read` : null);
}
