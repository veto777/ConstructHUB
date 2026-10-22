import { describe, expect, it } from "vitest";
import {
  cleanWebsite, researchOrderSchema, researchAdminOrderSchema, researchOrderSchemaFor, researchTierFor,
  RESEARCH_ADMIN_LIMITS, RESEARCH_LIMITS, RESEARCH_MAX_WEBSITES, STATE_CODES, type LicenseHit,
} from "@shared/research-reports";
import { makeSafeFetch, type PageResponse } from "../sitescan/http";
import { extractFromHtml, likelyPages, MAX_PAGES, readWebsite, websiteIds } from "./website";
import { searchCustomerIds, type LicenseFinder } from "./xref";
import { isAdminOrder } from "./runner";

describe("cleanWebsite: a bare public host", () => {
  it("strips scheme, www., path, query, port and case", () => {
    expect(cleanWebsite("https://www.Acme-Electric.com/contact?x=1#top")).toBe("acme-electric.com");
    expect(cleanWebsite("acme-electric.com")).toBe("acme-electric.com");
    expect(cleanWebsite("http://WWW.acme.co.uk:8080/")).toBe("acme.co.uk");
    expect(cleanWebsite("//shop.acme.com/x")).toBe("shop.acme.com");
    expect(cleanWebsite("acme.com.")).toBe("acme.com");
    expect(cleanWebsite("www2.acme.com")).toBe("acme.com");
  });
  it("rejects IPs, localhost, single words, private TLDs, logins and other schemes", () => {
    for (const bad of [
      "127.0.0.1", "http://10.0.0.5/", "192.168.1.1", "2130706433", "0x7f000001", "[::1]", "http://[fe80::1]/",
      "localhost", "http://localhost:3000", "foo.localhost", "intranet", "printer.local", "app.internal", "nas.lan",
      "box.home", "server.corp", "site.test", "x.example", "abc.invalid", "hidden.onion", "1.0.0.127.in-addr.arpa",
      "ftp://acme.com", "javascript:alert(1)", "http://user:pass@acme.com", "acme .com", "", "-acme.com", "acme.c0m",
    ]) expect(cleanWebsite(bad), bad).toBeNull();
  });
});

