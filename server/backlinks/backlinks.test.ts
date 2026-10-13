import { describe, expect, it } from "vitest";
import { buildQueryBank, hitsFromItems, isExcluded, normalizeDomain, parseImportLine, QUERY_TEMPLATES, NICHES, US_STATES } from "./discover";
import { analyzePage, classifyKind, gradeSource, mergeSignals } from "./vet";
import { composePitch, siteName, pickEmail, sendBlocker, outreachConfig, withFooter } from "./outreach";
import type { BacklinkSignals } from "@shared/backlinks";

const page = (body: string, url = "https://homefixblog.com/write-for-us/") => analyzePage({ url, status: 200, body });
const words = (n: number, w = "lorem") => Array.from({ length: n }, () => w).join(" ");

const GUEST = `<html lang="en-US"><head><title>Write for Us | HomeFix Blog</title></head><body>
  <h1>Write for us</h1><p>We publish guest posts for homeowners about roofing, plumbing, kitchen remodeling and home improvement.
  Read our guest post guidelines before you pitch. ${words(700, "homeowner")}</p>
  <a href="mailto:editor@homefixblog.com">Email the editor</a>
  <a href="/contact">Contact</a>
  <a href="https://other-site.com/a">a</a><a href="https://another.org/b" rel="nofollow">b</a><a href="https://third.net/c">c</a>
  <img src="logo@2x.png"> support@sentry.io
</body></html>`;

describe("discovery", () => {
  it("normalises hosts and refuses non-web input", () => {
    expect(normalizeDomain("https://WWW.Example.com/path?q=1")).toBe("example.com");
    expect(normalizeDomain("blog.example.co.uk")).toBe("blog.example.co.uk");
    expect(normalizeDomain("ftp://example.com")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("not a domain")).toBeNull();
  });
  it("excludes platforms and government sites, sub-domains included", () => {
    expect(isExcluded("facebook.com")).toBe(true);
    expect(isExcluded("m.facebook.com")).toBe(true);
    expect(isExcluded("permits.seattle.gov")).toBe(true);
    expect(isExcluded("notfacebook.com")).toBe(false);
  });
  it("builds one deduplicated bank covering every niche and state template", () => {
    const bank = buildQueryBank();
    expect(new Set(bank.map((q) => q.query)).size).toBe(bank.length);
    const expected = Object.values(QUERY_TEMPLATES).flat().reduce((a, t) => a + (t.per === "niche" ? NICHES.length : t.per === "state" ? US_STATES.length : 1), 0);
    expect(bank.length).toBe(expected);
    expect(bank.every((q) => !/\b(intitle|inurl|site):/i.test(q.query))).toBe(true); // operators bill 5x
    expect(bank.some((q) => q.kind === "pbn")).toBe(false);
  });
  it("keeps one organic hit per domain and drops excluded ones", () => {
    const hits = hitsFromItems([
      { type: "organic", url: "https://www.a.com/x", rank_absolute: 1 },
      { type: "organic", url: "https://a.com/y", rank_absolute: 2 },
      { type: "paid", url: "https://ads.com/" },
      { type: "organic", url: "https://www.youtube.com/watch?v=1", rank_absolute: 3 },
      { type: "organic", url: "https://b.org/", rank_absolute: 4 },
    ]);
    expect(hits.map((h) => h.domain)).toEqual(["a.com", "b.org"]);
    expect(hits[0].url).toBe("https://www.a.com/x");
  });
  it("reads import lines: domains, URLs, comments and junk", () => {
    expect(parseImportLine("example.com")).toEqual({ domain: "example.com", url: "https://example.com/" });
    expect(parseImportLine("https://x.org/write-for-us, note")).toEqual({ domain: "x.org", url: "https://x.org/write-for-us" });
    expect(parseImportLine("# a comment")).toBeNull();
    expect(parseImportLine("twitter.com")).toBeNull();
  });
});

