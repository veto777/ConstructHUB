/**
 * HOVER takeoff — the numbers an estimator quotes from, read out of HOVER's
 * measurement document (`?version=full_json`, "version": 2) and turned into
 * quote quantities by the owner's rules. Pure: no db, no fetch, shared by the
 * server (ingest, back-fill, estimate symbols, getCustomerTakeoff) and the
 * client (takeoff card, "Fill from HOVER").
 *
 * The real full_json (version 2) carries the numbers at:
 *   summary.area.total.siding / .facades.siding / .openings.siding   siding ft²
 *   summary.roof.roof_facets.area (roof.area.total)                    roof ft²
 *   summary.roof.waste_factor.area.plus_<n>_percent                    HOVER's waste rows
 *   roof.measurements.{ridges,hips,valleys,rakes,gutters_eaves,flashing,step_flashing}
 *   summary.roof.pitch[] / roof.pitch[]                                pitch breakdown
 *   openings.windows[] / window_groups[] / doors[]                     opening lists
 *   footprint.{area,perimeter,stories}
 *   summary.{trim,corners,roofline,openings,siding_waste}, elevations  reference
 * Older/other shapes (flat `roof.total_roof_area_sqft`, `openings.windows: 14`)
 * are still read as fallbacks. Anything absent stays null — never guessed.
 *
 * The rules (owner, 2026-10-17):
 *   - Siding quote quantity = total siding area rounded UP to the next
 *     `sidingRoundUpTo` (default 100): 2169 → 2200; an exact hundred stays.
 *   - Roof quote quantity = roof area + at least 5 % waste (`roofWastePct`,
 *     never below MIN_ROOF_WASTE_PCT). HOVER's own "+5 %" row is used when it
 *     agrees with the math (it rounds 2418.15 to 2418); without it the area is
 *     ceil(area × (1 + pct/100)). Squares = quantity / 100.
 */

export interface TakeoffRules {
  /** Roof waste added to the measured roof area, percent. Never below MIN_ROOF_WASTE_PCT. */
  roofWastePct: number;
  /** Siding area rounds UP to a multiple of this many ft² (1 = no rounding). */
  sidingRoundUpTo: number;
}

export const MIN_ROOF_WASTE_PCT = 5;
export const MAX_ROOF_WASTE_PCT = 50;
export const DEFAULT_TAKEOFF_RULES: TakeoffRules = { roofWastePct: 5, sidingRoundUpTo: 100 };
/** Choices offered in Settings (the server accepts any value inside the bounds). */
export const ROOF_WASTE_CHOICES = [5, 7, 10, 12, 15, 20] as const;
export const SIDING_ROUND_CHOICES = [1, 10, 25, 50, 100] as const;

/** Clamp whatever is stored (org custom_fields.takeoffRules) into valid rules; junk falls back to the defaults. */
export function normalizeTakeoffRules(input: unknown): TakeoffRules {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const pct = Number(r.roofWastePct);
  const inc = Number(r.sidingRoundUpTo);
  return {
    roofWastePct: Number.isFinite(pct)
      ? Math.min(MAX_ROOF_WASTE_PCT, Math.max(MIN_ROOF_WASTE_PCT, pct))
      : DEFAULT_TAKEOFF_RULES.roofWastePct,
    sidingRoundUpTo: Number.isFinite(inc) && inc >= 1 && inc <= 1000
      ? Math.round(inc)
      : DEFAULT_TAKEOFF_RULES.sidingRoundUpTo,
  };
}

// ── The rules (pure math) ───────────────────────────────────────────────────

/** Round UP to the next multiple of `increment`; an exact multiple stays; null stays null. */
export function roundUpTo(value: number | null | undefined, increment: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (!(increment > 0)) return value;
  // The epsilon keeps float noise (2100.0000000001) from bumping an exact multiple.
  return Math.ceil(value / increment - 1e-9) * increment;
}

/** Siding quote quantity: the total siding area rounded up per the rules. */
export function sidingQuoteSqft(areaSqft: number | null | undefined, rules: TakeoffRules = DEFAULT_TAKEOFF_RULES): number | null {
  return roundUpTo(areaSqft, rules.sidingRoundUpTo);
}

