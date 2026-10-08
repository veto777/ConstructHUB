/**
 * Campaign attribution (server/analytics-attribution.ts, shared/campaign-attribution.ts,
 * the landing columns written by POST /api/analytics/events and the Campaigns
 * view of GET /api/admin/analytics). Pure / mocked — no dev server, no database.
 *
 * Pinned behaviours:
 *   1. Campaign tags are sanitized: lower-case, trimmed, [a-z0-9._-] only, 64 chars.
 *   2. Nothing but utm_source / utm_medium / utm_campaign survives a query string —
 *      a token or an email in the URL never reaches a stored row.
 *   3. The referrer is reduced to its host.
 *   4. Consent is the same gate as every analytics write: denied or unanswered
 *      stores nothing, for page views and for sign-up attribution alike.
 *   5. Sign-up attribution is first touch, set once.
 *   6. The Campaigns view is platform-admin only.
 *   7. The CSV and CLI output shapes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

const mocks = vi.hoisted(() => {
  process.env.DEV_AUTH_BYPASS_USER1 = "true";
  process.env.NODE_ENV = "test";
  delete process.env.ADMIN_GATE_USER;
  delete process.env.ADMIN_GATE_PASS;
  return {
    inserted: [] as any[][],
    userRows: [] as any[],
    poolQueries: [] as { text: string; values?: unknown[] }[],
  };
});

vi.mock("./db", () => ({
  db: {
    insert: () => ({ values: async (v: any[]) => { mocks.inserted.push(v); } }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.userRows }) }) }),
  },
  pool: {
    query: async (text: string, values?: unknown[]) => {
      mocks.poolQueries.push({ text, values });
      return { rows: [], rowCount: 0 };
    },
  },
}));

import { registerAnalyticsRoutes } from "./analytics";
import {
  ANALYTICS_ATTRIBUTION_DDL, FIRST_TOUCH_WINDOW_DAYS, campaignReport, consentedVisitorId, landingColumns,
  recordSignupAttribution, reportRange, type Queryable,
} from "./analytics-attribution";
import {
  CAMPAIGN_CSV_HEADER, DIRECT_LABEL, campaignReportCsv, campaignReportText, groupReferrers, isInternalHost,
  referrerGroup, referrerHost, sanitizeUtm, sanitizeUtmValue, utmFromSearch, type CampaignReport,
} from "@shared/campaign-attribution";
import { parseArgs } from "../scripts/campaign-report";

const VID = "550e8400-e29b-41d4-a716-446655440000";
const GRANTED = `ch_consent=granted; ch_vid=${VID}`;

const routes = new Map<string, Function>();
const getDevUser = (req: any, res: any) => {
  if (req.user) return req.user;
  res.status(401).json({ message: "Not authenticated" });
  return null;
};
registerAnalyticsRoutes({
  get: (p: string, h: Function) => routes.set(`GET ${p}`, h),
  post: (p: string, h: Function) => routes.set(`POST ${p}`, h),
} as any, getDevUser);

let ipSeq = 0;
async function call(route: string, req: any) {
  const res: any = {
    code: 200, headers: {} as Record<string, unknown>,
    status(n: number) { this.code = n; return this; },
    json(d: any) { this.body = d; return this; },
    send(d: any) { this.body = d; return this; },
    setHeader(k: string, v: unknown) { this.headers[k] = v; },
  };
  await routes.get(route)!({ headers: {}, query: {}, body: {}, hostname: "constructhub.us", ip: `198.51.100.${++ipSeq}`, ...req }, res);
  return res;
}

beforeEach(() => {
  mocks.inserted.length = 0;
  mocks.poolQueries.length = 0;
  mocks.userRows = [];
});

describe("campaign tag sanitizing", () => {
  it("lower-cases, trims and keeps only [a-z0-9._-]", () => {
    expect(sanitizeUtmValue("  Instagram ")).toBe("instagram");
    expect(sanitizeUtmValue("CRM-Team_Profile.v2")).toBe("crm-team_profile.v2");
    expect(sanitizeUtmValue("re el<script>alert(1)</script>")).toBe("reelscriptalert1script");
    expect(sanitizeUtmValue("a@b.c")).toBe("ab.c");
    expect(sanitizeUtmValue("'; drop table users;--")).toBe("droptableusers--");
  });

  it("caps a value at 64 characters and turns junk-only or missing values into null", () => {
    expect(sanitizeUtmValue("x".repeat(500))).toBe("x".repeat(64));
    expect(sanitizeUtmValue("   ")).toBeNull();
    expect(sanitizeUtmValue("@@@ ///")).toBeNull();
    expect(sanitizeUtmValue(undefined)).toBeNull();
    expect(sanitizeUtmValue(42)).toBeNull();
    expect(sanitizeUtmValue({ toString: () => "instagram" })).toBeNull();
  });

  it("sanitizeUtm returns exactly the three tags, whatever else it is handed", () => {
    const utm = sanitizeUtm({ source: "Instagram", medium: "Reel", campaign: "Test-Clip", token: "SECRET", email: "a@b.c", term: "x" });
    expect(utm).toEqual({ source: "instagram", medium: "reel", campaign: "test-clip" });
  });

  it("utmFromSearch reads only utm_source / utm_medium / utm_campaign off a query string", () => {
    const utm = utmFromSearch("?utm_source=instagram&utm_medium=reel&utm_campaign=test-clip&token=SECRET&email=a@b.c&utm_content=x&utm_term=y");
    expect(utm).toEqual({ source: "instagram", medium: "reel", campaign: "test-clip" });
    expect(JSON.stringify(utm)).not.toMatch(/SECRET|a@b|utm_content|utm_term/);
    expect(utmFromSearch("?token=SECRET&email=a@b.c")).toBeNull();
    expect(utmFromSearch("")).toBeNull();
    expect(utmFromSearch("utm_source=LinkedIn")).toEqual({ source: "linkedin", medium: null, campaign: null });
  });
});

describe("referrer host", () => {
  it("keeps the host and nothing else", () => {
    expect(referrerHost("https://l.instagram.com/?u=https%3A%2F%2Fconstructhub.us%2F%3Ftoken%3DSECRET&e=abc")).toBe("l.instagram.com");
    expect(referrerHost("https://www.YouTube.com/watch?v=abc")).toBe("youtube.com");
    expect(referrerHost("https://m.facebook.com/some/path")).toBe("facebook.com");
    expect(referrerHost("android-app://com.linkedin.android/")).toBe("com.linkedin.android");
    expect(referrerHost("not a url")).toBeNull();
    expect(referrerHost("")).toBeNull();
    expect(referrerHost(null)).toBeNull();
  });

  it("names the groups the admin page lists", () => {
    expect(referrerGroup("instagram.com")).toBe("Instagram");
    expect(referrerGroup("l.instagram.com")).toBe("Instagram");
    expect(referrerGroup("tiktok.com")).toBe("TikTok");
    expect(referrerGroup("linkedin.com")).toBe("LinkedIn");
    expect(referrerGroup("lnkd.in")).toBe("LinkedIn");
    expect(referrerGroup("youtube.com")).toBe("YouTube");
    expect(referrerGroup("youtu.be")).toBe("YouTube");
    expect(referrerGroup("com.linkedin.android")).toBe("LinkedIn");
    expect(referrerGroup("com.instagram.android")).toBe("Instagram");
    expect(referrerGroup("com.google.android.youtube")).toBe("YouTube");
    expect(referrerGroup("com.google.android.googlequicksearchbox")).toBe("Google");
    expect(referrerGroup("google.com")).toBe("Google");
    expect(referrerGroup("google.co.uk")).toBe("Google");
    expect(referrerGroup("notgoogle.com")).toBe("notgoogle.com");
    expect(referrerGroup("example.org")).toBe("example.org");
    expect(referrerGroup(null)).toBe(DIRECT_LABEL);
  });

  it("groups hosts and sorts by visits", () => {
    const rows = groupReferrers([
      { host: null, visits: 3, visitors: 3, signups: 0 },
      { host: "instagram.com", visits: 4, visitors: 4, signups: 1 },
      { host: "l.instagram.com", visits: 6, visitors: 5, signups: 1 },
      { host: "example.org", visits: 1, visitors: 1, signups: 0 },
    ]);
    expect(rows.map((r) => r.label)).toEqual(["Instagram", DIRECT_LABEL, "example.org"]);
    expect(rows[0]).toEqual({ label: "Instagram", hosts: ["instagram.com", "l.instagram.com"], visits: 10, visitors: 9, signups: 2 });
  });

  it("the site's own domain is a navigation, not a source", () => {
    expect(isInternalHost("constructhub.us", "constructhub.us")).toBe(true);
    expect(isInternalHost("portal.constructhub.us", "constructhub.us")).toBe(true);
    expect(isInternalHost("constructhub.us", "portal.constructhub.us:443")).toBe(true);
    expect(isInternalHost("instagram.com", "constructhub.us")).toBe(false);
    expect(isInternalHost("evil.com", "127.0.0.1")).toBe(false);
    expect(isInternalHost(null, "constructhub.us")).toBe(false);
  });
});

describe("landingColumns", () => {
  it("only an event flagged as the first page view of a page load is a landing", () => {
    const none = { landing: false, utmSource: null, utmMedium: null, utmCampaign: null, referrerHost: null };
    expect(landingColumns({ utm: { source: "instagram" }, referrer: "https://instagram.com/" }, "constructhub.us")).toEqual(none);
    expect(landingColumns({ landing: "true", utm: { source: "instagram" } }, "constructhub.us")).toEqual(none);
    expect(landingColumns({}, "constructhub.us")).toEqual(none);
  });

  it("stores the sanitized tags and the referring host", () => {
    expect(landingColumns({
      landing: true, utm: { source: " Instagram", medium: "REEL", campaign: "test clip!", token: "SECRET" },
      referrer: "https://l.instagram.com/redirect",
    }, "constructhub.us")).toEqual({
      landing: true, utmSource: "instagram", utmMedium: "reel", utmCampaign: "testclip", referrerHost: "l.instagram.com",
    });
  });

  it("a page load from the site's own domain is not a landing unless it is tagged", () => {
    expect(landingColumns({ landing: true, referrer: "https://constructhub.us/pricing" }, "portal.constructhub.us").landing).toBe(false);
    expect(landingColumns({ landing: true, utm: { source: "email" }, referrer: "https://constructhub.us/pricing" }, "constructhub.us"))
      .toEqual({ landing: true, utmSource: "email", utmMedium: null, utmCampaign: null, referrerHost: null });
  });

  it("an untagged visit with no referrer is a direct landing", () => {
    expect(landingColumns({ landing: true }, "constructhub.us"))
      .toEqual({ landing: true, utmSource: null, utmMedium: null, utmCampaign: null, referrerHost: null });
  });
});

describe("POST /api/analytics/events — consent and what is stored", () => {
  const landingEvent = {
    type: "pageview", path: "/?utm_source=instagram&token=SECRET&email=a@b.c",
    referrer: "https://l.instagram.com/?u=x&token=SECRET",
    landing: true,
    utm: { source: "Instagram", medium: "reel", campaign: "test-clip", token: "SECRET", email: "a@b.c" },
    token: "SECRET", email: "a@b.c", query: "?token=SECRET",
  };

  it.each([
    ["no consent cookie", ""],
    ["consent denied", "ch_consent=denied"],
    ["consent denied but a visitor id presented", `ch_consent=denied; ch_vid=${VID}`],
    ["consent granted with a forged visitor id", "ch_consent=granted; ch_vid=not-minted"],
    ["a visitor id without consent", `ch_vid=${VID}`],
  ])("%s stores nothing", async (_name, cookie) => {
    const res = await call("POST /api/analytics/events", { headers: { cookie }, body: { events: [landingEvent] } });
    expect(res.body).toEqual({ ok: true, recorded: 0 });
    expect(mocks.inserted).toHaveLength(0);
    expect(mocks.poolQueries).toHaveLength(0);
  });

  it("granted consent stores the three tags and the referrer host — never the token, the email or the query", async () => {
    const res = await call("POST /api/analytics/events", {
      headers: { cookie: GRANTED, "user-agent": "vitest" },
      body: { events: [landingEvent, { path: "/pricing?token=SECRET", landing: true, utm: { source: "tiktok" } }] },
    });
    expect(res.body).toEqual({ ok: true, recorded: 2 });
    const [rows] = mocks.inserted;
    expect(rows[0]).toEqual({
      visitorId: VID, userId: null, type: "pageview", path: "/", referrer: "https://l.instagram.com/",
      ip: expect.any(String), userAgent: "vitest",
      landing: true, utmSource: "instagram", utmMedium: "reel", utmCampaign: "test-clip", referrerHost: "l.instagram.com",
    });
    // One page load, one landing: a second event in the batch cannot claim a campaign.
    expect(rows[1]).toMatchObject({ path: "/pricing", landing: false, utmSource: null, utmMedium: null, utmCampaign: null, referrerHost: null });
    expect(JSON.stringify(mocks.inserted)).not.toMatch(/SECRET|a@b\.c|utm_source=|token/i);
  });

  it("an event without the landing flag carries no attribution", async () => {
    await call("POST /api/analytics/events", { headers: { cookie: GRANTED }, body: { events: [{ path: "/features", referrer: "https://instagram.com/x" }] } });
    expect(mocks.inserted[0][0]).toMatchObject({ landing: false, utmSource: null, referrerHost: null });
  });
});

describe("sign-up attribution", () => {
  const fake = (rowCount = 1) => {
    const calls: { text: string; values?: unknown[] }[] = [];
    const q: Queryable = { query: async (text, values) => { calls.push({ text, values }); return { rows: [], rowCount }; } };
    return { q, calls };
  };

  it("consentedVisitorId is the one gate", () => {
    expect(consentedVisitorId(GRANTED)).toBe(VID);
    expect(consentedVisitorId(`ch_consent=denied; ch_vid=${VID}`)).toBeNull();
    expect(consentedVisitorId(`ch_vid=${VID}`)).toBeNull();
    expect(consentedVisitorId("ch_consent=granted")).toBeNull();
    expect(consentedVisitorId("ch_consent=%E0%A4%A; ch_vid=%E0%A4%A")).toBeNull();
    expect(consentedVisitorId(undefined)).toBeNull();
  });

  it.each([["unanswered", ""], ["denied", `ch_consent=denied; ch_vid=${VID}`], ["forged id", "ch_consent=granted; ch_vid=abc"]])(
    "consent %s: nothing is read and nothing is written", async (_n, cookie) => {
      const { q, calls } = fake();
      expect(await recordSignupAttribution(7, cookie, q)).toBe(false);
      expect(calls).toHaveLength(0);
    });

  it("copies the browser's EARLIEST attributed landing onto the user, once", async () => {
    const { q, calls } = fake(1);
    expect(await recordSignupAttribution(7, GRANTED, q)).toBe(true);
    expect(calls).toHaveLength(1);
    const { text, values } = calls[0];
    expect(values).toEqual([7, VID, FIRST_TOUCH_WINDOW_DAYS]);
    expect(text).toMatch(/INSERT INTO ch_signup_attribution \(user_id, utm_source, utm_medium, utm_campaign, referrer_host, touched_at\)/);
    expect(text).toMatch(/WHERE visitor_id = \$2 AND landing/);
    expect(text).toMatch(/ORDER BY created_at ASC\s+LIMIT 1/);       // first touch
    expect(text).toMatch(/ON CONFLICT \(user_id\) DO NOTHING/);      // …wins, and is never overwritten
    // Only the attribution columns are copied — no path, ip, user agent or referrer URL.
    expect(text).not.toMatch(/\bpath\b|\bip\b|user_agent|referrer\b(?!_host)/);
  });

  it("a user who already has a row keeps it, and a database error never breaks the sign-up", async () => {
    expect(await recordSignupAttribution(7, GRANTED, fake(0).q)).toBe(false);
    const boom: Queryable = { query: async () => { throw new Error("db down"); } };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await recordSignupAttribution(7, GRANTED, boom)).toBe(false);
    err.mockRestore();
  });

  it("both account-creation paths (email sign-up and Google) record it with the request's own cookies", () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, "auth.ts"), "utf8");
    expect(src.match(/void recordSignupAttribution\(newUser\.id, req\.headers\??\.cookie\)/g)).toHaveLength(2);
    expect(src.match(/\.insert\(users\)/g)).toHaveLength(2);
  });

  it("the schema keeps one row per user and goes with the account when it is erased", () => {
    const ddl = ANALYTICS_ATTRIBUTION_DDL.join("\n");
    expect(ddl).toMatch(/user_id integer PRIMARY KEY REFERENCES users\(id\) ON DELETE CASCADE/);
    expect(ddl).toMatch(/INSERT INTO ch_analytics_meta \(key\) VALUES \('attribution_started'\) ON CONFLICT \(key\) DO NOTHING/);
    for (const stmt of ANALYTICS_ATTRIBUTION_DDL) expect(stmt).toMatch(/IF NOT EXISTS|ON CONFLICT/); // idempotent
    expect(ddl).not.toMatch(/query|search|email|token/i);
  });
});

/** A Queryable that answers the report's queries from canned rows. */
function reportDb() {
  const calls: { text: string; values?: unknown[] }[] = [];
  const q: Queryable = {
    query: async (text, values) => {
      calls.push({ text, values });
      const t = text.replace(/\s+/g, " ");
      if (/^(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)/i.test(t.trim())) throw new Error("the report must be read-only");
      if (t.includes("ch_analytics_meta")) return { rows: [{ created_at: new Date("2026-10-08T15:00:00Z") }] };
      if (t.includes("FROM users")) return { rows: [{ n: 5 }] };
      if (t.includes("AS day") && t.includes("ch_analytics_events")) return { rows: [
        { day: "2026-10-09", utm_source: "instagram", visits: 7, visitors: 6 },
        { day: "2026-10-08", utm_source: "instagram", visits: 5, visitors: 5 },
        { day: "2026-10-08", utm_source: "linkedin", visits: 2, visitors: 2 },
      ] };
      if (t.includes("AS day")) return { rows: [{ day: "2026-10-09", utm_source: "instagram", signups: 2 }] };
      if (t.includes("e.utm_source, e.utm_medium, e.utm_campaign")) return { rows: [
        { utm_source: "linkedin", utm_medium: "post", utm_campaign: "launch", visits: 2, visitors: 2 },
        { utm_source: "instagram", utm_medium: "reel", utm_campaign: "crm-team-profile", visits: 9, visitors: 8 },
        { utm_source: "instagram", utm_medium: "reel", utm_campaign: "clip-2", visits: 3, visitors: 3 },
      ] };
      if (t.includes("s.utm_source, s.utm_medium, s.utm_campaign")) return { rows: [
        { utm_source: "instagram", utm_medium: "reel", utm_campaign: "crm-team-profile", signups: 2 },
        { utm_source: null, utm_medium: null, utm_campaign: null, signups: 1 },
      ] };
      if (t.includes("SELECT e.referrer_host")) return { rows: [
        { referrer_host: null, visits: 10, visitors: 9 },
        { referrer_host: "l.instagram.com", visits: 8, visitors: 7 },
        { referrer_host: "youtube.com", visits: 4, visitors: 4 },
      ] };
      if (t.includes("SELECT s.referrer_host")) return { rows: [
        { referrer_host: "l.instagram.com", signups: 2 }, { referrer_host: "youtube.com", signups: 1 },
      ] };
      if (t.includes("count(DISTINCT e.visitor_id)")) return { rows: [{ visits: 22, visitors: 20 }] };
      throw new Error(`unexpected query: ${t}`);
    },
  };
  return { q, calls };
}

