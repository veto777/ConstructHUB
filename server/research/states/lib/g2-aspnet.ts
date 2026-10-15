/**
 * Small helpers for the ASP.NET WebForms lookups the New England boards publish (MyLicense "eLicense" verification
 * sites in Massachusetts, the Rhode Island DLT trade lookup): a cookie-carrying session that follows redirects by
 * hand (fetch drops the cookies a 302 sets), and a parser for the form fields a browser would post back.
 * Every request goes through politeFetch (honest user agent, one request at a time per host, at most ~1/s).
 */
import { politeFetch } from "../../http";
import { decodeEntities } from "../../bulk-sources";
import { clean } from "../../bulk";

export class FormSession {
  private cookies = new Map<string, string>();
  constructor(private readonly minDelayMs = 1100, private readonly timeoutMs = 120_000) {}

  private remember(res: Response) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  private cookieHeader(): Record<string, string> {
    return this.cookies.size ? { cookie: Array.from(this.cookies, ([k, v]) => `${k}=${v}`).join("; ") } : {};
  }

  /** GET or POST, following up to 5 redirects with the session's cookies. Returns the final response and its URL. */
  async request(url: string, form?: URLSearchParams, referer?: string): Promise<{ res: Response; url: string }> {
    let method = form ? "POST" : "GET";
    let body: string | undefined = form?.toString();
    let current = url;
    for (let hop = 0; hop < 6; hop++) {
      const headers: Record<string, string> = { ...this.cookieHeader(), ...(referer ? { referer } : {}) };
      if (body != null) headers["content-type"] = "application/x-www-form-urlencoded";
      const res = await politeFetch(current, { method, body, headers, redirect: "manual" }, { minDelayMs: this.minDelayMs, timeoutMs: this.timeoutMs, retries: 1 });
      this.remember(res);
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.arrayBuffer().catch(() => undefined);
        current = new URL(loc, current).toString();
        method = "GET";
        body = undefined;
        continue;
      }
      if (!res.ok) { await res.arrayBuffer().catch(() => undefined); throw new Error(`HTTP ${res.status} for ${current}`); }
      return { res, url: current };
    }
    throw new Error(`too many redirects from ${url}`);
  }

  async text(url: string, form?: URLSearchParams, referer?: string): Promise<{ html: string; url: string }> {
    const { res, url: final } = await this.request(url, form, referer);
    return { html: await res.text(), url: final };
  }
}

/** Hidden and text inputs, checked boxes/radios and selected options, as the browser would post them. */
export function formFields(html: string): URLSearchParams {
  const form = new URLSearchParams();
  for (const m of Array.from(html.matchAll(/<input\b[^>]*>/gi))) {
    const tag = m[0];
    const name = tag.match(/\bname="([^"]+)"/)?.[1];
    if (!name) continue;
    const type = (tag.match(/\btype="([^"]+)"/i)?.[1] ?? "text").toLowerCase();
    const value = decodeEntities(tag.match(/\bvalue="([^"]*)"/)?.[1] ?? "");
    if (type === "hidden" || type === "text") form.set(name, value);
    else if ((type === "checkbox" || type === "radio") && /\bchecked\b/i.test(tag)) form.set(name, value || "on");
  }
  for (const m of Array.from(html.matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi))) {
    const opt = m[2].match(/<option[^>]*selected[^>]*value="([^"]*)"/i) ?? m[2].match(/<option[^>]*value="([^"]*)"/i);
    // A select with no options (filled by a later postback) isn't posted by a browser; posting it empty breaks some forms.
    if (opt) form.set(decodeEntities(m[1]), decodeEntities(opt[1]));
  }
  return form;
}

/** The text of an HTML fragment. */
export const textOf = (s: string | null | undefined): string | null =>
  clean(decodeEntities((s ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")));

/** The value attribute of the named submit button (boards label the same button differently). */
export const buttonValue = (html: string, name: string): string | null =>
  html.match(new RegExp(`name="${name.replace(/\$/g, "\\$")}"[^>]*value="([^"]*)"`))?.[1] ?? html.match(new RegExp(`value="([^"]*)"[^>]*name="${name.replace(/\$/g, "\\$")}"`))?.[1] ?? null;

/** Rows of an HTML table (by id) as arrays of cell HTML. */
export function tableRows(html: string, id: string): string[][] {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return [];
  const end = html.indexOf("</table>", start);
  const table = html.slice(start, end < 0 ? undefined : end);
  return Array.from(table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)).map((r) => Array.from(r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((c) => c[1]));
}

/** "Jane Q Public" → first "Jane", last "Public" (for lookups with separate name boxes). */
export function splitName(name: string): { first: string; last: string } | null {
  const words = name.replace(/[^A-Za-z' -]/g, " ").split(/\s+/).filter(Boolean);
  const suffix = /^(JR|SR|II|III|IV)$/i;
  while (words.length > 2 && suffix.test(words[words.length - 1])) words.pop();
  if (words.length < 2) return null;
  return { first: words[0], last: words[words.length - 1] };
}
