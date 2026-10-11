/**
 * The SEO Suite polish of 2026-10-11 (docs/product/FINDINGS-2026-10-11.md, "SEO Suite" 1–10): the shared constants
 * behind it, pure; and source guards on the pages, so a later edit cannot quietly bring one of the ten back.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { SEO_SAVED_DAYS, authorityOf, savedForWords } from "@shared/seo-constants";
import { lastRunAt } from "../../client/src/pages/seo/saved";
import { seoLinks } from "../../client/src/pages/seo/links";
import { CACHE_HOURS, KEYWORD_OVERVIEW_TTL_DAYS } from "./reports";
import { REPORT_TTL_DAYS } from "./explorer";
import { MENTIONS_CACHE_HOURS } from "./mentions";

const read = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, "../../client/src/pages/seo", rel), "utf8");
const server = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, rel), "utf8");
/** Comments aside; only code counts. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("#4 one saved-copy window everywhere", () => {
  it("the shared window is a week, in words too", () => {
    expect(SEO_SAVED_DAYS).toBe(7);
    expect(savedForWords(7)).toBe("a week");
    expect(savedForWords(1)).toBe("a day");
    expect(savedForWords(3)).toBe("3 days");
  });
  it("every server window is the shared one", () => {
    expect(CACHE_HOURS).toBe(SEO_SAVED_DAYS * 24);
    expect(KEYWORD_OVERVIEW_TTL_DAYS).toBe(SEO_SAVED_DAYS);
    expect(REPORT_TTL_DAYS).toBe(SEO_SAVED_DAYS);
    expect(MENTIONS_CACHE_HOURS).toBe(SEO_SAVED_DAYS * 24);
    const routes = code(server("routes.ts"));
    expect(routes).not.toMatch(/\b7 \* 24\b/);
    expect(routes).toContain("const FREE_IDEAS_HOURS = CACHE_HOURS;");
  });
  it("the pages take the window's words from one place, never 'a day'", () => {
    for (const f of ["planner.tsx", "content.tsx", "batch.tsx", "keyword-lists.tsx", "directories.tsx", "opportunities.tsx", "report-table.tsx"]) {
      const s = code(read(f));
      expect(s, f).not.toMatch(/(within|for) a day\b/);
      expect(s, f).toContain("SAVED_FOR");
    }
    expect(code(read("shell.tsx"))).toContain("export const SAVED_FOR = savedForWords(SEO_SAVED_DAYS);");
  });
});

describe("#4 a peek that finds a copy older than the window says when it was made", () => {
  it("lastRunAt reads the server's expired answer and nothing else", () => {
    expect(lastRunAt(new Error('404: {"code":"expired","message":"Last run 2026-10-02; a saved copy is kept 7 days, so this one is bought again.","lastAt":"2026-10-02T14:03:00.000Z"}'))).toBe("2026-10-02T14:03:00.000Z");
    expect(lastRunAt(new Error('404: {"code":"no_report","message":"Not run yet."}'))).toBeNull();
    expect(lastRunAt(new Error('404: {"code":"expired","lastAt":"yesterday"}'))).toBeNull();
    expect(lastRunAt(new Error("500: {\"message\":\"boom\"}"))).toBeNull();
    expect(lastRunAt(new Error("404: Not Found"))).toBeNull();
    expect(lastRunAt(null)).toBeNull();
  });
  it("the planner and content routes answer a peek through notSaved, with the last save's date", () => {
    const routes = code(server("routes.ts"));
    expect(routes).toMatch(/const notSaved = \(res: any, lastAt: string \| null, message: string\) => lastAt\s*\? res\.status\(404\)\.json\(\{ code: "expired"/);
    expect(routes).toContain('if (input.peek) return notSaved(res, await lastSavedAt(user, key), "Not run yet.");');
    expect(routes).toContain('if (peek) return notSaved(res, await lastSavedAt(user, key), "Not searched yet.");');
    expect(code(server("reports.ts"))).toMatch(/export async function lastSavedAt\(userId: number, key: string\): Promise<string \| null>/);
  });
  it("the planner's not-saved state claims nothing about the past it cannot know, and names the last run when it can", () => {
    const planner = code(read("planner.tsx"));
    expect(planner).not.toContain("Nothing has been charged yet");
    expect(planner).toContain("Nothing is charged until you press the button.");
    expect(planner).toMatch(/\{lastAt && <p data-testid="planner-expired">Last checked /);
    expect(planner).toMatch(/\{lastAt \? "Check again" : "Get the numbers"\}/);
    expect(planner).toContain("return { page: null, lastAt: lastRunAt(e) };");
    const content = code(read("content.tsx"));
    expect(content).toMatch(/data-testid="link-content-last-run"/);
    expect(content).toContain("return { page: null, lastAt: lastRunAt(e) };");
  });
});

describe("#5 one authority scale", () => {
  it("authorityOf: the source's 0–1000 rank as 0–100, clamped, null when unknown", () => {
    expect(authorityOf(238)).toBe(24);
    expect(authorityOf(245)).toBe(25);
    expect(authorityOf(0)).toBe(0);
    expect(authorityOf(1000)).toBe(100);
    expect(authorityOf(1200)).toBe(100);
    expect(authorityOf(-5)).toBe(0);
    expect(authorityOf(null)).toBeNull();
    expect(authorityOf(undefined)).toBeNull();
    expect(authorityOf(Number.NaN)).toBeNull();
  });
  it("Backlinks shows authority on that scale, never a 0–1000 domain rank", () => {
    const backlinks = code(read("backlinks.tsx"));
    expect(backlinks).not.toContain("Domain rank");
    expect(backlinks).not.toContain("0–1000");
    expect(backlinks).toContain('import { authorityOf } from "@shared/seo-constants";');
    expect(backlinks).toContain('<MetricColumn label="Authority" testId="tile-rank"');
    expect(backlinks).toContain("{authorityOf(s.rank) ?? \"—\"}");
    expect(backlinks).toContain('diff(authorityOf(s.rank), authorityOf(p?.rank), view("overview"), "link-rank-delta")');
    expect(backlinks).toContain("{authorityOf(b.domainRank) ?? \"—\"}");
    expect(backlinks).toContain('foot="Link authority, 0–100 — the scale Site explorer uses"');
  });
});

describe("#1 the 'being switched on' notice only where the page spends the source's data", () => {
  it("the shell renders it only when told what the page spends", () => {
    const shell = code(read("shell.tsx"));
    expect(shell).toContain('{status.data && !status.data.configured && spends && <NotReadyNotice spends={spends} />}');
    expect(shell).toMatch(/spends\?: "tracking" \| "lookups";/);
    expect(shell).toContain("Lookups are being switched on for your account — check back shortly. Saved results open as usual; a new lookup waits until it's on.");
  });
  it("the pages that spend say so; the pages that spend nothing say nothing", () => {
    expect(code(read("index.tsx"))).toContain('spends="tracking"');
    for (const f of ["dashboard.tsx", "explorer.tsx", "keywords.tsx", "content.tsx", "backlinks.tsx", "competitors.tsx", "batch.tsx", "grid.tsx", "ai.tsx", "mentions-page.tsx", "alerts.tsx"]) expect(code(read(f)), f).toContain('spends="lookups"');
    for (const f of ["audit.tsx", "reports.tsx", "usage.tsx", "plan.tsx"]) expect(code(read(f)), f).not.toContain("spends=");
  });
  it("the rank tracker's next-check tile shows the schedule and says the check waits — not '— Being switched on'", () => {
    const page = code(read("index.tsx"));
    expect(page).not.toContain("Being switched on");
    expect(page).toContain('{fmtDate(o.nextCheck.nextAt)}</Fig>}');
    expect(page).toContain('per check${configured ? "" : " — automatic checks start once rank tracking is set up"}');
  });
});

describe("#2 the two 'Competitors' read apart", () => {
  it("the paid gap page and the rank tracker's share-of-voice panel have different names", () => {
    expect(code(read("competitors.tsx"))).toContain('<SeoShell title="Competitor gap"');
    expect(code(read("rank-competitors.tsx"))).toContain("<SectionTitle>Competitors on your keywords</SectionTitle>");
    expect(code(read("competitors.tsx"))).toContain('data-testid="link-competitors-panel">Competitors on your keywords</Link>');
  });
});

describe("#3 the Alerts page opens on the alerts", () => {
  it("the alert list comes before the keyword watch", () => {
    const alerts = code(read("alerts.tsx"));
    const list = alerts.indexOf('data-testid="list-alerts"'), watch = alerts.indexOf('id="keyword-watch"');
    expect(list).toBeGreaterThan(0);
    expect(watch).toBeGreaterThan(list);
    // The watch is still where an alert's "Open this comparison" scrolls to.
    expect(alerts).toContain('document.getElementById("keyword-watch")?.scrollIntoView');
  });
});

describe("#6 the keywords explorer's tabs are `tab=`, like the audit's and mentions'", () => {
  it("the builder writes tab=", () => {
    expect(seoLinks.keywords("", { tab: "area", show: "gaps" })).toBe("/seo/keywords?tab=area&show=gaps");
    expect(seoLinks.keywords("roof", { tab: "bulk" })).toBe("/seo/keywords?keyword=roof&tab=bulk");
    expect(seoLinks.servicePlanner(3)).toBe("/seo/keywords?tab=area&site=3");
  });
  it("the page reads tab= (and the older view= so saved links keep working); no page writes view= for it", () => {
    const keywords = code(read("keywords.tsx"));
    expect(keywords).toContain('const tab = p.get("tab") ?? p.get("view")');
    expect(keywords).toContain('const mode: Mode = address.tab ?? "one";');
    // The older spelling is rewritten in place, so the shell's nav and crumb (which match `tab`) agree with the page.
    expect(keywords).toContain('if (v !== null && p.get("tab") === null) setParams({ tab: v || null, view: null }, true);');
    expect(code(read("keyword-lists.tsx"))).toContain('const tab = a.get("tab") ?? a.get("view")');
    for (const f of fs.readdirSync(path.resolve(import.meta.dirname, "../../client/src/pages/seo")).filter((f) => /\.tsx?$/.test(f))) {
      for (const call of code(read(f)).match(/seoLinks\.keywords\([^;]*?\)/g) ?? []) expect(call, f).not.toMatch(/\bview:/);
    }
  });
});

describe("#7 the local grid's rivals table says what it counts", () => {
  it("points, and a note that several businesses can be in the first 3 at one point", () => {
    const grid = code(read("grid.tsx"));
    expect(grid).toContain(">Points in the first 3</th>");
    expect(grid).toContain(">Points found</th>");
    expect(grid).toContain('data-testid="text-grid-rivals-note"');
    expect(grid).toContain("so more than one business can be in the first 3 at the same point");
    expect(grid).not.toMatch(/<th className="num">In the first 3<\/th>/);
  });
});

describe("#8 the movement tile names the device it counts", () => {
  it("foot and titles carry the first device, as the server's summary does", () => {
    const page = code(read("index.tsx"));
    expect(page).toContain('title={`The keywords that went up since the check before on ${o.devices[0]} (newly found ones included)`}');
    expect(page).toContain(">down</Fig> · {o.devices[0]}</>}");
  });
});

describe("#9 the content explorer looks up both settings of 'Leave out <site>'", () => {
  it("a miss on one setting peeks the other and says which copy is shown", () => {
    const content = code(read("content.tsx"));
    expect(content).toMatch(/const otherBody = useMemo\(\(\) => \{ const \{ exclude, \.\.\.rest \} = body as typeof body & \{ exclude\?: string \}; return exclude \|\| !site \? rest : \{ \.\.\.rest, exclude: site\.domain \}; \}, \[body, site\]\);/);
    expect(content).toContain('const alt: Saved = await api("POST", "/api/seo/content", { ...otherBody, peek: true }); return { ...alt, other: true };');
    expect(content).toContain('data-testid="content-other-variant"');
    expect(content).toContain('data-testid="button-content-run-variant"');
  });
});

describe("#10 the dashboard's health tile counts the sites it leaves out", () => {
  it("says how many sites are not crawled yet", () => {
    const dash = code(read("dashboard.tsx"));
    expect(dash).toContain('data-testid="text-health-uncrawled"> · {fmtNum(shownCards.length - crawled.length)} not crawled yet</span>');
  });
});
