/**
 * HOVER "XML 3D Export" → a compact JSON mesh the in-app 3D viewer renders.
 *
 * Source: GET https://hover.to/api/v3/models/{model_id}/artifacts/cad_export.xml?version=v2
 * (developers.hover.to/reference/get-xml-3d-export). The documented shape:
 *
 *   <DATA_EXPORT>
 *     <LOCATION address=… lat=… long=…/>
 *     <STRUCTURES>
 *       <ROOF id="ROOF1">                       one element per structure
 *         <FACES>
 *           <FACE id="F1" type="ROOF" name="RF-10">
 *             <POLYGON id="P1" path="L360,L332,L351,L593" size="619.8" pitch="7"/>
 *           </FACE>
 *           <FACE id="F11" type="WALL" children="F12,F13" name="SI-8">  (children = its openings)
 *           <FACE id="F12" type="WALLPENETRATION">  … pitch="Infinity"
 *         </FACES>
 *         <LINES>  <LINE id="L1" type="BOTTOMWALL" path="C1,C2"/> …  (EAVE, RIDGE, HIP, STEPFLASH, OTHER, …)
 *         <POINTS> <POINT id="C1" data="x,y,z"/> …                    (feet, z up)
 *
 * A POLYGON's path is an ordered ring of LINE ids; each LINE joins two POINTs. We chain the lines into a ring of
 * points (a line may be listed in either direction). `size` is HOVER's own area in sq ft — for a wall it is the NET
 * area (its openings already subtracted), so it is passed through untouched. HOVER gives no size for an opening;
 * its area is computed from HOVER's own geometry and marked areaSource "geometry". Nothing is invented: a value
 * HOVER does not provide stays null.
 *
 * The parser is a small tag/attribute scanner (no DTDs, no entity expansion beyond the five XML entities and
 * numeric references) — an export is data, never markup we execute. Pure: no I/O, safe to import anywhere.
 */

/** HOVER face classes: windows and doors are openings with a kind; a WALLPENETRATION is an untyped cut-out. */
export type MeshFaceType = "roof" | "wall" | "opening" | "window" | "door" | "soffit";
export const OPENING_TYPES: readonly MeshFaceType[] = ["opening", "window", "door"];
/** Bump when the parsed shape changes: a cached mesh of an older version is re-read from HOVER's export. */
export const MESH_VERSION = 2;

export interface MeshFace {
  id: string;
  /** HOVER's facet label ("RF-5", "SI-1", "BR-2", "Unclassified-3"); openings usually have none. */
  name: string | null;
  type: MeshFaceType;
  /** HOVER's window-type / door-type ("doublehung", "casement", "exterior", "garage"), lower-cased; null otherwise. */
  subtype: string | null;
  /** Indices into vertices (÷3), an ordered ring, not closed (first ≠ last). */
  polygon: number[];
  areaSqft: number | null;
  areaSource: "hover" | "geometry" | null;
  /** Roof pitch as rise per 12 ("7/12"); null for walls/openings or when HOVER gives none. */
  pitch: string | null;
  /** The wall an opening belongs to (from the wall's children list). */
  parentId: string | null;
}

export interface MeshEdge {
  a: number;
  b: number;
  /** HOVER's line class, lower-cased ("eave", "ridge", "hip", "valley", "rake", "stepflash", "other", …). */
  type: string;
  lengthFt: number;
}

export interface HoverMesh {
  version: number;
  units: "ft";
  up: "z";
  /** Flat [x, y, z, x, y, z, …] in feet, HOVER's model frame. */
  vertices: number[];
  faces: MeshFace[];
  /** Lines bounding roof facets, deduped, with their HOVER class and length. */
  edges: MeshEdge[];
  location: { address: string | null; lat: number | null; long: number | null } | null;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  counts: { roof: number; wall: number; opening: number; window: number; door: number; soffit: number; skipped: number };
  totals: { roofSqft: number | null; wallSqft: number | null };
}

export const MESH_LIMITS = { xmlBytes: 40 * 1024 * 1024, points: 250_000, faces: 50_000 } as const;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e];
    const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out[m[1]] = decodeEntities(m[2] ?? m[3] ?? "");
  return out;
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/** "7" → "7/12"; "Infinity", junk, ≤0 or absurd → null. */
export function pitchLabel(raw: string | undefined): string | null {
  const n = num(raw);
  if (n === null || n < 0 || n > 48) return null;
  return `${round(n, 2)}/12`;
}

