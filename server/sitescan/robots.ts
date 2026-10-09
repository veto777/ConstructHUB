/**
 * robots.txt, read the way Google's parser reads it (RFC 9309) — and safe to run on a file a stranger wrote.
 *
 * A rule is never turned into a regular expression (review S-1: `*` became a backtracking `.*`, so one hostile
 * robots.txt froze the web process). Rules are matched by a plain two-pointer wildcard walk, and everything a site
 * controls is bounded: the file's size, the number of rules, a rule's length, the address's length, and the work one
 * match and one rule set may do. Past a bound the answer is "not allowed" — a crawler that cannot tell stays out.
 *
 * What a rule means:
 *  - it is matched from the start of the address's path and query; `*` stands for any run of characters; a `$` at the
 *    very end means the address must end there (a `$` anywhere else is an ordinary character);
 *  - paths are case-sensitive; percent-encoding is compared in one spelling (`%7e` = `%7E` = `~`, `é` = `%C3%A9`);
 *  - of all rules that match, the longest wins; Allow wins a tie; no rule matching = allowed;
 *  - an empty Disallow allows everything; lines we do not know are skipped.
 */
export const ROBOTS_LIMITS = {
  /** Google reads the first 500 KiB of a robots.txt and ignores the rest. */
  bytes: 500 * 1024,
  /** Allow/Disallow lines kept, over all groups. The rest are ignored (`truncated`). */
  rules: 5000,
  /** A longer rule is ignored (`truncated`): no address this crawler asks for is that long. */
  ruleLength: 2048,
  /** A longer address is not allowed — the crawler never requests one (http.ts siteUrl). */
  urlLength: 2048,
  sitemaps: 50,
  /** Character comparisons one `allowed()` may spend, and one rule set over its whole life. */
  stepsPerCall: 500_000,
  stepsTotal: 50_000_000,
} as const;

type Rule = { allow: boolean; pattern: string; anchored: boolean; weight: number };
type Meter = { left: number };

const HEX = "0123456789ABCDEF";
const hexValue = (c: number) =>
  c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
const unreserved = (c: number) =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 46 || c === 95 || c === 126;
/** ASCII the URL parser writes as an escape inside a path: " < > ` { } — a rule may spell them raw. */
const urlEscapes = (c: number) => c === 34 || c === 60 || c === 62 || c === 96 || c === 123 || c === 125;
const pct = (byte: number) => "%" + HEX[byte >> 4] + HEX[byte & 15];

/**
 * One spelling for a path or a rule, so the two can be compared character by character (RFC 9309 §2.2.2): an
 * encoded unreserved character is decoded (`%7E` → `~`), every other escape gets upper-case hex, and a character
 * outside ASCII (or a space, a control character, or one the URL parser escapes in a path) is written as its escape. One pass, no regular expression.
 */
export function normalizeRobotsPath(s: string): string {
  let out = "",
    from = 0; // start of the run of ordinary characters not yet copied
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 32 && c < 127 && c !== 37 && !urlEscapes(c)) continue;
    out += s.slice(from, i);
    if (c === 37 /* % */) {
      const hi = i + 2 < s.length ? hexValue(s.charCodeAt(i + 1)) : -1,
        lo = hi >= 0 ? hexValue(s.charCodeAt(i + 2)) : -1;
      if (hi >= 0 && lo >= 0) {
        const byte = hi * 16 + lo;
        out += unreserved(byte) ? String.fromCharCode(byte) : pct(byte);
        i += 2;
      } else out += "%";
    } else if (c < 128) out += pct(c);
    else {
      let cp = s.codePointAt(i)!;
      if (cp > 0xffff) i++;
      else if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd; // a lone surrogate
      if (cp < 0x800) out += pct(0xc0 | (cp >> 6)) + pct(0x80 | (cp & 63));
      else if (cp < 0x10000) out += pct(0xe0 | (cp >> 12)) + pct(0x80 | ((cp >> 6) & 63)) + pct(0x80 | (cp & 63));
      else out += pct(0xf0 | (cp >> 18)) + pct(0x80 | ((cp >> 12) & 63)) + pct(0x80 | ((cp >> 6) & 63)) + pct(0x80 | (cp & 63));
    }
    from = i + 1;
  }
  return from === 0 ? s : out + s.slice(from);
}

/**
 * Does `pattern` (already normalised; `*` = any run; `anchored` = must reach the end of `path`) match from the start
 * of `path`? The greedy two-pointer walk: on a mismatch go back to the last `*` and let it take one more character.
 * No recursion, no regular expression; every comparison is paid for from `meter`. null = the meter ran out.
 */
export function robotsPatternMatches(pattern: string, anchored: boolean, path: string, meter: Meter = { left: Infinity }): boolean | null {
  const pl = pattern.length, sl = path.length;
  let p = 0, s = 0, star = -1, mark = 0;
  for (;;) {
    if (--meter.left < 0) return null;
    if (p === pl) {
      if (!anchored || s === sl) return true;
      if (star < 0) return false;
      // Anchored, and path is left over: the text after the last `*` has to be the END of the path, so try only there.
      const at = sl - (pl - star - 1);
      if (at <= mark) return false;
      mark = at; p = star + 1; s = at;
      continue;
    }
    const c = pattern.charCodeAt(p);
    if (c === 42 /* * */) {
      star = p++; mark = s;
      if (p === pl) return true; // a last `*` takes whatever is left
      continue;
    }
    if (s < sl && c === path.charCodeAt(s)) { p++; s++; continue; }
    // A mismatch. With the path used up, giving the `*` more cannot help.
    if (star < 0 || s >= sl || ++mark > sl) return false;
    p = star + 1; s = mark;
  }
}

