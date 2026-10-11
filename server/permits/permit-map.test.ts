/**
 * The permit-coverage map must never hand react-simple-maps' <Marker> a point
 * geoAlbersUsa cannot place: Marker destructures the projection result, so a
 * null is a TypeError that unmounts the Search page (the Oct 2026 Puerto Rico
 * white screen). Real projection test over the shipped topojson for every state
 * in the join table, the guard's edge cases, the fallback card, and a source
 * guard that the component only draws Markers behind the guard.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { feature } from "topojson-client";
import { geoCentroid } from "d3-geo";
import { renderToStaticMarkup } from "react-dom/server";
import { FIPS_USPS, placeable, stateLabelPoint } from "../../client/src/components/permit-map-geo";
import { PermitMapBoundary } from "../../client/src/components/permit-map";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.resolve(root, rel), "utf8");
const topo = JSON.parse(read("client/public/us-states-10m.json"));
const states: { id: string; centroid: [number, number]; geo: any }[] = topo.objects.states.geometries.map((g: any) => {
  const geo = feature(topo as any, g as any);
  return { id: String(g.id), centroid: geoCentroid(geo as any) as [number, number], geo };
});

describe("FIPS_USPS against the shipped us-states-10m.json", () => {
  it("names only states the projection can draw, and every one of them projects", () => {
    for (const [id, usps] of Object.entries(FIPS_USPS)) {
      const st = states.find((s) => s.id === id);
      expect(st, `${id} (${usps}) is in the topojson`).toBeDefined();
      expect(placeable(st!.centroid), `${usps} centroid ${st!.centroid} is placeable`).toBe(true);
      expect(stateLabelPoint(st!.geo), `${usps} has a label point`).toEqual(st!.centroid);
    }
    expect(Object.keys(FIPS_USPS)).toHaveLength(51); // 50 states + DC
  });
  it("leaves out exactly the geographies geoAlbersUsa cannot place (PR and the other territories)", () => {
    const left = states.filter((s) => !(s.id in FIPS_USPS)).map((s) => s.id).sort();
    // 60 AS, 66 GU, 69 MP, 72 PR, 78 VI — present in the topojson, outside every inset.
    expect(left).toEqual(["60", "66", "69", "72", "78"]);
    for (const id of left) {
      const st = states.find((s) => s.id === id)!;
      expect(Number.isFinite(st.centroid[0]) && Number.isFinite(st.centroid[1]), `${id} has a finite centroid (so a finite check alone is not enough)`).toBe(true);
      expect(placeable(st.centroid), `${id} is not placeable`).toBe(false);
      expect(stateLabelPoint(st.geo), `${id} gets no label`).toBeNull();
    }
  });
});

describe("placeable", () => {
  it("accepts points inside the three insets", () => {
    expect(placeable([-104.99, 39.74])).toBe(true); // Denver
    expect(placeable([-149.9, 61.2])).toBe(true); // Anchorage
    expect(placeable([-157.86, 21.31])).toBe(true); // Honolulu
    expect(placeable([-80.19, 25.76])).toBe(true); // Miami
  });
  it("rejects points outside them and anything that is not a finite pair", () => {
    expect(placeable([-66.1, 18.4])).toBe(false); // San Juan, PR
    expect(placeable([144.79, 13.47])).toBe(false); // Guam
    expect(placeable([2.35, 48.86])).toBe(false); // Paris
    expect(placeable([null, 18.4])).toBe(false);
    expect(placeable([-66.1, null])).toBe(false);
    expect(placeable([NaN, 38])).toBe(false);
    expect(placeable([-97, Infinity])).toBe(false);
    expect(placeable(["-97", "38"])).toBe(false);
    expect(placeable(null)).toBe(false);
    expect(placeable(undefined)).toBe(false);
    expect(placeable([-97])).toBe(false);
  });
});

describe("PermitMapBoundary", () => {
  it("flags a render error and draws the fallback card with a retry", () => {
    expect(PermitMapBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    const failed = new PermitMapBoundary({ children: null });
    failed.state = { failed: true };
    const html = renderToStaticMarkup(failed.render() as any);
    expect(html).toContain('data-testid="permit-map-fallback"');
    expect(html).toContain("Searching below still works");
    expect(html).toContain("Try again");
    expect(html).toContain('class="permit-map');
    const fine = new PermitMapBoundary({ children: "map" });
    expect(fine.render()).toBe("map");
  });
});

describe("permit-map.tsx only draws Markers behind the guard", () => {
  const src = read("client/src/components/permit-map.tsx");
  it("labels states at stateLabelPoint() and dots only placeable() portals", () => {
    const markers = [...src.matchAll(/<Marker[^>]*coordinates=\{([^}]+)\}/g)].map((m) => m[1].trim());
    expect(markers).toEqual(["labelAt", "[c.lng, c.lat]"]);
    expect(src).toContain("const labelAt = usps ? stateLabelPoint(geo) : null;");
    expect(src).toContain("{usps && labelAt && (");
    expect(src).toContain(".filter((p) => placeable([p.lng, p.lat]))");
    expect(src).toContain(".filter((c) => placeable([c.lng, c.lat]))");
    expect(src).not.toMatch(/FIPS_USPS[^\n]*=/); // the table lives in permit-map-geo.ts only
  });
  it("exports PermitMap wrapped in the error boundary, and Search still imports it", () => {
    expect(src).toContain("export function PermitMap(");
    expect(src).toMatch(/<PermitMapBoundary>\s*<PermitMapInner \{\.\.\.props\} \/>\s*<\/PermitMapBoundary>/);
    expect(src).toContain("static getDerivedStateFromError()");
    expect(read("client/src/pages/search.tsx")).toContain('import { PermitMap, type MapPortal } from "@/components/permit-map";');
  });
});
