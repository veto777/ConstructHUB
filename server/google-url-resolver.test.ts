import { describe, it, expect } from "vitest";
import { isAllowedGoogleFetchTarget, isAllowedGoogleRedirectTarget, isGoogleMapsPageUrl } from "./google-url-resolver";

describe("isGoogleMapsPageUrl (what the headless browser may open)", () => {
  it("accepts real Google Maps pages", () => {
    expect(isGoogleMapsPageUrl("https://www.google.com/maps/place/Acme+Roofing/@40.1,-74.2,17z")).toBe(true);
    expect(isGoogleMapsPageUrl("https://google.co.uk/maps/search/acme")).toBe(true);
    expect(isGoogleMapsPageUrl("https://maps.google.com/maps?cid=123")).toBe(true);
  });

  it("refuses a non-Google host that merely contains google.com/maps", () => {
    expect(isGoogleMapsPageUrl("http://10.0.0.5:8080/google.com/maps/place/zzqxjv9917")).toBe(false);
    expect(isGoogleMapsPageUrl("http://evil.example/google.com/maps/place/x")).toBe(false);
    expect(isGoogleMapsPageUrl("https://google.com.evil.example/maps/place/x")).toBe(false);
    expect(isGoogleMapsPageUrl("http://localhost/?u=google.com/maps")).toBe(false);
  });

  it("refuses Google pages that are not Maps, shortlinks, and junk", () => {
    expect(isGoogleMapsPageUrl("https://www.google.com/search?q=x")).toBe(false);
    expect(isGoogleMapsPageUrl("https://www.google.com/mapsfoo")).toBe(false);
    expect(isGoogleMapsPageUrl("https://maps.app.goo.gl/abc")).toBe(false);
    expect(isGoogleMapsPageUrl("file:///etc/passwd#google.com/maps")).toBe(false);
    expect(isGoogleMapsPageUrl("")).toBe(false);
    expect(isGoogleMapsPageUrl(null)).toBe(false);
  });
});

describe("redirect hop allowlist", () => {
  it("allows Google hosts and refuses everything else", () => {
    expect(isAllowedGoogleRedirectTarget("https://www.google.com/maps/place/x")).toBe(true);
    expect(isAllowedGoogleRedirectTarget("https://consent.google.com/m?continue=x")).toBe(true);
    expect(isAllowedGoogleRedirectTarget("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isAllowedGoogleRedirectTarget("http://internal.example/google.com")).toBe(false);
    expect(isAllowedGoogleRedirectTarget("https://evilgoogle.com/")).toBe(false);
    expect(isAllowedGoogleFetchTarget("http://10.0.0.5/goo.gl/maps")).toBe(false);
  });
});
