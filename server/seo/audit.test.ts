import { describe, expect, it } from "vitest";
import { auditSummary, groupFindings, healthScore, issueKey, ITEM_CAP, type AuditPage, type AuditReport } from "./audit";

const page = (url: string, status = 200, redirects = 0): AuditPage => ({ url, status, redirects });
const finding = (id: string, severity: string, urls: string[], title = id) => ({ id, category: "technical", severity, title, urls, why: "why", fix: "fix" });

describe("issueKey", () => {
  it("rolls per-entry findings up and leaves the rest alone", () => {
    expect(issueKey("gap-services-Roof repair")).toBe("gap-services");
    expect(issueKey("gap-service_areas-Tampa")).toBe("gap-service_areas");
    expect(issueKey("psi-mobile-https://a.com/")).toBe("psi-mobile");
    expect(issueKey("duplicate-title")).toBe("duplicate-title");
    expect(issueKey("nap-address")).toBe("nap-address");
  });
});

describe("healthScore", () => {
  it("is the share of crawled URLs with no error", () => {
    const pages = [page("a"), page("b"), page("c", 404), page("d")];
    expect(healthScore({ findings: [finding("https", "critical", ["a"])] }, pages)).toBe(50);
  });
  it("ignores warnings and notices", () => {
    expect(healthScore({ findings: [finding("thin", "warning", ["a"]), finding("llms", "info", ["a"])] }, [page("a"), page("b")])).toBe(100);
  });
  it("counts a URL that could not be fetched as an error", () => {
    expect(healthScore({ errors: [{ url: "x" }] }, [page("a")])).toBe(50);
  });
  it("does not count an error on a URL that was never crawled", () => {
    expect(healthScore({ findings: [finding("https", "critical", ["elsewhere"])] }, [page("a")])).toBe(100);
  });
  it("is null when nothing was crawled", () => {
    expect(healthScore({}, [])).toBeNull();
  });
});

describe("groupFindings", () => {
  it("merges rolled-up findings into one issue with one entry each", () => {
    const g = groupFindings([
      finding("gap-services-Roof repair", "warning", ["home"], "No matching service page: Roof repair"),
      finding("gap-services-Gutters", "warning", ["home"], "No matching service page: Gutters"),
      finding("psi-mobile-https://a.com/", "critical", ["https://a.com/"], "mobile PageSpeed performance: 41"),
      finding("psi-mobile-https://a.com/b", "warning", ["https://a.com/b"], "mobile PageSpeed performance: 77"),
    ]);
    expect(g.get("gap-services")!.items).toEqual(["Roof repair", "Gutters"]);
    expect(g.get("gap-services")!.title).toBe("Google Business Profile services with no matching page");
    expect(g.get("psi-mobile")!.items).toEqual(["https://a.com/ — score 41", "https://a.com/b — score 77"]);
    expect(g.get("psi-mobile")!.severity).toBe("error");
  });
  it("survives a malformed report", () => {
    expect(groupFindings(undefined).size).toBe(0);
    expect(groupFindings([null as any, { severity: "warning" } as any]).size).toBe(0);
  });
});

describe("auditSummary", () => {
  const pages = [page("a"), page("b", 200, 1), page("c", 404), page("d", 503)];
  const report: AuditReport = {
    scannedAt: "2026-10-01T00:00:00Z", url: "https://x.com/", remaining: 7, blocked: 2, errors: [{ url: "e" }], coverage: { pageCap: 150 },
    findings: [finding("status", "critical", ["c", "d"], "HTTP errors"), finding("thin", "warning", ["a", "b", "c"], "Thin content"), finding("llms", "info", ["a"], "No llms.txt")],
  };
  it("counts statuses, totals and sorts errors first", () => {
    const s = auditSummary(report, pages);
    expect(s.statuses).toEqual({ ok: 1, redirected: 1, clientError: 1, serverError: 1, failed: 1 });
    expect(s.totals).toEqual({ error: { issues: 1, affected: 2 }, warning: { issues: 1, affected: 3 }, notice: { issues: 1, affected: 1 } });
    expect(s.issues.map((i) => i.key)).toEqual(["status", "thin", "llms"]);
    expect(s.health).toBe(40);
    expect(s.crawled).toBe(4);
    expect(s.notCrawled).toBe(7);
    expect(s.blockedByRobots).toBe(2);
    expect(s.pageCap).toBe(150);
  });
  it("has no change figures without a previous crawl", () => {
    const s = auditSummary(report, pages);
    expect(s.healthChange).toBeNull();
    expect(s.issues.every((i) => i.previous === null && i.change === null && !i.isNew)).toBe(true);
    expect(s.fixed).toEqual([]);
  });
  it("compares with the previous crawl: change, new and fixed issues", () => {
    const before = { report: { findings: [finding("thin", "warning", ["a"], "Thin content"), finding("alt", "warning", ["a", "b"], "Images without alt text")] }, pages: [page("a"), page("b")] };
    const s = auditSummary(report, pages, before);
    const thin = s.issues.find((i) => i.key === "thin")!, status = s.issues.find((i) => i.key === "status")!;
    expect([thin.previous, thin.change, thin.isNew]).toEqual([1, 2, false]);
    expect([status.previous, status.change, status.isNew]).toEqual([0, 2, true]);
    expect(s.fixed).toEqual([{ key: "alt", title: "Images without alt text", severity: "warning", previous: 2 }]);
    expect(s.healthChange).toBe(40 - 100);
  });
  it("caps the listed items but not the count", () => {
    const urls = Array.from({ length: ITEM_CAP + 20 }, (_, i) => `u${i}`);
    const s = auditSummary({ findings: [finding("thin", "warning", urls)] }, []);
    expect(s.issues[0].count).toBe(ITEM_CAP + 20);
    expect(s.issues[0].items).toHaveLength(ITEM_CAP);
  });
});
