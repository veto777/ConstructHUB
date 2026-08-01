/**
 * Canonical link bases (PORTAL_URL / CLIENT_URL / APP_URL) vs Host-header
 * derivation. Pure unit tests — no server, no DB. The functions read
 * process.env at call time, so each case sets the env it needs and the
 * afterEach restores it.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  siteBaseUrl,
  clientPortalBaseUrl,
  portalBaseUrl,
  PRIMARY_DOMAIN,
} from "./site-context";

const req = (host: string) => ({ headers: { host } });

const TOUCHED = ["NODE_ENV", "REPLIT_DEPLOYMENT", "PORTAL_URL", "CLIENT_URL", "APP_URL"] as const;
const saved: Record<string, string | undefined> = Object.fromEntries(
  TOUCHED.map((k) => [k, process.env[k]]),
);

function setEnv(patch: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("production (host derivation — no env set)", () => {
  const prod = { NODE_ENV: "production", REPLIT_DEPLOYMENT: undefined,
    PORTAL_URL: undefined, CLIENT_URL: undefined, APP_URL: undefined };

  it("a recognised host keeps its own origin", () => {
    setEnv(prod);
    expect(siteBaseUrl(req("portal.constructhub.us"))).toBe("https://portal.constructhub.us");
    expect(siteBaseUrl(req("constructionhub.app"))).toBe("https://constructionhub.app");
  });

  it("an unrecognised host falls back to the primary domain", () => {
    setEnv(prod);
    expect(siteBaseUrl(req("evil.example.com"))).toBe(`https://${PRIMARY_DOMAIN}`);
  });

  it("clientPortalBaseUrl derives the client subdomain of the caller's domain", () => {
    setEnv(prod);
    expect(clientPortalBaseUrl(req("constructhub.us"))).toBe("https://client.constructhub.us");
  });

  it("portalBaseUrl derives the portal subdomain even from a client-host request", () => {
    setEnv(prod);
    expect(portalBaseUrl(req("client.constructhub.us"))).toBe("https://portal.constructhub.us");
    expect(portalBaseUrl(req("evil.example.com"))).toBe("https://portal.constructhub.us");
  });
});

describe("production (canonical env bases set)", () => {
  const prodEnv = {
    NODE_ENV: "production", REPLIT_DEPLOYMENT: undefined,
    PORTAL_URL: "https://portal.constructhub.us",
    CLIENT_URL: "https://client.constructhub.us",
    APP_URL: "https://constructhub.us",
  };

  it("PORTAL_URL wins for siteBaseUrl, whatever the Host header says", () => {
    setEnv(prodEnv);
    expect(siteBaseUrl(req("evil.example.com"))).toBe("https://portal.constructhub.us");
    expect(siteBaseUrl(req("constructhub.us"))).toBe("https://portal.constructhub.us");
    expect(siteBaseUrl(req("client.constructhub.us"))).toBe("https://portal.constructhub.us");
  });

  it("CLIENT_URL wins for clientPortalBaseUrl", () => {
    setEnv(prodEnv);
    expect(clientPortalBaseUrl(req("evil.example.com"))).toBe("https://client.constructhub.us");
  });

  it("portalBaseUrl returns PORTAL_URL even from the client host", () => {
    setEnv(prodEnv);
    expect(portalBaseUrl(req("client.constructhub.us"))).toBe("https://portal.constructhub.us");
  });

  it("APP_URL is the marketing fallback when PORTAL_URL is unset and the host is unknown", () => {
    setEnv({ ...prodEnv, PORTAL_URL: undefined });
    expect(siteBaseUrl(req("evil.example.com"))).toBe("https://constructhub.us");
  });

  it("blank env values are ignored, not treated as set", () => {
    setEnv({ ...prodEnv, PORTAL_URL: "   " });
    expect(siteBaseUrl(req("portal.constructhub.us"))).toBe("https://portal.constructhub.us");
  });

  it("a trailing slash on the env value is stripped", () => {
    setEnv({ ...prodEnv, PORTAL_URL: "https://portal.constructhub.us/" });
    expect(siteBaseUrl(req("evil.example.com"))).toBe("https://portal.constructhub.us");
  });
});

describe("development (env bases must not change today's behaviour)", () => {
  it("siteBaseUrl stays the request origin even with PORTAL_URL set", () => {
    setEnv({ NODE_ENV: "development", REPLIT_DEPLOYMENT: undefined,
      PORTAL_URL: "https://portal.constructhub.us", CLIENT_URL: "https://client.constructhub.us" });
    expect(siteBaseUrl(req("127.0.0.1:8159"))).toBe("http://127.0.0.1:8159");
    expect(clientPortalBaseUrl(req("127.0.0.1:8159"))).toBe("http://127.0.0.1:8159");
    expect(portalBaseUrl(req("127.0.0.1:8159"))).toBe("http://127.0.0.1:8159");
  });
});
