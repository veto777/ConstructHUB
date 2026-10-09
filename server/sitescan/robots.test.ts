/**
 * robots.txt matching (review S-1). The old matcher turned each `*` into a backtracking `.*` regular expression; a
 * hostile robots.txt froze the web process (4 stars on a 200-character path: 21.7 s). These prove the replacement is
 * (1) fast on exactly those inputs, (2) right — compared against a slow, obviously-correct reference on thousands of
 * random rules and paths, (3) unchanged on ordinary robots files, and (4) bounded whatever the file says.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROBOTS_LIMITS, normalizeRobotsPath, robotsPatternMatches, robotsRules } from "./robots";

const site = "https://site.test";
const ms = (work: () => unknown) => {
  const t = performance.now();
  work();
  return performance.now() - t;
};

describe("a hostile robots.txt cannot stall the process", () => {
  it("the reviewer's cases (redos.mjs) finish in milliseconds, with the right answer", () => {
    for (const stars of [4, 5, 6, 7, 12, 40]) {
      const rule = "/" + "*a".repeat(stars) + "*b",
        url = `${site}/` + "a".repeat(200);
      let allowed: boolean | undefined;
      const took = ms(() => (allowed = robotsRules(`User-agent: *\nDisallow: ${rule}`).allowed(url)));
      expect(allowed, `${stars} stars`).toBe(true); // no "b" in the path: the rule does not match
      expect(took, `${stars} stars took ${took.toFixed(1)} ms`).toBeLessThan(50);
    }
  });
  it("the exploit as described: a starred Disallow plus a long Sitemap address", () => {
    const text = `User-agent: *\nDisallow: /*a*a*a*a*a*b\nSitemap: ${site}/${"a".repeat(1500)}`;
    const took = ms(() => {
      const r = robotsRules(text);
      expect(r.sitemaps).toHaveLength(1);
      expect(r.allowed(r.sitemaps[0])).toBe(true);
      expect(r.allowed(`${site}/${"a".repeat(1500)}b`)).toBe(false);
    });
    expect(took).toBeLessThan(50);
  });
  it("no rule can cost more than the per-call limit, and a rule set stops when its total is spent", () => {
    // The worst case for a two-pointer walk: a long almost-match after a star, at every position of a long path.
    const worst = "/*" + "a".repeat(1000) + "b",
      url = `${site}/` + "a".repeat(2000);
    const meter = { left: 10_000 };
    expect(robotsPatternMatches("*" + "a".repeat(1000) + "b", false, "a".repeat(2000), meter)).toBeNull();
    const r = robotsRules(`User-agent: *\n${Array.from({ length: 200 }, (_, i) => `Disallow: ${worst}${i}`).join("\n")}`);
    let calls = 0;
    const took = ms(() => {
      while (!r.exhausted && calls < 10_000) {
        expect(r.allowed(url)).toBe(false); // could not tell → not allowed
        calls++;
      }
    });
    expect(r.exhausted).toBe(true);
    expect(calls).toBeLessThanOrEqual(ROBOTS_LIMITS.stepsTotal / ROBOTS_LIMITS.stepsPerCall);
    expect(r.allowed(`${site}/plain`)).toBe(false); // spent: stays closed
    expect(took).toBeLessThan(5_000);
    // One call is a few milliseconds at most.
    const fresh = robotsRules(`User-agent: *\nDisallow: ${worst}`);
    expect(ms(() => fresh.allowed(url))).toBeLessThan(200);
  });
  it("reads at most 500 KiB, a bounded number of rules, and ignores over-long rules and addresses", () => {
    const line = "Disallow: /blocked-" + "x".repeat(40) + "\n";
    const big = "User-agent: *\n" + line.repeat(20_000) + "Disallow: /after-the-limit\n";
    expect(Buffer.byteLength(big)).toBeGreaterThan(ROBOTS_LIMITS.bytes);
    let r = robotsRules(big);
    expect(r.truncated).toBe(true);
    expect(r.allowed(`${site}/after-the-limit`)).toBe(true); // past 500 KiB: not read, as Google does
    expect(r.allowed(`${site}/blocked-${"x".repeat(40)}`)).toBe(false);
    expect(ms(() => robotsRules(big))).toBeLessThan(500);

    const many = "User-agent: *\n" + Array.from({ length: ROBOTS_LIMITS.rules + 10 }, (_, i) => `Disallow: /r${i}/`).join("\n");
    r = robotsRules(many);
    expect(r.truncated).toBe(true);
    expect(r.allowed(`${site}/r0/x`)).toBe(false);
    expect(r.allowed(`${site}/r${ROBOTS_LIMITS.rules - 1}/x`)).toBe(false);
    expect(r.allowed(`${site}/r${ROBOTS_LIMITS.rules + 5}/x`)).toBe(true); // over the rule limit: ignored

    r = robotsRules(`User-agent: *\nDisallow: /${"y".repeat(ROBOTS_LIMITS.ruleLength)}\nDisallow: /kept`);
    expect(r.truncated).toBe(true);
    expect(r.allowed(`${site}/kept`)).toBe(false);

    r = robotsRules("User-agent: *\nAllow: /");
    expect(r.allowed(`${site}/${"z".repeat(ROBOTS_LIMITS.urlLength)}`)).toBe(false); // longer than the crawler ever asks for
    expect(r.allowed("not a url")).toBe(false);
    expect(robotsRules(`Sitemap: ${site}/a.xml\n`.repeat(500)).sitemaps).toHaveLength(ROBOTS_LIMITS.sitemaps);
    expect(robotsRules(undefined as any).allowed(`${site}/`)).toBe(true);
  });
  it("is not built on regular expressions made from the file", () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "robots.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).not.toMatch(/new RegExp|RegExp\(/);
    expect(src).not.toMatch(/\.match\(|\.test\(|\.replace\(/);
  });
});

// ---- The reference: slow and obviously right (a table over every pattern position × path position) ---------------
function referenceMatch(rule: string, pathAndQuery: string): boolean {
  const anchored = rule.endsWith("$"),
    pat = normalizeRobotsPath(anchored ? rule.slice(0, -1) : rule),
    s = normalizeRobotsPath(pathAndQuery);
  // ok[i][j]: pat[i..] matches s[j..] (as a prefix, or all of it when anchored)
  const ok: boolean[][] = Array.from({ length: pat.length + 1 }, () => new Array(s.length + 1).fill(false));
  for (let i = pat.length; i >= 0; i--)
    for (let j = s.length; j >= 0; j--)
      ok[i][j] =
        i === pat.length
          ? !anchored || j === s.length
          : pat[i] === "*"
            ? ok[i + 1][j] || (j < s.length && ok[i][j + 1])
            : j < s.length && pat[i] === s[j] && ok[i + 1][j + 1];
  return ok[0][0];
}
function referenceAllowed(rules: { allow: boolean; rule: string }[], url: string): boolean {
  const u = new URL(url),
    hits = rules.filter((r) => r.rule && referenceMatch(r.rule, u.pathname + u.search));
  if (!hits.length) return true;
  const longest = Math.max(...hits.map((r) => r.rule.length));
  return hits.some((r) => r.rule.length === longest && r.allow);
}
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("the matcher agrees with a reference implementation", () => {
  it("on 30,000 random rule sets and addresses", () => {
    const rand = rng(20261009),
      pick = (chars: string) => chars[Math.floor(rand() * chars.length)],
      word = (chars: string, max: number) => Array.from({ length: Math.floor(rand() * (max + 1)) }, () => pick(chars)).join("");
    let matched = 0,
      blocked = 0;
    for (let n = 0; n < 30_000; n++) {
      // Few distinct characters, many stars: collisions and backtracking are the point.
      const rules = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => ({
        allow: rand() < 0.4,
        rule: "/" + word("ab/*", 7) + (rand() < 0.25 ? "$" : "") + (rand() < 0.05 ? "a" : ""),
      }));
      const url = `${site}/` + word("ab/", 10) + (rand() < 0.15 ? "?" + word("ab=", 4) : "") + (rand() < 0.03 ? "$" : "");
      const text = "User-agent: *\n" + rules.map((r) => `${r.allow ? "Allow" : "Disallow"}: ${r.rule}`).join("\n");
      const got = robotsRules(text).allowed(url),
        want = referenceAllowed(rules, url);
      if (got !== want) throw new Error(`disagreement on ${JSON.stringify({ rules, url, got, want })}`);
      if (rules.some((r) => referenceMatch(r.rule, new URL(url).pathname + new URL(url).search))) matched++;
      if (!want) blocked++;
    }
    // The comparison means something only if both outcomes occur often.
    expect(matched).toBeGreaterThan(3_000);
    expect(blocked).toBeGreaterThan(1_500);
  });
  it("on single patterns, including longer ones", () => {
    const rand = rng(7),
      word = (chars: string, max: number) => Array.from({ length: Math.floor(rand() * (max + 1)) }, () => chars[Math.floor(rand() * chars.length)]).join("");
    for (let n = 0; n < 20_000; n++) {
      const rule = word("ab*", 14) + (rand() < 0.3 ? "$" : ""),
        s = word("ab", 30);
      const anchored = rule.endsWith("$"),
        pattern = (anchored ? rule.slice(0, -1) : rule).replace(/\*+/g, "*");
      expect(robotsPatternMatches(pattern, anchored, s), `${rule} vs ${s}`).toBe(referenceMatch(rule, s));
    }
  });
});

describe("ordinary robots files read as before", () => {
  const allowed = (text: string, p: string, agent?: string) => robotsRules(text, agent).allowed(site + p);
  it("longest rule wins; Allow wins a tie; nothing matching = allowed", () => {
    const text = "User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /tie\nAllow: /tie";
    expect(allowed(text, "/private")).toBe(false);
    expect(allowed(text, "/private/x")).toBe(false);
    expect(allowed(text, "/private/open")).toBe(true);
    expect(allowed(text, "/private/open/deeper?x=1")).toBe(true);
    expect(allowed(text, "/tie/x")).toBe(true);
    expect(allowed(text, "/elsewhere")).toBe(true);
    // Order in the file does not matter.
    expect(allowed("User-agent: *\nAllow: /private/open\nDisallow: /private", "/private/open")).toBe(true);
    // Google's own examples.
    expect(allowed("User-agent: *\nAllow: /p\nDisallow: /", "/page")).toBe(true);
    expect(allowed("User-agent: *\nAllow: /folder\nDisallow: /folder", "/folder/page")).toBe(true);
    expect(allowed("User-agent: *\nAllow: /page\nDisallow: /*.htm", "/page.htm")).toBe(false);
    expect(allowed("User-agent: *\nAllow: /page\nDisallow: /*.ph", "/page.php5")).toBe(true);
    expect(allowed("User-agent: *\nAllow: /$\nDisallow: /", "/")).toBe(true);
    expect(allowed("User-agent: *\nAllow: /$\nDisallow: /", "/page.htm")).toBe(false);
  });
  it("`*` and the end anchor `$`", () => {
    const text = "User-agent: *\nDisallow: /*.pdf$\nDisallow: /search*sort=\nDisallow: /exact$";
    expect(allowed(text, "/files/a.pdf")).toBe(false);
    expect(allowed(text, "/files/a.pdf?download=1")).toBe(true);
    expect(allowed(text, "/files/a.pdfx")).toBe(true);
    expect(allowed(text, "/search?q=1&sort=asc")).toBe(false);
    expect(allowed(text, "/search?q=1")).toBe(true);
    expect(allowed(text, "/exact")).toBe(false);
    expect(allowed(text, "/exact/more")).toBe(true);
    expect(allowed("User-agent: *\nDisallow: /fish*", "/fish.html")).toBe(false);
    expect(allowed("User-agent: *\nDisallow: /fish*", "/Fish.asp")).toBe(true);
    expect(allowed("User-agent: *\nDisallow: /a**b***c", "/a1b2c")).toBe(false);
    expect(allowed("User-agent: *\nDisallow: *", "/anything")).toBe(false);
    expect(allowed("User-agent: *\nDisallow: /*", "/anything")).toBe(false);
    // A `$` that is not at the end is an ordinary character.
    expect(allowed("User-agent: *\nDisallow: /a$b", "/a$b")).toBe(false);
    expect(allowed("User-agent: *\nDisallow: /a$b", "/a")).toBe(true);
    // Characters that mean something in a regular expression mean nothing here.
    expect(allowed("User-agent: *\nDisallow: /a.b", "/aXb")).toBe(true);
    expect(allowed("User-agent: *\nDisallow: /a+(b)[c]{2}|d^", "/a+(b)[c]{2}|d^")).toBe(false);
    expect(allowed("User-agent: *\nDisallow: /a+(b)[c]{2}|d^", "/aa(b)c|d")).toBe(true);
    expect(allowed("User-agent: *\nDisallow: /a?b=1", "/a?b=1")).toBe(false);
    expect(allowed("User-agent: *\nDisallow: /a?b=1", "/ab=1")).toBe(true);
  });
  it("paths are case-sensitive; directives and agent names are not", () => {
    expect(allowed("User-agent: *\nDisallow: /Private", "/private")).toBe(true);
    expect(allowed("USER-AGENT: *\nDISALLOW: /private", "/private")).toBe(false);
    expect(allowed("User-agent: GPTBOT\nDisallow: /", "/", "GPTBot")).toBe(false);
  });
  it("percent-encoding is compared in one spelling", () => {
    expect(allowed("User-agent: *\nDisallow: /caf%c3%a9", "/caf%C3%A9")).toBe(false);
    expect(allowed("User-agent: *\nDisallow: /café", "/caf%C3%A9")).toBe(false);
    expect(allowed("User-agent: *\nDisallow: /café", "/café")).toBe(false); // the URL parser encodes the address
    expect(allowed("User-agent: *\nDisallow: /%7Ejoe/", "/~joe/x")).toBe(false);
    expect(allowed("User-agent: *\nDisallow: /~joe/", "/%7ejoe/x")).toBe(false);
    expect(allowed("User-agent: *\nDisallow: /a%2Fb", "/a/b")).toBe(true); // an encoded slash is not a slash
    expect(allowed("User-agent: *\nDisallow: /a%2fb", "/a%2Fb")).toBe(false);
    expect(allowed("User-agent: *\nDisallow: /a%2Ab", "/aXb")).toBe(true); // an encoded star is not a wildcard
    expect(allowed("User-agent: *\nDisallow: /100%", "/100%")).toBe(false); // a stray % is itself
    expect(normalizeRobotsPath("/a b/%e2%82%ac/€/%41%zz")).toBe("/a%20b/%E2%82%AC/%E2%82%AC/A%zz");
    expect(normalizeRobotsPath("/😀")).toBe("/%F0%9F%98%80");
  });
  it("an empty Disallow allows everything", () => {
    expect(allowed("User-agent: *\nDisallow:", "/anything")).toBe(true);
    expect(allowed("User-agent: *\nDisallow:\nDisallow: /x", "/x")).toBe(false);
    expect(allowed("", "/anything")).toBe(true);
  });
  it("comments, a byte-order mark, CRLF and bare CR line ends, blank lines, odd spacing", () => {
    const body = ["# the whole file", "User-agent: *   # everyone", "", "Disallow: /private # not this", "  Allow :  /private/open  ", "Crawl-delay: 2"];
    for (const eol of ["\n", "\r\n", "\r"]) {
      const text = "﻿" + body.join(eol) + eol;
      expect(allowed(text, "/private")).toBe(false);
      expect(allowed(text, "/private/open")).toBe(true);
      expect(allowed(text, "/private%20#")).toBe(false);
      expect(robotsRules(text).delay).toBe(2);
    }
  });
  it("unknown directives and lines without a colon are skipped", () => {
    const text = "User-agent: *\nHost: site.test\nClean-param: ref /x\nNoindex: /y\nthis is not a directive\nRequest-rate: 1/5\nDisallow: /z";
    expect(allowed(text, "/x")).toBe(true);
    expect(allowed(text, "/y")).toBe(true);
    expect(allowed(text, "/z")).toBe(false);
    // A rule before any User-agent line belongs to nobody.
    expect(allowed("Disallow: /\nUser-agent: *\nAllow: /", "/x")).toBe(true);
  });
  it("groups: our own token beats `*`; several names share a group; same-name groups add up", () => {
    const text = [
      "User-agent: *", "Disallow: /for-everyone",
      "User-agent: ConstructHUBSiteScan", "Disallow: /for-us", "Crawl-delay: 5",
      "User-agent: GPTBot", "User-agent: ClaudeBot", "Disallow: /",
      "User-agent: constructhubsitescan", "Disallow: /also-us",
    ].join("\n");
    expect(allowed(text, "/for-us")).toBe(false);
    expect(allowed(text, "/also-us")).toBe(false);
    expect(allowed(text, "/for-everyone")).toBe(true); // a group that names us replaces `*`
    expect(robotsRules(text).delay).toBe(5);
    expect(allowed(text, "/x", "GPTBot")).toBe(false);
    expect(allowed(text, "/x", "ClaudeBot")).toBe(false);
    expect(allowed(text, "/for-everyone", "PerplexityBot")).toBe(false);
    expect(allowed(text, "/for-us", "PerplexityBot")).toBe(true);
    expect(robotsRules(text, "PerplexityBot").delay).toBe(0);
    // A file with no group for us and none for `*` allows everything.
    expect(allowed("User-agent: GPTBot\nDisallow: /", "/x")).toBe(true);
    // A nameless User-agent line names nobody (it used to match every crawler).
    expect(allowed("User-agent:\nDisallow: /", "/x")).toBe(true);
  });
  it("sitemaps and crawl delay", () => {
    const r = robotsRules(`Sitemap: ${site}/a.xml\nUser-agent: *\nCrawl-delay: 1.5\nCrawl-delay: abc\nSITEMAP: /b.xml`);
    expect(r.sitemaps).toEqual([`${site}/a.xml`, "/b.xml"]);
    expect(r.delay).toBe(1.5);
    expect(r.truncated).toBe(false);
    expect(r.exhausted).toBe(false);
  });
});