/** The first 500 KiB, cut back to the last whole line (half a rule is not a rule). */
function clip(text: string): { text: string; cut: boolean } {
  if (text.length <= ROBOTS_LIMITS.bytes && Buffer.byteLength(text, "utf8") <= ROBOTS_LIMITS.bytes) return { text, cut: false };
  const head = Buffer.from(text.slice(0, ROBOTS_LIMITS.bytes), "utf8").subarray(0, ROBOTS_LIMITS.bytes).toString("utf8");
  const end = Math.max(head.lastIndexOf("\n"), head.lastIndexOf("\r"));
  return { text: end >= 0 ? head.slice(0, end) : "", cut: true };
}

export type RobotsRules = {
  sitemaps: string[];
  delay: number;
  /** May this address be requested? False when it is too long, unreadable, or the work limit ran out. */
  allowed: (url: string) => boolean;
  /** Part of the file was not used: it was over 500 KiB, or had more or longer rules than are kept. */
  truncated: boolean;
  /** The rule set's work limit ran out: every answer since is "not allowed", and none of them says anything. */
  readonly exhausted: boolean;
};

export function robotsRules(text: string, agent = "ConstructHUBSiteScan", opts: { stepsTotal?: number } = {}): RobotsRules {
  const groups: { agents: string[]; rules: Rule[]; delay: number }[] = [];
  let g: (typeof groups)[number] | undefined,
    directives = false,
    kept = 0;
  const sitemaps: string[] = [];
  const clipped = clip(typeof text === "string" ? text : "");
  let truncated = clipped.cut;
  for (const line of clipped.text.split(/\r\n|\r|\n/)) {
    const hash = line.indexOf("#"),
      clean = (hash < 0 ? line : line.slice(0, hash)).trim(), // trim() also drops a byte-order mark
      pos = clean.indexOf(":");
    if (pos < 0) continue;
    const key = clean.slice(0, pos).trim().toLowerCase(),
      value = clean.slice(pos + 1).trim();
    if (key === "sitemap") {
      if (value && value.length <= ROBOTS_LIMITS.urlLength && sitemaps.length < ROBOTS_LIMITS.sitemaps) sitemaps.push(value);
    } else if (key === "user-agent") {
      if (!g || directives) {
        g = { agents: [], rules: [], delay: 0 };
        groups.push(g);
        directives = false;
      }
      if (value) g.agents.push(value.toLowerCase());
    } else if (g && (key === "allow" || key === "disallow" || key === "crawl-delay")) {
      directives = true;
      if (key === "crawl-delay") g.delay = Math.max(g.delay, Number(value) || 0);
      else if (value) {
        if (kept >= ROBOTS_LIMITS.rules || value.length > ROBOTS_LIMITS.ruleLength) {
          truncated = true;
          continue;
        }
        const anchored = value.endsWith("$");
        // `**` means what `*` means; written once, a run of stars costs nothing to match.
        const spelled = normalizeRobotsPath(anchored ? value.slice(0, -1) : value);
        const pattern = spelled.includes("**") ? spelled.split("*").filter((piece, i, all) => piece || i === 0 || i === all.length - 1).join("*") : spelled;
        if (pattern.length > ROBOTS_LIMITS.ruleLength * 3) { truncated = true; continue; }
        kept++;
        g.rules.push({ allow: key === "allow", pattern, anchored, weight: value.length });
      }
    }
  }
  const mine = agent.toLowerCase();
  const matching = groups.filter((x) => x.agents.some((a) => a !== "*" && mine.includes(a)));
  const selected = matching.length ? matching : groups.filter((x) => x.agents.includes("*"));
  // Longest rule first, Allow before Disallow on a tie: the first one that matches is the answer.
  const rules = selected
    .flatMap((x) => x.rules)
    .sort((a, b) => b.weight - a.weight || Number(b.allow) - Number(a.allow));
  let budget = opts.stepsTotal ?? ROBOTS_LIMITS.stepsTotal,
    exhausted = false;
  return {
    sitemaps,
    delay: Math.max(0, ...selected.map((x) => x.delay)),
    truncated,
    get exhausted() {
      return exhausted;
    },
    allowed: (url: string) => {
      if (exhausted || typeof url !== "string" || url.length > ROBOTS_LIMITS.urlLength) return false;
      let path: string;
      try {
        const u = new URL(url);
        path = normalizeRobotsPath(u.pathname + u.search);
      } catch {
        return false;
      }
      const meter = { left: Math.min(ROBOTS_LIMITS.stepsPerCall, budget) },
        start = meter.left;
      let answer: boolean | null = true;
      for (const r of rules) {
        const m = robotsPatternMatches(r.pattern, r.anchored, path, meter);
        if (m === null) { answer = null; break; }
        if (m) { answer = r.allow; break; }
      }
      budget -= start - Math.max(0, meter.left);
      if (budget <= 0) exhausted = true;
      return answer ?? false;
    },
  };
}
