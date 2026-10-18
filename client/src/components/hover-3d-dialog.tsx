/**
 * The in-app HOVER 3D viewer dialog — everything stays inside ConstructHUB; nobody needs a HOVER login.
 *
 * Tabs:
 *   3D model           our three.js viewer (hover-3d-viewer.tsx, lazy-loaded) over GET …/model3d
 *   Wireframes         HOVER's wireframe PNGs streamed through our server (GET …/wireframes/:view)
 *   HOVER design studio the homeowner share link (https://hover.to/shared/<token>, embeddable) in an iframe — only
 *                      when a live share exists; contractors see how to enable it, clients never see the tab without one
 *
 * Sources (all server-gated, see server/crm/hover-model3d.ts):
 *   crm      /api/crm/measurements/:id/…        contractor session, org + record visibility
 *   portal   /api/client/measurements/:id/…     client-portal session, that customer's own capture only
 *   estimate /api/public/estimates/:token/…     the public estimate's email gate (or a contractor preview grant)
 */
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, ExternalLink, Eye, EyeOff, Loader2, Rows3, Ruler } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { HoverMesh, MeshFace } from "@shared/hover-mesh";
import type { ViewPreset } from "./hover-3d-viewer";

const Hover3DViewer = lazy(() => import("./hover-3d-viewer"));

export type Viewer3DSource =
  | { kind: "crm"; measurementId: string }
  | { kind: "portal"; measurementId: string }
  | { kind: "estimate"; token: string; preview?: string | null };

type Tab = "model" | "wireframes" | "studio";

interface Model3dResponse {
  status: "ready" | "unavailable" | "not_connected" | "rate_limited" | "error" | "denied";
  reason?: string;
  retryAfterSec?: number;
  mesh?: HoverMesh;
  address?: string | null;
  share?: { url: string } | null;
  hoverAppUrl?: string | null;
  wireframeViews?: { id: string; label: string }[];
}

const base = (s: Viewer3DSource) =>
  s.kind === "crm" ? `/api/crm/measurements/${encodeURIComponent(s.measurementId)}`
    : s.kind === "portal" ? `/api/client/measurements/${encodeURIComponent(s.measurementId)}`
      : `/api/public/estimates/${encodeURIComponent(s.token)}`;
const qs = (s: Viewer3DSource) => (s.kind === "estimate" && s.preview ? `?preview=${encodeURIComponent(s.preview)}` : "");

async function fetchModel3d(src: Viewer3DSource): Promise<Model3dResponse> {
  const r = await fetch(`${base(src)}/model3d${qs(src)}`, { credentials: "same-origin" });
  const body = await r.json().catch(() => null);
  if (body && typeof body.status === "string") return body;
  return { status: r.status === 401 || r.status === 403 || r.status === 404 || r.status === 410 ? "denied" : "error" };
}

