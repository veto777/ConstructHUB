import { gscComparable as _gscComparable } from "./site-report";
import { describe, expect, it } from "vitest";
import { reportEmail, unsubscribeToken, validUnsubscribe } from "./site-report-send";
import { moverLine, nextSendAt, rankingsSection, renderReportPdf, reportHighlights, reportIsEmpty, scheduleInput, sendPeriod, type SiteReport } from "./site-report";

const check = (keywordId: number, keyword: string, checkedOn: string, position: number | null, extra: Partial<{ device: string; local: number | null; hasPack: boolean; location: string | null; volume: number | null }> = {}) =>
  ({ keywordId, keyword, checkedOn, position, device: "desktop", local: null, hasPack: false, location: null, volume: null, ...extra });
const today = new Date("2026-10-08T12:00:00Z");

describe("rankingsSection", () => {
  const checks = [
    check(1, "roof repair", "2026-09-03", 12), check(1, "roof repair", "2026-09-10", 9), check(1, "roof repair", "2026-10-08", 3),
    check(2, "siding", "2026-09-10", 4), check(2, "siding", "2026-10-08", 9),
    check(3, "gutters", "2026-09-10", 8), check(3, "gutters", "2026-10-08", null),
    check(4, "windows", "2026-10-08", 6, { local: 2, hasPack: true, location: "Tampa, Florida" }),
    check(1, "roof repair", "2026-10-08", 30, { device: "mobile" }),
  ];
  const out = rankingsSection(checks, "desktop", 30, today)!;
  it("compares the latest check with the one nearest 30 days back", () => {
    expect(out.comparedWith).toBe("2026-09-10");
    expect(out.section).toMatchObject({ tracked: 4, checked: 4, device: "desktop", improvedCount: 1, declinedCount: 2, checkedOn: "2026-10-08", top3: 1, top10: 3, previousTop3: 0, previousTop10: 3, inMapPack: 1, withMapPack: 1 });
    expect(out.section.averagePosition).toBe(6);
    expect(out.section.previousAverage).toBe(7);
  });
  it("lists what moved up and down, biggest first, and leaves out a keyword with no earlier check", () => {
    expect(out.section.improved.map((m) => [m.keyword, m.from, m.to])).toEqual([["roof repair", 9, 3]]);
    expect(out.section.declined.map((m) => [m.keyword, m.from, m.to])).toEqual([["gutters", 8, null], ["siding", 4, 9]]);
  });
  it("ignores other devices, and has nothing to compare on a first check", () => {
    expect(out.section.keywords.find((k) => k.keyword === "roof repair")!.position).toBe(3);
    const first = rankingsSection([check(1, "a", "2026-10-08", 5)], "desktop", 30, today)!;
    expect(first.comparedWith).toBeNull();
    expect(first.section).toMatchObject({ previousTop10: null, improved: [], declined: [] });
    expect(rankingsSection([], "desktop")).toBeNull();
  });
});

const report = (over: Partial<SiteReport> = {}): SiteReport => ({
  domain: "example.com", generatedAt: "2026-10-08T12:00:00Z", comparedWith: "2026-09-10",
  rankings: { tracked: 4, checked: 4, device: "desktop", improvedCount: 1, declinedCount: 1, checkedOn: "2026-10-08", top3: 1, top10: 3, averagePosition: 6, previousTop3: 0, previousTop10: 2, previousAverage: 7, inMapPack: 1, withMapPack: 2,
    improved: [{ keyword: "roof repair", location: "Tampa, Florida", device: "desktop", from: 9, to: 3 }], declined: [{ keyword: "gutters", location: null, device: "desktop", from: 8, to: null }],
    keywords: [{ keyword: "roof repair", location: "Tampa, Florida", position: 3, previous: 9, local: 2, volume: 880 }] },
  search: { fetchedAt: "2026-10-07T00:00:00Z", authority: 37, referringDomains: 2660, backlinks: 32000, organicKeywords: 74, organicTraffic: 54, trafficValue: 997, trafficChange: 12, keywordsChange: -3, referringDomainsChange: 0 },
  audit: { scannedAt: "2026-10-06T00:00:00Z", health: 97, healthChange: 3, crawled: 150, errors: 4, warnings: 216, notices: 2, topIssues: [{ title: "HTTP errors", severity: "error", count: 4 }] },
  searchConsole: { clicks: 412, impressions: 18300, position: 14.2, previousClicks: 380, previousImpressions: 19000 },
  alerts: [{ title: "2 rankings fell for example.com", kind: "rank_drop", createdAt: "2026-10-08T00:00:00Z" }],
  ...over,
});