const NOW = new Date("2026-10-14T16:00:00Z"); // noon Eastern

describe("the campaign report", () => {
  it("defaults to the last 7 Eastern days and accepts a picked range", () => {
    expect(reportRange({}, NOW)).toEqual({ since: "2026-10-08", until: "2026-10-14" });
    expect(reportRange({}, new Date("2026-10-15T02:00:00Z"))).toEqual({ since: "2026-10-08", until: "2026-10-14" }); // 10pm Eastern
    expect(reportRange({ days: "1" }, NOW)).toEqual({ since: "2026-10-14", until: "2026-10-14" });
    expect(reportRange({ since: "2026-10-08", until: "2026-10-10" }, NOW)).toEqual({ since: "2026-10-08", until: "2026-10-10" });
    expect(reportRange({ since: "2026-10-12", until: "2026-10-10" }, NOW)).toEqual({ since: "2026-10-04", until: "2026-10-10" });
    expect(reportRange({ since: "'; drop table users;--", until: "2026-13-45" }, NOW)).toEqual({ since: "2026-10-08", until: "2026-10-14" });
  });

  it("merges visits and sign-ups by source → medium → campaign, sorted by visits", async () => {
    const { q, calls } = reportDb();
    const r = await campaignReport(q, {}, NOW);
    expect(r.since).toBe("2026-10-08");
    expect(r.attributionStartedAt).toBe("2026-10-08T15:00:00.000Z");
    expect(r.totals).toEqual({ visits: 22, visitors: 20, signups: 5, attributedSignups: 3 });
    expect(r.campaigns).toEqual([
      { source: "instagram", medium: "reel", campaign: "crm-team-profile", visits: 9, visitors: 8, signups: 2 },
      { source: "instagram", medium: "reel", campaign: "clip-2", visits: 3, visitors: 3, signups: 0 },
      { source: "linkedin", medium: "post", campaign: "launch", visits: 2, visitors: 2, signups: 0 },
    ]);
    expect(r.referrers.map((x) => [x.label, x.visits, x.signups])).toEqual([
      [DIRECT_LABEL, 10, 0], ["Instagram", 8, 2], ["YouTube", 4, 1],
    ]);
    expect(r.daily).toEqual([
      { day: "2026-10-08", source: "instagram", visits: 5, visitors: 5, signups: 0 },
      { day: "2026-10-08", source: "linkedin", visits: 2, visitors: 2, signups: 0 },
      { day: "2026-10-09", source: "instagram", visits: 7, visitors: 6, signups: 2 },
    ]);
    // Dates are bound parameters, never spliced into the SQL.
    for (const c of calls.slice(1)) expect(c.values).toEqual(["2026-10-08", "2026-10-14"]);
  });

  it("--source narrows it with a sanitized bound parameter", async () => {
    const { q, calls } = reportDb();
    await campaignReport(q, { since: "2026-10-08", source: "Insta gram'; --" }, NOW);
    const withSource = calls.filter((c) => c.text.includes("utm_source = $3"));
    expect(withSource.length).toBeGreaterThan(0);
    for (const c of withSource) expect(c.values).toEqual(["2026-10-08", "2026-10-14", "instagram--"]);
    expect(calls.map((c) => c.text).join("\n")).not.toContain("Insta gram");
  });
});

