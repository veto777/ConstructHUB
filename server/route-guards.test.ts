import { describe, expect, it } from "vitest";
import {
  clickGuardSettingsInput, edgeGeo, escapeHtml, exclusionKeyMatches, exclusionListKey, googleReviewLink,
  isOwnerPreview, isPublicIpv4, locationUpdateInput, normalizeBlockedIp, normalizeTrackedDomain, oneLine,
  placeStreetLine, safeRedirectUrl, visitorIp,
} from "./route-guards";

describe("inquiry email escaping", () => {
  it("escapes markup and keeps header values on one line", () => {
    expect(escapeHtml(`<a href="https://example.invalid/x">'hi' & <i>v</i></a>`))
      .toBe("&lt;a href=&quot;https://example.invalid/x&quot;&gt;&#39;hi&#39; &amp; &lt;i&gt;v&lt;/i&gt;&lt;/a&gt;");
    expect(oneLine("Acme\r\nBcc: attacker@example.invalid")).toBe("Acme Bcc: attacker@example.invalid");
  });
});

describe("visitor IP and edge geo", () => {
  it("uses the proxy-resolved req.ip, never the raw first X-Forwarded-For entry", () => {
    expect(visitorIp({ ip: "198.51.100.7", headers: { "x-forwarded-for": "203.0.113.191, 198.51.100.7" } })).toBe("198.51.100.7");
    expect(visitorIp({ ip: "::ffff:192.0.2.4" })).toBe("192.0.2.4");
    expect(visitorIp({ socket: {} })).toBe("unknown");
  });
  it("reads Cloudflare country/city headers and leaves unknowns null", () => {
    expect(edgeGeo({ headers: { "cf-ipcountry": "us", "cf-ipcity": "Denver" } })).toEqual({ country: "US", city: "Denver" });
    expect(edgeGeo({ headers: { "cf-ipcountry": "XX" } })).toEqual({ country: null, city: null });
    expect(edgeGeo({ headers: { "cf-ipcountry": "T1" } }).country).toBeNull();
    expect(edgeGeo({ headers: {} })).toEqual({ country: null, city: null });
  });
});

describe("blocked IP entries", () => {
  it("accepts single IPs, bounded CIDR ranges and last-octet wildcards", () => {
    expect(normalizeBlockedIp(" 198.51.100.91 ")).toBe("198.51.100.91");
    expect(normalizeBlockedIp("2001:DB8::1")).toBe("2001:db8::1");
    expect(normalizeBlockedIp("::ffff:192.0.2.9")).toBe("192.0.2.9");
    expect(normalizeBlockedIp("203.0.113.0/24")).toBe("203.0.113.0/24");
    expect(normalizeBlockedIp("172.16.0.*")).toBe("172.16.0.*");
    expect(normalizeBlockedIp("2001:db8::/48")).toBe("2001:db8::/48");
  });
  it("rejects text, impossible addresses and ranges wide enough to exclude everyone", () => {
    for (const bad of ["", "   ", "QA-g07-google-ads not-an-ip", "999.999.1.1", "10.0.0.0/8", "0.0.0.0/0", "1.2.*.*", "300.1.1.*", "::/0"]) {
      expect(normalizeBlockedIp(bad), bad).toBeNull();
    }
  });
  it("treats only routable IPv4 as public", () => {
    expect(isPublicIpv4("203.0.113.5")).toBe(true);
    for (const ip of ["10.1.2.3", "192.168.1.2", "172.16.4.4", "172.31.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1", "2001:db8::1", "junk"]) {
      expect(isPublicIpv4(ip), ip).toBe(false);
    }
    expect(isPublicIpv4("172.64.0.1")).toBe(true);
  });
});

describe("tracked domains", () => {
  it("normalises to a bare hostname", () => {
    expect(normalizeTrackedDomain("https://www.Example.com/path?q=1")).toBe("www.example.com");
    expect(normalizeTrackedDomain("example.co.uk")).toBe("example.co.uk");
    expect(normalizeTrackedDomain("shop.example.com:8443")).toBe("shop.example.com");
  });
  it("rejects blanks, spaces, markup and single labels", () => {
    for (const bad of ["", "   ", "QA-g07-google-ads verify not a domain ###", "not a domain!! <b>v</b>", "localhost", "javascript:alert(1)"]) {
      expect(normalizeTrackedDomain(bad), bad).toBeNull();
    }
  });
});

