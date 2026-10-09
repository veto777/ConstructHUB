/**
 * The rank tracker's place box (client/src/pages/seo/location-picker.tsx, used by the "Add keywords" form in
 * client/src/pages/seo/index.tsx): a town typed there but never chosen from the list must not go out as "no place" —
 * that would quietly make the check a country-wide one (audit #55). Enter is guarded inside the box; this covers the
 * form itself (a click on "Track these", or Enter from another control). Pure module + source guard, no browser.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { unresolvedPlaceMessage } from "@shared/seo-place";

const read = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, "../../client/src/pages/seo", rel), "utf8");
/** Comments aside; only code counts. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("a typed town that was never chosen", () => {
  it("is a problem the form names; nothing typed is no problem", () => {
    expect(unresolvedPlaceMessage("", "the site's default (United States)")).toBeNull();
    expect(unresolvedPlaceMessage("   ", "the site's default (United States)")).toBeNull();
    expect(unresolvedPlaceMessage(" Tampa ", "the site's default (United States)")).toBe("\"Tampa\" isn't a chosen place yet: pick it from the list, or clear the box to check from the site's default (United States).");
    expect(unresolvedPlaceMessage("Kelowna", "the site's default (Canada)")).toMatch(/check from the site's default \(Canada\)\.$/);
  });

  it("the form stops before sending and the picker links an announced message to its box", () => {
    const form = code(read("index.tsx")), picker = code(read("location-picker.tsx"));
    // The form: a submit goes through one gate that asks the shared rule before the request, with the typed text the picker reported.
    const submit = form.slice(form.indexOf("const submit = () =>"), form.indexOf("m.mutate();", form.indexOf("const submit = () =>")));
    expect(submit).toMatch(/unresolvedPlaceMessage\(typed, defaultLabel\)/);
    expect(submit).toMatch(/setPlaceError\(problem\); return;/);
    expect(form).toMatch(/onSubmit=\{\(e\) => \{ e\.preventDefault\(\); submit\(\); \}\} data-testid="form-add-keywords"/);
    const picked = form.slice(form.indexOf("<LocationPicker "), form.indexOf("/>", form.indexOf("<LocationPicker ")));
    expect(picked).toMatch(/onTyped=\{\(t\) => \{ setTyped\(t\);/);
    expect(picked).toMatch(/error=\{placeError\}/);
    // The picker: the typed text is reported on every change and cleared on a pick; the message is under the box, linked
    // (aria-describedby + aria-invalid) and announced (role="alert").
    expect(picker).toMatch(/const type = \(v: string\) => \{ setText\(v\); onTyped\?\.\(v\.trim\(\)\); \}/);
    expect(picker).toMatch(/const clear = \(\) => \{[^}]*onTyped\?\.\(""\); \}/);
    expect(picker).toMatch(/const pick = \(p: Place\) => \{ onChange\(p\); clear\(\); \}/);
    expect(picker).toMatch(/aria-invalid=\{error \? true : undefined\} aria-describedby=\{error \? `\$\{id\}-error` : undefined\}/);
    expect(picker).toMatch(/<p id=\{`\$\{id\}-error`\} role="alert"/);
    // Enter inside the box stays guarded: it picks the highlighted place or does nothing, never submits the text.
    expect(picker).toMatch(/if \(e\.key === "Enter" && text\.trim\(\)\) \{ e\.preventDefault\(\);/);
  });
});

/*
 * "All data takes you somewhere" (owner 2026-10-09), audit round 2 (Kimi): every figure, label, cell, count, delta,
 * legend entry and row on the rank tracker is a link built by seoLinks that lands on its data with the filter applied,
 * the page honours every parameter and says so in a chip, every control writes the address, and on a phone every link
 * is a 44 px target with a cue that needs no hover. Source pins of docs/seo-links/rank-tracker.md, plus the pure
 * parameter reader (rank-params.ts).
 */