/** Generic color names only — no manufacturer color names. */
// Generic colour families (previews, not product names). The first QUICK of each row are the buttons; every one is
// in the "More colors" dropdown; the custom picker offers soft exterior tones (PASTEL_GRID) and an exact hex code.
export const QUICK = 10;
export const SIDING_SWATCHES = [
  { name: "White", hex: "#f1f0ea" }, { name: "Cream", hex: "#ebe0c4" }, { name: "Beige", hex: "#cdb894" },
  { name: "Light gray", hex: "#b9bcbb" }, { name: "Gray", hex: "#868a8b" }, { name: "Blue", hex: "#5b6f84" },
  { name: "Green", hex: "#7f9070" }, { name: "Red", hex: "#8a3b33" }, { name: "Navy", hex: "#2f3b50" },
  { name: "Charcoal", hex: "#3c3f42" },
  { name: "Warm white", hex: "#f4efe3" }, { name: "Pale sand", hex: "#e5dbc3" }, { name: "Khaki", hex: "#b8a888" },
  { name: "Taupe", hex: "#a39483" }, { name: "Mocha", hex: "#7a6555" }, { name: "Chestnut", hex: "#5c4536" },
  { name: "Fog", hex: "#d5d8d6" }, { name: "Pewter", hex: "#9fa4a6" }, { name: "Iron gray", hex: "#5f6467" },
  { name: "Graphite", hex: "#2b2e30" }, { name: "Black", hex: "#17181a" },
  { name: "Sky blue", hex: "#a9bfcf" }, { name: "Slate blue", hex: "#6c8299" }, { name: "Deep ocean", hex: "#3d5366" },
  { name: "Mint", hex: "#b9c9b4" }, { name: "Sage", hex: "#99a68c" }, { name: "Olive", hex: "#6f7a52" }, { name: "Forest", hex: "#3f5240" },
  { name: "Butter", hex: "#efe1a9" }, { name: "Gold", hex: "#c9a44c" }, { name: "Terracotta", hex: "#b1623f" },
  { name: "Brick", hex: "#7b3a2f" }, { name: "Burgundy", hex: "#5e2a30" }, { name: "Plum", hex: "#4f3b4e" },
] as const;
export const ROOF_SWATCHES = [
  { name: "Charcoal", hex: "#3a3c3f" }, { name: "Black", hex: "#1f2022" }, { name: "Slate gray", hex: "#5d6468" },
  { name: "Brown", hex: "#5e4a3a" }, { name: "Tan", hex: "#a08a6a" }, { name: "Green", hex: "#3a4a3c" },
  { name: "Red clay", hex: "#93503a" }, { name: "Light gray", hex: "#9a9c9b" },
  { name: "Weathered wood", hex: "#6b6058" }, { name: "Driftwood", hex: "#8a7f73" }, { name: "Pewter gray", hex: "#777b7e" },
  { name: "Onyx", hex: "#2a2b2d" }, { name: "Shakewood", hex: "#7a5a44" }, { name: "Hickory", hex: "#8b6b50" },
  { name: "Desert tan", hex: "#b59a76" }, { name: "Hunter green", hex: "#2f4a38" }, { name: "Slate blue", hex: "#4d5a6b" },
  { name: "Terra cotta", hex: "#a8603f" }, { name: "Copper", hex: "#9c5a33" }, { name: "Silver (metal)", hex: "#b8bcbf" },
  { name: "Galvanized (metal)", hex: "#9da2a6" }, { name: "Bronze (metal)", hex: "#5a4a3c" }, { name: "White (metal)", hex: "#e9e9e6" },
] as const;
export const WINDOW_SWATCHES = [
  { name: "Clear glass", hex: "#4a6378" }, { name: "Sky", hex: "#6f8ea6" }, { name: "Bronze tint", hex: "#5c4f44" },
  { name: "Gray tint", hex: "#5a6166" }, { name: "Green tint", hex: "#4f6b62" }, { name: "Blue tint", hex: "#3f5d7a" },
  { name: "Mirror", hex: "#8fa3b3" }, { name: "Dark", hex: "#2e3a44" }, { name: "Smoke", hex: "#6b6f73" }, { name: "Frosted", hex: "#b7c4cc" },
] as const;
export const DOOR_SWATCHES = [
  { name: "Walnut", hex: "#6b5341" }, { name: "Oak", hex: "#a07c52" }, { name: "Mahogany", hex: "#5a2f26" },
  { name: "Black", hex: "#1c1c1e" }, { name: "White", hex: "#f0eee8" }, { name: "Red", hex: "#9b2f2a" },
  { name: "Navy", hex: "#263754" }, { name: "Forest", hex: "#2f4a38" }, { name: "Teal", hex: "#2f6b6a" }, { name: "Charcoal", hex: "#3c3f42" },
  { name: "Yellow", hex: "#e0b43a" }, { name: "Sage", hex: "#8a9a7b" }, { name: "Burgundy", hex: "#5e2a30" }, { name: "Gray", hex: "#868a8b" },
] as const;

/**
 * The custom picker's tones: 12 hues at five depths, all muted (saturation 22–32%), plus warm and cool neutrals —
 * the soft colours houses are actually painted, not the phone's fluorescent colour wheel (owner 2026-10-18: "make
 * the color wheel more pastel colors, not fluorescent"). An exact code still goes in the hex box.
 */
