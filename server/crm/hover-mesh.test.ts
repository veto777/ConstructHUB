/**
 * HOVER XML 3D export → JSON mesh (shared/hover-mesh.ts). Pure units, no DB, no network.
 *
 * The fixture is SYNTHETIC: a 30 × 20 ft gable box built in the documented export format
 * (developers.hover.to/reference/get-xml-3d-export — DATA_EXPORT / LOCATION / STRUCTURES / ROOF / FACES / FACE /
 * POLYGON path=<lines> / LINES / LINE path=<points> / POINTS / POINT data="x,y,z"). No real address.
 */
import { describe, it, expect } from "vitest";
import {
  parseHoverXml3d, chainLines, pitchLabel, polygonArea, HoverMeshError, MESH_LIMITS,
} from "@shared/hover-mesh";

/** Points of a 30 (x) × 20 (y) box, 10 ft eaves, ridge along x at 15 ft (a 6/12 roof: 5 ft rise over 10 ft run). */
const P: Record<string, [number, number, number]> = {
  C1: [0, 0, 0], C2: [30, 0, 0], C3: [30, 20, 0], C4: [0, 20, 0],
  C5: [0, 0, 10], C6: [30, 0, 10], C7: [30, 20, 10], C8: [0, 20, 10],
  C9: [0, 10, 15], C10: [30, 10, 15],
  // a 3 × 4 ft window in the front wall (y = 0)
  C11: [5, 0, 3], C12: [8, 0, 3], C13: [8, 0, 7], C14: [5, 0, 7],
  // a 3 × 7 ft door in the front wall
  C15: [20, 0, 0], C16: [23, 0, 0], C17: [23, 0, 7], C18: [20, 0, 7],
};
const L: Record<string, [string, string, string]> = {
  // front wall y=0: C1-C2 eave bottom, C2-C6, C6-C5 (eave), C5-C1  — L4 deliberately listed reversed
  L1: ["BOTTOMWALL", "C1", "C2"], L2: ["OTHER", "C2", "C6"], L3: ["EAVE", "C6", "C5"], L4: ["OTHER", "C1", "C5"],
  // back wall y=20
  L5: ["BOTTOMWALL", "C4", "C3"], L6: ["OTHER", "C3", "C7"], L7: ["EAVE", "C7", "C8"], L8: ["OTHER", "C8", "C4"],
  // gable ends (pentagons)
  L9: ["BOTTOMWALL", "C1", "C4"], L10: ["RAKE", "C8", "C9"], L11: ["RAKE", "C9", "C5"],
  L12: ["BOTTOMWALL", "C2", "C3"], L13: ["RAKE", "C7", "C10"], L14: ["RAKE", "C10", "C6"],
  // ridge
  L15: ["RIDGE", "C9", "C10"],
  // window + door rings
  L16: ["OTHER", "C11", "C12"], L17: ["OTHER", "C12", "C13"], L18: ["OTHER", "C13", "C14"], L19: ["OTHER", "C14", "C11"],
  L20: ["OTHER", "C15", "C16"], L21: ["OTHER", "C16", "C17"], L22: ["OTHER", "C17", "C18"], L23: ["OTHER", "C18", "C15"],
};