import { seoLinks } from "../../client/src/pages/seo/links";
import { keepsRow, narrowingWords, parseRankParams, scopeOf, withFeature } from "../../client/src/pages/seo/rank-params";

describe("the rank tracker address (links.ts), appended parameters", () => {
  it("writes the panels' own controls and the new narrowings; the Search Console connection has a builder", () => {
    expect(seoLinks.rankTracker(3, { location: "Tampa, Florida", noMap: true, checked: true })).toBe("/seo/rank-tracker?site=3&location=Tampa%2C+Florida&noMap=true&checked=true");
    expect(seoLinks.rankTracker(3, { gsc: "query", gscSort: "gain", gscAll: true })).toBe("/seo/rank-tracker?site=3&gsc=query&gscSort=gain&gscAll=true");
    expect(seoLinks.rankTracker(3, { group: 5, groupsAll: true, competing: 7, competingShow: "variants" })).toBe("/seo/rank-tracker?site=3&group=5&groupsAll=true&competing=7&competingShow=variants");
    expect(seoLinks.rankTracker(3, { feature: "ai_overview,local_pack", band: "top10" })).toBe("/seo/rank-tracker?site=3&feature=ai_overview%2Clocal_pack&band=top10");
    expect(seoLinks.searchConsole()).toBe("/search-console");
    expect(seoLinks.rankTracker(3, { noVolume: true, device: "mobile" })).toBe("/seo/rank-tracker?site=3&noVolume=true&device=mobile");
    expect(seoLinks.alerts({ site: 3, now: 9, before: 8, watch: "gone", watchAll: true })).toBe("/seo/alerts?site=3&now=9&before=8&watch=gone&watchAll=true");
  });
});

describe("the address is read in full and said in the chip (rank-params.ts)", () => {
  const words = (t: string) => ({ ai_overview: "an AI overview", featured_snippet: "a featured snippet" } as Record<string, string>)[t] ?? t;
  it("a map pack, a device, the history's figure and check: each is read, and only a narrowing makes the table's chip", () => {
    const map = parseRankParams("?site=3&mapPack=true");
    expect(map).toMatchObject({ site: 3, mapPack: true, narrowed: true });
    expect(narrowingWords(map, "desktop", words)).toBe("Keywords whose results show a map pack · desktop");
    const dev = parseRankParams("?site=3&device=desktop&keyword=roof+repair");
    expect(dev).toMatchObject({ device: "desktop", keyword: "roof repair", narrowed: true });
    expect(narrowingWords(dev, "desktop", words)).toBe("All keywords — “roof repair” highlighted · desktop");
    expect(narrowingWords(parseRankParams("?site=3&device=desktop"), "mobile", words, "desktop")).toBe("All keywords · mobile (desktop is not tracked for this site)");
    const hist = parseRankParams("?site=3&panel=history&series=visibility&date=2026-10-08");
    expect(hist).toMatchObject({ panel: "history", series: "visibility", date: "2026-10-08", narrowed: false });
  });
  it("the appended narrowings, a feature list, and the panels' controls", () => {
    const p = parseRankParams("?site=3&location=Tampa%2C+Florida&noMap=1&checked=true&feature=ai_overview%2Cfeatured_snippet&gsc=query&gscSort=loss&gscAll=true&group=5&groupsAll=yes&competing=7&competingShow=changed");
    expect(p).toMatchObject({ location: "Tampa, Florida", noMap: true, checked: true, features: ["ai_overview", "featured_snippet"], gsc: "query", gscSort: "loss", gscAll: true, group: 5, groupsAll: true, competing: 7, competingShow: "changed", narrowed: true });
    expect(narrowingWords(p, null, words)).toBe("Keywords checked from “Tampa, Florida”, with a saved check, whose results show an AI overview and a featured snippet, whose results show no map pack");
    expect(parseRankParams("?gsc=nope&gscSort=up&group=0&competingShow=x")).toMatchObject({ gsc: null, gscSort: null, group: null, competingShow: null });
  });
  it("a count made over the narrowed rows carries the narrowing, and adds its feature to the list", () => {
    const p = parseRankParams("?site=3&band=top10&tag=roofing&device=mobile&feature=ai_overview&keyword=x&panel=keywords");
    expect(scopeOf(p)).toEqual({ device: "mobile", band: "top10", tag: "roofing", feature: "ai_overview" });
    expect(withFeature("ai_overview", "featured_snippet")).toBe("ai_overview,featured_snippet");
    expect(withFeature("ai_overview", "ai_overview")).toBe("ai_overview");
    expect(withFeature(null, "local_pack")).toBe("local_pack");
    expect(seoLinks.rankTracker(3, { ...scopeOf(p), feature: withFeature(p.feature, "featured_snippet") })).toBe("/seo/rank-tracker?site=3&device=mobile&band=top10&tag=roofing&feature=ai_overview%2Cfeatured_snippet");
  });
  it("'no volume yet' is a narrowing: read, kept by the scope, said in the chip, and it keeps only the rows with no volume", () => {
    const p = parseRankParams("?site=3&noVolume=true");
    expect(p).toMatchObject({ noVolume: true, narrowed: true });
    expect(scopeOf(p)).toEqual({ noVolume: true });
    expect(narrowingWords(p, null, words)).toBe("Keywords with no monthly search volume yet");
    const row = (searchVolume: number | null) => ({ tags: [], searchVolume, positions: { desktop: null } });
    expect(keepsRow(row(null), p, "desktop")).toBe(true);
    expect(keepsRow(row(320), p, "desktop")).toBe(false);
    expect(keepsRow(row(320), parseRankParams("?site=3"), "desktop")).toBe(true);
  });
});