describe("CSV and CLI output", () => {
  const report: CampaignReport = {
    since: "2026-10-08", until: "2026-10-14", attributionStartedAt: "2026-10-08T15:00:00.000Z",
    totals: { visits: 22, visitors: 20, signups: 5, attributedSignups: 3 },
    campaigns: [{ source: "instagram", medium: "reel", campaign: "=cmd", visits: 9, visitors: 8, signups: 2 }],
    referrers: [{ label: "Instagram", hosts: ["instagram.com", "l.instagram.com"], visits: 8, visitors: 7, signups: 2 }],
    daily: [{ day: "2026-10-08", source: "instagram", visits: 5, visitors: 5, signups: 0 }],
  };

  it("CSV: one header, one row per campaign / referrer / day, formula cells defused", () => {
    const lines = campaignReportCsv(report).split("\n");
    expect(lines[0]).toBe(CAMPAIGN_CSV_HEADER.map((h) => `"${h}"`).join(","));
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(`"Campaign","instagram","reel","'=cmd","","","9","8","2"`);
    expect(lines[2]).toBe(`"Referrer","Instagram","","","instagram.com l.instagram.com","","8","7","2"`);
    expect(lines[3]).toBe(`"Daily","instagram","","","","2026-10-08","5","5","0"`);
    for (const l of lines) expect(l.split('","')).toHaveLength(CAMPAIGN_CSV_HEADER.length);
  });

  it("CLI text: the range, the start date, the consent caveat and the three tables", () => {
    const text = campaignReportText(report);
    expect(text).toContain("Campaign report 2026-10-08 to 2026-10-14 (US Eastern days)");
    expect(text).toContain("Attribution recorded from 2026-10-08");
    expect(text).toContain("Only visitors who accepted the cookie banner are counted.");
    expect(text).toContain("sign-ups 5 (3 attributed)");
    expect(text).toMatch(/CAMPAIGNS\nSource\s+Medium\s+Campaign\s+Visits\s+Visitors\s+Sign-ups\n-+/);
    expect(text).toMatch(/instagram\s+reel\s+=cmd\s+9\s+8\s+2/);
    expect(text).toMatch(/REFERRERS\nReferrer\s+Hosts\s+Visits\s+Visitors\s+Sign-ups/);
    expect(text).toMatch(/DAILY BY SOURCE\nDay\s+Source\s+Visits\s+Visitors\s+Sign-ups/);
    expect(campaignReportText({ ...report, campaigns: [], referrers: [], daily: [], attributionStartedAt: null }))
      .toContain("(no tagged visits in this range)");
  });

  it("CLI arguments", () => {
    expect(parseArgs(["--since", "2026-10-08", "--source", "instagram"])).toEqual({ since: "2026-10-08", source: "instagram", csv: false });
    expect(parseArgs(["--since=2026-10-08", "--until=2026-10-14", "--csv"])).toEqual({ since: "2026-10-08", until: "2026-10-14", csv: true });
    expect(() => parseArgs(["--since", "yesterday"])).toThrow(/date like/);
    expect(() => parseArgs(["--since"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--delete"])).toThrow(/Unknown argument/);
  });

  it("the CLI only ever reads", () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, "../scripts/campaign-report.ts"), "utf8");
    expect(src).toContain('"BEGIN TRANSACTION READ ONLY"');
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/);
  });
});

