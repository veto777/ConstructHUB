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
  it("keeps a site that blocks robots as unconfirmed — never quality on authority alone", () => {
    const blocked = { ...page("<html></html>"), httpStatus: 403 };
    const g = gradeSource("directory", blocked, null);
    expect(g.tier).toBe("C");
    expect(g.reasons[0]).toMatch(/Unconfirmed/);
    expect(gradeSource("directory", blocked, { rank: 600, referringDomains: 50000, spamScore: 2, checkedAt: "x" }).tier).toBe("C");
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

// 2026-10-13: the owner's screenshot showed zillow.com, raspberrypi.com and news.bloomberglaw.com graded "A 100" as guest-post
// sites. Each case below is the shape of a real false positive; none may come out quality, however strong the domain.
describe("vetting — false positives from the first run", () => {
  const BIG = { rank: 640, referringDomains: 175918, spamScore: 8, checkedAt: "x" };
  const graded = (url: string, body: string, home?: string) => {
    const found = analyzePage({ url, status: 200, body });
    const h = home ? analyzePage({ url: new URL("/", url).href, status: 200, body: home }) : null;
    return gradeSource("guest_post", mergeSignals(found, h), BIG);
  };
  const TECH_HOME = `<html><head><title>Raspberry Pi</title></head><body>${words(900, "computer")}</body></html>`;
  it("a user profile on a platform that says 'guest posting' (zillow.com/profile/…)", () => {
    const g = graded("https://zillow.com/profile/livepositiv8", `<html><head><title>Guest Posting | Zillow</title></head><body>Submit a guest post about construction ${words(700, "homeowner")}</body></html>`);
    expect(g.tier).toBe("X");
    expect(g.reasons.join(" ")).toMatch(/user profile|platform where anyone can post/);
  });
  it("an article that happens to contain the phrase, on a site that is not about the trades", () => {
    const g = graded("https://raspberrypi.com/news/build-smart-doorbell-windows-10/",
      `<html><head><title>Build a smart doorbell with Windows 10</title></head><body>${words(1200, "doorbell")} write for us windows install</body></html>`, TECH_HOME);
    expect(g.tier).toBe("X");
    expect(g.reasons.join(" ")).toMatch(/No page on the site invites submissions/);
  });
  it("a real write-for-us page on an off-topic site", () => {
    const g = graded("https://techblog.com/write-for-us/", `<html><head><title>Write for us</title></head><body>${words(800, "software")}</body></html>`, TECH_HOME);
    expect(g.tier).toBe("X");
    expect(g.reasons.join(" ")).toMatch(/not about home improvement/);
  });
  it("lists of guest-post sites, sellers' case studies and job boards", () => {
    expect(graded("https://ecodesoft.com/free-guest-posting-sites-list/", `<html><head><title>Free guest posting sites list</title></head><body>${words(800, "roofing")}</body></html>`).reasons.join(" ")).toMatch(/list of guest-post sites/);
    expect(graded("https://wildnet.com/case-studies/guest-posting-case-studies", `<html><head><title>Guest posting case studies</title></head><body>write for us ${words(800, "roofing")}</body></html>`).reasons.join(" ")).toMatch(/seller/);
    expect(graded("https://freelance.example.com/job-search/technology-guest-post-sites/", `<html><head><title>Jobs</title></head><body>write for us ${words(800, "roofing")}</body></html>`).tier).toBe("X");
  });
  it("a site for another country's market", () => {
    const g = graded("https://thetimes.com.au/write-for-us", `<html><head><title>Write for us — home improvement</title></head><body>${words(800, "renovation")}</body></html>`);
    expect(g.reasons.join(" ")).toMatch(/outside the US \(\.au\)/);
  });
  it("still grades a real home-improvement blog with its own write-for-us page as quality", () => {
    const home = `<html><head><title>HomeFix Blog — roofing, plumbing and remodeling tips</title></head><body>${words(400, "kitchen remodeling")} <a href="/write-for-us/">Write for us</a></body></html>`;
    const article = analyzePage({ url: "https://homefixblog.com/how-to-fix-gutters/", status: 200, body: `<html><head><title>How to fix gutters</title></head><body>${words(900, "gutters")} <a href="/write-for-us/">Write for us</a></body></html>` });
    const s = mergeSignals(article, analyzePage({ url: "https://homefixblog.com/", status: 200, body: home }));
    expect(s.submissionUrl).toBe("https://homefixblog.com/write-for-us/");
    expect(gradeSource("guest_post", s, { rank: 300, referringDomains: 800, spamScore: 3, checkedAt: "x" }).tier).toBe("A");
  });
  it("SEO/marketing agencies, foreign-market sites, platforms and free blog sub-domains", () => {
    const wfu = (url: string, homeTitle: string) => gradeSource("guest_post", mergeSignals(
      analyzePage({ url, status: 200, body: `<html><head><title>Write for us</title></head><body>${words(800, "roofing")}</body></html>` }),
      analyzePage({ url: new URL("/", url).href, status: 200, body: `<html><head><title>${homeTitle}</title></head><body>${words(600, "roofing contractors")}</body></html>` })), { rank: 300, referringDomains: 900, spamScore: 2, checkedAt: "x" });
    expect(wfu("https://localseoguy.digital/write-for-us", "Home Services Local SEO Consultant").reasons.join(" ")).toMatch(/agency/);
    expect(wfu("https://brandingmarketingagency.com/write-for-us/", "").reasons.join(" ")).toMatch(/agency/);
    expect(wfu("https://elitebreeze.com/write-for-us/", "EliteBreeze HVAC – Top HVAC Service Provider in Mumbai").reasons.join(" ")).toMatch(/outside the US/);
    expect(wfu("https://roofblog.wordpress.com/write-for-us/", "Roofing tips for homeowners").tier).toBe("C");
    expect(wfu("https://houseupgrades.home.blog/write-for-us/", "Roofing tips for homeowners").tier).toBe("C");
    expect(wfu("https://roofingcontractorblog.com/write-for-us/", "Roofing tips for homeowners").tier).toBe("A");
    expect(gradeSource("directory", { ...analyzePage({ url: "https://yelp.com/", status: 403, body: "" }) }, { rank: 700, referringDomains: 1, spamScore: 1, checkedAt: "x" }).tier).toBe("X");
  });
});
