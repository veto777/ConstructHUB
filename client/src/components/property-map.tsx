/**
 * County map for the Property records page, drawn like the Search permits map (permit-map.tsx): same
 * frame, projection, zoom limits and label sizing. Each county is shaded by what the list holds for it:
 * a records site to open, an office with only a phone, or nothing listed. Clicking a county shows its
 * office row(s) exactly as the list shows them and can filter the list to it.
 *
 * Data: the offices the page already loaded from the gated /api/property-appraisers (no new endpoint,
 * nothing leaves that gate); shapes: client/public/us-counties-10m.json (us-atlas 3.0.1, public Census
 * geometry). Offices join to shapes by state FIPS + normalised county name (property-map-geo.ts); an
 * office that does not match is left off the map and stays in the list.
 *
 * Safety, as on the permit map: every <Marker> coordinate passes placeable() first (a null projection
 * white-screened /search once), and the drawing sits in an error boundary so the list keeps working.
 */
import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps";
import { feature, mesh } from "topojson-client";
import { geoAlbersUsa, geoCentroid, geoPath } from "d3-geo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GoogleList, GooglePill } from "@/components/google";
import { Plus, Minus, RotateCcw, X, MapPin, Search, List } from "lucide-react";
import { MapFrame, PermitMapBoundary } from "./permit-map";
import { FIPS_USPS, placeable, stateLabelPoint } from "./permit-map-geo";
import {
  buildCountyIndex, countyDisplayName, summarizeCoverage, TOWN_ASSESSED_STATES, type OfficeShade,
} from "./property-map-geo";
import { PropertyOfficeRow, type PropertyAppraiser } from "./property-office-row";
import { propertyOfficeLinks } from "@/pages/property-display";

// Same limits as the permit map (owner, 2026-10-14: "make sure you can zoom in even more").
const MAX_ZOOM = 128;
const WIDTH = 975, HEIGHT = 610, SCALE = 1300;
const HOME: [number, number] = [-97, 38];
// County names stay ~10px on screen at every zoom and every screen width: the font size in map units is
// NAME_PX x (map units per screen pixel) / zoom, so a phone gets the same 10px a desktop does.
const NAME_PX = 10;

const FILL: Record<OfficeShade | "empty" | "town", string> = {
  site: "var(--pm-site)", phone: "var(--pm-phone)", none: "var(--pm-none)", empty: "var(--pm-none)", town: "var(--pm-town)",
};
const STATUS: Record<OfficeShade | "empty" | "town", string> = {
  site: "Records site to open", phone: "Office phone only", none: "Office listed, no site or phone", empty: "No office on record", town: "Assessed by each town (list only)",
};

type Shape = { id: string; name: string; label: string; usps: string; at: [number, number] | null; width: number; f: any };

// The same projection ComposableMap builds from projection="geoAlbersUsa" + projectionConfig.scale.
const projection = geoAlbersUsa().translate([WIDTH / 2, HEIGHT / 2]).scale(SCALE);
const countyPath = geoPath(projection);

export function PropertyMap(props: { offices: PropertyAppraiser[]; onShowCounty: (countyId: number, stateCode: string) => void; onShowState: (stateCode: string) => void }) {
  return (
    <PermitMapBoundary message="The county map could not be drawn. The office list below still works.">
      <PropertyMapInner {...props} />
    </PermitMapBoundary>
  );
}

