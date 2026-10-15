/**
 * Small helpers shared by the g6 state packs (IA, MO, KS, NE, SD, ND): zip extraction for bulk files, a cookie jar
 * for form lookups, and text cleanup. Nothing here knows about any one agency.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { clean } from "../../bulk";
import { decodeEntities } from "../../bulk-sources";
import { USER_AGENT, rateLimitHost } from "../../../scrapers/polite-fetch";

const run = promisify(execFile);

export async function* fromFile<T>(path: string, fn: (p: string) => AsyncIterable<T>): AsyncIterable<T> {
  try { yield* fn(path); } finally { await fs.rm(path, { force: true }); }
}

/** The first file of a zip (or the one whose name matches), extracted to a temp file; the zip is deleted. */
export async function unzipFirst(zip: string, match?: RegExp): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), "ch-unzip-"));
  try {
    await run("unzip", ["-q", "-o", zip, "-d", dir], { maxBuffer: 1 << 20 });
    const files = (await fs.readdir(dir)).filter((f) => !match || match.test(f));
    if (!files.length) throw new Error("zip has no matching file");
    const out = join(tmpdir(), `ch-bulk-${Date.now()}-${Math.random().toString(36).slice(2)}-${files[0]}`);
    await fs.rename(join(dir, files[0]), out);
    return out;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(zip, { force: true });
  }
}

/** HTML fragment → plain text. */
export const htmlText = (v: string | null | undefined): string | null =>
  clean(decodeEntities((v ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")));

/** "2026-03-31T00:00:00" or "2026-03-31" → "2026-03-31". */
export const isoDay = (v: unknown): string | null => {
  const m = typeof v === "string" ? v.match(/^(\d{4}-\d{2}-\d{2})/) : null;
  return m ? m[1] : null;
};

/** Join address parts, skipping empties. */
export const joinAddr = (...parts: (string | null | undefined)[]): string | null => clean(parts.map((p) => clean(p)).filter(Boolean).join(" "));

/** A tiny cookie-keeping client for one lookup session (ASP.NET and Visualforce forms need their session cookie). */
export class Session {
  private jar = new Map<string, string>();
  constructor(private minDelayMs = 1200) {}
  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    await rateLimitHost(url, this.minDelayMs);
    const headers = new Headers(init.headers ?? {});
    if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
    if (this.jar.size) headers.set("cookie", Array.from(this.jar, ([k, v]) => `${k}=${v}`).join("; "));
    const res = await fetch(url, { ...init, headers, redirect: "manual", signal: init.signal ?? AbortSignal.timeout(60_000) });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      if (i > 0) this.jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      await res.arrayBuffer().catch(() => undefined);
      return this.fetch(new URL(loc, url).toString(), { headers: { referer: url } });
    }
    return res;
  }
  async text(url: string, init: RequestInit = {}, label = "lookup"): Promise<string> {
    const res = await this.fetch(url, init);
    if (!res.ok) throw new Error(`${label} returned HTTP ${res.status}`);
    return res.text();
  }
}

/** Every hidden input of a page (ASP.NET / Visualforce view state), wherever it sits in the page. */
export function hiddenInputs(html: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of Array.from(html.matchAll(/<input[^>]*>/gi))) {
    const t = m[0];
    if (!/type="hidden"/i.test(t)) continue;
    const name = t.match(/name="([^"]+)"/)?.[1];
    if (name) out.push([name, decodeEntities(t.match(/value="([^"]*)"/)?.[1] ?? "")]);
  }
  return out;
}