describe("order limits: customers unchanged, admins relaxed with hard ceilings", () => {
  const base = { agreeNonRefundable: true, agreeNoGuarantee: true, agreeNotFcra: true };
  const names = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Acme ${i} LLC`, kind: "company" as const }));
  it("a customer: 5 names, 3 states, 3 websites at most", () => {
    expect(RESEARCH_LIMITS).toMatchObject({ names: 5, states: 3, licenseNumbers: 5, phones: 3, addresses: 3, websites: 3 });
    expect(researchOrderSchema.safeParse({ ...base, subjects: names(5), states: ["FL", "GA", "AL"] }).success).toBe(true);
    expect(researchOrderSchema.safeParse({ ...base, subjects: names(6), states: ["FL"] }).success).toBe(false);
    expect(researchOrderSchema.safeParse({ ...base, subjects: names(1), states: ["FL", "GA", "AL", "TX"] }).success).toBe(false);
    const sites = (n: number) => researchOrderSchema.safeParse({ ...base, states: ["FL"], subjects: [{ name: "Acme", kind: "company", websites: Array.from({ length: n }, (_, i) => `acme${i}.com`) }] });
    expect(sites(RESEARCH_MAX_WEBSITES).success).toBe(true);
    expect(sites(RESEARCH_MAX_WEBSITES + 1).success).toBe(false);
    expect(researchOrderSchemaFor(false)).toBe(researchOrderSchema);
  });
  it("normalizes websites, merges duplicates and rejects private ones", () => {
    const r = researchOrderSchema.parse({ ...base, states: ["FL"], subjects: [{ name: "Acme", kind: "company", websites: ["https://www.acme.com/about", "ACME.com", " "] }] });
    expect(r.subjects[0].websites).toEqual(["acme.com"]);
    expect(researchOrderSchema.safeParse({ ...base, states: ["FL"], subjects: [{ name: "Acme", kind: "company", websites: ["http://127.0.0.1"] }] }).success).toBe(false);
  });
  it("an admin: 50 names, all 51 states, 25 of each identifier; nothing past the ceilings", () => {
    expect(RESEARCH_ADMIN_LIMITS).toMatchObject({ names: 50, states: 51, licenseNumbers: 25, phones: 25, addresses: 25, websites: 25 });
    expect(researchOrderSchemaFor(true)).toBe(researchAdminOrderSchema);
    const all = [...STATE_CODES];
    expect(all).toHaveLength(51);
    expect(researchAdminOrderSchema.safeParse({ ...base, subjects: names(50), states: all }).success).toBe(true);
    expect(researchAdminOrderSchema.safeParse({ ...base, subjects: names(7), states: all.slice(0, 6) }).success).toBe(true);
    expect(researchAdminOrderSchema.safeParse({ ...base, subjects: names(51), states: ["FL"] }).success).toBe(false);
    const phones = (n: number) => Array.from({ length: n }, (_, i) => `813555${String(1000 + i)}`);
    const one = (s: object) => researchAdminOrderSchema.safeParse({ ...base, states: ["FL"], subjects: [{ name: "Acme", kind: "company", ...s }] });
    expect(one({ phones: phones(25), websites: Array.from({ length: 25 }, (_, i) => `a${i}.com`) }).success).toBe(true);
    expect(one({ phones: phones(26) }).success).toBe(false);
    // Bad values are still bad for an admin.
    expect(one({ websites: ["localhost"] }).success).toBe(false);
  });
  it("researchTierFor is unchanged for customers", () => {
    expect(researchTierFor(1, 1)).toBe("standard");
    expect(researchTierFor(2, 1)).toBe("extended");
    expect(researchTierFor(5, 3)).toBe("extended");
    expect(researchTierFor(6, 1)).toBeNull();
    expect(researchTierFor(1, 4)).toBeNull();
    expect(researchTierFor(0, 1)).toBeNull();
    // Websites, like the other identifiers, don't change the price.
    const r = researchOrderSchema.parse({ ...base, states: ["FL"], subjects: [{ name: "Acme", kind: "company", websites: ["acme.com", "acme.net"] }] });
    expect(researchTierFor(r.subjects.length, r.states.length)).toBe("standard");
  });
  it("only a $0 order is an admin order", () => {
    expect(isAdminOrder({ price_cents: 0 })).toBe(true);
    expect(isAdminOrder({ price_cents: 49_900 })).toBe(false);
    expect(isAdminOrder({})).toBe(false);
  });
});

const SAMPLE_JSONLD = `<!doctype html><html><head><title>Home | Bright Spark Electric</title>
<meta property="og:site_name" content="Bright Spark Electric">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
  {"@type":"WebSite","name":"Home"},
  {"@type":["LocalBusiness","Electrician"],"name":"Bright Spark Electric LLC","telephone":"+1-813-555-0142",
   "address":{"@type":"PostalAddress","streetAddress":"4100 W Kennedy Blvd Ste 210","addressLocality":"Tampa","addressRegion":"FL","postalCode":"33609"}}
]}</script>
<script type="application/ld+json">{ not json</script>
</head><body><nav><a href="/contact-us">Contact</a> <a href="/about">About us</a> <a href="https://facebook.com/brightspark">FB</a>
<a href="/gallery.jpg">pic</a> <a href="tel:8135550199">Call</a></nav>
<main><p>Serving Tampa Bay since 2009.</p></main>
<footer><p>Florida State License # EC13008123</p><p>© 2024 Bright Spark Electric LLC. All rights reserved.</p></footer></body></html>`;

const SAMPLE_TEXT = `<html><head><title>Contact Us</title></head><body>
<h1>Contact</h1>
<div class="addr">1200 North Main Street, Suite 4<br>Phoenix, AZ 85004</div>
<p>Office: (602) 555-0110 &middot; Fax 602.555.0111</p>
<p>Licensed &amp; insured. ROC #123456. CSLB Lic. No. 987654. Licensed since 2005.</p>
<p>Also licensed: CGC1512345 and License No: 2024</p>
<script>var phone = "212-555-0000";</script>
</body></html>`;

describe("extractFromHtml", () => {
  it("reads LocalBusiness JSON-LD, tel: links, license labels and the copyright line", () => {
    const e = extractFromHtml(SAMPLE_JSONLD, "brightspark.com");
    expect(e.names[0]).toBe("Bright Spark Electric LLC");
    expect(e.names).toContain("Bright Spark Electric");
    expect(e.names).not.toContain("Home");
    expect(e.phones).toEqual(["(813) 555-0142", "(813) 555-0199"]);
    expect(e.addresses).toEqual(["4100 W Kennedy Blvd Ste 210, Tampa, FL 33609"]);
    expect(e.licenseNumbers).toEqual(["EC13008123"]);
  });
  it("reads plain text: phones, a street finished by the next line, ROC/CSLB/Florida forms, no years, no script text", () => {
    const e = extractFromHtml(SAMPLE_TEXT);
    expect(e.phones).toEqual(["(602) 555-0110", "(602) 555-0111"]);
    expect(e.addresses).toEqual(["1200 North Main Street, Suite 4, Phoenix, AZ 85004"]);
    expect(e.licenseNumbers).toEqual(["ROC123456", "987654", "CGC1512345"]);
    expect(e.phones).not.toContain("(212) 555-0000");
  });
  it("finds contact/about pages on the same host only", () => {
    const pages = likelyPages(SAMPLE_JSONLD, "https://brightspark.com/");
    expect(pages).toEqual(["https://brightspark.com/contact-us", "https://brightspark.com/about"]);
    expect(likelyPages("<a href='/services'>Services</a>", "https://x.com/")).toEqual(["https://x.com/contact", "https://x.com/contact-us", "https://x.com/about", "https://x.com/about-us"]);
  });
  it("survives junk", () => {
    expect(extractFromHtml("")).toEqual({ names: [], phones: [], addresses: [], licenseNumbers: [] });
    expect(extractFromHtml("<script type='application/ld+json'>[[[[[[[[[{}]]]]]]]]]</script>").phones).toEqual([]);
  });
});

const page = (url: string, body: string, status = 200, type = "text/html; charset=utf-8"): PageResponse => ({ url, status, body, bytes: body.length, headers: { "content-type": type }, redirects: [] });

describe("readWebsite", () => {
  it("reads the homepage and its contact pages, merging what each says", async () => {
    const asked: string[] = [];
    const r = await readWebsite("brightspark.com", {
      now: Date.now,
      fetch: async (url) => {
        asked.push(url);
        if (url === "https://brightspark.com/") return page(url, SAMPLE_JSONLD);
        if (url.endsWith("/contact-us")) return page(url, SAMPLE_TEXT);
        throw new Error("Request timed out");
      },
    });
    expect(r.read).toBe(true);
    expect(r.pages).toEqual(["https://brightspark.com/", "https://brightspark.com/contact-us"]);
    expect(r.phones).toContain("(602) 555-0110");
    expect(r.licenseNumbers).toEqual(["EC13008123", "ROC123456", "987654", "CGC1512345"]);
    expect(r.note).toMatch(/Read 2 page\(s\).*1 page\(s\) could not be read/);
    expect(asked.length).toBeLessThanOrEqual(MAX_PAGES);
    expect(asked.some((u) => u.includes("facebook"))).toBe(false);
  });
  it("falls back to http, and reports a site that can't be read without throwing", async () => {
    const r = await readWebsite("down.example.com", { now: Date.now, fetch: async () => { throw new Error("DNS resolved to a non-public address"); } });
    expect(r).toMatchObject({ host: "down.example.com", read: false, pages: [], phones: [] });
    expect(r.note).toContain("non-public address");
    const http = await readWebsite("old.com", { now: Date.now, fetch: async (u) => (u.startsWith("https") ? page(u, "", 503) : page(u, SAMPLE_TEXT)) });
    expect(http.read).toBe(true);
    expect(http.pages[0]).toBe("http://old.com/");
  });
  it("skips non-HTML answers", async () => {
    const r = await readWebsite("files.com", { now: Date.now, fetch: async (u) => page(u, "%PDF", 200, "application/pdf") });
    expect(r.read).toBe(false);
  });
  it("the shared safe fetch refuses hosts that resolve to private addresses (SSRF guard)", async () => {
    let sent = 0;
    const fetchVia = (ip: string) => makeSafeFetch(async () => [{ address: ip, family: ip.includes(":") ? 6 : 4 }], async () => { sent++; return { status: 200, body: "", bytes: 0, headers: {} }; });
    for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.0.10", "172.16.5.5", "100.64.0.1", "::1", "fe80::1"]) {
      await expect(fetchVia(ip)("https://evil.com/")).rejects.toThrow(/non-public/);
    }
    expect(sent).toBe(0);
    const r = await readWebsite("evil.com", { now: Date.now, fetch: fetchVia("169.254.169.254") });
    expect(r.read).toBe(false);
    expect(sent).toBe(0);
  });
});

