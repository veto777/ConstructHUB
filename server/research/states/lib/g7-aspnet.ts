/**
 * A small cookie-keeping client for public ASP.NET Web Forms / PHP session search pages (the Nevada State
 * Contractors Board forms, Utah DOPL's disciplinary-action search): GET the form, post it back with its own hidden
 * fields, follow the redirect to the results page. Polite: one request at a time per host, the honest user agent.
 */
import { politeFetch } from "../../http";
import { decodeEntities } from "../../bulk-sources";

export class FormSession {
  private cookies = new Map<string, string>();
  constructor(private readonly minDelayMs = 1500, private readonly timeoutMs = 120_000) {}

  private keep(res: Response) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  private cookieHeader() { return Array.from(this.cookies, ([k, v]) => `${k}=${v}`).join("; "); }

  /** A request with this session's cookies; redirects followed by hand so each hop's cookies are kept. */
  async request(url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<{ url: string; html: string; status: number }> {
    let target = url;
    let method = init.method ?? "GET";
    let body = init.body;
    for (let hop = 0; hop < 5; hop++) {
      const headers: Record<string, string> = { ...(init.headers ?? {}) };
      if (this.cookies.size) headers.cookie = this.cookieHeader();
      if (body != null) headers["content-type"] ??= "application/x-www-form-urlencoded";
      const res = await politeFetch(target, { method, body, headers, redirect: "manual" }, { minDelayMs: this.minDelayMs, timeoutMs: this.timeoutMs });
      this.keep(res);
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.arrayBuffer().catch(() => undefined);
        target = new URL(loc, target).toString();
        method = "GET"; body = undefined;
        continue;
      }
      return { url: target, html: await res.text(), status: res.status };
    }
    throw new Error(`too many redirects from ${new URL(url).host}`);
  }

  /** Post a form back: its hidden inputs plus the given fields. */
  async postBack(url: string, html: string, fields: Record<string, string>) {
    const form = new URLSearchParams(hiddenFields(html));
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return this.request(url, { method: "POST", body: form.toString(), headers: { referer: url } });
  }
}

/** The hidden inputs of a page (ASP.NET __VIEWSTATE, __EVENTVALIDATION, …). */
export function hiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of Array.from(html.matchAll(/<input[^>]*type="hidden"[^>]*>/gi))) {
    const name = m[0].match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    out[name] = decodeEntities(m[0].match(/value="([^"]*)"/)?.[1] ?? "");
  }
  return out;
}

/** The text of an HTML fragment: tags out, entities decoded, whitespace collapsed. */
export function cellText(v: string): string | null {
  const t = decodeEntities(v.replace(/\s+/g, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t\r\f\v\u00a0]+/g, " ").replace(/ *\n */g, "\n").trim();
  return t ? t : null;
}

/** The <td> cells of each <tr> in an HTML fragment. */
export function tableRows(html: string): string[][] {
  return Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)).map((r) => Array.from(r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((c) => c[1]));
}