export interface RoofQuote {
  wastePct: number;
  quantitySqft: number | null;
  squares: number | null;
  /** HOVER's own row for the same waste %, the plain ceil() of the math, and whether they agree (±1 ft²). */
  crossCheck: { hoverSqft: number; computedSqft: number; agrees: boolean } | null;
}

/**
 * Roof quote quantity: area + waste (at least MIN_ROOF_WASTE_PCT). `hoverWasteRows` is
 * summary.roof.waste_factor.area ({ plus_5_percent: 2418, … }); its row for this % wins when it
 * agrees with the math within 1 ft², otherwise ceil(area × (1 + pct/100)) stands.
 */
export function roofQuote(
  areaSqft: number | null | undefined,
  rules: TakeoffRules = DEFAULT_TAKEOFF_RULES,
  hoverWasteRows?: Record<string, unknown> | null,
  suggestedPct?: number | null,
): RoofQuote {
  const wastePct = Math.max(MIN_ROOF_WASTE_PCT, rules.roofWastePct, suggestedPct ?? 0);
  if (areaSqft === null || areaSqft === undefined || !Number.isFinite(areaSqft)) {
    return { wastePct, quantitySqft: null, squares: null, crossCheck: null };
  }
  const exact = areaSqft * (1 + wastePct / 100);
  const computed = Math.ceil(exact - 1e-9);
  const hoverRow = Number.isInteger(wastePct) ? toNum(hoverWasteRows?.[`plus_${wastePct}_percent`]) : null;
  const agrees = hoverRow !== null && Math.abs(hoverRow - exact) <= 1;
  const quantitySqft = agrees ? hoverRow! : computed;
  return {
    wastePct,
    quantitySqft,
    squares: round2(quantitySqft / 100),
    crossCheck: hoverRow === null ? null : { hoverSqft: hoverRow, computedSqft: computed, agrees },
  };
}

// ── The takeoff shape ───────────────────────────────────────────────────────

export interface TakeoffWindow { id: string | null; widthIn: number | null; heightIn: number | null; unitedInches: number | null; areaSqft: number | null }
export interface TakeoffWindowGroup { name: string | null; widthIn: number | null; heightIn: number | null; unitedInches: number | null; windows: string[] }
export interface TakeoffDoor { id: string | null; widthIn: number | null; heightIn: number | null; areaSqft: number | null }
export interface TakeoffPitch { pitch: string; areaSqft: number | null; percent: number | null }

export interface HoverTakeoff {
  /** Shape version of THIS object (bump when fields change meaning). */
  version: 1;
  /** HOVER's full_json "version" (2 today), null for older shapes. */
  sourceVersion: number | null;
  rules: TakeoffRules;
  siding: {
    /** HOVER summary.area.total.siding = facades + openings + trim. */
    areaSqft: number | null;
    /** areaSqft rounded up per rules.sidingRoundUpTo — what the estimate quotes. */
    quantitySqft: number | null;
    facadesSqft: number | null;
    openingsSqft: number | null;
    /** total − facades − openings (HOVER lists no trim area of its own). */
    trimSqft: number | null;
    /** Non-siding cladding (brick/stone/…) total, reference only. */
    otherSqft: number | null;
    /** summary.siding_waste verbatim ({ zero, with_openings, plus_10_percent, … }). */
    wasteTable: Record<string, number> | null;
  };
  roof: {
    areaSqft: number | null;
    wastePct: number;
    /** areaSqft + wastePct — what the estimate quotes. */
    quantitySqft: number | null;
    /** quantitySqft / 100. */
    squares: number | null;
    /** areaSqft / 100 (no waste) — what crm_measurements.squares_milli holds. */
    measuredSquares: number | null;
    facets: number | null;
    pitch: TakeoffPitch[];
    predominantPitch: string | null;
    /** summary.roof.waste_factor.area verbatim. */
    hoverWasteTable: Record<string, number> | null;
    /** An explicit waste % in the document itself (older shapes only); it can raise the rule, never lower it. */
    hoverSuggestedPct?: number | null;
    wasteCrossCheck: RoofQuote["crossCheck"];
    lengths: {
      ridges: number | null; hips: number | null; ridgesHips: number | null;
      valleys: number | null; rakes: number | null; eaves: number | null;
      flashing: number | null; stepFlashing: number | null;
      /** rakes + eaves. */
      dripEdge: number | null;
    };
  };
  footprint: { areaSqft: number | null; perimeterFt: number | null; stories: number | null };
  windows: TakeoffWindow[];
  windowGroups: TakeoffWindowGroup[];
  doors: TakeoffDoor[];
  counts: { windows: number | null; doors: number | null; windowGroups: number | null };
  totals: { windowsAreaSqft: number | null; windowsUnitedInches: number | null; doorsAreaSqft: number | null };
  reference: {
    trim: { levelStarterLf: number | null; slopedLf: number | null; verticalLf: number | null };
    corners: { insideQty: number | null; insideLf: number | null; outsideQty: number | null; outsideLf: number | null };
    soffit: { eavesSqft: number | null; rakesSqft: number | null; totalSqft: number | null };
    fascia: { eavesLf: number | null; rakesLf: number | null };
    frieze: { levelLf: number | null; slopedLf: number | null };
    openingTrim: { quantity: number | null; topsLf: number | null; sidesLf: number | null; sillsLf: number | null; perimeterLf: number | null };
    elevations: Record<string, number>;
  };
  /** Where the numbers came from — filled when read for a client (getCustomerTakeoff), absent in raw_payload. */
  source?: {
    measurementId: string;
    hoverJobId: string | null;
    hoverModelId: string | null;
    capturedAt: string | null;
    address: string | null;
    projectId: string | null;
    /** Session-gated download of HOVER's measurement PDF, when stored. */
    pdfUrl: string | null;
    /** The contractor's HOVER viewer (needs their HOVER login) — never a client link. */
    hoverAppUrl: string | null;
  };
}

