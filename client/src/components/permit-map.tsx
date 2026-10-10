/**
 * US permit-coverage map for the Search Permits page. States fill blue where at
 * least one COUNTY permit portal is live-searchable; every searchable portal is a
 * clickable orange dot (the "find them manually" path). Zoom + pan with a reset.
 * Data: GET /api/permits/map (same searchable predicate as the headline count);
 * centroids are public US Census Gazetteer (server/data/jurisdiction-coords.json).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Search as SearchIcon, Plus, Minus, RotateCcw, X, MapPin } from "lucide-react";

export interface MapPortal {
  databaseId: number;
  jurisdiction: string;
  jurisdictionType: string;
  state: string | null;
  countyName: string | null;
  countyId: number;
  platform: string | null;
  portalUrl: string | null;
  searchUrl: string | null;
  lat: number | null;
  lng: number | null;
  alertsSupported: boolean;
}
interface MapData {
  summary: { searchable: number; withCoords: number; counties: number; cities: number; states: number };
  states: { stateCode: string; countySearchable: boolean; totalPortals: number }[];
  portals: MapPortal[];
}

// State FIPS (us-atlas geography id) -> USPS code, to join the topojson to /api/permits/map.
const FIPS_USPS: Record<string, string> = {
  "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL",
  "13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME",
  "24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH",
  "34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI",
  "45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI",
  "56":"WY","72":"PR",
};

type Cell = { key: string; lat: number; lng: number; portals: MapPortal[]; hasCounty: boolean };

// Degrees of lat/lng merged into one dot at a given zoom (0 = show every site).
function gridStep(zoom: number): number {
  if (zoom >= 6) return 0;
  if (zoom >= 4) return 0.12;
  if (zoom >= 2.5) return 0.35;
  if (zoom >= 1.5) return 0.7;
  return 1.3;
}

export function PermitMap({ onPick }: { onPick: (p: MapPortal) => void }) {
  const { data, isLoading, isError } = useQuery<MapData>({ queryKey: ["/api/permits/map"] });
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<[number, number]>([-97, 38]);
  const [selected, setSelected] = useState<Cell | null>(null);

  const blueStates = useMemo(() => {
    const s = new Set<string>();
    for (const st of data?.states ?? []) if (st.countySearchable) s.add(st.stateCode);
    return s;
  }, [data]);

  const located = useMemo(() => (data?.portals ?? []).filter((p) => p.lat != null && p.lng != null), [data]);

  // Group portals into dots; merge nearby ones at low zoom so ~1,800 points stay smooth.
  const cells = useMemo<Cell[]>(() => {
    const step = gridStep(zoom);
    const by = new Map<string, Cell>();
    for (const p of located) {
      const lat = p.lat as number, lng = p.lng as number;
      const key = step === 0 ? `${lat.toFixed(4)},${lng.toFixed(4)}`
        : `${Math.round(lat / step)},${Math.round(lng / step)}`;
      let c = by.get(key);
      if (!c) { c = { key, lat, lng, portals: [], hasCounty: false }; by.set(key, c); }
      c.portals.push(p);
      if (p.jurisdictionType === "county") c.hasCounty = true;
    }
    // Centre each merged dot on its members.
    for (const c of by.values()) {
      c.lat = c.portals.reduce((s, p) => s + (p.lat as number), 0) / c.portals.length;
      c.lng = c.portals.reduce((s, p) => s + (p.lng as number), 0) / c.portals.length;
    }
    return Array.from(by.values());
  }, [located, zoom]);

  const clamp = (z: number) => Math.max(1, Math.min(12, z));
  const reset = () => { setZoom(1); setCenter([-97, 38]); setSelected(null); };

  return (
    <div className="permit-map rounded-xl border g-card overflow-hidden">
      <style>{`
        .permit-map { --map-land: hsl(var(--muted)); --map-land-stroke: hsl(var(--background));
          --map-blue: hsl(var(--primary) / 0.32); --map-blue-stroke: hsl(var(--primary) / 0.6);
          --map-dot: #f97316; --map-dot-stroke: #ffffff; }
        .dark .permit-map { --map-blue: hsl(var(--primary) / 0.45); --map-dot: #fb923c; --map-dot-stroke: hsl(var(--background)); }
        .permit-map .rsm-geography { outline: none; }
      `}</style>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs g-text-2 border-b">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-4 rounded-sm" style={{ background: "var(--map-blue)", border: "1px solid var(--map-blue-stroke)" }} />County permits searchable</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-4 rounded-sm" style={{ background: "var(--map-land)" }} />No county portal yet</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--map-dot)", border: "1.5px solid var(--map-dot-stroke)" }} />Searchable portal</span>
        {data && <span className="ml-auto">{data.summary.withCoords.toLocaleString()} portals mapped</span>}
      </div>

      <div className="relative">
        {isLoading && <div className="flex h-[300px] items-center justify-center g-text-2 text-sm">Loading map…</div>}
        {isError && <div className="flex h-[300px] items-center justify-center g-text-2 text-sm">Map unavailable right now.</div>}
        {data && (
          <>
            <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
              <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Zoom in" onClick={() => setZoom((z) => clamp(z * 1.5))}><Plus className="h-4 w-4" /></Button>
              <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Zoom out" onClick={() => setZoom((z) => clamp(z / 1.5))}><Minus className="h-4 w-4" /></Button>
              <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Reset map" onClick={reset}><RotateCcw className="h-4 w-4" /></Button>
            </div>
            <ComposableMap projection="geoAlbersUsa" width={975} height={610} projectionConfig={{ scale: 1300 }} style={{ width: "100%", height: "auto", background: "transparent" }}>
              <ZoomableGroup zoom={zoom} center={center} minZoom={1} maxZoom={12} onMoveEnd={({ zoom: z, coordinates }) => { setZoom(z); setCenter(coordinates as [number, number]); }}>
                <Geographies geography="/us-states-10m.json">
                  {({ geographies }: any) => geographies.map((geo: any) => {
                    const usps = FIPS_USPS[geo.id as string];
                    const blue = usps ? blueStates.has(usps) : false;
                    return (
                      <Geography key={geo.rsmKey} geography={geo}
                        fill={blue ? "var(--map-blue)" : "var(--map-land)"}
                        stroke="var(--map-land-stroke)" strokeWidth={0.5}
                        style={{ default: { outline: "none" }, hover: { outline: "none", fill: blue ? "var(--map-blue-stroke)" : "var(--map-land)" }, pressed: { outline: "none" } }} />
                    );
                  })}
                </Geographies>
                {cells.map((c) => {
                  const r = (c.hasCounty ? 4.2 : 2.9) / Math.sqrt(zoom);
                  return (
                    <Marker key={c.key} coordinates={[c.lng, c.lat]} onClick={() => setSelected(c)} style={{ default: { cursor: "pointer" }, hover: { cursor: "pointer" }, pressed: {} }}>
                      <circle r={r} fill="var(--map-dot)" stroke="var(--map-dot-stroke)" strokeWidth={r > 3 ? 1 : 0.6} opacity={0.92} />
                      {c.portals.length > 1 && zoom < 6 && (
                        <text textAnchor="middle" y={r * 0.5} fontSize={r * 1.1} fill="var(--map-dot-stroke)" style={{ pointerEvents: "none", fontWeight: 700 }}>{c.portals.length}</text>
                      )}
                    </Marker>
                  );
                })}
              </ZoomableGroup>
            </ComposableMap>
          </>
        )}

        {selected && (
          <div className="absolute inset-x-2 bottom-2 z-20 max-h-[55%] overflow-auto rounded-lg border g-card p-3 shadow-lg sm:inset-x-auto sm:right-2 sm:w-80" data-testid="map-portal-panel">
            <div className="mb-1 flex items-start justify-between gap-2">
              <span className="text-sm font-semibold inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0" />{selected.portals.length > 1 ? `${selected.portals.length} portals here` : selected.portals[0].jurisdiction}</span>
              <button type="button" aria-label="Close" className="g-text-2 hover:g-text" onClick={() => setSelected(null)}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2.5">
              {selected.portals.slice(0, 40).map((p) => {
                const link = p.portalUrl || p.searchUrl;
                return (
                  <div key={p.databaseId} className="border-t pt-2 first:border-t-0 first:pt-0">
                    <div className="text-sm font-medium">{p.jurisdiction}</div>
                    <div className="g-text-2 text-xs">
                      {p.countyName ? `${p.countyName} County · ` : ""}{p.platform || "Portal"}
                      {p.alertsSupported && <Badge variant="outline" className="ml-1.5 px-1 py-0 text-[10px]">Alerts</Badge>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={() => { onPick(p); setSelected(null); }} data-testid={`map-search-${p.databaseId}`}><SearchIcon className="mr-1 h-3 w-3" />Search this portal</Button>
                      {link && <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center rounded-md border px-2 text-xs g-text hover:g-card-2"><ExternalLink className="mr-1 h-3 w-3" />Official site</a>}
                    </div>
                  </div>
                );
              })}
              {selected.portals.length > 40 && <div className="g-text-2 text-xs">+{selected.portals.length - 40} more — zoom in to separate them.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