describe("words", () => {
  it("highlights carry the change since the earlier check", () => {
    const rows = Object.fromEntries(reportHighlights(report()));
    expect(rows["Keywords in the top 10"]).toBe("3 of 4 checked (+1)");
    expect(rows["Not covered by the latest check"]).toBeUndefined();
    const partial = report(); partial.rankings!.tracked = 10;
    expect(Object.fromEntries(reportHighlights(partial))["Not covered by the latest check"]).toBe("6 of 10 tracked keywords");
    expect(rows["Average position"]).toBe("6 (was 7)");
    expect(rows["Clicks from Google, last 28 days"]).toBe("412 (+32)");
    expect(rows["Times shown in Google, last 28 days"]).toBe("18,300 (−700)");
    expect(rows["In the Google map pack"]).toBe("1 of 2 searches that show a map");
    expect(rows["Keywords the site ranks for"]).toBe("74 (−3)");
    expect(rows["Websites linking to it"]).toBe("2,660");
    expect(rows["Site health (0–100)"]).toBe("97 (+3) · 4 errors, 216 warnings");
  });
  it("a mover reads like a sentence", () => {
    expect(moverLine({ keyword: "roof repair", location: "Tampa, Florida", device: "desktop", from: 9, to: 3 })).toBe('"roof repair" in Tampa, Florida moved from 9 to 3');
    expect(moverLine({ keyword: "gutters", location: null, device: "desktop", from: 8, to: null })).toBe('"gutters" dropped out of the results (was 8)');
    expect(moverLine({ keyword: "siding", location: null, device: "desktop", from: null, to: 5 })).toBe('"siding" now ranks at 5');
  });
  it("knows when there is nothing to report", () => {
    expect(reportIsEmpty(report())).toBe(false);
    expect(reportIsEmpty(report({ rankings: null, search: null, audit: null, searchConsole: null }))).toBe(true);
    expect(reportIsEmpty(report({ rankings: null, search: null, audit: null }))).toBe(false);
  });
});

describe("PDF", () => {
  it("renders a real PDF for a full report, an empty one and a bad logo", async () => {
    for (const [r, brand] of [[report(), { name: "Aspire Marketing", logo: null }], [report({ rankings: null, search: null, audit: null, searchConsole: null, alerts: [] }), null], [report(), { name: "X", logo: "data:image/png;base64,not-an-image" }]] as const) {
      const pdf = await renderReportPdf(r, brand);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(800);
    }
  });
  it("survives a long keyword table (page breaks)", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ keyword: `keyword number ${i} with a fairly long phrase to ellipsise`, location: i % 2 ? "Bellingham, Washington" : null, position: i + 1, previous: i, local: null, volume: 100 * i }));
    const pdf = await renderReportPdf(report({ rankings: { ...report().rankings!, tracked: 120, keywords: many } }));
    expect(pdf.length).toBeGreaterThan(3000);
  });
});