describe("vetting", () => {
  it("reads what the page shows — and only emails the site publishes", () => {
    const s = page(GUEST);
    expect(s.title).toBe("Write for Us | HomeFix Blog");
    expect(s.lang).toBe("en-us");
    expect(s.acceptsSubmissions).toBe(true);
    expect(s.submissionHints).toEqual(expect.arrayContaining(["write for us", "guest post guidelines"]));
    expect(s.emails).toEqual(["editor@homefixblog.com"]);
    expect(s.contactUrl).toBe("https://homefixblog.com/contact");
    expect(s.outboundLinks).toBe(3);
    expect(s.rel).toEqual({ dofollow: 2, nofollow: 1, sponsored: 0 });
    expect(s.nicheHits).toBeGreaterThan(15);
  });
  it("grades an on-topic guest-post site as quality, capped at B until authority is measured", () => {
    const s = page(GUEST);
    const g = gradeSource("guest_post", s, null);
    expect(g.kind).toBe("guest_post");
    expect(g.tier).toBe("B");
    expect(g.reasons).toContain("authority not measured yet (tier capped at B)");
    const measured = gradeSource("guest_post", s, { rank: 450, referringDomains: 900, spamScore: 3, checkedAt: "2026-10-13T00:00:00Z" });
    expect(measured.tier).toBe("A");
  });
  it("blocks link sellers as PBNs and never grades them quality", () => {
    const s = page(`<html><body>${words(500, "home")} Buy guest posts here — we accept all niches. DA 50+ guest post sites. Link insertion available.</body></html>`);
    expect(s.pbnHints.length).toBeGreaterThanOrEqual(2);
    expect(classifyKind("guest_post", s)).toBe("pbn");
    const g = gradeSource("guest_post", s, null);
    expect(g.tier).toBe("X");
    expect(g.kind).toBe("pbn");
  });
  it("rejects parked, foreign, dead and spammy sites", () => {
    expect(gradeSource("directory", page(`<html><body>This domain is for sale! Buy this domain.</body></html>`), null).tier).toBe("X");
    expect(gradeSource("directory", page(`<html lang="de"><body>${words(800)}</body></html>`), null).tier).toBe("X");
    expect(gradeSource("directory", { ...page("<html></html>"), httpStatus: 404 }, null).tier).toBe("X");
    expect(gradeSource("guest_post", page(`<html><body>${words(800)} ${"casino slots ".repeat(3)} ${"payday loans ".repeat(3)}</body></html>`), null).tier).toBe("X");
    expect(gradeSource("guest_post", page(GUEST), { rank: 500, referringDomains: 900, spamScore: 55, checkedAt: "x" }).tier).toBe("X");
  });
  it("does not count one news headline as a spam site", () => {
    expect(page(`<html><body>${words(800)} Casino operator files for bankruptcy</body></html>`).spamHints).toEqual([]);
    expect(page(`<html><head><title>Best online casino bonuses</title></head><body>${words(800)}</body></html>`).spamHints).toEqual(["casino/betting"]);
  });
  it("keeps a site that blocks robots as unconfirmed; authority decides it", () => {
    const blocked = { ...page("<html></html>"), httpStatus: 403 };
    const g = gradeSource("directory", blocked, null);
    expect(g.tier).toBe("C");
    expect(g.reasons[0]).toMatch(/Unconfirmed/);
    expect(gradeSource("directory", blocked, { rank: 600, referringDomains: 50000, spamScore: 2, checkedAt: "x" }).tier).toBe("A");
    expect(gradeSource("directory", { ...blocked, httpStatus: 404 }, null).tier).toBe("X");
  });
  it("classifies by what the page shows, keeping a state search's citation", () => {
    const dir = page(`<html><body>${words(300)} Add your business to our directory</body></html>`);
    expect(classifyKind("citation", dir)).toBe("citation");
    expect(classifyKind("guest_post", dir)).toBe("directory");
    const pr = page(`<html><body>${words(300)} Submit your press release today</body></html>`);
    expect(classifyKind("directory", pr)).toBe("press_release");
  });
  it("merges two pages of a site", () => {
    const a = page(GUEST);
    const b: BacklinkSignals = { ...a, emails: ["press@homefixblog.com"], spamHints: ["pharma"], words: 50, contactUrl: null };
    const m = mergeSignals(a, b);
    expect(m.emails).toEqual(["editor@homefixblog.com", "press@homefixblog.com"]);
    expect(m.spamHints).toEqual(["pharma"]);
    expect(m.words).toBe(a.words);
  });
});

describe("outreach", () => {
  it("prefers an editorial mailbox and never a no-reply", () => {
    expect(pickEmail(["jane@x.com", "editor@x.com"])).toBe("editor@x.com");
    expect(pickEmail(["noreply@x.com", "privacy@x.com"])).toBeNull();
    expect(pickEmail(["jane@x.com"])).toBe("jane@x.com");
  });
  it("pitches honestly: paid placements marked sponsored, and the CAN-SPAM footer", () => {
    const p = composePitch("guest_post", "homefixblog.com", page(GUEST), "Pat");
    expect(p.subject).toBe("Contributor article for HomeFix Blog");
    expect(siteName("unknown.com", { ...page(GUEST), title: "Write for Us" })).toBe("unknown.com");
    expect(p.body).toContain('rel="sponsored"');
    const full = withFooter(p.body, "123 Main St, Bellingham, WA");
    expect(full).toContain("123 Main St, Bellingham, WA");
    expect(full).toMatch(/Reply "stop"/);
  });
  it("will not send without a separate mailbox and a postal address", () => {
    expect(sendBlocker(outreachConfig({}))).toMatch(/off/);
    expect(sendBlocker(outreachConfig({ BACKLINKS_OUTREACH_SEND: "on", BACKLINKS_SMTP_USER: "a@constructhub.us", BACKLINKS_SMTP_PASS: "x", BACKLINKS_SENDER_ADDRESS: "1 Main" }))).toMatch(/constructhub\.us/);
    expect(sendBlocker(outreachConfig({ BACKLINKS_OUTREACH_SEND: "on", BACKLINKS_SMTP_USER: "a@outreach.example", BACKLINKS_SMTP_PASS: "x" }))).toMatch(/postal/);
    expect(sendBlocker(outreachConfig({ BACKLINKS_OUTREACH_SEND: "on", BACKLINKS_SMTP_USER: "a@outreach.example", BACKLINKS_SMTP_PASS: "x", BACKLINKS_SENDER_ADDRESS: "1 Main" }))).toBeNull();
  });
});
