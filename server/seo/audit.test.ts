import { describe, expect, it } from "vitest";
import { auditSummary, groupFindings, healthScore, issueKey, ITEM_CAP, pageChanges, type AuditPage, type AuditReport } from "./audit";

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
    expect(s.statuses).toEqual({ ok: 1, redirected: 1, clientError: 1, serverError: 1, failed: 1, excluded: 0, unusual: 0 });
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

describe("what counts as broken, and what counts as fixed", () => {
  it("a file or an off-site redirect the crawler skipped is an exclusion, not a failure", () => {
    const report: AuditReport = { errors: [
      { url: "a.pdf", message: "Non-HTML response excluded from page checks." },
      { url: "out", message: "Redirect leaves the selected origin; destination excluded from audit." },
      { url: "down", message: "Request failed, exceeded a limit, or was blocked by the network safety policy." },
    ] };
    const s = auditSummary(report, [page("a")]);
    expect(s.statuses.failed).toBe(1);
    expect(s.statuses.excluded).toBe(2);
    expect(s.health).toBe(50); // "a" is fine, "down" failed; the two exclusions are not counted
  });
  it("an issue whose pages were not crawled this time is 'not re-checked', not fixed", () => {
    const before = { report: { findings: [finding("thin", "warning", ["https://x/old"], "Thin content"), finding("alt", "warning", ["https://x/a"], "Images without alt text")] }, pages: [page("https://x/old"), page("https://x/a")] };
    const s = auditSummary({ findings: [] }, [page("https://x/a")], before);
    expect(s.fixed.map((f) => f.key)).toEqual(["alt"]);
    expect(s.notRechecked.map((f) => f.key)).toEqual(["thin"]);
  });
  it("an issue is fixed only when every page it was on was crawled again", () => {
    const before = { report: { findings: [finding("thin", "warning", ["https://x/a", "https://x/b"], "Thin content")] }, pages: [page("https://x/a"), page("https://x/b")] };
    expect(auditSummary({ findings: [] }, [page("https://x/a")], before).notRechecked.map((f) => f.key)).toEqual(["thin"]);
    expect(auditSummary({ findings: [] }, [page("https://x/a"), page("https://x/b")], before).fixed.map((f) => f.key)).toEqual(["thin"]);
  });
  it("a PageSpeed entry is re-checked only when that page was MEASURED again for the same device", () => {
    const psi = { id: "psi-mobile-https://x/a", category: "performance", severity: "warning", title: "mobile PageSpeed performance: 41", urls: ["https://x/a"], why: "", fix: "" };
    const before = { report: { findings: [psi] }, pages: [page("https://x/a")] };
    const now = (psiNow: unknown[]) => auditSummary({ findings: [], psi: psiNow as any }, [page("https://x/a")], before);
    // Measured again on mobile, and now 90 or better (so no finding): fixed.
    expect(now([{ url: "https://x/a", strategy: "mobile", score: 93 }]).fixed.map((f) => f.key)).toEqual(["psi-mobile"]);
    // The page was crawled again, but the speed test did not run, failed, was switched off, or ran for the other device:
    // the finding is gone from the list without anything having been measured. Not a fix.
    for (const attempt of [[], [{ url: "https://x/a", strategy: "mobile", reason: "request_error", unavailable: "failed" }], [{ reason: "disabled" }], [{ url: "https://x/a", strategy: "desktop", score: 95 }], [{ url: "https://x/b", strategy: "mobile", score: 95 }]])
      expect([now(attempt).fixed.map((f) => f.key), now(attempt).notRechecked.map((f) => f.key)]).toEqual([[], ["psi-mobile"]]);
    expect(auditSummary({ findings: [] }, [page("https://x/other")], before).notRechecked.map((f) => f.key)).toEqual(["psi-mobile"]);
  });
  it("a check that only samples links or images is never called fixed just because it stopped being listed", () => {
    const broken = { id: "broken-links", category: "technical", severity: "warning", title: "Broken checked links", urls: ["https://x/gone"], why: "", fix: "" };
    const images = { id: "oversized-images", category: "performance", severity: "warning", title: "Oversized sampled images", urls: ["https://x/a"], why: "", fix: "" };
    const before = { report: { findings: [broken, images] }, pages: [page("https://x/a"), page("https://x/gone")] };
    const s = auditSummary({ findings: [] }, [page("https://x/a"), page("https://x/gone")], before);
    expect([s.fixed.map((f) => f.key), s.notRechecked.map((f) => f.key).sort()]).toEqual([[], ["broken-links", "oversized-images"]]);
  });
  it("'addresses with no page answered like real pages' is fixed only when this crawl asked again and every answer was honest", () => {
    const soft = { id: "soft-404", category: "technical", severity: "warning", title: "Addresses with no page are answered like real pages", urls: ["https://x/not-a-page-0123456789"], why: "", fix: "" };
    const before = { report: { findings: [soft] }, pages: [page("https://x/")] };
    const now = (coverage?: unknown) => auditSummary({ findings: [], ...(coverage === undefined ? {} : { coverage }) } as any, [page("https://x/")], before);
    // Each answer with the part of the site it was asked in: the first at the top ("/"), any further one in "/services/".
    const probe = (...outcomes: string[]) => ({ missingPageProbe: { asked: outcomes.length, outcomes, probes: outcomes.map((outcome, i) => ({ part: i ? "/services/" : "/", outcome })) } });
    // Asked again and answered "not found" — or as a noindexed page, the way a client-routed app can: fixed.
    expect(now(probe("not_found", "not_found")).fixed.map((f) => f.key)).toEqual(["soft-404"]);
    expect(now(probe("noindex")).fixed.map((f) => f.key)).toEqual(["soft-404"]);
    // Not asked (robots.txt, not measured), no answer, or an answer that proves nothing (a sign-in, a bot check, a server
    // error) — even next to an honest one: not re-checked, never "fixed".
    for (const c of [{ missingPageProbe: { asked: 0, outcomes: [], reason: "robots" } }, { missingPageProbe: { asked: 0, outcomes: [], reason: "not_measured" } }, probe("undetermined"), { missingPageProbe: { asked: 2, outcomes: ["not_found", "undetermined"], probes: [{ part: "/", outcome: "undetermined" }, { part: "/", outcome: "not_found" }] } }, { missingPageProbe: { asked: 1, outcomes: ["not_found"] } }, { missingPageProbe: { asked: 1, outcomes: ["not_found"], probes: [{ part: "/services/", outcome: "not_found" }] } }, { missingPageProbe: null }, {}, undefined])
      expect([now(c).fixed.map((f) => f.key), now(c).notRechecked.map((f) => f.key)], JSON.stringify(c)).toEqual([[], ["soft-404"]]);
    // Still there: listed as an issue with the address that was asked for.
    const still = auditSummary({ findings: [soft], coverage: probe("ok_as_page") } as any, [page("https://x/")], before);
    expect(still.issues.find((i) => i.key === "soft-404")).toMatchObject({ count: 1, previous: 1, change: 0, severity: "warning" });
  });
  it("Google-profile checks are 'not re-checked' when this crawl had no profile", () => {
    const local = { id: "gap-services-Gutters", category: "local", severity: "warning", title: "No matching service page: Gutters", urls: ["https://x/"], why: "", fix: "" };
    const before = { report: { profile: { id: 7 }, findings: [local] }, pages: [page("https://x/")] };
    expect(auditSummary({ findings: [] }, [page("https://x/")], before).notRechecked.map((f) => f.key)).toEqual(["gap-services"]);
    expect(auditSummary({ profile: { id: 7 }, findings: [] }, [page("https://x/")], before).fixed.map((f) => f.key)).toEqual(["gap-services"]);
  });
  it("a malformed stored report is read as empty instead of throwing", () => {
    const s = auditSummary({ findings: "nope", errors: { a: 1 } } as any, []);
    expect(s.issues).toEqual([]);
    expect(s.health).toBeNull();
    expect(groupFindings([{ id: "x", severity: "warning", category: "content", title: 5, urls: "u" } as any]).get("x")!.items).toEqual([]);
  });
});