describe("schedule", () => {
  it("weekly is seven days on; monthly is the 1st of next month; off is never", () => {
    const from = new Date("2026-10-08T15:00:00Z");
    expect(nextSendAt("weekly", from)!.toISOString()).toBe("2026-10-15T15:00:00.000Z");
    expect(nextSendAt("monthly", from)!.toISOString()).toBe("2026-11-01T13:00:00.000Z");
    expect(nextSendAt("monthly", new Date("2026-12-31T23:00:00Z"))!.toISOString()).toBe("2027-01-01T13:00:00.000Z");
    expect(nextSendAt("off", from)).toBeNull();
  });
  it("one send per recipient per week or month", () => {
    expect(sendPeriod("monthly", new Date("2026-10-08T00:00:00Z"))).toBe("2026-10");
    expect(sendPeriod("weekly", new Date("2026-10-08T00:00:00Z"))).toBe(sendPeriod("weekly", new Date("2026-10-09T00:00:00Z")));
    expect(sendPeriod("weekly", new Date("2026-10-08T00:00:00Z"))).not.toBe(sendPeriod("weekly", new Date("2026-10-16T00:00:00Z")));
  });
  it("takes up to five valid addresses", () => {
    expect(scheduleInput.parse({ frequency: "monthly", recipients: [" Owner@Example.com "] }).recipients).toEqual(["owner@example.com"]);
    expect(scheduleInput.safeParse({ frequency: "monthly", recipients: ["nope"] }).success).toBe(false);
    expect(scheduleInput.safeParse({ frequency: "daily", recipients: [] }).success).toBe(false);
    expect(scheduleInput.safeParse({ frequency: "weekly", recipients: Array.from({ length: 6 }, (_, i) => `a${i}@x.com`) }).success).toBe(false);
  });
});

describe("report email", () => {
  it("says who asked for it and how to stop it", () => {
    const m = reportEmail(report(), { senderName: "Aspire Interiors", unsubscribe: "https://constructhub.us/api/seo/report-unsubscribe?u=1&e=a%40b.com&t=abc" });
    expect(m.subject).toBe("SEO report — example.com");
    expect(m.text).toContain("Aspire Interiors asked ConstructHUB to send you this report.");
    expect(m.text).toContain("Stop them here: https://constructhub.us/api/seo/report-unsubscribe?u=1&e=a%40b.com&t=abc");
    expect(m.text).toContain("1 moved up and 1 moved down");
  });
  it("an unsubscribe token belongs to one account and one address, and needs the secret", () => {
    const t = unsubscribeToken(7, "Client@Example.com", "s3cret");
    expect(t).toHaveLength(40);
    expect(validUnsubscribe(7, "client@example.com", t, "s3cret")).toBe(true);
    expect(validUnsubscribe(8, "client@example.com", t, "s3cret")).toBe(false);
    expect(validUnsubscribe(7, "other@example.com", t, "s3cret")).toBe(false);
    expect(validUnsubscribe(7, "client@example.com", t, "another")).toBe(false);
    expect(validUnsubscribe(7, "client@example.com", "", "s3cret")).toBe(false);
    expect(unsubscribeToken(7, "client@example.com", "")).toBe("");
    expect(validUnsubscribe(7, "client@example.com", "", "")).toBe(false);
  });
});

describe("Search Console numbers in a report", () => {
  const base = { clicks: 120, impressions: 4000, position: 9.1, previousClicks: 100, previousImpressions: 3500 };
  it("compares the two periods only when both are complete", () => {
    expect(_gscComparable({ ...base, days: 28, previousDays: 28 })).toBe(true);
    // 26 of 28 against a full 28 would show a fall that is only missing days.
    expect(_gscComparable({ ...base, days: 26, previousDays: 28 })).toBe(false);
    expect(_gscComparable({ ...base, days: 28, previousDays: 6 })).toBe(false);
    expect(_gscComparable({ ...base, previousClicks: null, previousImpressions: null, days: 28, previousDays: 0 })).toBe(false);
  });
  it("work done: tasks marked done in the last 30 days, newest first, and what is still open; no plan = no section", async () => {
    const { workSection } = await import("./site-report");
    const now = new Date("2026-10-08T12:00:00Z");
    const t = (title: string, status: string, done_at: string | null = null) => ({ title, status, done_at, target: null, note: null, kind: "page" });
    const w = workSection([t("old", "done", "2026-08-01T00:00:00Z"), t("a", "done", "2026-10-01T00:00:00Z"), t("b", "done", "2026-10-05T00:00:00Z"), t("c", "todo"), t("d", "doing"), t("e", "dropped")], now)!;
    expect([w.done.map((x) => x.title), w.doneCount, w.open, w.inProgress]).toEqual([["b", "a"], 2, 2, 1]);
    expect(workSection([], now)).toBeNull();
  });
});