function syntheticXml(extra = ""): string {
  const lines = Object.entries(L).map(([id, [t, a, b]]) => `<LINE id="${id}" type="${t}" path="${a},${b}"/>`).join("\n");
  const points = Object.entries(P).map(([id, xyz]) => `<POINT id="${id}" data="${xyz.join(",")}"/>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE x [ <!ENTITY boom "should never expand"> ]>
<DATA_EXPORT xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<LOCATION address="Synthetic Test House &amp; Co." lat="10.5" long="-20.25"/>
<STRUCTURES>
<ROOF id="ROOF1">
<FACES>
<FACE id="F1" type="ROOF" name="RF-1"><POLYGON id="P1" path="L3,L11,L15,L14" size="335.41" pitch="6"/></FACE>
<FACE id="F2" type="ROOF" name="RF-2"><POLYGON id="P2" path="L7,L13,L15,L10" size="335.41" pitch="6"/></FACE>
<FACE id="F3" type="WALL" children="F4,F5" name="SI-1"><POLYGON id="P3" path="L1,L2,L3,L4" size="267"/></FACE>
<FACE id="F4" type="WALLPENETRATION"><POLYGON id="P4" path="L16,L17,L18,L19" pitch="Infinity"/></FACE>
<FACE id="F5" type="WALLPENETRATION"><POLYGON id="P5" path="L20,L21,L22,L23" pitch="Infinity"/></FACE>
<FACE id="F6" type="WALL" children="" name="SI-2"><POLYGON id="P6" path="L5,L6,L7,L8" size="300"/></FACE>
<FACE id="F7" type="WALL" children="" name="SI-3"><POLYGON id="P7" path="L9,L8,L10,L11,L4" size="250"/></FACE>
<FACE id="F8" type="WALL" children="" name="SI-4"><POLYGON id="P8" path="L12,L6,L13,L14,L2" size="250"/></FACE>
<FACE id="F9" type="GUTTER" name="G-1"><POLYGON id="P9" path="L1,L2,L3" size="1"/></FACE>
<!-- <FACE id="F99" type="ROOF" name="commented out"> -->
${extra}
</FACES>
<LINES>
${lines}
</LINES>
<POINTS>
${points}
</POINTS>
</ROOF>
</STRUCTURES>
</DATA_EXPORT>`;
}

describe("chainLines", () => {
  it("chains a ring whatever direction each line is listed in, and drops the closing repeat", () => {
    expect(chainLines([["a", "b"], ["b", "c"], ["c", "d"], ["d", "a"]])).toEqual(["a", "b", "c", "d"]);
    expect(chainLines([["b", "a"], ["c", "b"], ["c", "d"], ["a", "d"]])).toEqual(["a", "b", "c", "d"]);
  });
  it("rejects disconnected or degenerate paths", () => {
    expect(chainLines([["a", "b"], ["c", "d"]])).toBeNull();
    expect(chainLines([["a", "b"]])).toBeNull();
    expect(chainLines([])).toBeNull();
    expect(chainLines([["a", "b"], ["b", "c"], ["x", "y"]])).toBeNull();
  });
});

describe("pitch + area helpers", () => {
  it("pitch is rise/12; Infinity and junk are null", () => {
    expect(pitchLabel("7")).toBe("7/12");
    expect(pitchLabel("4.5")).toBe("4.5/12");
    expect(pitchLabel("Infinity")).toBeNull();
    expect(pitchLabel("")).toBeNull();
    expect(pitchLabel(undefined)).toBeNull();
    expect(pitchLabel("-1")).toBeNull();
  });
  it("planar area in any orientation", () => {
    expect(polygonArea([[0, 0, 0], [3, 0, 0], [3, 0, 4], [0, 0, 4]])).toBeCloseTo(12);
    expect(polygonArea([[0, 0, 0], [0, 2, 0], [2, 2, 0], [2, 0, 0]])).toBeCloseTo(4);
  });
});

describe("parseHoverXml3d (synthetic gable box)", () => {
  const mesh = parseHoverXml3d(syntheticXml());

  it("classifies faces and skips types it does not render", () => {
    expect(mesh.counts).toEqual({ roof: 2, wall: 4, opening: 2, skipped: 1 });
    expect(mesh.faces.map((f) => f.id)).toEqual(["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"]);
    expect(mesh.faces.find((f) => f.name === "commented out")).toBeUndefined();
  });

  it("passes HOVER's sizes and pitches through untouched", () => {
    const rf1 = mesh.faces.find((f) => f.id === "F1")!;
    expect(rf1).toMatchObject({ name: "RF-1", type: "roof", areaSqft: 335.41, areaSource: "hover", pitch: "6/12", parentId: null });
    const wall = mesh.faces.find((f) => f.id === "F3")!;
    expect(wall).toMatchObject({ type: "wall", areaSqft: 267, areaSource: "hover", pitch: null });
    expect(mesh.totals).toEqual({ roofSqft: 670.8, wallSqft: 1067 });
  });

  it("openings know their wall; their area comes from the geometry and says so", () => {
    const win = mesh.faces.find((f) => f.id === "F4")!;
    const door = mesh.faces.find((f) => f.id === "F5")!;
    expect(win).toMatchObject({ type: "opening", parentId: "F3", areaSqft: 12, areaSource: "geometry", pitch: null, name: null });
    expect(door).toMatchObject({ parentId: "F3", areaSqft: 21 });
  });

  it("builds ordered vertex rings that index into the flat vertex array", () => {
    const ring = (id: string) => mesh.faces.find((f) => f.id === id)!.polygon
      .map((i) => [mesh.vertices[i * 3], mesh.vertices[i * 3 + 1], mesh.vertices[i * 3 + 2]]);
    // Gable end (pentagon) through a reversed line (L4) — 5 distinct corners in ring order.
    expect(ring("F7")).toHaveLength(5);
    expect(ring("F3")).toEqual([[0, 0, 0], [30, 0, 0], [30, 0, 10], [0, 0, 10]]);
    // Shared corners are shared vertices (C5 is in the front wall, the gable and the roof).
    expect(mesh.vertices.length / 3).toBe(18);
    expect(mesh.bounds).toEqual({ min: [0, 0, 0], max: [30, 20, 15] });
  });

  it("roof edges carry HOVER's line class and a length from its geometry", () => {
    const ridge = mesh.edges.filter((e) => e.type === "ridge");
    expect(ridge).toHaveLength(1);
    expect(ridge[0].lengthFt).toBe(30);
    expect(mesh.edges.filter((e) => e.type === "rake").map((e) => e.lengthFt)).toEqual([11.18, 11.18, 11.18, 11.18]);
    expect(mesh.edges.filter((e) => e.type === "eave")).toHaveLength(2);
  });

  it("decodes the five XML entities only — no DTD expansion", () => {
    expect(mesh.location).toEqual({ address: "Synthetic Test House & Co.", lat: 10.5, long: -20.25 });
    expect(JSON.stringify(mesh)).not.toContain("should never expand");
  });

  it("ids are scoped per structure (a second structure's F1 does not collide)", () => {
    const two = syntheticXml().replace("</STRUCTURES>", `<ROOF id="ROOF2"><FACES>
<FACE id="F1" type="ROOF" name="GARAGE-RF"><POLYGON id="P1" path="L1,L2,L3" size="10" pitch="4"/></FACE>
</FACES><LINES><LINE id="L1" path="C1,C2"/><LINE id="L2" path="C2,C3"/><LINE id="L3" path="C3,C1"/></LINES>
<POINTS><POINT id="C1" data="100,0,0"/><POINT id="C2" data="110,0,0"/><POINT id="C3" data="110,10,3"/></POINTS></ROOF></STRUCTURES>`);
    const m2 = parseHoverXml3d(two);
    expect(m2.counts.roof).toBe(3);
    const garage = m2.faces.find((f) => f.name === "GARAGE-RF")!;
    expect(garage.id).toBe("2-F1");
    expect(garage.polygon.map((i) => m2.vertices[i * 3])).toEqual([100, 110, 110]);
  });

  it("a face whose lines or points are missing is skipped, not guessed", () => {
    const broken = syntheticXml(`<FACE id="F50" type="ROOF" name="RF-X"><POLYGON id="P50" path="L1,L999" size="5" pitch="3"/></FACE>`);
    const m = parseHoverXml3d(broken);
    expect(m.faces.find((f) => f.id === "F50")).toBeUndefined();
    expect(m.counts.skipped).toBe(2);
  });
});

describe("parseHoverXml3d refusals", () => {
  const code = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return e instanceof HoverMeshError ? e.code : "other"; } };
  it("not an export / empty / oversized", () => {
    expect(code(() => parseHoverXml3d("<html>nope</html>"))).toBe("not_xml");
    expect(code(() => parseHoverXml3d("{}"))).toBe("not_xml");
    expect(code(() => parseHoverXml3d("<DATA_EXPORT><STRUCTURES></STRUCTURES></DATA_EXPORT>"))).toBe("empty_geometry");
    expect(code(() => parseHoverXml3d(`<DATA_EXPORT>${" ".repeat(MESH_LIMITS.xmlBytes)}</DATA_EXPORT>`))).toBe("too_large");
  });
});
