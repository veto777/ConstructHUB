/**
 * The Property records county map (client/src/components/property-map.tsx) joins offices to us-atlas
 * county shapes by real identifiers only: state FIPS + normalised county name. This reports the match
 * rate and lists the unmatched offices for (1) the offices the appraiser seed actually stores (a replay
 * of server/seed-all-appraisers.ts over the counties directory) and (2) the whole NETR source file, and
 * pins the hard cases (independent cities, St./Saint, parishes, Alaska, CT, DC) to their FIPS codes.
 * An office that does not match stays list-only: nothing here may invent a county.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  buildCountyIndex, countyDisplayName, matchCountyFips, normalizeCountyName, summarizeCoverage,
  TOWN_ASSESSED_STATES, USPS_FIPS,
} from "../../client/src/components/property-map-geo";
import { FIPS_USPS } from "../../client/src/components/permit-map-geo";
import { propertyOfficeLinks } from "../../client/src/pages/property-display";
import { normCounty } from "../county-name";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.resolve(root, rel), "utf8");
const topo = JSON.parse(read("client/public/us-counties-10m.json"));
const shapes = topo.objects.counties.geometries.map((g: any) => ({ id: String(g.id), name: String(g.properties?.name ?? "") }));
const index = buildCountyIndex(shapes);
const source: { stateCode: string; county: string; name: string; linkStatus: string }[] = JSON.parse(read("server/data/appraisers.json"));

/** The offices the seed stores: NETR rows joined to the counties directory the way syncAppraiserRecords does. */
function seededOffices() {
  const directory = [...read("server/seed-all-counties.ts").matchAll(/\{ name: "([^"]+)", state: "[^"]+", stateCode: "([A-Z]{2})" \}/g)]
    .map((m) => ({ name: m[1], stateCode: m[2] }));
  const fx = JSON.parse(read("server/data/county-fixes.json"));
  for (const r of fx.countyRenames) for (const c of directory)
    if (c.stateCode === r.state && c.name === r.from && !directory.some((x) => x.stateCode === r.state && x.name === r.to)) c.name = r.to;
  for (const a of fx.countyAdds) if (!directory.some((x) => x.stateCode === a.state && x.name === a.name)) directory.push({ name: a.name, stateCode: a.state });
  const byKey = new Map(directory.map((c) => [`${c.stateCode}|${normCounty(c.name)}`, c]));
  const covered = new Set<string>();
  const out: { office: string; county: { name: string; stateCode: string } }[] = [];
  for (const r of source) {
    const c = byKey.get(`${r.stateCode}|${normCounty(r.county)}`);
    if (!c) continue;
    const k = `${c.stateCode}|${c.name}`;
    if (covered.has(k)) continue;
    covered.add(k);
    out.push({ office: r.name, county: c });
  }
  return { directory, offices: out };
}

