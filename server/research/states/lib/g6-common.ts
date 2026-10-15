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
import { personText } from "../../person-name";
import { fetchWithDeadline } from "../../http";

const run = promisify(execFile);

export async function* fromFile<T>(path: string, fn: (p: string) => AsyncIterable<T>): AsyncIterable<T> {
  try { yield* fn(path); } finally { await fs.rm(path, { force: true }); }
}

/** unzip's own time limits: listing a zip, and extracting one member (large files take minutes). */
const LIST_TIMEOUT_MS = 60_000;
const EXTRACT_TIMEOUT_MS = 15 * 60_000;

/**
 * The one member a loader wants (by `match` against its file name, folders aside): exactly one must match. Several
 * matches, or several files and no `match`, is an error rather than a guess at which one is the data.
 */
export function pickZipMember(members: string[], match?: RegExp): string {
  const files = members.filter((m) => m && !m.endsWith("/"));
  const base = (m: string) => m.split("/").pop() ?? m;
  const hits = match ? files.filter((m) => match.test(base(m))) : files;
  if (!hits.length) throw new Error(`zip has no matching file (members: ${files.slice(0, 5).map(base).join(", ") || "none"})`);
  if (hits.length > 1) throw new Error(`zip has ${hits.length} matching files (${hits.slice(0, 5).map(base).join(", ")}); expected one`);
  return hits[0];
}

/** The zip's one matching member, extracted to a temp file; the zip is deleted. unzip runs under a time limit. */
export async function unzipFirst(zip: string, match?: RegExp): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), "ch-unzip-"));
  try {
    const { stdout } = await run("unzip", ["-Z1", zip], { maxBuffer: 16 << 20, timeout: LIST_TIMEOUT_MS });
    const member = pickZipMember(stdout.split(/\r?\n/), match);
    // unzip reads a member argument as a pattern: its wildcard characters are escaped.
    await run("unzip", ["-q", "-o", "-j", zip, member.replace(/([[\]*?\\])/g, "\\$1"), "-d", dir], { maxBuffer: 1 << 20, timeout: EXTRACT_TIMEOUT_MS });
    const name = member.split("/").pop()!;
    const out = join(tmpdir(), `ch-bulk-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
    await fs.rename(join(dir, name), out);
    return out;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(zip, { force: true });
  }
}

/** HTML fragment → plain text. */
export const htmlText = (v: string | null | undefined): string | null =>
  clean(decodeEntities((v ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")));

/**
 * A person-name cell as text (round 6, decision 3): like the helper above, but a <br> between two names stays a list
 * (written " / ", ../../person-name.ts), so "Jane Smith<br>John Doe" is never read as one person. Whitespace in the
 * page source is not a separator; only the <br> is.
 */
export const htmlPerson = (v: string | null | undefined): string | null =>
  v == null ? null : personText(decodeEntities(v.replace(/\s+/g, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")));

/** "2026-03-31T00:00:00" or "2026-03-31" → "2026-03-31". */
export const isoDay = (v: unknown): string | null => {
  const m = typeof v === "string" ? v.match(/^(\d{4}-\d{2}-\d{2})/) : null;
  return m ? m[1] : null;
};

/** Join address parts, skipping empties. */
export const joinAddr = (...parts: (string | null | undefined)[]): string | null => clean(parts.map((p) => clean(p)).filter(Boolean).join(" "));

const MAX_REDIRECTS = 8;

/** A tiny cookie-keeping client for one lookup session (ASP.NET and Visualforce forms need their session cookie). */
export class Session {
  private jar = new Map<string, string>();
  constructor(private minDelayMs = 1200) {}
  /** One request (60 s deadline over the body too; robots.txt honored; 401/403 end the search), redirects followed by hand. */
  async fetch(url: string, init: RequestInit = {}, hops = 0): Promise<Response> {
    if (hops > MAX_REDIRECTS) throw new Error(`more than ${MAX_REDIRECTS} redirects from ${url}`);
    const headers = new Headers(init.headers ?? {});
    if (this.jar.size) headers.set("cookie", Array.from(this.jar, ([k, v]) => `${k}=${v}`).join("; "));
    // fetchWithDeadline guards every hop (the host's block and cooldown, robots.txt, the rate limit) and throws
    // PortalBlockedError on a 401/403, which blocks the host for every caller (round 2, decision 6).
    const res = await fetchWithDeadline(url, { ...init, headers, redirect: "manual" }, 60_000, this.minDelayMs);
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      if (i > 0) this.jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      await res.arrayBuffer().catch(() => undefined);
      return this.fetch(new URL(loc, url).toString(), { headers: { referer: url } }, hops + 1);
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