describe("pageChanges", () => {
  it("compares two crawls' pages by address — www, a trailing slash and case of the host are the same page", () => {
    const now = [page("https://a.com/"), page("https://www.a.com/new"), page("https://A.com/kept/")];
    const before = [page("https://a.com"), page("https://a.com/kept"), page("https://a.com/old?x=1")];
    expect(pageChanges(now, before)).toEqual({ added: ["https://www.a.com/new"], removed: ["https://a.com/old?x=1"] });
    expect(pageChanges(now, now)).toEqual({ added: [], removed: [] });
  });
});

describe("odd but readable crawls", () => {
  it("an answer outside the usual classes is its own kind and an error page; area scores that are not scores are none", () => {
    const s = auditSummary({ findings: [], scores: {} as any }, [page("https://a.com/", 200), page("https://a.com/x", 999), page("https://a.com/y", 101)]);
    expect([s.statuses.ok, s.statuses.serverError, s.statuses.unusual, s.health, s.scores]).toEqual([1, 0, 2, 33, null]);
    const g = groupFindings([{ id: "x", category: { bad: 1 } as any, severity: "warning", title: "X", urls: ["u"], why: { no: 1 } as any, fix: null as any }]);
    expect([g.get("x")!.category, g.get("x")!.why, g.get("x")!.fix]).toEqual(["technical", "", ""]);
  });
});