describe("GET /api/admin/analytics?view=campaigns is platform-admin only", () => {
  const query = { view: "campaigns", since: "2026-10-08", until: "2026-10-14" };

  it("signed out: 401, and the report is never queried", async () => {
    const res = await call("GET /api/admin/analytics", { query });
    expect(res.code).toBe(401);
    expect(mocks.poolQueries).toHaveLength(0);
  });

  it("a signed-in account that is not a platform admin: 403, and the report is never queried", async () => {
    mocks.userRows = [{ id: 9, email: "contractor@example.com" }];
    const res = await call("GET /api/admin/analytics", { query, user: { id: 9 } });
    expect(res.code).toBe(403);
    expect(res.body.message).toBe("Platform admin access required");
    expect(mocks.poolQueries).toHaveLength(0);
  });

  it("a platform admin gets the report shape", async () => {
    mocks.userRows = [{ id: 1, email: "dev@constructhub.local" }];
    const res = await call("GET /api/admin/analytics", { query, user: { id: 1 } });
    expect(res.code).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["attributionStartedAt", "campaigns", "daily", "referrers", "since", "totals", "until"]);
    expect(res.body).toMatchObject({ since: "2026-10-08", until: "2026-10-14", campaigns: [], referrers: [], daily: [] });
    expect(mocks.poolQueries.length).toBeGreaterThan(0);
    for (const c of mocks.poolQueries) expect(c.text.trim()).toMatch(/^SELECT/);
  });
});