// ── Reading full_json ───────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const m = v.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  return null;
}

function at(obj: any, path: string): unknown {
  let cur = obj;
  for (const k of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** First finite number at any of the dotted paths. */
function numAt(obj: any, paths: string[]): number | null {
  for (const p of paths) {
    const n = toNum(at(obj, p));
    if (n !== null) return n;
  }
  return null;
}

function strAt(obj: any, paths: string[]): string | null {
  for (const p of paths) {
    const v = at(obj, p);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const r2 = (n: number | null) => (n === null ? null : round2(n));
const sum = (xs: (number | null)[]): number | null => {
  const ok = xs.filter((x): x is number => x !== null);
  return ok.length ? round2(ok.reduce((a, b) => a + b, 0)) : null;
};
const sumAll = (xs: (number | null)[]): number | null =>
  xs.length && xs.every((x) => x !== null) ? round2((xs as number[]).reduce((a, b) => a + b, 0)) : null;

/** One dimension in inches: `67"`, `67`, `5' 7"`, `5'`. */
function inches(s: string): number | null {
  const ft = s.match(/(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*"?)?/);
  if (ft) return Number(ft[1]) * 12 + (ft[2] ? Number(ft[2]) : 0);
  return toNum(s);
}

/** `190" x 85"` → { w: 190, h: 85 }. */
export function parseWidthHeight(v: unknown): { w: number | null; h: number | null } {
  if (typeof v !== "string") return { w: null, h: null };
  const parts = v.split(/\s*[x×]\s*/i);
  if (parts.length !== 2) return { w: null, h: null };
  return { w: inches(parts[0]), h: inches(parts[1]) };
}

/** Numeric object values only (HOVER's waste tables). */
function numberTable(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(v)) {
    const n = toNum(x);
    if (n !== null) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** "8/12", "8 / 12", 8 → "8/12". */
function pitchLabel(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return `${v}/12`;
  if (typeof v === "string" && v.trim()) return v.replace(/\s+/g, "");
  return null;
}

/**
 * Build the takeoff from a full_json document. Null when the document carries no roof, siding,
 * footprint or opening numbers at all (nothing to quote from).
 */
export function extractHoverTakeoff(fullJson: unknown, rulesIn?: Partial<TakeoffRules> | null): HoverTakeoff | null {
  const j: any = fullJson && typeof fullJson === "object" ? fullJson : null;
  if (!j || j.trimmed === true) return null;
  const rules = normalizeTakeoffRules({ ...DEFAULT_TAKEOFF_RULES, ...(rulesIn ?? {}) });

  // ── Siding ────────────────────────────────────────────────────────────────
  const sidingArea = numAt(j, [
    "summary.area.total.siding",
    // older / flat shapes
    "siding.total_siding_area_sqft", "siding.total_area_sqft", "summary.siding_area_sqft", "siding_area_sqft", "areas.walls_sqft",
  ]);
  const facades = numAt(j, ["summary.area.facades.siding"]);
  const openingsArea = numAt(j, ["summary.area.openings.siding"]);
  const trim = sidingArea !== null && facades !== null && openingsArea !== null && sidingArea - facades - openingsArea >= 0
    ? round2(sidingArea - facades - openingsArea) : null;

  // ── Roof ──────────────────────────────────────────────────────────────────
  const roofArea = numAt(j, [
    "summary.roof.roof_facets.area", "roof.area.total",
    "roof.total_roof_area_sqft", "roof.total_area_sqft", "summary.roof_area_sqft", "roof_area_sqft", "areas.roof_facets_sqft",
  ]);
  const hoverWasteTable = numberTable(at(j, "summary.roof.waste_factor.area"));
  // An explicit waste suggestion only exists in older shapes; it can raise the %, never lower it.
  const suggestedPct = numAt(j, ["waste.suggested_percent", "waste.percent", "waste_factor", "roof.waste_percent", "wastePercent"]);
  const rq = roofQuote(roofArea, rules, hoverWasteTable, suggestedPct);

  const pitchSrc = arr(at(j, "summary.roof.pitch")).length ? arr(at(j, "summary.roof.pitch")) : arr(at(j, "roof.pitch"));
  const pitch: TakeoffPitch[] = pitchSrc
    .map((p: any) => ({ pitch: pitchLabel(p?.roof_pitch ?? p?.pitch) ?? "", areaSqft: toNum(p?.area), percent: toNum(p?.percentage) }))
    .filter((p) => p.pitch);
  const predominant = pitch.length
    ? [...pitch].sort((a, b) => (b.areaSqft ?? b.percent ?? 0) - (a.areaSqft ?? a.percent ?? 0))[0].pitch
    : pitchLabel(at(j, "roof.predominant_pitch") ?? at(j, "predominant_pitch") ?? (typeof at(j, "roof.pitch") === "string" ? at(j, "roof.pitch") : null) ?? at(j, "pitch"));

  const ridges = numAt(j, ["roof.measurements.ridges"]);
  const hips = numAt(j, ["roof.measurements.hips"]);
  const ridgesHips = numAt(j, ["summary.roof.ridges_hips.length"]) ?? sum([ridges, hips]);
  const rakes = numAt(j, ["roof.measurements.rakes", "summary.roof.rakes.length"]);
  const eaves = numAt(j, ["roof.measurements.gutters_eaves", "summary.roof.gutters_eaves.length"]);
  const lengths = {
    ridges: r2(ridges), hips: r2(hips), ridgesHips: r2(ridgesHips),
    valleys: r2(numAt(j, ["roof.measurements.valleys", "summary.roof.valleys.length"])),
    rakes: r2(rakes), eaves: r2(eaves),
    flashing: r2(numAt(j, ["roof.measurements.flashing", "summary.roof.flashing.length"])),
    stepFlashing: r2(numAt(j, ["roof.measurements.step_flashing", "summary.roof.step_flashing.length"])),
    dripEdge: sumAll([rakes, eaves]),
  };

  // ── Footprint ─────────────────────────────────────────────────────────────
  const storiesN = numAt(j, ["footprint.stories", "property.stories", "summary.stories", "stories", "building.stories"]);
  const footprint = {
    areaSqft: numAt(j, ["footprint.area"]),
    perimeterFt: r2(numAt(j, ["footprint.perimeter"])),
    stories: storiesN === null ? null : Math.round(storiesN),
  };

  // ── Openings ──────────────────────────────────────────────────────────────
  const windows: TakeoffWindow[] = arr(at(j, "openings.windows")).map((w: any) => {
    const wh = parseWidthHeight(w?.width_x_height);
    return {
      id: typeof w?.opening === "string" ? w.opening : null,
      widthIn: wh.w, heightIn: wh.h,
      unitedInches: toNum(w?.united_inches) ?? (wh.w !== null && wh.h !== null ? wh.w + wh.h : null),
      areaSqft: toNum(w?.area),
    };
  });
  const windowGroups: TakeoffWindowGroup[] = arr(at(j, "openings.window_groups"))
    .map((g: any) => ({
      name: typeof g?.name === "string" ? g.name : null,
      widthIn: r2(toNum(g?.width)), heightIn: r2(toNum(g?.height)),
      unitedInches: r2(toNum(g?.united_inches)),
      windows: arr(g?.windows).filter((x: unknown): x is string => typeof x === "string"),
    }))
    // HOVER does not guarantee order; the PDF numbers them WG-1, WG-2, …
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true }));
  const doors: TakeoffDoor[] = arr(at(j, "openings.doors")).map((d: any) => {
    const wh = parseWidthHeight(d?.width_x_height);
    return { id: typeof d?.opening === "string" ? d.opening : null, widthIn: wh.w, heightIn: wh.h, areaSqft: toNum(d?.area) };
  });
  // Older shapes carry only a count ("openings.windows": 14).
  const windowCountScalar = typeof at(j, "openings.windows") === "number"
    ? toNum(at(j, "openings.windows"))
    : numAt(j, ["windows.count", "summary.windows", "windows_count", "openings.windows_count"]);
  const counts = {
    windows: windows.length ? windows.length : (windowCountScalar === null ? null : Math.round(windowCountScalar)),
    doors: doors.length ? doors.length : (Array.isArray(at(j, "openings.doors")) ? 0 : null),
    windowGroups: windowGroups.length ? windowGroups.length : null,
  };
  if (Array.isArray(at(j, "openings.windows")) && !windows.length) counts.windows = 0;
  const totals = {
    windowsAreaSqft: windows.length ? sum(windows.map((w) => w.areaSqft)) : null,
    windowsUnitedInches: windows.length ? sum(windows.map((w) => w.unitedInches)) : null,
    doorsAreaSqft: doors.length ? sum(doors.map((d) => d.areaSqft)) : null,
  };

  // ── Reference (trim / corners / soffit) ───────────────────────────────────
  const eavesSoffit = numAt(j, ["summary.roofline.eaves_fascia.soffit_area"]);
  const rakesSoffit = numAt(j, ["summary.roofline.rakes_fascia.soffit_area"]);
  const elevations: Record<string, number> = {};
  const sides = at(j, "elevations.sides");
  if (sides && typeof sides === "object") {
    for (const [side, v] of Object.entries(sides as Record<string, any>)) {
      const n = toNum(v?.total);
      if (n !== null) elevations[side] = n;
    }
  }
  const reference = {
    trim: {
      levelStarterLf: r2(numAt(j, ["summary.trim.level_starter.siding"])),
      slopedLf: r2(numAt(j, ["summary.trim.sloped_trim.siding"])),
      verticalLf: r2(numAt(j, ["summary.trim.vertical_trim.siding"])),
    },
    corners: {
      insideQty: numAt(j, ["summary.corners.inside_corners_qty.siding"]),
      insideLf: r2(numAt(j, ["summary.corners.inside_corners_len.siding"])),
      outsideQty: numAt(j, ["summary.corners.outside_corners_qty.siding"]),
      outsideLf: r2(numAt(j, ["summary.corners.outside_corners_len.siding"])),
    },
    soffit: { eavesSqft: r2(eavesSoffit), rakesSqft: r2(rakesSoffit), totalSqft: sumAll([eavesSoffit, rakesSoffit]) },
    fascia: {
      eavesLf: r2(numAt(j, ["summary.roofline.eaves_fascia.length"])),
      rakesLf: r2(numAt(j, ["summary.roofline.rakes_fascia.length"])),
    },
    frieze: {
      levelLf: r2(numAt(j, ["summary.roofline.level_frieze_board.length"])),
      slopedLf: r2(numAt(j, ["summary.roofline.sloped_frieze_board.length"])),
    },
    openingTrim: {
      quantity: numAt(j, ["summary.openings.quantity.siding"]),
      topsLf: r2(numAt(j, ["summary.openings.tops_length.siding"])),
      sidesLf: r2(numAt(j, ["summary.openings.sides_length.siding"])),
      sillsLf: r2(numAt(j, ["summary.openings.sills_length.siding"])),
      perimeterLf: r2(numAt(j, ["summary.openings.total_perimeter.siding"])),
    },
    elevations,
  };

  const hasAnything = sidingArea !== null || roofArea !== null || footprint.areaSqft !== null
    || windows.length > 0 || doors.length > 0 || counts.windows !== null || footprint.stories !== null || !!predominant;
  if (!hasAnything) return null;

  return {
    version: 1,
    sourceVersion: toNum(j.version),
    rules,
    siding: {
      areaSqft: sidingArea,
      quantitySqft: sidingQuoteSqft(sidingArea, rules),
      facadesSqft: facades,
      openingsSqft: openingsArea,
      trimSqft: trim,
      otherSqft: numAt(j, ["summary.area.total.other"]),
      wasteTable: numberTable(at(j, "summary.siding_waste")),
    },
    roof: {
      areaSqft: roofArea,
      wastePct: rq.wastePct,
      quantitySqft: rq.quantitySqft,
      squares: rq.squares,
      measuredSquares: roofArea === null ? null : round2(roofArea / 100),
      facets: numAt(j, ["summary.roof.roof_facets.total", "roof.area.facets"]) ?? (arr(at(j, "roof.facets")).length || null),
      pitch,
      predominantPitch: predominant,
      hoverWasteTable,
      hoverSuggestedPct: suggestedPct,
      wasteCrossCheck: rq.crossCheck,
      lengths,
    },
    footprint,
    windows,
    windowGroups,
    doors,
    counts,
    totals,
    reference,
  };
}

/**
 * Re-apply (possibly changed) org rules to a STORED takeoff — for rows whose measurement document is not kept.
 * Only the quote quantities depend on the rules; the measured values stay as they are.
 */
export function reapplyTakeoffRules(t: HoverTakeoff, rulesIn?: Partial<TakeoffRules> | null): HoverTakeoff {
  const rules = normalizeTakeoffRules({ ...DEFAULT_TAKEOFF_RULES, ...(rulesIn ?? {}) });
  const rq = roofQuote(t.roof.areaSqft, rules, t.roof.hoverWasteTable, t.roof.hoverSuggestedPct ?? null);
  return {
    ...t,
    rules,
    siding: { ...t.siding, quantitySqft: sidingQuoteSqft(t.siding.areaSqft, rules) },
    roof: { ...t.roof, wastePct: rq.wastePct, quantitySqft: rq.quantitySqft, squares: rq.squares, wasteCrossCheck: rq.crossCheck },
  };
}

/**
 * The part of a full_json document the takeoff reads, for documents too big to keep whole: drops the bulky
 * per-facade lists, soffit segments, wireframes and captured images, keeps everything extractHoverTakeoff uses
 * (extracting the compact document gives the same takeoff — tested).
 */
export function compactHoverFullJson(fullJson: unknown): unknown {
  const j: any = fullJson && typeof fullJson === "object" ? fullJson : null;
  if (!j) return fullJson;
  const sides: Record<string, { total: unknown }> = {};
  const src = j.elevations?.sides;
  if (src && typeof src === "object") for (const [k, v] of Object.entries(src as Record<string, any>)) sides[k] = { total: v?.total };
  const pick = (o: any, keys: string[]) => {
    if (!o || typeof o !== "object") return o;
    const out: any = {};
    for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
    return out;
  };
  return {
    compact: true,
    version: j.version,
    summary: j.summary,
    roof: j.roof && typeof j.roof === "object"
      ? { ...pick(j.roof, ["area", "pitch", "measurements", "total_roof_area_sqft", "total_area_sqft", "predominant_pitch", "waste_percent"]),
          ...(Array.isArray(j.roof.facets) ? { facets: j.roof.facets.map((f: any) => ({ facet: f?.facet })) } : {}),
          ...(typeof j.roof.pitch === "string" ? { pitch: j.roof.pitch } : {}) }
      : j.roof,
    openings: j.openings,
    footprint: j.footprint,
    elevations: Object.keys(sides).length ? { sides } : undefined,
    // Older flat shapes.
    siding: j.siding, property: j.property, waste: j.waste, areas: j.areas, windows: j.windows,
    stories: j.stories, pitch: j.pitch, predominant_pitch: j.predominant_pitch, building: j.building,
    waste_factor: j.waste_factor, wastePercent: j.wastePercent, roof_area_sqft: j.roof_area_sqft,
    siding_area_sqft: j.siding_area_sqft, windows_count: j.windows_count,
  };
}

// ── crm_measurements columns ────────────────────────────────────────────────

const milli = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 1000));

/**
 * The crm_measurements numeric columns from a takeoff. They hold MEASURED values (no waste, no rounding)
 * like every other provider's row; the waste % lands in waste_suggestion_bps so a price-book formula
 * `ceil([SQUARES] * (1 + [WASTE]/100))` adds it exactly once. Quote quantities live in raw_payload.takeoff.
 */
export function takeoffColumns(t: HoverTakeoff | null) {
  if (!t) {
    return {
      squaresMilli: null, roofAreaSfMilli: null, wallAreaSfMilli: null, ridgeLfMilli: null, hipLfMilli: null,
      valleyLfMilli: null, eaveLfMilli: null, rakeLfMilli: null, perimeterLfMilli: null,
      predominantPitch: null, stories: null, facetCount: null, wasteSuggestionBps: null,
    };
  }
  const L = t.roof.lengths;
  return {
    squaresMilli: t.roof.areaSqft === null ? null : Math.round(t.roof.areaSqft * 10),
    roofAreaSfMilli: milli(t.roof.areaSqft),
    wallAreaSfMilli: milli(t.siding.areaSqft),
    // HOVER reports ridges and hips separately in roof.measurements; only the combined figure otherwise.
    ridgeLfMilli: milli(L.ridges ?? L.ridgesHips),
    hipLfMilli: milli(L.ridges !== null ? L.hips : null),
    valleyLfMilli: milli(L.valleys),
    eaveLfMilli: milli(L.eaves),
    rakeLfMilli: milli(L.rakes),
    // Roof perimeter = drip edge = rakes + eaves (the footprint perimeter is kept in the takeoff).
    perimeterLfMilli: milli(L.dripEdge),
    predominantPitch: t.roof.predominantPitch,
    stories: t.footprint.stories,
    facetCount: t.roof.facets === null ? null : Math.round(t.roof.facets),
    wasteSuggestionBps: t.roof.areaSqft === null ? null : Math.round(t.roof.wastePct * 100),
  };
}

// ── Estimating: symbols + "Fill from HOVER" ─────────────────────────────────

/** Price-book formula symbols a takeoff adds (on top of SQUARES/SF/LF/PITCH/STORIES/WASTE). */
export const TAKEOFF_SYMBOLS = ["SIDING_SF", "ROOF_SF", "ROOF_SQ", "WINDOWS", "DOORS", "UI"] as const;

export function takeoffSymbols(t: HoverTakeoff | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!t) return out;
  const put = (k: string, v: number | null) => { if (v !== null && Number.isFinite(v)) out[k] = v; };
  put("SIDING_SF", t.siding.quantitySqft);
  put("ROOF_SF", t.roof.quantitySqft);
  put("ROOF_SQ", t.roof.squares);
  put("WINDOWS", t.counts.windows);
  put("DOORS", t.counts.doors);
  put("UI", t.totals.windowsUnitedInches);
  return out;
}

type Unit = "sf" | "sq" | "lf" | "ea" | "ui" | null;

function normUnit(unit: string | null | undefined): Unit {
  const u = String(unit ?? "").toLowerCase().replace(/[.\s_-]/g, "");
  if (!u) return null;
  if (["sf", "sqft", "squarefeet", "squarefoot", "ft2", "ft²", "sqf"].includes(u)) return "sf";
  if (["sq", "sqs", "square", "squares", "roofsquare", "roofsquares"].includes(u)) return "sq";
  if (["lf", "ft", "lft", "linearft", "linearfeet", "linearfoot", "feet", "foot"].includes(u)) return "lf";
  if (["ea", "each", "unit", "units", "pc", "pcs", "piece", "count", "ct"].includes(u)) return "ea";
  if (["ui", "unitedinch", "unitedinches", "uinch"].includes(u)) return "ui";
  return null;
}

export interface TakeoffFill { quantity: number; basis: string }

/**
 * The takeoff quantity for one estimate line, by its unit and name, or null when nothing fits (the line is
 * left alone). Roof-flavoured square-foot lines take the roof quantity with waste; other square-foot lines
 * take the rounded siding quantity; "sq" lines take roof squares; window/door "each" lines take the counts;
 * united-inch lines take the window total; linear-foot lines take the roof length their name names.
 */
export function takeoffQuantityForLine(
  line: { name?: string | null; unit?: string | null },
  t: HoverTakeoff | null,
): TakeoffFill | null {
  if (!t) return null;
  const unit = normUnit(line.unit);
  const name = String(line.name ?? "").toLowerCase();
  const pick = (v: number | null, basis: string): TakeoffFill | null =>
    v === null || !Number.isFinite(v) ? null : { quantity: round2(v), basis };
  // A siding product named "shingles" (Hardie shingle siding) is siding, not a roof.
  const sidingy = /siding|hardie|batten|cladding|\bwall/.test(name);
  const roofy = !sidingy && /roof|shingle|underlay|felt|ice[\s-]*(and|&)?[\s-]*water|ice[\s-]*shield|ridge[\s-]*cap|hip[\s-]*cap|decking|sheathing|tear\s*-?off|re-?roof/.test(name);

  switch (unit) {
    case "sf":
      if (/soffit/.test(name)) return pick(t.reference.soffit.totalSqft, "soffit area");
      if (/window/.test(name)) return pick(t.totals.windowsAreaSqft, "window area");
      if (/door/.test(name)) return pick(t.totals.doorsAreaSqft, "door area");
      if (roofy) return pick(t.roof.quantitySqft, `roof area + ${t.roof.wastePct}% waste`);
      return pick(t.siding.quantitySqft, `siding area rounded up to ${t.rules.sidingRoundUpTo}`);
    case "sq":
      if (sidingy) return pick(t.siding.quantitySqft === null ? null : t.siding.quantitySqft / 100, "siding squares");
      return pick(t.roof.squares, `roof squares + ${t.roof.wastePct}% waste`);
    case "ea":
      if (/window/.test(name)) return pick(t.counts.windows, "window count");
      if (/door/.test(name)) return pick(t.counts.doors, "door count");
      return null;
    case "ui":
      return pick(t.totals.windowsUnitedInches, "window united inches");
    case "lf": {
      const L = t.roof.lengths;
      if (/ridge|hip/.test(name)) return pick(L.ridgesHips, "ridges + hips");
      if (/valley/.test(name)) return pick(L.valleys, "valleys");
      if (/drip/.test(name)) return pick(L.dripEdge, "drip edge (rakes + eaves)");
      if (/step\s*flash/.test(name)) return pick(L.stepFlashing, "step flashing");
      if (/flash/.test(name)) return pick(L.flashing, "flashing");
      if (/rake/.test(name)) return pick(L.rakes, "rakes");
      if (/gutter|eave/.test(name)) return pick(L.eaves, "eaves");
      // Fascia runs along the eaves AND the rakes (a bare "Fascia" line); "eave fascia" / "rake fascia" match above.
      if (/fascia/.test(name)) return pick(L.dripEdge, "fascia (eaves + rakes)");
      if (/outside\s*corner/.test(name)) return pick(t.reference.corners.outsideLf, "outside corners");
      if (/inside\s*corner/.test(name)) return pick(t.reference.corners.insideLf, "inside corners");
      if (/starter/.test(name) && /siding/.test(name)) return pick(t.reference.trim.levelStarterLf, "siding starter");
      return null;
    }
    default:
      return null;
  }
}

/** Compact back-compat summary (raw_payload.summary, the client list) derived from a takeoff. */
export function takeoffSummary(t: HoverTakeoff | null) {
  return {
    roofSqft: t?.roof.areaSqft ?? null,
    sidingSqft: t?.siding.areaSqft ?? null,
    windowsCount: t?.counts.windows ?? null,
    stories: t?.footprint.stories ?? null,
    pitch: t?.roof.predominantPitch ?? null,
    wasteBps: t && t.roof.areaSqft !== null ? Math.round(t.roof.wastePct * 100) : null,
  };
}