const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(2)}%`;

describe("us-counties-10m.json", () => {
  it("has one shape per FIPS code and indexes every county the map draws (50 states + DC)", () => {
    const ids = shapes.map((s: any) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const drawn = shapes.filter((s: any) => FIPS_USPS[s.id.slice(0, 2)]);
    expect(drawn.length).toBe(3142);
    let indexed = 0;
    for (const byName of index.values()) for (const list of byName.values()) indexed += list.length;
    expect(indexed).toBe(drawn.length);
    // Same us-atlas release as the permit map's states file.
    expect(JSON.stringify(topo.objects.states.geometries.map((g: any) => g.id).sort()))
      .toBe(JSON.stringify(JSON.parse(read("client/public/us-states-10m.json")).objects.states.geometries.map((g: any) => g.id).sort()));
  });
});

describe("matchCountyFips — real identifiers only", () => {
  it.each([
    ["VA", "Richmond", "51159"], ["VA", "Richmond City", "51760"], ["VA", "Roanoke", "51161"], ["VA", "Roanoke City", "51770"],
    ["VA", "Fairfax", "51059"], ["VA", "Fairfax City", "51600"], ["VA", "Franklin", "51067"], ["VA", "Franklin City", "51620"],
    ["VA", "Alexandria City", "51510"], ["VA", "Alexandria", "51510"], ["VA", "Charles City", "51036"], ["VA", "James City", "51095"],
    ["MD", "Baltimore", "24005"], ["MD", "Baltimore City", "24510"], ["MD", "Prince Georges", "24033"], ["MD", "St. Mary's", "24037"],
    ["MO", "St. Louis", "29189"], ["MO", "St. Louis County", "29189"], ["MO", "St. Louis City", "29510"], ["MO", "Ste. Genevieve", "29186"],
    ["MO", "St. Francois", "29187"], ["NV", "Carson City", "32510"], ["NY", "St. Lawrence", "36089"], ["WI", "St. Croix", "55109"],
    ["LA", "St. John the Baptist", "22095"], ["LA", "Orleans Parish", "22071"], ["LA", "LaSalle", "22059"], ["NM", "Dona Ana", "35013"],
    ["IA", "O'Brien", "19141"], ["DC", "District of Columbia", "11001"], ["CT", "Tolland", "09013"], ["CT", "Fairfield", "09001"],
    ["AK", "Juneau City and", "02110"], ["AK", "Sitka City and", "02220"], ["AK", "Kenai Peninsula Borough", "02122"],
    ["AK", "Bethel Census Area", "02050"], ["AK", "Kusilvak", "02158"], ["AK", "Anchorage", "02020"], ["AL", "St. Clair", "01115"],
  ])("%s %s -> %s", (st, name, fips) => {
    expect(matchCountyFips(index, st, name)).toBe(fips);
  });

  it.each([
    ["AK", "Craig (City of)"], ["AK", "Fairbanks District"], ["AK", "Chugach"], ["AK", "Copper River"], ["AK", "Wade Hampton"],
    ["VA", "Clifton Forge City"], ["VA", "Bedford City"], ["MA", "Boxborough"], ["AR", "Arkansas (Northern District)"],
    ["XX", "Orange"], ["PR", "San Juan"], ["TX", ""], ["TX", null],
  ])("%s %s stays unmatched", (st, name) => {
    expect(matchCountyFips(index, st, name as string | null)).toBeNull();
  });

  it("normalises spelling only, never meaning", () => {
    expect(normalizeCountyName("Prince George's County")).toBe(normalizeCountyName("Prince Georges"));
    expect(normalizeCountyName("St. Charles Parish")).toBe("saintcharles");
    expect(normalizeCountyName("Ste. Genevieve")).toBe("saintegenevieve");
    expect(normalizeCountyName("Doña Ana")).toBe("donaana");
    expect(normalizeCountyName("Charles City")).toBe("charlescity"); // a county, kept whole
    expect(USPS_FIPS.VA).toBe("51");
    expect(countyDisplayName("51760", "Richmond")).toBe("Richmond (city)");
    expect(countyDisplayName("22071", "Orleans")).toBe("Orleans Parish");
    expect(countyDisplayName("02110", "Juneau")).toBe("Juneau");
    expect(countyDisplayName("32510", "Carson City")).toBe("Carson City");
  });
});

describe("match report", () => {
  it("places every office the seed stores outside New England, and lists the rest", () => {
    const { offices } = seededOffices();
    const town = offices.filter((o) => TOWN_ASSESSED_STATES.has(o.county.stateCode));
    const rest = offices.filter((o) => !TOWN_ASSESSED_STATES.has(o.county.stateCode));
    const unmatched = rest.filter((o) => !matchCountyFips(index, o.county.stateCode, o.county.name));
    const fipsSeen = new Map<string, string>();
    for (const o of rest) {
      const f = matchCountyFips(index, o.county.stateCode, o.county.name);
      if (!f) continue;
      // One counties-directory row per shape: two different rows on one shape would be a guess.
      expect(fipsSeen.get(f) ?? `${o.county.stateCode}|${o.county.name}`, `two rows on ${f}`).toBe(`${o.county.stateCode}|${o.county.name}`);
      fipsSeen.set(f, `${o.county.stateCode}|${o.county.name}`);
      expect(f.slice(0, 2)).toBe(USPS_FIPS[o.county.stateCode]);
    }
    console.log(`[property map] seeded offices: ${offices.length}; New England (town-assessed, list only): ${town.length}; ` +
      `matched ${rest.length - unmatched.length}/${rest.length} (${pct(rest.length - unmatched.length, rest.length)}); unmatched: ${unmatched.map((o) => `${o.county.stateCode}:${o.county.name}`).join(", ") || "none"}`);
    expect(offices.length).toBeGreaterThan(3000);
    expect(unmatched).toEqual([]);
  });

  it("reports the whole NETR source file (towns, city offices and split districts stay list-only)", () => {
    const rest = source.filter((r) => !TOWN_ASSESSED_STATES.has(r.stateCode));
    const unmatched = rest.filter((r) => !matchCountyFips(index, r.stateCode, r.county));
    const byState: Record<string, string[]> = {};
    for (const r of unmatched) (byState[r.stateCode] ??= []).push(r.county);
    console.log(`[property map] NETR source: ${source.length} offices; New England list-only: ${source.length - rest.length}; ` +
      `matched ${rest.length - unmatched.length}/${rest.length} (${pct(rest.length - unmatched.length, rest.length)}); unmatched ${unmatched.length}:\n` +
      Object.entries(byState).map(([st, names]) => `  ${st} (${names.length}): ${names.join("; ")}`).join("\n"));
    // Outside Alaska (cities, old recording districts, places) and the split-district offices
    // ("Arkansas (Northern District)", "Barbour (Eufaula)"), what is left are the source's own spellings:
    // not guessed into a county here. The seed reaches Oglala Lakota and Dona Ana by their Census names.
    expect(unmatched.filter((r) => r.stateCode !== "AK" && !/\(|District/.test(r.county)).map((r) => `${r.stateCode}:${r.county}`).sort())
      .toEqual(["DC:Washington", "LA:West Felician", "MO:St. Genevieve", "SD:Shannon", "VA:Clifton Forge City"]);
    expect(unmatched.length).toBeLessThanOrEqual(98);
  });
});

describe("county shading mirrors the list row", () => {
  const base = { isActive: true, linkStatus: "verified", portalUrl: "https://county.gov/a", searchUrl: "https://county.gov/a", phone: "(555) 010-0000" };
  it("site only when the row shows an Open portal / Search records pill", () => {
    expect(propertyOfficeLinks(base).shade).toBe("site");
    expect(propertyOfficeLinks({ ...base, linkStatus: "unconfirmed" }).shade).toBe("site");
    expect(propertyOfficeLinks({ ...base, linkStatus: "dead" }).shade).toBe("phone");
    expect(propertyOfficeLinks({ ...base, isActive: false }).shade).toBe("phone");
    expect(propertyOfficeLinks({ ...base, portalUrl: "https://validate.perfdrive.com/", searchUrl: "https://validate.perfdrive.com/" }).shade).toBe("phone");
    expect(propertyOfficeLinks({ ...base, linkStatus: "none", portalUrl: null, searchUrl: null, phone: null }).shade).toBe("none");
  });
  it("a county takes its best office; New England and unmatched offices stay off the map", () => {
    const o = (stateCode: string, name: string, shade: "site" | "phone" | "none") => ({ county: { stateCode, name }, shade });
    const s = summarizeCoverage([o("TX", "Harris", "phone"), o("TX", "Harris", "site"), o("MA", "Worcester", "site"), o("AK", "Craig (City of)", "site")], index, (x) => x.shade);
    expect(s.byFips.get("48201")).toMatchObject({ shade: "site" });
    expect(s.byFips.get("48201")!.offices).toHaveLength(2);
    expect(s.byFips.has("25027")).toBe(false);
    expect(s.townAssessed).toHaveLength(1);
    expect(s.unmatched.map((x) => x.county.name)).toEqual(["Craig (City of)"]);
  });
});

describe("property-map.tsx safety", () => {
  const src = read("client/src/components/property-map.tsx");
  it("only draws Markers at placeable points, inside the error boundary", () => {
    const markers = [...src.matchAll(/<Marker[^>]*coordinates=\{([^}]+)\}/g)].map((m) => m[1].trim());
    expect(markers).toEqual(["labelAt", "s.at"]);
    expect(src).toContain("const labelAt = usps ? stateLabelPoint(geo) : null;");
    expect(src).toContain("{s.at && placeable(s.at) && (");
    expect(src).toContain("at: placeable(c) ? c : null");
    expect(src).toMatch(/<PermitMapBoundary message=[^>]+>\s*<PropertyMapInner \{\.\.\.props\} \/>\s*<\/PermitMapBoundary>/);
    expect(src).toContain("const MAX_ZOOM = 128;");
  });
  it("reads offices from the page (the gated endpoint), never a new data route", () => {
    expect(src).not.toMatch(/useQuery|fetch\(["'`]\/api/);
    expect(src).toContain('fetch("/us-counties-10m.json")');
    const page = read("client/src/pages/property.tsx");
    expect(page).toContain('<PropertyMap offices={appraisers}');
    expect(page).toContain('queryKey: ["/api/property-appraisers"]');
  });
});