function PropertyMapInner({ offices, onShowCounty, onShowState }: { offices: PropertyAppraiser[]; onShowCounty: (countyId: number, stateCode: string) => void; onShowState: (stateCode: string) => void }) {
  const [topo, setTopo] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    fetch("/us-counties-10m.json")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((t) => { if (live) setTopo(t); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [attempt]);

  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<[number, number]>(HOME);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  // Map units per screen pixel (the SVG is 975 units wide and scales to its box).
  const boxRef = useRef<HTMLDivElement>(null);
  // The first "Zoom in" after picking a county zooms toward it; later ones keep wherever you panned.
  const focusNext = useRef(false);
  const [unitsPerPx, setUnitsPerPx] = useState(WIDTH / 720);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (el.clientWidth > 0) setUnitsPerPx(WIDTH / el.clientWidth); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [topo]);

  // Shapes the projection can draw (50 states + DC), with a label point and on-map width for names.
  const shapes = useMemo(() => {
    const out = new Map<string, Shape>();
    if (!topo?.objects?.counties) return out;
    for (const f of (feature(topo, topo.objects.counties) as any).features) {
      const id = String(f.id), usps = FIPS_USPS[id.slice(0, 2)];
      if (!usps) continue;
      const c = geoCentroid(f);
      const [[x0], [x1]] = countyPath.bounds(f);
      out.set(id, { id, name: f.properties?.name ?? "", label: countyDisplayName(id, f.properties?.name ?? ""), usps,
        at: placeable(c) ? c : null, width: Number.isFinite(x1 - x0) ? x1 - x0 : 0, f });
    }
    return out;
  }, [topo]);

  const coverage = useMemo(() => {
    const index = buildCountyIndex([...shapes.values()].map((s) => ({ id: s.id, name: s.name })));
    return summarizeCoverage(offices, index, (o) => propertyOfficeLinks(o).shade);
  }, [shapes, offices]);

  const kindOf = (id: string): OfficeShade | "empty" | "town" => {
    const usps = FIPS_USPS[id.slice(0, 2)];
    if (usps && TOWN_ASSESSED_STATES.has(usps)) return "town";
    return coverage.byFips.get(id)?.shade ?? "empty";
  };

  // The legend counts OFFICES by the rule the stat row above the map and every list row use (propertyOfficeLinks), so
  // the page gives one number for each kind (review w2-agent10: 2,719 vs 2,693 when the legend counted counties).
  const counts = useMemo(() => {
    const n = { site: 0, phone: 0, none: 0 };
    for (const o of offices) n[propertyOfficeLinks(o).shade]++;
    return n;
  }, [offices]);

  // 3,100 county paths: build the layer once per data change, not on every hover or zoom (React skips
  // an identical element), and keep strokes one screen pixel with non-scaling-stroke.
  const countyLayer = useMemo(() => topo && (
    <Geographies geography={topo}>
      {({ geographies, path }: any) => (
        <>
          {geographies.map((geo: any) => {
            const id = String(geo.id);
            if (!FIPS_USPS[id.slice(0, 2)]) return null;
            const fill = FILL[kindOf(id)];
            return (
              <Geography key={geo.rsmKey} geography={geo} fill={fill} stroke="var(--pm-line)" strokeWidth={0.35} vectorEffect="non-scaling-stroke" tabIndex={-1}
                onClick={() => { setSelected(id); focusNext.current = true; }} onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover((h) => (h === id ? null : h))}
                data-fips={id}
                style={{ default: { outline: "none", cursor: "pointer" }, hover: { outline: "none", cursor: "pointer", filter: "brightness(0.82) saturate(1.2)" }, pressed: { outline: "none" } }} />
            );
          })}
          <path d={path(mesh(topo, topo.objects.states, (a: any, b: any) => a !== b)) ?? undefined} fill="none" stroke="var(--pm-state-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
        </>
      )}
    </Geographies>
  ), [topo, coverage]); // eslint-disable-line react-hooks/exhaustive-deps

  // State codes, like the permit map, until county names take over.
  const stateLayer = useMemo(() => topo && (
    <Geographies geography={{ ...topo, objects: { states: topo.objects.states } }}>
      {({ geographies }: any) => geographies.map((geo: any) => {
        const usps = FIPS_USPS[geo.id as string];
        const labelAt = usps ? stateLabelPoint(geo) : null;
        return usps && labelAt ? (
          <Marker key={geo.rsmKey} coordinates={labelAt}>
            <text textAnchor="middle" dy="0.32em" fill="var(--map-state)"
              style={{ pointerEvents: "none", fontWeight: 700, letterSpacing: "0.02em", fontSize: "var(--pm-state-size)" }}>{usps}</text>
          </Marker>
        ) : null;
      })}
    </Geographies>
  ), [topo]);

  // County names: only those in view whose shape is wide enough on screen to hold the name.
  const names = useMemo(() => {
    if (zoom < 2) return [];
    const c = projection(center);
    if (!c) return [];
    const hw = WIDTH / 2 / zoom, hh = HEIGHT / 2 / zoom;
    const out: Shape[] = [];
    for (const s of shapes.values()) {
      if (!s.at) continue;
      // Shape width on screen vs the name's width at NAME_PX.
      if ((s.width * zoom) / unitsPerPx < s.label.replace(/ (County|Parish)$/, "").length * NAME_PX * 0.56 + 6) continue;
      const p = projection(s.at);
      if (!p || Math.abs(p[0] - c[0]) > hw || Math.abs(p[1] - c[1]) > hh) continue;
      out.push(s);
    }
    return out;
  }, [shapes, zoom, center, unitsPerPx]);

  const clamp = (z: number) => Math.max(1, Math.min(MAX_ZOOM, z));
  const reset = () => { setZoom(1); setCenter(HOME); setSelected(null); };
  const nameFont = (NAME_PX * unitsPerPx) / zoom;
  const sel = selected ? shapes.get(selected) : null;
  const selKind = selected ? kindOf(selected) : null;
  const selOffices = selected ? coverage.byFips.get(selected)?.offices ?? [] : [];
  const hov = hover ? shapes.get(hover) : null;
  const listOnly = coverage.unmatched.length;

  const controls = (
    <>
      <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Zoom in" onClick={() => { if (focusNext.current && sel?.at) setCenter(sel.at); focusNext.current = false; setZoom((z) => clamp(z * 1.6)); }}><Plus className="h-4 w-4" /></Button>
      <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Zoom out" onClick={() => setZoom((z) => clamp(z / 1.6))}><Minus className="h-4 w-4" /></Button>
      <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Reset map" onClick={reset}><RotateCcw className="h-4 w-4" /></Button>
    </>
  );

  return (
    <MapFrame>
      <style>{`
        .permit-map { --pm-site: hsl(var(--primary) / 0.55); --pm-phone: hsl(38 92% 50% / 0.5); --pm-none: hsl(var(--muted));
          --pm-town: hsl(var(--muted-foreground) / 0.18);
          --pm-line: hsl(var(--background)); --pm-state-line: hsl(var(--foreground) / 0.45); --pm-state-size: ${9 / Math.pow(zoom, 0.75)}px; }
        .dark .permit-map { --pm-site: hsl(var(--primary) / 0.7); --pm-phone: hsl(38 92% 55% / 0.55); }
      `}</style>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs g-text-2 border-b" data-testid="property-map-legend">
        <LegendSwatch fill={FILL.site} label={`Records site · ${counts.site.toLocaleString()} offices`} />
        <LegendSwatch fill={FILL.phone} label={`Phone only · ${counts.phone.toLocaleString()} offices`} />
        <LegendSwatch fill={FILL.none} label={`Nothing listed · ${counts.none.toLocaleString()} offices`} border />
        <LegendSwatch fill={FILL.town} label="Town-assessed (New England)" border />
        {topo && <span className="sm:ml-auto" data-testid="property-map-list-only">{listOnly > 0 ? `${listOnly.toLocaleString()} office${listOnly === 1 ? "" : "s"} list only · ` : ""}zoom in for names</span>}
      </div>

      <div className="relative" ref={boxRef}>
        {!topo && !failed && <Skeleton className="aspect-[975/610] w-full" />}
        {failed && <div className="flex aspect-[975/610] w-full flex-col items-center justify-center gap-2 g-text-2 text-sm">Map unavailable right now. <Button variant="outline" onClick={() => setAttempt((a) => a + 1)}>Retry</Button></div>}
        {topo && (
          <>
            {/* Over the map from sm up; on a phone they sit under it, so they never cover New England. */}
            <div className="absolute right-2 top-2 z-10 hidden flex-col gap-1 sm:flex">{controls}</div>
            {hov && (
              <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[70%] rounded-md border g-card px-2 py-1 text-xs shadow-sm" data-testid="property-map-hover">
                <span className="font-semibold">{hov.label}, {hov.usps}</span><span className="g-text-2"> · {STATUS[kindOf(hov.id)]}</span>
              </div>
            )}
            <ComposableMap projection="geoAlbersUsa" width={WIDTH} height={HEIGHT} projectionConfig={{ scale: SCALE }} style={{ width: "100%", height: "auto", background: "transparent" }} data-testid="property-map">
              <ZoomableGroup zoom={zoom} center={center} minZoom={1} maxZoom={MAX_ZOOM} onMoveEnd={({ zoom: z, coordinates }) => { setZoom(z); setCenter(coordinates as [number, number]); }}>
                {countyLayer}
                {sel && (
                  <path d={countyPath(sel.f) ?? undefined} fill="none" stroke="hsl(var(--foreground))" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: "none" }} data-testid="property-map-selected" />
                )}
                {zoom < 4 && stateLayer}
                {names.map((s) => (
                  <Fragment key={s.id}>
                    {s.at && placeable(s.at) && (
                      <Marker coordinates={s.at}>
                        <text textAnchor="middle" dy="0.32em" fontSize={nameFont} fill="var(--map-name)"
                          stroke="var(--map-name-bg)" strokeWidth={nameFont * 0.22} paintOrder="stroke"
                          style={{ pointerEvents: "none", fontWeight: 600 }}>{s.label.replace(/ (County|Parish)$/, "")}</text>
                      </Marker>
                    )}
                  </Fragment>
                ))}
              </ZoomableGroup>
            </ComposableMap>
          </>
        )}
      </div>

      {topo && <div className="flex justify-end gap-1 border-t px-2 py-1.5 sm:hidden">{controls}</div>}

      {sel && selKind && (
        <div className="border-t px-3 py-3" data-testid="property-map-panel" aria-live="polite">
          <div className="mb-1 flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold inline-flex items-center gap-1" data-testid="property-map-panel-title"><MapPin className="h-3.5 w-3.5 shrink-0" />{sel.label}, {sel.usps}</div>
              <div className="g-text-2 text-xs">{STATUS[selKind]}</div>
            </div>
            <button type="button" aria-label="Close" className="g-text-2 hover:g-text" onClick={() => setSelected(null)}><X className="h-4 w-4" /></button>
          </div>
          {selKind === "town" ? (
            <div className="space-y-2 text-sm g-text-2">
              <p>Property here is assessed by each town, not the county. Find the town's assessor in the list.</p>
              <GooglePill icon={List} label={`Show ${sel.usps} offices in the list`} onClick={() => onShowState(sel.usps)} testId="property-map-show-state" />
            </div>
          ) : selOffices.length ? (
            <>
              <GoogleList>
                {selOffices.map((o) => <PropertyOfficeRow key={o.id} appraiser={o} testIdPrefix="map-" />)}
              </GoogleList>
              <div className="mt-2">
                <GooglePill icon={List} label="Show this county in the list" onClick={() => onShowCounty(selOffices[0].countyId, sel.usps)} testId="property-map-show-county" />
              </div>
            </>
          ) : (
            <div className="space-y-2 text-sm g-text-2">
              <p>We have no assessor office on record for this county yet.</p>
              <GooglePill icon={Search} variant="quiet" label="Find property records" external
                title="Find the official property records office through a web search" testId="property-map-fallback"
                href={`https://www.google.com/search?q=${encodeURIComponent(`${sel.label} ${sel.usps} assessor property records`)}`} />
            </div>
          )}
        </div>
      )}
    </MapFrame>
  );
}

function LegendSwatch({ fill, label, border }: { fill: string; label: string; border?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-3 w-4 rounded-sm" style={{ background: fill, border: border ? "1px solid hsl(var(--border))" : undefined }} />{label}
    </span>
  );
}