/**
 * Chain a ring of lines (each [p, q]) into an ordered ring of point ids. Each line shares one endpoint with the next;
 * either direction is accepted. Returns null when the lines do not form a connected ring.
 */
export function chainLines(lines: [string, string][]): string[] | null {
  if (!lines.length) return null;
  if (lines.length === 1) return null;
  const [a0, b0] = lines[0];
  const [a1, b1] = lines[1];
  // Orient the first line so its END touches the second line.
  let ring: string[];
  if (b0 === a1 || b0 === b1) ring = [a0, b0];
  else if (a0 === a1 || a0 === b1) ring = [b0, a0];
  else return null;
  for (let i = 1; i < lines.length; i++) {
    const [p, q] = lines[i];
    const end = ring[ring.length - 1];
    if (p === end) ring.push(q);
    else if (q === end) ring.push(p);
    else return null;
  }
  // A closed ring returns to its start; drop the repeat.
  if (ring.length > 1 && ring[ring.length - 1] === ring[0]) ring.pop();
  return ring.length >= 3 ? ring : null;
}

type V3 = [number, number, number];

/** Planar polygon area (Newell's method), any orientation, in the vertices' units squared. */
export function polygonArea(pts: V3[]): number {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1, z1] = pts[i];
    const [x2, y2, z2] = pts[(i + 1) % pts.length];
    nx += (y1 - y2) * (z1 + z2);
    ny += (z1 - z2) * (x1 + x2);
    nz += (x1 - x2) * (y1 + y2);
  }
  return Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
}

const FACE_TYPES: Record<string, MeshFaceType> = {
  ROOF: "roof", WALL: "wall", WALLPENETRATION: "opening", WINDOW: "window", DOOR: "door", GARAGEDOOR: "door", SOFFIT: "soffit",
};

export class HoverMeshError extends Error {
  constructor(public code: "too_large" | "not_xml" | "empty_geometry" | "too_many", message: string) {
    super(message);
    this.name = "HoverMeshError";
  }
}