describe("website identifiers in the search", () => {
  const hit = (o: Partial<LicenseHit>): LicenseHit => ({
    state: "FL", source: "Fake board", sourceUrl: "https://example.test/board", businessName: null, licenseNumber: null, licenseType: null,
    specialty: null, status: "Current", principal: null, city: null, expires: null, matchedOn: "business", ...o,
  });
  const finder: LicenseFinder = {
    state: "FL", label: "Fake board",
    byId: async (q) => ({
      licenses: q.type === "phone" && q.value.includes("0142") ? [hit({ businessName: "BRIGHT SPARK ELECTRIC LLC", licenseNumber: "EC13008123", phone: "8135550142" })]
        : q.type === "license" && q.value === "EC999" ? [hit({ businessName: "OTHER CO", licenseNumber: "EC999" })] : [],
      enforcement: [],
    }),
  };
  it("carries the website as provenance into matches and the report's wording", async () => {
    const ids = websiteIds([{ host: "brightspark.com", read: true, pages: [], note: "", names: [], phones: ["(813) 555-0142"], addresses: [], licenseNumbers: ["EC999"] }]);
    expect(ids).toEqual([{ type: "license", value: "EC999", from: "brightspark.com" }, { type: "phone", value: "(813) 555-0142", from: "brightspark.com" }]);
    const r = await searchCustomerIds([finder], ids, { name: "Bright Spark Electric", kind: "company" });
    expect(r.licenses).toHaveLength(1);
    expect(r.licenses[0]).toMatchObject({ matchedOn: "phone", fromWebsite: "brightspark.com" });
    expect(r.matched[0]).toMatchObject({ fromWebsite: "brightspark.com", byYourIdentifier: true, relatedVia: "matched by the license number found on the website brightspark.com (EC999)" });
    expect(r.searches.map((x) => x.query)).toEqual(["license number EC999 (from the website brightspark.com)", "phone (813) 555-0142 (from the website brightspark.com)"]);
  });
  it("a customer's own identifier is searched once, before the website's copy, and keeps its wording", async () => {
    const r = await searchCustomerIds([finder], [{ type: "phone", value: "(813) 555-0142" }, { type: "phone", value: "813-555-0142", from: "brightspark.com" }], { name: "Bright Spark Electric", kind: "company" });
    expect(r.used).toBe(1);
    expect(r.licenses[0].fromWebsite).toBeUndefined();
  });
  it("the per-name search limit applies, and an admin order can raise it", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ type: "license" as const, value: `EC${1000 + i}`, from: "big.com" }));
    expect((await searchCustomerIds([finder], many, { name: "X Co", kind: "company" })).used).toBe(25);
    expect((await searchCustomerIds([finder], many, { name: "X Co", kind: "company" }, 150)).used).toBe(30);
  });
});