const PASTEL_HUES = [0, 22, 40, 55, 80, 120, 160, 190, 210, 235, 270, 320];
const PASTEL_DEPTHS: readonly [s: number, l: number][] = [[30, 88], [32, 80], [30, 70], [26, 58], [22, 45]];
const PASTEL_NEUTRALS: readonly [h: number, s: number, l: number][] = [
  [40, 8, 95], [40, 8, 88], [40, 6, 78], [40, 5, 66], [210, 5, 56], [210, 7, 42], [210, 8, 30], [210, 10, 20],
];
export function hslHex(h: number, s: number, l: number): string {
  const sat = s / 100, light = l / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    const c = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
export const PASTEL_GRID = PASTEL_DEPTHS.map(([s, l]) => PASTEL_HUES.map((h) => hslHex(h, s, l)));
export const PASTEL_NEUTRAL_HEXES = PASTEL_NEUTRALS.map(([h, s, l]) => hslHex(h, s, l));

const PRESETS: { id: ViewPreset; label: string }[] = [
  { id: "front", label: "Front" }, { id: "back", label: "Back" }, { id: "left", label: "Left" },
  { id: "right", label: "Right" }, { id: "top", label: "Top" }, { id: "iso", label: "3/4" },
];

const UNAVAILABLE_COPY: Record<string, string> = {
  no_xml_export: "HOVER has no 3D export for this capture's deliverable type.",
  no_model: "HOVER has not finished a 3D model for this capture.",
  hover_refused: "HOVER did not allow the 3D export for this capture.",
  hover_not_found: "HOVER could not find this capture's 3D model.",
  empty_geometry: "HOVER's 3D export for this capture has no geometry.",
  bad_export: "HOVER's 3D export for this capture could not be read.",
  not_hover: "This measurement did not come from HOVER.",
};

function fallbackText(d: Model3dResponse | undefined, audience: "contractor" | "client"): string {
  if (!d) return "Could not load the 3D model.";
  if (d.status === "unavailable") return UNAVAILABLE_COPY[d.reason ?? ""] ?? "The 3D model is not available for this capture.";
  if (d.status === "not_connected") {
    return audience === "contractor"
      ? "HOVER is disconnected or its sign-in expired — reconnect HOVER in Integrations to load the 3D model."
      : "The 3D model is not available right now.";
  }
  if (d.status === "rate_limited") return `HOVER is busy — try again in ${Math.max(5, d.retryAfterSec ?? 30)} seconds.`;
  if (d.status === "denied") return "This 3D model is not available to you.";
  return "Could not load the 3D model right now.";
}

export function Hover3DDialog({ open, onOpenChange, source, title, initialTab }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  source: Viewer3DSource;
  title?: string;
  initialTab?: Tab;
}) {
  const audience = source.kind === "crm" ? "contractor" : "client";
  const q = useQuery({
    queryKey: ["hover-model3d", base(source), qs(source)],
    queryFn: () => fetchModel3d(source),
    enabled: open,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const d = q.data;
  const ready = d?.status === "ready" && !!d.mesh;
  const share = d?.share?.url ?? null;
  const [tab, setTab] = useState<Tab>(initialTab ?? "model");
  useEffect(() => { if (open) setTab(initialTab ?? "model"); }, [open, initialTab]);
  // Fall back once the model answers: no mesh → the design studio when it exists, else the wireframes.
  useEffect(() => {
    if (!open || !d || initialTab) return;
    if (d.status !== "ready" && d.status !== "rate_limited") setTab(share ? "studio" : "wireframes");
  }, [open, d, share, initialTab]);

  const showStudioTab = audience === "contractor" || !!share;
  const tabs: { id: Tab; label: string }[] = [
    { id: "model", label: "3D model" },
    { id: "wireframes", label: "Wireframes" },
    ...(showStudioTab ? [{ id: "studio" as Tab, label: "HOVER design studio" }] : []),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // app-status-pad-phone: on a phone the dialog fills the screen, so the title clears the clock (index.css).
        className="app-status-pad-phone flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-[92vh] sm:w-[96vw] sm:max-w-[1400px] sm:rounded-lg"
        data-testid="dialog-hover-3d">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 pr-12">
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Box className="h-4 w-4 text-muted-foreground" /> {title ?? (audience === "client" ? "Your home in 3D" : "3D model")}
            </DialogTitle>
            <DialogDescription className="truncate text-xs">
              {d?.address ?? (audience === "client" ? "Measured with HOVER — spin, zoom and try colors." : "HOVER capture")}
            </DialogDescription>
          </div>
          <div role="tablist" className="flex gap-1 rounded-lg bg-muted p-1 text-sm" aria-label="Viewer">
            {tabs.map((t) => (
              <button key={t.id} role="tab" type="button" aria-selected={tab === t.id}
                onClick={() => setTab(t.id)} data-testid={`hover-3d-tab-${t.id}`}
                className={cn("rounded-md px-3 py-1.5 font-medium transition-colors",
                  tab === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {t.label}
              </button>
            ))}
          </div>
          {audience === "contractor" && d?.hoverAppUrl && (
            <a href={d.hoverAppUrl} target="_blank" rel="noopener noreferrer" data-testid="hover-3d-open-in-hover"
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
              Open in HOVER <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        <div className="relative min-h-0 flex-1">
          {tab === "model" && (
            q.isError ? (
              <Centered>
                <p className="max-w-md text-center text-sm text-muted-foreground" data-testid="hover-3d-error">The 3D model could not be loaded. Check your connection and try again.</p>
                <Button size="sm" variant="outline" onClick={() => q.refetch()}>Try again</Button>
              </Centered>
            ) : q.isLoading || !d ? (
              <Centered><Loader2 className="h-5 w-5 animate-spin" /> Loading the 3D model…</Centered>
            ) : ready ? (
              <ModelTab mesh={d.mesh!} />
            ) : (
              <Centered>
                <p className="max-w-md text-center text-sm text-muted-foreground" data-testid="hover-3d-fallback">{fallbackText(d, audience)}</p>
                <div className="flex gap-2">
                  {d.status === "rate_limited" && <Button size="sm" variant="outline" onClick={() => q.refetch()}>Try again</Button>}
                  <Button size="sm" variant="outline" onClick={() => setTab("wireframes")}>See wireframes</Button>
                  {share && <Button size="sm" variant="outline" onClick={() => setTab("studio")}>Open design studio</Button>}
                </div>
              </Centered>
            )
          )}
          {tab === "wireframes" && <WireframesTab source={source} views={d?.wireframeViews ?? DEFAULT_VIEWS} />}
          {tab === "studio" && (
            share ? (
              <iframe src={share} title="HOVER design studio" className="h-full w-full border-0" data-testid="hover-3d-studio"
                allow="fullscreen; xr-spatial-tracking; accelerometer; gyroscope" referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads" />
            ) : (
              <Centered>
                <p className="max-w-md text-center text-sm text-muted-foreground" data-testid="hover-3d-studio-off">
                  Create a share link in HOVER to enable the design studio here. In HOVER, open the job and tap Share —
                  ConstructHUB picks the link up on the next sync, or paste it on the project's HOVER card.
                </p>
              </Centered>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const DEFAULT_VIEWS = [
  { id: "front", label: "Front" }, { id: "back", label: "Back" }, { id: "left", label: "Left" }, { id: "right", label: "Right" },
  { id: "top", label: "Top" }, { id: "roof-lengths", label: "Roof lengths" }, { id: "roof-areas", label: "Roof areas" },
  { id: "roof-pitches", label: "Roof pitches" },
];

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">{children}</div>;
}

function ModelTab({ mesh }: { mesh: HoverMesh }) {
  const [siding, setSiding] = useState<string>(SIDING_SWATCHES[0].hex);
  const [roof, setRoof] = useState<string>(ROOF_SWATCHES[0].hex);
  const [windowColor, setWindowColor] = useState<string>(WINDOW_SWATCHES[0].hex);
  const [doorColor, setDoorColor] = useState<string>(DOOR_SWATCHES[0].hex);
  // "Select several": taps add/remove faces; the panel totals them.
  const [multi, setMulti] = useState(false);
  const [picked, setPicked] = useState<MeshFace[]>([]);
  const [showOpenings, setShowOpenings] = useState(true);
  // Lap-siding reveal in inches (0 = plain walls) and shingle courses on the roof — a look, not a product.
  const [reveal, setReveal] = useState<number>(7);
  const [shingles, setShingles] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [view, setView] = useState<{ preset: ViewPreset; seq: number }>({ preset: "iso", seq: 0 });
  const [selected, setSelected] = useState<MeshFace | null>(null);
  const onPick = (f: MeshFace | null) => {
    if (!multi) { setSelected(f); return; }
    if (!f) return;
    setPicked((cur) => (cur.some((x) => x.id === f.id) ? cur.filter((x) => x.id !== f.id) : [...cur, f]));
  };
  const selectedIds = multi ? picked.map((f) => f.id) : selected ? [selected.id] : [];
  const pickedArea = picked.reduce((a, f) => a + (f.areaSqft ?? 0), 0);
  const [panelOpen, setPanelOpen] = useState(false);

  const parentName = useMemo(() => {
    if (!selected?.parentId) return null;
    return mesh.faces.find((f) => f.id === selected.parentId)?.name ?? null;
  }, [selected, mesh]);

  return (
    <div className="flex h-full flex-col md:flex-row">
      <div className="relative min-h-[45vh] flex-1 bg-gradient-to-b from-sky-100 to-slate-50 dark:from-slate-800 dark:to-slate-900">
        <Suspense fallback={<Centered><Loader2 className="h-5 w-5 animate-spin" /> Starting 3D…</Centered>}>
          <Hover3DViewer mesh={mesh} sidingColor={siding} roofColor={roof} showOpenings={showOpenings} sidingReveal={reveal || null} roofShingles={shingles}
            showLabels={showLabels} view={view} selectedIds={selectedIds} onSelect={onPick}
            windowColor={windowColor} doorColor={doorColor} />
        </Suspense>
        <div className="absolute left-2 top-2 flex flex-wrap gap-1" data-testid="hover-3d-presets">
          {PRESETS.map((p) => (
            <Button key={p.id} size="sm" variant="secondary" className="h-7 px-2 text-xs shadow-sm"
              onClick={() => setView((v) => ({ preset: p.id, seq: v.seq + 1 }))} data-testid={`hover-3d-view-${p.id}`}>
              {p.label}
            </Button>
          ))}
          <Button size="sm" variant={multi ? "default" : "secondary"} className="h-7 px-2 text-xs shadow-sm" aria-pressed={multi}
            onClick={() => { setMulti((v) => !v); setSelected(null); setPicked([]); }} data-testid="hover-3d-multi-toggle">
            {multi ? "Select several: on" : "Select several"}
          </Button>
          {/* Phones: the design panel sits under the model, shown on demand. */}
          <Button size="sm" variant="default" className="h-7 px-2 text-xs shadow-sm md:hidden"
            onClick={() => setPanelOpen((v) => !v)} data-testid="hover-3d-design-toggle">
            {panelOpen ? "Hide design" : "Colors & options"}
          </Button>
        </div>
        {multi && (
          <div className="absolute bottom-2 left-2 right-2 rounded-lg border bg-background/95 p-3 text-sm shadow-md sm:right-auto sm:min-w-64 sm:max-w-sm"
            data-testid="hover-3d-multi-info">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">{picked.length ? `${picked.length} face${picked.length === 1 ? "" : "s"} · ${pickedArea.toLocaleString("en-US", { maximumFractionDigits: 1 })} sq ft` : "Tap faces to add them up"}</span>
              {picked.length > 0 && <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setPicked([])}>Clear</button>}
            </div>
            {picked.length > 0 && (
              <ul className="mt-1 max-h-28 overflow-y-auto text-xs tabular-nums text-muted-foreground">
                {picked.map((f) => (
                  <li key={f.id} className="flex justify-between gap-3">
                    <span className="capitalize">{f.name ?? f.type}</span>
                    <span>{f.areaSqft === null ? "—" : `${f.areaSqft.toLocaleString("en-US", { maximumFractionDigits: 1 })} sq ft`}{f.pitch ? ` · ${f.pitch}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {selected && !multi && (
          <div className="absolute bottom-2 left-2 right-2 rounded-lg border bg-background/95 p-3 text-sm shadow-md sm:right-auto sm:min-w-64"
            data-testid="hover-3d-face-info">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">
                {selected.name ?? (selected.type === "opening" ? "Window / door" : selected.type === "roof" ? "Roof facet" : "Wall")}
              </span>
              <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setSelected(null)}>Close</button>
            </div>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs tabular-nums">
              <dt className="text-muted-foreground">Type</dt>
              <dd className="capitalize">{selected.type === "opening" ? "window / door" : selected.type}</dd>
              <dt className="text-muted-foreground">Area</dt>
              <dd>
                {selected.areaSqft === null ? "—" : `${selected.areaSqft.toLocaleString("en-US", { maximumFractionDigits: 1 })} sq ft`}
                {selected.areaSource === "geometry" && <span className="text-muted-foreground"> (from the model's geometry)</span>}
                {selected.type === "wall" && selected.areaSource === "hover" && <span className="text-muted-foreground"> (net of openings)</span>}
              </dd>
              {selected.type === "roof" && (<><dt className="text-muted-foreground">Pitch</dt><dd>{selected.pitch ?? "—"}</dd></>)}
              {parentName && (<><dt className="text-muted-foreground">Wall</dt><dd>{parentName}</dd></>)}
            </dl>
          </div>
        )}
      </div>

      <aside className={cn("w-full shrink-0 space-y-4 overflow-y-auto border-t p-4 text-sm md:block md:w-72 md:border-l md:border-t-0",
        panelOpen ? "block max-h-[45vh]" : "hidden")} data-testid="hover-3d-design">
        <SwatchRow title="Siding color" swatches={SIDING_SWATCHES} value={siding} onChange={setSiding} testid="siding" />
        <SwatchRow title="Roof color" swatches={ROOF_SWATCHES} value={roof} onChange={setRoof} testid="roof" />
        <SwatchRow title="Window color" swatches={WINDOW_SWATCHES} value={windowColor} onChange={setWindowColor} testid="window" />
        <SwatchRow title="Door color" swatches={DOOR_SWATCHES} value={doorColor} onChange={setDoorColor} testid="door" />
        <label className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">{showOpenings ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} Show windows/doors</span>
          <Switch checked={showOpenings} onCheckedChange={setShowOpenings} data-testid="hover-3d-toggle-openings" />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><Rows3 className="h-4 w-4" /> Siding lines</span>
          <select value={reveal} onChange={(e) => setReveal(Number(e.target.value))} aria-label="Siding reveal"
            className="h-8 rounded-md border bg-background px-2 text-sm" data-testid="hover-3d-siding-reveal">
            <option value={0}>Off</option>
            {[4, 5, 6, 7, 8, 10, 12].map((n) => <option key={n} value={n}>{n}" reveal</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><Rows3 className="h-4 w-4" /> Shingle look</span>
          <Switch checked={shingles} onCheckedChange={setShingles} data-testid="hover-3d-toggle-shingles" />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><Ruler className="h-4 w-4" /> Measurements</span>
          <Switch checked={showLabels} onCheckedChange={setShowLabels} data-testid="hover-3d-toggle-labels" />
        </label>
        <div className="space-y-1 rounded-md bg-muted/60 p-3 text-xs tabular-nums text-muted-foreground" data-testid="hover-3d-totals">
          <div className="font-medium text-foreground">From HOVER's model</div>
          <div>{mesh.counts.roof} roof facets{mesh.totals.roofSqft !== null ? ` · ${Math.round(mesh.totals.roofSqft).toLocaleString("en-US")} sq ft` : ""}</div>
          <div>{mesh.counts.wall} wall faces{mesh.totals.wallSqft !== null ? ` · ${Math.round(mesh.totals.wallSqft).toLocaleString("en-US")} sq ft` : ""}</div>
          <div>{mesh.counts.window ?? 0} windows · {mesh.counts.door ?? 0} doors{mesh.counts.opening ? ` · ${mesh.counts.opening} other openings` : ""}</div>
          {!!mesh.counts.soffit && <div>{mesh.counts.soffit} soffit faces</div>}
        </div>
        <p className="text-xs text-muted-foreground">
          Drag to spin, pinch or scroll to zoom, right-drag or two fingers to pan. Tap a face for its size and pitch.
          Colors are a preview, not a product selection.
        </p>
      </aside>
    </div>
  );
}

function SwatchRow({ title, swatches, value, onChange, testid }: {
  title: string; swatches: readonly { name: string; hex: string }[]; value: string; onChange: (hex: string) => void; testid: string;
}) {
  const current = swatches.find((s) => s.hex === value);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{current?.name ?? "Custom"}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {swatches.slice(0, QUICK).map((s) => (
          <button key={s.hex} type="button" title={s.name} aria-label={`${title}: ${s.name}`} aria-pressed={s.hex === value}
            onClick={() => onChange(s.hex)} data-testid={`hover-3d-swatch-${testid}-${s.name.replace(/\s+/g, "-").toLowerCase()}`}
            className={cn("h-8 w-8 rounded-full border shadow-sm outline-none ring-offset-2 ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring",
              s.hex === value && "ring-2 ring-primary")}
            style={{ backgroundColor: s.hex }} />
        ))}
      </div>
      {/* The whole palette, and any colour at all. */}
      <div className="flex items-center gap-2">
        <select value={current ? value : ""} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label={`${title}: more colors`}
          className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs" data-testid={`hover-3d-palette-${testid}`}>
          <option value="">More colors…</option>
          {swatches.map((s) => <option key={s.hex} value={s.hex}>{s.name}</option>)}
        </select>
        <CustomColor title={title} value={value} onChange={onChange} testid={testid} />
      </div>
    </div>
  );
}

/** The custom colour button: a popover of soft exterior tones (PASTEL_GRID) and a hex box, not the native wheel. */
function CustomColor({ title, value, onChange, testid }: { title: string; value: string; onChange: (hex: string) => void; testid: string }) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  const swatch = (h: string, extra?: string) => (
    <button key={h} type="button" title={h} aria-label={`${title}: ${h}`} aria-pressed={h === value} onClick={() => onChange(h)}
      className={cn("aspect-square w-full rounded-sm border border-black/10 outline-none ring-offset-1 ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring dark:border-white/10",
        h === value && "ring-2 ring-primary", extra)}
      style={{ backgroundColor: h }} />
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border" title="Custom color"
          aria-label={`${title}: custom color`} data-testid={`hover-3d-custom-${testid}`}>
          <span aria-hidden="true" className="h-5 w-5 rounded-sm border border-black/10" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(value) ? value : "#888888" }} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] p-3" data-testid={`hover-3d-custom-${testid}-popover`}>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Custom color — soft exterior tones</p>
        <div className="grid grid-cols-12 gap-1">{PASTEL_GRID.flat().map((h) => swatch(h))}</div>
        <div className="mt-1.5 grid grid-cols-12 gap-1">{PASTEL_NEUTRAL_HEXES.map((h) => swatch(h))}</div>
        <label className="mt-3 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Exact code</span>
          <input value={hex} maxLength={7} spellCheck={false} placeholder="#aabbcc"
            onChange={(e) => { const v = e.target.value.trim(); setHex(v); if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toLowerCase()); }}
            className="h-7 w-24 rounded-md border bg-background px-2 font-mono text-xs" data-testid={`hover-3d-custom-${testid}-hex`} />
        </label>
      </PopoverContent>
    </Popover>
  );
}

function WireframesTab({ source, views }: { source: Viewer3DSource; views: { id: string; label: string }[] }) {
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [big, setBig] = useState<string | null>(null);
  const live = views.filter((v) => !failed.has(v.id));
  const url = (id: string) => `${base(source)}/wireframes/${encodeURIComponent(id)}${qs(source)}`;
  if (!live.length) {
    return <Centered><p className="max-w-md text-center" data-testid="hover-3d-wireframes-none">HOVER has no wireframe images for this capture.</p></Centered>;
  }
  const bigView = big && live.find((v) => v.id === big) ? big : null;
  return (
    <div className="h-full overflow-y-auto p-4" data-testid="hover-3d-wireframes">
      {bigView && (
        <figure className="mb-4 rounded-lg border bg-white p-2">
          <img src={url(bigView)} alt={`${views.find((v) => v.id === bigView)?.label} wireframe`} className="mx-auto max-h-[60vh] w-auto" />
          <figcaption className="mt-1 text-center text-xs text-muted-foreground">{views.find((v) => v.id === bigView)?.label}</figcaption>
        </figure>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {live.map((v) => (
          <button key={v.id} type="button" onClick={() => setBig(v.id)}
            className={cn("rounded-lg border bg-white p-2 text-left transition hover:shadow", !loaded.has(v.id) && "animate-pulse")}
            data-testid={`hover-3d-wireframe-${v.id}`}>
            <img src={url(v.id)} alt={`${v.label} wireframe`} loading="lazy" className="aspect-[4/3] w-full object-contain"
              onLoad={() => setLoaded((s) => new Set(s).add(v.id))}
              onError={() => setFailed((s) => new Set(s).add(v.id))} />
            <div className="mt-1 text-xs font-medium text-slate-700">{v.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A "View 3D model" button that owns its dialog. */
export function View3DButton({ source, label = "View 3D model", title, initialTab, variant = "default", size = "sm", className, testid }: {
  source: Viewer3DSource; label?: string; title?: string; initialTab?: Tab;
  variant?: "default" | "outline" | "secondary" | "ghost" | "link"; size?: "sm" | "default"; className?: string; testid?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size={size} variant={variant} className={className} onClick={() => setOpen(true)} data-testid={testid}>
        <Box className="mr-1.5 h-3.5 w-3.5" /> {label}
      </Button>
      {open && <Hover3DDialog open={open} onOpenChange={setOpen} source={source} title={title} initialTab={initialTab} />}
    </>
  );
}