/** Parse a HOVER XML 3D export. Throws HoverMeshError when it is not one or holds no renderable face. */
export function parseHoverXml3d(xml: string): HoverMesh {
  if (typeof xml !== "string") throw new HoverMeshError("not_xml", "not an XML export");
  if (xml.length > MESH_LIMITS.xmlBytes) throw new HoverMeshError("too_large", "XML export is too large");
  if (!/<DATA_EXPORT[\s>]/.test(xml)) throw new HoverMeshError("not_xml", "not a HOVER XML 3D export");

  // Ids are only unique inside one structure (<STRUCTURES><ROOF id="ROOF1">…), so they are scoped per structure.
  interface RawFace { id: string; type: string; name: string | null; subtype: string | null; children: string[]; path: string[]; size: number | null; pitch: string | undefined; scope: number }
  const faces: RawFace[] = [];
  const lines = new Map<string, { p: string; q: string; type: string }>();
  const points = new Map<string, V3>();
  let location: HoverMesh["location"] = null;

  const stack: string[] = [];
  let scope = 0;
  let currentFace: RawFace | null = null;
  const tagRe = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  // Comments, processing instructions, CDATA and doctypes are skipped wholesale.
  const body = xml.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[\s\S]*?>/g, "");
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(body))) {
    const closing = m[1] === "/";
    const tag = m[2].toUpperCase();
    const selfClosing = m[4] === "/";
    if (closing) {
      // Pop to the matching tag (tolerates sloppy nesting).
      const at = stack.lastIndexOf(tag);
      if (at >= 0) stack.length = at;
      if (tag === "FACE") currentFace = null;
      continue;
    }
    const attrs = parseAttrs(m[3]);
    const parent = stack[stack.length - 1];
    if (parent === "STRUCTURES") scope++;
    const key = (id: string) => `${scope}:${id}`;
    switch (tag) {
      case "LOCATION":
        location = { address: attrs.address?.trim() || null, lat: num(attrs.lat), long: num(attrs.long) };
        break;
      case "FACE": {
        currentFace = {
          id: key(attrs.id ?? `anon${faces.length}`),
          type: (attrs.type ?? "").toUpperCase(),
          name: attrs.name?.trim() || null,
          subtype: (attrs["window-type"] ?? attrs["door-type"])?.trim().toLowerCase() || null,
          children: (attrs.children ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(key),
          path: [], size: null, pitch: undefined, scope,
        };
        faces.push(currentFace);
        if (faces.length > MESH_LIMITS.faces) throw new HoverMeshError("too_many", "too many faces");
        if (selfClosing) currentFace = null;
        break;
      }
      case "POLYGON":
        if (currentFace && !currentFace.path.length) {
          currentFace.path = (attrs.path ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(key);
          currentFace.size = num(attrs.size);
          currentFace.pitch = attrs.pitch;
        }
        break;
      case "LINE": {
        const [p, q] = (attrs.path ?? "").split(",").map((s) => s.trim());
        if (attrs.id && p && q) lines.set(key(attrs.id), { p: key(p), q: key(q), type: (attrs.type ?? "other").toLowerCase() });
        break;
      }
      case "POINT": {
        const xyz = (attrs.data ?? "").split(",").map((s) => Number(s));
        if (attrs.id && xyz.length === 3 && xyz.every(Number.isFinite)) {
          points.set(key(attrs.id), xyz as V3);
          if (points.size > MESH_LIMITS.points) throw new HoverMeshError("too_many", "too many points");
        }
        break;
      }
    }
    if (!selfClosing && tag !== "POLYGON" && tag !== "LINE" && tag !== "POINT" && tag !== "LOCATION") stack.push(tag);
  }

  // Openings know their wall through the wall's children list.
  const parentOf = new Map<string, string>();
  for (const f of faces) if (f.type === "WALL") for (const c of f.children) parentOf.set(c, f.id);

  const vertices: number[] = [];
  const vIndex = new Map<string, number>();
  const vertexOf = (pid: string): number | null => {
    const hit = vIndex.get(pid);
    if (hit !== undefined) return hit;
    const p = points.get(pid);
    if (!p) return null;
    const i = vertices.length / 3;
    vertices.push(round(p[0], 4), round(p[1], 4), round(p[2], 4));
    vIndex.set(pid, i);
    return i;
  };

  const out: MeshFace[] = [];
  const counts = { roof: 0, wall: 0, opening: 0, window: 0, door: 0, soffit: 0, skipped: 0 };
  const roofLineIds = new Set<string>();
  const idOut = (id: string) => (id.startsWith("1:") ? id.slice(2) : id.replace(":", "-"));
  for (const f of faces) {
    const type = FACE_TYPES[f.type];
    const segs = f.path.map((lid) => lines.get(lid));
    if (!type || !segs.length || segs.some((s) => !s)) { counts.skipped++; continue; }
    const ring = chainLines(segs.map((s) => [s!.p, s!.q]));
    if (!ring) { counts.skipped++; continue; }
    const poly = ring.map(vertexOf);
    if (poly.some((i) => i === null)) { counts.skipped++; continue; }
    let areaSqft: number | null = f.size !== null && f.size >= 0 ? round(f.size, 2) : null;
    let areaSource: MeshFace["areaSource"] = areaSqft !== null ? "hover" : null;
    if (areaSqft === null && OPENING_TYPES.includes(type)) {
      areaSqft = round(polygonArea(ring.map((pid) => points.get(pid)!)), 2);
      areaSource = "geometry";
    }
    if (type === "roof") for (const lid of f.path) roofLineIds.add(lid);
    counts[type]++;
    out.push({
      id: idOut(f.id), name: f.name, type, subtype: f.subtype, polygon: poly as number[], areaSqft, areaSource,
      pitch: type === "roof" ? pitchLabel(f.pitch) : null,
      parentId: OPENING_TYPES.includes(type) && parentOf.has(f.id) ? idOut(parentOf.get(f.id)!) : null,
    });
  }
  if (!out.length) throw new HoverMeshError("empty_geometry", "the export holds no renderable faces");

  const edges: MeshEdge[] = [];
  for (const lid of roofLineIds) {
    const l = lines.get(lid)!;
    const a = vIndex.get(l.p), b = vIndex.get(l.q);
    if (a === undefined || b === undefined) continue;
    const pa = points.get(l.p)!, pb = points.get(l.q)!;
    edges.push({ a, b, type: l.type, lengthFt: round(Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]), 2) });
  }

  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], vertices[i + k]);
      max[k] = Math.max(max[k], vertices[i + k]);
    }
  }
  const sum = (t: MeshFaceType) => {
    const xs = out.filter((f) => f.type === t && f.areaSource === "hover").map((f) => f.areaSqft!);
    return xs.length ? round(xs.reduce((a, b) => a + b, 0), 1) : null;
  };
  return {
    version: MESH_VERSION, units: "ft", up: "z", vertices, faces: out, edges, location,
    bounds: { min, max }, counts, totals: { roofSqft: sum("roof"), wallSqft: sum("wall") },
  };
}
