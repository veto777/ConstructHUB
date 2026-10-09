/**
 * Reports, local grid, AI visibility, alerts, action plan, mentions, usage, batch, competitors and the shell — "all
 * data takes you somewhere" (owner 2026-10-09), Kimi audit round 2. Every figure on these screens is a link built by
 * seoLinks, the address is the state, the chips say only what is true, and every link is a 44 px target with a cue that
 * needs no hover. Pure modules + a source guard, no browser (the rank-tracker-ui test's pattern).
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { seoLinks } from "../../client/src/pages/seo/links";
import { spentOn } from "../../client/src/pages/seo/usage-links";

const read = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, "../../client/src/pages/seo", rel), "utf8");
/** Comments aside; only code counts. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("the addresses (links.ts, appended only)", () => {
  it("local grid, AI, alerts, plan", () => {
    expect(seoLinks.localGrid(3, { scan: 9, show: "failed" })).toBe("/seo/local-grid?site=3&scan=9&show=failed");
    expect(seoLinks.ai(3, { latest: true, days: 30, named: true })).toBe("/seo/ai?site=3&latest=true&days=30&named=true");
    expect(seoLinks.ai(3, { vs: "2026-08" })).toBe("/seo/ai?site=3&vs=2026-08");
    expect(seoLinks.ai(3, { mentions: "x.com", platform: "chat_gpt" })).toBe("/seo/ai?site=3&mentions=x.com&platform=chat_gpt");
    expect(seoLinks.alerts({ site: 3, kind: "rank_drop", alert: 41 })).toBe("/seo/alerts?site=3&kind=rank_drop&alert=41");
    expect(seoLinks.alerts({ undelivered: true })).toBe("/seo/alerts?undelivered=true");
    expect(seoLinks.alerts({ site: 3, before: 7, now: 8 })).toBe("/seo/alerts?site=3&before=7&now=8");
    expect(seoLinks.plan(3, { due: "soon" })).toBe("/seo/plan?site=3&due=soon");
    expect(seoLinks.plan(3, { owner: "Sam Lee" })).toBe("/seo/plan?site=3&owner=Sam+Lee");
  });
  it("round 3: one grid outline per colour, the alerts' reveals, the site's planner", () => {
    for (const show of ["4-10", "11-20", "notFound"] as const) expect(seoLinks.localGrid(3, { scan: 9, show })).toBe(`/seo/local-grid?site=3&scan=9&show=${show}`);
    expect(seoLinks.alerts({ site: 3, all: "41,42", more: 2 })).toBe("/seo/alerts?site=3&all=41%2C42&more=2");
    expect(seoLinks.servicePlanner(3)).toBe("/seo/keywords?view=area&site=3");
  });
  it("the app pages and Google's own listing — no hand-written address anywhere", () => {
    expect(seoLinks.appSettings({ tab: "notifications" })).toBe("/settings?tab=notifications");
    expect(seoLinks.siteScan()).toBe("/site-scan");
    expect(seoLinks.pricing()).toBe("/pricing");
    expect(seoLinks.searchConsole()).toBe("/search-console");
    expect(seoLinks.googleMaps({ cid: "123456789", name: "Alpine" })).toBe("https://www.google.com/maps?cid=123456789");
    expect(seoLinks.googleMaps({ cid: null, name: "Alpine Exteriors", address: "Bellingham, WA" })).toBe("https://www.google.com/maps/search/?api=1&query=Alpine%20Exteriors%2C%20Bellingham%2C%20WA");
    // An id that is not Google's number is never put into an address.
    expect(seoLinks.googleMaps({ cid: "1; drop", name: "X" })).toBe("https://www.google.com/maps/search/?api=1&query=X");
  });
});

describe("usage: every paid lookup opens the page that spent it, and nothing is guessed", () => {
  const sites = [{ id: 1, domain: "alpine.example", businessName: "Alpine Exteriors" }, { id: 2, domain: "beta.example", businessName: null }] as any[];
  it("the four kinds the first pass left as words", () => {
    expect(spentOn("Rendering check — alpine.example, 12 pages", sites)).toBe("/seo/audit?site=1&tab=rendering");
    expect(spentOn("Content gap — alpine.example vs a.com, b.com", sites)).toBe("/seo/explorer?domain=alpine.example&view=contentGap");
    expect(spentOn("Link intersect — alpine.example vs a.com", sites)).toBe("/seo/explorer?domain=alpine.example&view=linkIntersect");
    expect(spentOn("Batch analysis — 12 websites", sites)).toBe("/seo/batch");
    expect(spentOn("AI mentions — rival.com (ChatGPT)", sites)).toBe("/seo/ai?site=1&mentions=rival.com&platform=chat_gpt");
    expect(spentOn("AI mentions — beta.example (Google AI Overviews)", sites)).toBe("/seo/ai?site=2&mentions=beta.example&platform=google");
  });
  it("an AI question: its site from the label, a monthly one by its id, else its first 90 characters", () => {
    expect(spentOn('AI visibility — "best siding contractor in Bellingham" (ChatGPT, Perplexity) for beta.example', sites)).toBe("/seo/ai?site=2&prompt=best+siding+contractor+in+Bellingham");
    expect(spentOn('AI visibility — "who fixes roofs (fast)" (ChatGPT, monthly #12) for alpine.example', sites)).toBe("/seo/ai?site=1&question=12");
    // An older row names no site: with several sites it opens nothing rather than a wrong one.
    expect(spentOn('AI visibility — "best siding" (ChatGPT)', sites)).toBeNull();
    expect(spentOn('AI visibility — "best siding" (ChatGPT)', [sites[0]])).toBe("/seo/ai?site=1&prompt=best+siding");
    expect(spentOn('AI visibility — "x" (ChatGPT) for gone.example', sites)).toBeNull();
  });
  it("a snapshot or gap of a site no longer the account's opens nothing (the old fallbacks guessed)", () => {
    expect(spentOn("Backlink snapshot — gone.example (monthly)", sites)).toBeNull();
    expect(spentOn("Keyword snapshot — gone.example (now)", sites)).toBeNull();
    expect(spentOn("Competitor gap — gone.example vs rival.com", sites)).toBeNull();
    expect(spentOn("Backlink snapshot — alpine.example (refresh)", sites)).toBe("/seo/backlinks?site=1");
    expect(spentOn("Competitor gap — alpine.example vs rival.com", sites)).toBe("/seo/competitors?site=1&competitor=rival.com");
    expect(spentOn('Mentions watch — "Alpine Exteriors"', sites)).toBe("/seo/mentions?site=1");
  });
  it("round 3: the six paid kinds that were words open the page that spent them", () => {
    // Every report table the server names ("<name> — <target>") opens that report.
    const routes = fs.readFileSync(path.resolve(import.meta.dirname, "routes.ts"), "utf8");
    const block = /const REPORT_NAMES: Record<string, string> = \{([\s\S]*?)\n\};/.exec(routes)?.[1] ?? "";
    const names = [...block.matchAll(/(\w+): "([^"]+)"/g)].map((m) => [m[1], m[2]] as const);
    expect(names.length).toBeGreaterThanOrEqual(18);
    for (const [key, name] of names) {
      const idea = ["matchingTerms", "relatedTerms", "questions"].includes(key);
      expect(spentOn(`${name} — ${idea ? "roof repair" : "alpine.example"}`, sites), name).toBe(idea ? seoLinks.keywords("roof repair", { table: key }) : seoLinks.explorer("alpine.example", key));
    }
    expect(spentOn("Organic keywords — rival.com", sites)).toBe("/seo/explorer?domain=rival.com&view=keywords");
    expect(spentOn("Ads — rival.com", sites)).toBe("/seo/explorer?domain=rival.com&view=ads");
    expect(spentOn("Directories — alpine.example, a.com, b.com", sites)).toBe("/seo/explorer?domain=alpine.example&view=directories&rivals=a.com%2Cb.com");
    expect(spentOn("Directories — alpine.example", sites)).toBe("/seo/explorer?domain=alpine.example&view=directories&rivals=none");
    expect(spentOn("Directories — a.com (second try for alpine.example, a.com)", sites)).toBe("/seo/explorer?domain=alpine.example&view=directories&rivals=a.com");
    // An older second try names no comparison: nothing is guessed.
    expect(spentOn("Directories — a.com (second try)", sites)).toBeNull();
    expect(spentOn("Service-area planner — beta.example (3 × 5)", sites)).toBe("/seo/keywords?view=area&site=2");
    expect(spentOn("Service-area planner — gone.example (3 × 5)", sites)).toBeNull();
    expect(spentOn("Opportunities — alpine.example", sites)).toBe("/seo/explorer?domain=alpine.example&view=opportunities");
    expect(spentOn("Bulk keyword analysis — 12 keywords", sites)).toBe("/seo/keywords?view=bulk");
    // Labels that only look like "<name> — <target>" stay words.
    expect(spentOn("Content explorer — missing figures for 3 pages (second try)", sites)).toBeNull();
    expect(routes).toContain("`Directories — ${again.join(\", \")} (second try for ${sites.join(\", \")})`");
    for (const l of ["`Directories — ${sites.join(\", \")}`", "`Service-area planner — ${site.domain} (", "`Opportunities — ${domain}`", "`Bulk keyword analysis — ${keywords.length} keyword"]) expect(routes, l).toContain(l);
  });
  it("the server's labels carry the site and the monthly question's id", () => {
    const routes = fs.readFileSync(path.resolve(import.meta.dirname, "routes.ts"), "utf8"), monthly = fs.readFileSync(path.resolve(import.meta.dirname, "ai-monthly.ts"), "utf8");
    expect(routes).toContain('label: `AI visibility — "${input.prompt.slice(0, 90)}" (${engines.map((e) => AI_ENGINES[e].label).join(", ")}) for ${site.domain}`');
    expect(monthly).toContain('monthly #${t.id}) for ${site.domain}`');
  });
});

describe("the screens: every figure a link, honest chips, 44 px targets", () => {
  const viz = read("viz-more.tsx"), shell = code(read("shell.tsx"));
  const reports = code(read("reports.tsx")), grid = code(read("grid.tsx")), ai = code(read("ai.tsx")), summary = code(read("ai-summary.tsx"));
  const alerts = code(read("alerts.tsx")), plan = code(read("plan.tsx")), planButton = code(read("plan-button.tsx"));
  const mentions = code(read("mentions.tsx")), mentionsPage = code(read("mentions-page.tsx")), usage = code(read("usage.tsx"));
  const batch = code(read("batch.tsx")), competitors = code(read("competitors.tsx"));
  const all = { reports, grid, ai, summary, alerts, plan, planButton, mentions, mentionsPage, usage, batch, competitors };

  it("the link classes: 44 px, a cue without hover, a focus ring", () => {
    expect(viz).toContain('export const TAP = "inline-flex min-h-11 items-center gap-x-1"');
    expect(viz).toContain('export const LINK_CUE = "underline decoration-dotted underline-offset-2 hover:decoration-solid"');
    for (const k of ["FIGURE_LINK", "QUIET_LINK", "TEXT_LINK"]) expect(viz).toMatch(new RegExp(`export const ${k} = \`[^\`]*\\$\\{TAP\\} \\$\\{LINK_CUE\\} \\$\\{FOCUS_RING\\}\``));
    // LinkedFigure: the focus ring and the label's cue.
    expect(viz).toMatch(/<Link href=\{href\} className=\{`block min-w-0 rounded-md \$\{FOCUS_RING\}`\}/);
  });

  it("no hover-only link, no hand-written address, no link hidden in a closed disclosure", () => {
    for (const [name, s] of Object.entries(all)) {
      expect(s, name).not.toMatch(/className="[^"]*hover:underline/);
      expect(s, name).not.toMatch(/className="g-link"/);
      expect(s, name).not.toMatch(/href="\/(seo|settings|site-scan|search-console|pricing)/);
      expect(s, name).not.toMatch(/href=\{`\/seo/);
      expect(s, name).not.toContain("<details");
    }
  });

  it("shell: one writer of ?site=, tab strips that show there is more, Tile with an href", () => {
    expect(shell).toContain('onChange={(e) => { onSite(Number(e.target.value)); setParam("site", Number(e.target.value)); }}');
    expect(shell).toMatch(/export function TabStrip\(/);
    expect(shell).toContain("![scrollbar-width:thin]");
    expect(shell).toContain("[&>a]:min-h-11");
    expect(shell).toContain('<TabStrip label="SEO sections">');
    expect(shell).toMatch(/export function Tile\(\{ label, value, hint, testId, href \}/);
    for (const t of ["link-usage-balance", "link-usage-credit", "link-usage-keywords"]) expect(shell).toContain(`data-testid="${t}"`);
    expect(shell).toContain("inline-flex min-h-11 items-center gap-1 rounded-sm underline decoration-dotted");
    // Each page's own site change only drops its parameters in place; the picker writes ?site=.
    for (const s of [grid, ai, plan, reports]) expect(s).toMatch(/const changeSite = \(id: number\) => \{ clearParams\(\[?[^)]*\]?\); onSite\(id\); \};/);
  });

  it("reports: the grid line by its place in the report, the section chip only when it exists, keyword rows on screen", () => {
    expect(reports).toContain("const g = kwOf !== undefined ? r.grids?.[gridN++] : undefined;");
    expect(reports).toContain("const sectionHere = !!r && !!section && !!target && hasSection(r, section);");
    expect(reports).toContain("sectionHere ? `Jumped to: ${target!.words}`");
    expect(reports).toContain('const changeSite = (id: number) => { clearParams(["section"]); onSite(id); };');
    expect(reports).toContain("(allKeywords ? r.rankings.keywords : r.rankings.keywords.slice(0, KEYWORD_ROWS))");
    expect(reports).toContain("href={kw(k.keyword, dev, { mapPack: true })}");
    expect(reports).toContain("seoLinks.alerts({ site: site.id, kind: a.kind, alert: a.id })");
    expect(reports).toContain('seoLinks.plan(site.id, { due: "soon" })');
    expect(reports).toContain("seoLinks.plan(site.id, { owner: t.owner })");
    expect(reports).toContain("{ ...was, show: \"top3\" }");
    for (const t of ["link-report-all-keywords", "link-report-due-soon", "link-report-connect-gsc", "link-report-branding", "button-report-all-keywords"]) expect(reports).toContain(t);
  });

  it("reports, round 3: the Keywords checked bar links like the tiles, the section chip also on an empty report, a 44 px PDF pill", () => {
    expect(reports).toContain('testId="report-checked-dist"');
    expect(reports).toContain('segmentHref={(part) => part === "4-10" ? seoLinks.rankTracker(site.id, { positions: "4-10", device: dev }) : seoLinks.rankTracker(site.id, { band: part === "top3" ? "top3" : "rest", device: dev })}');
    for (const k of ['key: "top3"', 'key: "4-10"', 'key: "rest"']) expect(reports).toContain(k);
    expect(reports).toContain('{section && r && <ActiveFilter');
    expect(reports).toContain("is not in this report — the report has no numbers for");
    expect(reports).toContain('className="g-pill !min-h-11 w-full justify-center sm:w-auto"');
  });

  it("local grid: failed points, honest chip on a failed scan, Google's reviews on Google", () => {
    expect(grid).toContain('case "failed": return !!p.failed;');
    expect(grid).toContain('href={here({ show: "failed" })}');
    expect(grid).toContain("const waiting = !shown && openId != null && view.data?.status !== \"failed\" && !view.isError;");
    expect(grid).toContain("failed and ${failed === 1 ? \"is\" : \"are\"} not outlined");
    expect(grid).toContain("seoLinks.googleMaps({ cid: r.cid, name: r.name");
    expect(grid).toContain("href={seoLinks.googleMaps(l)}");
    expect(grid).toContain('data-testid="link-grid-pin-maps"');
    expect(grid).toContain("at(previous.id, { show: \"found\" })");
  });

  it("local grid, round 3: the key outlines one colour each, the picked point its colour, no-website rows say so in words", () => {
    expect(grid).toContain('["#f9ab00", "4–10", "4-10"], ["#e8710a", "11–20", "11-20"], ["#c5221f", "20+ not found", "notFound"]');
    expect(grid).not.toContain('"4–10", "found"');
    expect(grid).toContain('case "4-10": return p.rank !== null && p.rank >= 4 && p.rank <= 10;');
    expect(grid).toContain('case "notFound": return !p.failed && p.rank === null;');
    expect(grid).toContain("here({ show: bandOf(selected), cell: cell ?? undefined })");
    expect(grid).toContain('data-testid={`link-grid-key-${s}`}');
    // Visible words on a phone (a title never shows there), and no guessed link.
    expect(grid).toContain('· no website to open</span>');
    expect(grid).toContain("<>{l.name} <span className=\"g-text-2 text-[12px] font-normal\">(no website in Google's listing)</span></>");
  });

  it("AI visibility: every parameter read, nothing silently dropped, clear clears all", () => {
    for (const p of ["prompt", "question", "month", "assistant", "named", "cited", "first", "business", "source", "latest", "days", "vs", "mentions", "platform"]) expect(ai, p).toContain(`"${p}"`);
    expect(ai).toContain("— not a month (YYYY-MM), so not applied");
    expect(ai).toContain("so none match");
    expect(ai).toContain("— not true or false, so not applied");
    expect(ai).toContain('data-testid="ai-question-missing"');
    expect(ai).toContain('clearParams([...FILTER_PARAMS, "prompt", "question", "vs", "mentions", "platform"], false)');
    expect(ai).toContain('data-label="Question"');
    expect(ai).toContain('data-label="Assistant"');
    expect(ai).toContain('data-testid="button-ai-history"');
    // The like-for-like month is the address.
    expect(summary).toContain('onChange={(e) => setParam("vs", e.target.value)}');
    // The headline figures land on exactly the answers they count.
    expect(summary).toContain("seoLinks.ai(id, { latest: true, days: s.nowDays, ...p })");
    for (const f of ["nowWith({ named: true })", "nowWith({ cited: true })", "nowWith({ first: true })", "nowWith({ assistant: e.engine, named: true })", "nowWith({ business: b.name })", "nowWith({ source: x.domain })"]) expect(summary).toContain(f);
    expect(summary).toContain("Answers counted");
    expect(summary).toContain('data-testid="link-ai-sources-basis"');
  });

  it("AI visibility, round 3: a question opened alone is said, so its clear is there", () => {
    expect(ai).toContain("const questionWords = filtering || !d ? \"\" : promptParam !== null");
    expect(ai).toContain("One question: \"${shown.prompt}\"");
    expect(ai).toContain("— no saved answers to it for");
    expect(ai).toContain("so the newest question is shown");
    expect(ai).toMatch(/const chips = \[\s*questionWords,/);
    expect(summary).toContain('data-label={x.directory ? "Action plan" : undefined}');
  });

  it("alerts: per-item scans and checks, ?alert= / ?undelivered=, the keyword watch kept", () => {
    expect(alerts).not.toContain("a.items[0]");
    expect(alerts).toContain("items.length === 1 ? items[0] : undefined");
    expect(alerts).toContain("seoLinks.localGrid(a.siteId, { scan: i.wasScanId, show })");
    expect(alerts).toContain("seoLinks.mentions(a.siteId, i.checkId ? { check: i.checkId } : {})");
    expect(alerts).toContain('const alertParam = params.get("alert")');
    expect(alerts).toContain('params.get("undelivered")');
    expect(alerts).toContain("id={`alert-${a.id}`}");
    expect(alerts).toContain("...(alertId === a.id ? HIGHLIGHT : {})");
    expect(alerts).toContain("— not among the");
    expect(alerts).toContain('clearParams(["kind", "site", "alert", "undelivered", "more", "all"], false)');
    expect(alerts).toContain('<TabStrip label="Which alerts"');
    expect(alerts).toContain('className="g-pill g-pill--sm !min-h-11" disabled={read.isPending}');
    // The rank tracker's keyword-watch link stays (seoLinks.alerts now / before).
    expect(alerts).toContain("seoLinks.alerts({ site: a.siteId, kind: kind === \"all\" ? undefined : kind, now: i.snapshotId, before: i.beforeId })");
    for (const t of ["link-alert-date-", "link-alert-move-", "link-alert-scan-", "link-alert-check-", "link-alerts-undelivered", "link-alerts-settings"]) expect(alerts).toContain(t);
    // The server keeps both scans' ids with a grid alert.
    expect(fs.readFileSync(path.resolve(import.meta.dirname, "grid-monitor.ts"), "utf8")).toContain("scanId: now.id, wasScanId: before.id");
  });

  it("alerts, round 3: the reveals are addresses, the counts keep `undelivered`, a bad value is said", () => {
    // "Show all" and "Show more" are links (the back button undoes them); no local reveal state is left.
    expect(alerts).not.toContain("setAll(");
    expect(alerts).not.toMatch(/<button[^>]*data-testid="button-rank-alert-all"/);
    expect(alerts).toMatch(/<Link href=\{allHref\}[^>]*data-testid="button-rank-alert-all"/);
    expect(alerts).toMatch(/<Link href=\{allHref\}[^>]*data-testid="link-kw-alert-all"/);
    expect(alerts).toContain("const allHref = (id: number) => here({ all: allIds.has(id) ? [...allIds].filter((x) => x !== id) : [...allIds, id] });");
    expect(alerts).toMatch(/<Link href=\{here\(\{ more: shownPages \+ 1 \}\)\} className=\{`g-pill !min-h-11 \$\{FOCUS_RING\}`\} data-testid="button-alerts-more">/);
    expect(alerts).toContain('const moreParam = params.get("more");');
    expect(alerts).toContain("if (last) more.mutate({ url, before: last.id, key: loadKey });");
    expect(alerts).toContain('data-testid="button-alerts-more-retry"');
    expect(alerts).toContain("setParams({ site: e.target.value === \"site\" ? site.id : null, more: null })");
    // "Showing N of M": N keeps the undelivered narrowing it counts.
    expect(alerts).toContain('<Link href={undeliveredOnly ? seoLinks.alerts({ site: scopeSite, kind: kind === "all" ? undefined : kind, undelivered: true }) : tabHref(kind)} className={QUIET_LINK} data-testid="link-alerts-listed">');
    expect(alerts).toContain('undelivered="${undeliveredParam}" — not true or false, so not applied');
    expect(alerts).toContain('marked "Not sent" — or "Email not sent" when the bell entry went out and only the email failed.');
  });

  it("action plan: every parameter said (also ?status=open), due soon and owner, origins that exist", () => {
    expect(plan).toContain('list !== "open" || statusParam === "open" ? STATUS_WORDS[list] : ""');
    expect(plan).toContain("— not a task number");
    expect(plan).toContain('const OWN_PARAMS = ["task", "status", "kind", "due", "owner"];');
    expect(plan).toContain("seoLinks.plan(site.id, { owner: t.owner");
    expect(plan).toContain('if (s.startsWith("prospect:"))');
    expect(plan).toContain("seoLinks.alerts({ site: site.id, before: Number(m[1]), now: Number(m[2]) })");
    expect(plan).toContain('typeof t.facts.origin === "string"');
    expect(plan).toContain('<TabStrip label="Tasks">');
    expect(plan).toContain("const CHIP_LINK = `g-chip g-chip--sm ${TAP_PAD} ${LINK_CUE} ${FOCUS_RING}`;");
    expect(plan.match(/className="g-pill g-pill--sm !min-h-11"/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(planButton).toContain("seoLinks.plan(v.siteId)");
    expect(planButton).toContain("slice(0, cutSource ? 11 : 12)");
  });

  it("mentions: the chip says what is shown, the clear says where it lands, every cell opens its data", () => {
    expect(mentionsPage).toContain("— not available (it may belong to another site), so the newest check is shown");
    expect(mentionsPage).toContain("— not a check number, so the newest check is shown");
    expect(mentionsPage).toContain("clearLabel={`Newest check · ${TAB_LABEL.prospects}`}");
    expect(mentions).toContain("onCheck?.({ chosen: !!q.data.watch?.chosen, missing: !!q.data.watch?.missing })");
    expect(mentions).toContain("seoLinks.backlinks(siteId, { domain: r.domain })");
    expect(mentions).toContain('data-label="Is it you?"');
    expect(mentions).toContain('<TabStrip label="Which mentions">');
    expect(mentions).toContain('className="g-pill g-pill--sm !min-h-11 ml-auto" disabled={!rows.length} onClick={exportCsv} data-testid="button-mentions-export"');
  });

  it("mentions, round 3: a check is named only once it is known to be shown; the watch rows' link words link", () => {
    expect(mentionsPage).toContain("const known = checkState !== null && checkState.check === check ? checkState : null;");
    expect(mentionsPage).toContain(": missing || !known ? \"\" :");
    expect(mentionsPage).toContain("onCheck={(s) => setCheckState({ ...s, check })}");
    expect(mentionsPage).toContain("in the monthly watch below");
    expect(mentions).toContain('<label className="flex min-h-11 items-center gap-2"><input type="checkbox"');
    expect(mentions).toContain('data-testid={`link-mentions-watch-link-${r.domain}`}');
  });

  it("usage, batch, competitors", () => {
    expect(usage).toContain('import { spentOn } from "./usage-links";');
    expect(usage).toContain("set aside — still running");
    expect(usage).not.toContain('title="Still running');
    expect(usage).toContain('seoLinks.usage({ credits: "add" })} className={FIGURE_LINK}');
    expect(batch).toContain('data-testid="select-batch-sort"');
    expect(batch).toContain('className="g-pill g-pill--sm !min-h-11 ml-auto" onClick={exportCsv}');
    expect(competitors).toContain('seoLinks.keywords(g.keyword, { section: "cpc" })');
    expect(competitors).toContain('clearParams(["competitor"], false); setCompetitor(""); gap.reset();');
    expect(competitors).toContain('className="g-pill !min-h-11" disabled={track.isPending}');
    // Round 3: the batch meta line links (the table; the month it was charged), the Track cell has its phone label.
    expect(batch).toContain('href={seoLinks.usage({ month: page.fetchedAt.slice(0, 7) })}');
    for (const t of ["link-batch-count", "link-batch-as-of"]) expect(batch).toContain(`data-testid="${t}"`);
    expect(batch).toContain('<table id="table-batch"');
    expect(competitors).toContain('<td className="num" data-label="Rank tracker">');
  });
});