describe("every figure on the rank tracker is a link that lands on its data (audit round 2)", () => {
  const page = code(read("index.tsx")), history = code(read("rank-history.tsx")), tags = code(read("rank-tags.tsx")), voice = code(read("rank-competitors.tsx"));
  const groups = code(read("serp-groups.tsx")), gsc = code(read("gsc-breakdown.tsx")), competing = code(read("competing.tsx")), viz = code(read("viz-rank.tsx")), chips = code(read("serp-features.tsx"));
  const watch = code(read("keyword-watch.tsx")), alerts = code(read("alerts.tsx")), params = code(read("rank-params.ts"));

  it("the page: tile feet, recent checks, the no-volume count, a row's place and 'no map', and the counts carry the narrowing", () => {
    expect(page).toContain('id="gsc-before"');
    expect(page).toContain('id="gsc-position"');
    expect(page).toContain('id="next-check-serps"');
    expect(page).toContain('to({ panel: "history", date: utcDay(r.created_at) })');
    expect(page).toContain('data-testid={`link-recent-check-${r.id}`}');
    expect(page).toContain('data-testid="link-no-volume"');
    expect(page).toContain("to({ ...onDevice, noVolume: true })");
    expect(page).not.toContain('seoLinks.keywords("", { view: "bulk" })');
    expect(page).toContain('id="table-shown"');
    expect(page).toContain('id="table-all"');
    expect(page).toContain('id="visibility-basis"');
    expect(page).toContain("data-testid={`link-serp-title-${r.id}-${t.position}`}");
    expect(page).not.toMatch(/<span title="No website on Google's listing">/);
    expect(page).toContain('to({ ...onDevice, location: r.location })');
    expect(page).toContain('to({ ...onDevice, noMap: true })');
    expect(page).toContain('to({ ...onDevice, tag: t })');
    expect(page).toContain("data-testid={`link-row-tag-${r.id}-${slug(t)}`}");
    expect(page).toContain("to({ ...scope, feature: withFeature(scope.feature, t) })");
    expect(page).toContain("to({ ...scope, mapPack: true })");
    expect(page).toContain("to({ ...scope, checked: true })");
    expect(page).toContain("data-testid={`link-pack-${r.id}-${p.position}`}");
    expect(page).toContain("data-testid={`link-serp-${r.id}-${t.position}`}");
    expect(page).toContain("<KeywordHistory id={r.id} devices={o.devices} href={history} />");
  });

  it("the page: no raw address, the site written by the shell alone, the chip there with no keywords and honest about an untracked device", () => {
    expect(page).not.toMatch(/href="\/search-console"|href="\/seo\/keywords"|href="\/seo\//);
    expect(page).toContain("seoLinks.searchConsole()");
    expect(page).not.toContain('setParam("site"');
    expect(page).not.toMatch(/\bsetParam\(/);
    expect(page.indexOf('data-testid="rank-filter"')).toBeLessThan(page.indexOf('testId="seo-empty-keywords"'));
    expect(page).toContain("params.device && !o.devices.includes(params.device) ? params.device : null");
    expect(page).toContain('data-testid="active-filter"');
  });

  it("history: a chip for the figure and the check, a list of dated checks, every date and cell a link, '—' for an unmeasured map pack, the configured frequency", () => {
    expect(history).toContain('data-testid="active-filter"');
    expect(history).toContain('data-testid="link-clear-history"');
    expect(history).toContain("SERIES_WORDS[p.series]");
    expect(history).toContain("no check was saved on");
    expect(history).toContain('data-testid="list-checks"');
    expect(history).toContain("data-testid={`link-check-${d.date}`}");
    expect(history).toContain("data-testid={`link-history-date-${d.date}`}");
    expect(history).toContain("`link-kw-history-date-${id}-${p.date}`");
    expect(history).toContain("`link-kw-history-${d}-${id}-${p.date}`");
    // The ranking page in a keyword's history opens in Site explorer (a builder), not as a raw address.
    expect(history).toContain("data-testid={`link-kw-history-page-${id}-${p.date}`}");
    expect(history).not.toMatch(/<a href=\{p\.url\}/);
    // The checks beyond the newest ten are a link too; a band cell of 0 is a link like any other.
    expect(history).toContain('data-testid="link-checks-earlier"');
    expect(history).not.toMatch(/: d\[b\.key\]\}<\/td>/);
    // The chip is said even when there is no check to show it on; "(none)" is not carried by a count.
    expect(history.indexOf("const chip = ")).toBeLessThan(history.indexOf("if (h.days.length === 0 && !tag"));
    expect(history).toContain("no check is saved yet");
    expect(history).toContain("...(tag ? { tag } : {})");
    expect(history).toMatch(/d\.mapPack == null \? <span title="The map pack was not measured in this check">—<\/span>/);
    expect(history).not.toContain("d.mapPack == null ? 0");
    expect(history).toContain('EVERY[site.rankFrequency ?? "weekly"]');
    expect(history).not.toContain("next weekly check");
    expect(history).toContain("<option value={NO_TAG}>");
    expect(history).toContain('data-testid="text-history-notag"');
    expect(viz).toContain("data-testid={`${testId ?? \"trend\"}-first`}");
    expect(viz).toContain("data-testid={`${testId ?? \"trend\"}-last`}");
  });

  it("the panels: tags' checked / both-times / deltas, competitors' observed count, groups' not-found, GSC cells, competing dates", () => {
    expect(tags).toContain("data-testid={`link-tag-checked-${id(r)}`}");
    expect(tags).toContain("data-testid={`link-tag-both-${id(r)}`}");
    expect(tags).toContain("testId={`link-tag-visibility-change-${id(r)}`}");
    expect(tags).toContain("testId={`link-tag-top10-change-${id(r)}`}");
    expect(tags).not.toContain(": fmtNum(r.top10)}");
    expect(tags).not.toContain(": fmtNum(r.newSince)}");
    expect(tags).toContain("spanWords(d.now, \"now\")");
    expect(voice).toContain("data-testid={`link-map-leader-name-${i}`}");
    expect(groups).toContain("data-testid={`link-group-member-shared-${m.keywordId}`}");
    expect(groups).toContain("button-group-recorded-");
    expect(competing).toContain("testId={`link-competing-variant-${i.keywordId}-${v}-${n}`}");
    expect(competing).toContain('data-testid="link-competing-days"');
    expect(competing).toContain("data-testid={`link-competing-device-${i.keywordId}`}");
    for (const id of ["link-gsc-property", "link-gsc-through", "link-gsc-days", "link-gsc-days-before"]) expect(gsc, id).toContain(`data-testid="${id}"`);
    expect(tags).toContain("`t-${slug(r.tag)}`");
    expect(voice).toContain("data-testid={`link-voice-observed-${id(d.domain)}`}");
    expect(voice).toContain("data-testid={`link-voice-top10-${id(d.domain)}`}");
    expect(voice).toContain("data-testid={`link-voice-share-${id(d.domain)}`}");
    expect(voice).toContain("data-testid={`link-seen-figures-${id(s.domain)}`}");
    expect(voice).toContain("data-testid={`link-map-leader-keywords-${i}`}");
    expect(voice).toContain('data-testid="text-voice-notag"');
    expect(voice).toContain("<option value={NO_TAG}>");
    expect(groups).toContain('to({ band: "notFound" })');
    expect(groups).toContain("data-testid={`link-group-notfound-${id}`}");
    expect(groups).toContain("`link-group-from-${id}`");
    expect(groups).toContain('data-testid="link-serp-compared"');
    for (const id of ["clicks", "clicks-before", "change", "impressions", "position", "position-before"]) expect(gsc, id).toContain(`"${id}"`);
    expect(gsc).toContain("data-testid={`link-gsc-${id}-${i}`}");
    expect(competing).toContain("`link-competing-first-${i.keywordId}`");
    expect(competing).toContain("data-testid={`link-competing-lastposition-${i.keywordId}`}");
    expect(competing).toContain("data-testid={`link-competing-times-${i.keywordId}-${n}`}");
    expect(competing).toContain("data-testid={`link-competing-location-${i.keywordId}`}");
  });

  it("the panels' own controls are the address (no local reveal state), and 'checked' reads the address", () => {
    expect(gsc).toContain('const dimension = p.gsc ?? "page", sort: Sort = p.gscSort ?? "clicks"');
    expect(gsc).toContain('setParam("gscSort"');
    expect(gsc).toContain("hrefWith({ gscAll: true })");
    expect(gsc).toContain('hrefWith({ gsc: x === "page" ? null : x, gscAll: null })');
    expect(groups).toContain("const open = p.group, all = p.groupsAll");
    expect(groups).toContain('setParam("group"');
    // A count that opens a group is a link to the address with the group set; a group the address opens is always shown.
    expect(groups).toContain("<Link href={hrefWith({ group: isOpen ? null : id })}");
    expect(groups).not.toMatch(/const reveal = [^;]*<button/);
    expect(groups).toContain("g.members[0].keywordId === open");
    expect(groups).not.toContain(': "#"');
    expect(groups).toContain("hrefWith({ groupsAll: all ? null : true })");
    expect(competing).toContain("const open = p.competing;");
    expect(competing).toContain("const more = p.competingShow ??");
    expect(competing).toContain('setParam("competing"');
    expect(competing).toContain("hrefWith({ competingShow: more === k ? null : k");
    expect(competing).toContain("<Link href={hrefWith({ competing: isOpen ? null : i.keywordId })}");
    for (const f of [gsc, groups, competing]) expect(f).not.toMatch(/\buseState\b/);
    expect(params).toContain("if (p.checked && !pos) return false;");
    expect(params).toContain("if (p.noMap && (!pos || showsMapPack(pos))) return false;");
    expect(params).toContain("if (p.location && (r.location ?? null) !== p.location) return false;");
  });

  it("on a phone every link is a 44 px target with a cue that needs no hover, and focus is visible", () => {
    const link = viz.match(/export const LINK = "([^"]+)"/)![1];
    expect(link).toContain("!underline decoration-dotted");
    expect(link).toContain("focus-visible:decoration-solid");
    expect(link).toContain("max-sm:min-h-11");
    expect(viz.match(/export const TAP = "([^"]+)"/)![1]).toContain("max-sm:!min-h-11");
    expect(chips.match(/const CHIP = "([^"]+)"/)![1]).toContain("max-sm:min-h-11");
    expect(viz).toContain('className="!min-h-7 rounded-md border px-2.5 py-0.5 text-[12px] transition-colors max-sm:!min-h-11"');
    // The distribution bar: each segment a 44 px hit area at phone width around its stripe; every legend entry a link, 0 too.
    const bar = viz.slice(viz.indexOf("export function LinkedDistributionBar"));
    expect(bar).toContain('className="group flex items-center rounded-sm max-sm:min-h-11"');
    expect(bar).not.toMatch(/p\.value > 0\s*\?\s*<Link/);
    expect(bar).not.toMatch(/tabIndex=\{-1\}|aria-hidden><Link/);
    // The remove button and the row buttons in the table.
    expect(page).toContain('className="g-pill g-pill--danger !min-h-8 !px-2 max-sm:!min-h-11"');
    expect(page).toContain("className={`g-link ${TAP}`}");
    // Every link on these files uses the cue, not the bare class.
    for (const [name, f] of Object.entries({ page, history, tags, voice, groups, gsc, competing, watch })) expect(f, name).not.toMatch(/<Link [^>]*className="g-link"/);
    // A delta keeps the underline cue too (its colour is green or red; the cue is the link's).
    for (const [name, f] of Object.entries({ page, history, tags, voice, groups, gsc, competing, watch, viz })) expect(f, name).not.toContain("!no-underline");
    // One history check alone has its own id (the list of checks carries link-check-<date>).
    expect(history).toContain("`link-only-check-${first.date}`");
  });

  it("the keyword watch (on Alerts): the pair, the list and 'show all' are the address, every figure leads somewhere, and 'Open this comparison' is a link", () => {
    expect(watch).toContain('const watchParam = address.get("watch")');
    expect(watch).toContain('address.get("watchAll")');
    expect(watch).not.toMatch(/useState<"added"|setShown|setTab/);
    expect(watch).toContain("<Link key={k} href={tabHref(k)}");
    expect(watch).toContain("hrefWith({ watchAll: true })");
    expect(watch).toContain('data-testid="active-filter"');
    expect(watch).toContain('data-testid="link-kw-newest"');
    // "Back to the newest two" is the link alone: no second write of the address beside it (one history entry).
    expect(watch).not.toMatch(/onClick=\{\(\) => onPick\??\.?\(null\)\}/);
    expect(watch).toContain('data-testid="link-kw-latest-date"');
    for (const id of ["link-kw-latest", "link-kw-next", "link-kw-since", "link-kw-added", "link-kw-gone"]) expect(watch, id).toContain(`data-testid="${id}"`);
    expect(watch).toContain("data-testid={`link-kw-${tab}-${n}`}");
    expect(watch).toContain("data-testid={`link-kw-${tab}-position-${n}`}");
    expect(watch).toContain("data-testid={`link-kwpage-${id}-${n}`}");
    expect(watch).toContain("seoLinks.keywords(k.keyword, marketParams(x))");
    expect(watch).toContain('seoLinks.explorer(site.domain, "keywords"');
    expect(watch).toContain('seoLinks.explorer(site.domain, "pages", { path })');
    // Nothing is bought by arriving: the one POST that spends is the snapshot button's.
    expect(watch.match(/snap\.mutate\(/g)).toHaveLength(1);
    expect(alerts).toContain('data-testid="link-kw-alert-open"');
    expect(alerts).toContain("seoLinks.alerts({ site: a.siteId, kind: kind === \"all\" ? undefined : kind, now: i.snapshotId, before: i.beforeId })");
    expect(alerts).toContain('const kwNow = Number(params.get("now")) || null, kwBefore = Number(params.get("before")) || null');
    expect(alerts).not.toMatch(/useState<KwPick/);
  });
});