describe("Click Guard settings", () => {
  it("accepts in-range values and known toggles", () => {
    expect(clickGuardSettingsInput.safeParse({ blockDays: 30, clickThreshold: 3, exclusionListRate: 200 }).success).toBe(true);
    expect(clickGuardSettingsInput.safeParse({ vpnBlocking: false, countryMode: "block" }).success).toBe(true);
  });
  it("rejects out-of-range, NaN (sent as null), and unknown keys", () => {
    for (const bad of [{ blockDays: 500 }, { blockDays: null }, { exclusionListRate: 5 }, { clickThreshold: -2 }, { clickThreshold: 2.5 }, { vpnBlockMode: "block" }, {}]) {
      expect(clickGuardSettingsInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    const r = clickGuardSettingsInput.safeParse({ blockDays: 500 });
    expect(!r.success && r.error.errors[0].message).toBe("Block duration must be a whole number from 1 to 90");
  });
});

describe("exclusion list key", () => {
  it("is stable per tracking id and checked exactly", () => {
    const key = exclusionListKey("tid-1");
    expect(key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(exclusionKeyMatches("tid-1", key)).toBe(true);
    expect(exclusionKeyMatches("tid-2", key)).toBe(false);
    expect(exclusionKeyMatches("tid-1", undefined)).toBe(false);
    expect(exclusionKeyMatches("tid-1", key.slice(1))).toBe(false);
    expect(exclusionKeyMatches("tid-1", [key])).toBe(false);
  });
});

describe("VPN Shield redirect", () => {
  it("allows only http(s) targets", () => {
    expect(safeRedirectUrl("https://example.invalid/blocked")).toBe("https://example.invalid/blocked");
    for (const bad of ["", "javascript:document.body.innerText='QA'", "data:text/html,x", "/relative", "not a url"]) {
      expect(safeRedirectUrl(bad), bad).toBeNull();
    }
  });
});

describe("Places street line", () => {
  const denver = {
    formatted_address: "5475 Peoria St #4-106, Denver, CO 80239, USA",
    address_components: [
      { long_name: "4-106", types: ["subpremise"] }, { long_name: "5475", types: ["street_number"] },
      { long_name: "Peoria Street", types: ["route"] }, { long_name: "Denver", types: ["locality", "political"] },
      { long_name: "CO", types: ["administrative_area_level_1", "political"] }, { long_name: "80239", types: ["postal_code"] },
    ],
  };
  it("keeps only the part before the city", () => {
    expect(placeStreetLine(denver)).toBe("5475 Peoria St #4-106");
    expect(placeStreetLine({ ...denver, formatted_address: "Suite 200, 123 Main St, Denver, CO 80239, USA" })).toBe("Suite 200, 123 Main St");
  });
  it("returns null when Google has no street (service-area business)", () => {
    expect(placeStreetLine({ formatted_address: "Denver, CO, USA", address_components: [{ long_name: "Denver", types: ["locality"] }] })).toBeNull();
  });
  it("falls back to components when the city is not in the formatted string", () => {
    expect(placeStreetLine({ ...denver, formatted_address: "" })).toBe("5475 Peoria Street #4-106");
  });
});

describe("location PUT whitelist", () => {
  it("accepts https social links and blank entries", () => {
    const r = locationUpdateInput.safeParse({ socialProfiles: { facebook: "https://facebook.com/acme", twitter: "" } });
    expect(r.success).toBe(true);
  });
  it("rejects non-https social links, unknown platforms and server-owned fields", () => {
    expect(locationUpdateInput.safeParse({ socialProfiles: { facebook: "notaurl" } }).success).toBe(false);
    expect(locationUpdateInput.safeParse({ socialProfiles: { twitter: "javascript:alert(1)" } }).success).toBe(false);
    expect(locationUpdateInput.safeParse({ socialProfiles: { myspace: "https://myspace.com/x" } }).success).toBe(false);
    for (const field of ["reviewCount", "businessPhotoCount", "avgRating", "userId", "gbpLocationName"]) {
      expect(locationUpdateInput.safeParse({ [field]: 1 }).success, field).toBe(false);
    }
  });
  it("validates the notification email and stores a blank as null", () => {
    expect(locationUpdateInput.safeParse({ notificationEmail: "not-an-email" }).success).toBe(false);
    const r = locationUpdateInput.safeParse({ notificationEmail: "", gbpManagementEnabled: true });
    expect(r.success && r.data.notificationEmail).toBeNull();
  });
});

describe("review links and owner preview", () => {
  it("accepts Google hosts only and upgrades to https", () => {
    expect(googleReviewLink("https://g.page/r/abc/review")).toBe("https://g.page/r/abc/review");
    expect(googleReviewLink("http://search.google.com/local/writereview?placeid=X")).toBe("https://search.google.com/local/writereview?placeid=X");
    expect(googleReviewLink("https://maps.app.goo.gl/xyz")).toBe("https://maps.app.goo.gl/xyz");
    expect(googleReviewLink("https://www.google.co.uk/maps/place/Acme")).toBe("https://www.google.co.uk/maps/place/Acme");
    for (const bad of ["not a url", "https://example.com/QA-g10-verify-review", "https://google.com.evil.example/x", "https://evilgoogle.com/", "javascript:alert(1)", "https://www.google.com/"]) {
      expect(googleReviewLink(bad), bad).toBeNull();
    }
  });
  it("recognises the owner's own preview only", () => {
    expect(isOwnerPreview({ user: { id: 7 } }, { userId: 7 })).toBe(true);
    expect(isOwnerPreview({ user: { id: 8 } }, { userId: 7 })).toBe(false);
    expect(isOwnerPreview({}, { userId: 7 })).toBe(false);
  });
});
