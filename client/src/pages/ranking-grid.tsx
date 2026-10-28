import { AppPage, PageHeader, Section, appTable, appTableCards } from "@/components/app-ui";
import { useState, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GoogleSurface } from "@/components/google";
import { SamplePreview, showSample } from "@/components/sample-preview";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Grid3X3, Search, Loader2, Trash2, Target, TrendingUp, ChevronDown, ChevronUp, Building, ZoomIn, ZoomOut, RotateCcw, FileText, BarChart3, Trophy, MapPin, ArrowLeft, Printer, Clock, type LucideIcon } from "lucide-react";
import type { RankingGridScan, RankingGridResult } from "@shared/schema";
import { creditsLabel, gridCreditCost, usageLine, type EntitlementsInfo } from "@/lib/pricing-display";

interface BusinessResult {
  placeId: string;
  companyName: string;
  address: string;
  category: string;
}

interface BusinessDetails {
  companyName: string;
  address: string;
  city: string;
  countyState: string;
  phone: string;
  website: string;
  category: string;
  lat?: number;
  lon?: number;
}

interface CompetitorAgg {
  name: string;
  address: string;
  foundAt: number;
  totalLocations: number;
  avgRank: number;
  bestRank: number;
}

// "A B C" / "A, B-C!" both become "a b c", so a listing address like "Denver, CO"
// compares against the scanned address "Denver, CO 80202".
const normKey = (s: string | null | undefined) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The scanned business is not its own competitor. Stored per-point rows only carry
// name+address (no place id), so match both; a same-name listing at a different
// address is another branch of the brand, not the scanned business.
function isScannedBusiness(c: { name: string; address: string }, scan: RankingGridScan): boolean {
  const bizName = normKey(scan.businessName);
  if (bizName.length < 4 || normKey(c.name) !== bizName) return false;
  const scanAddr = normKey(scan.address), compAddr = normKey(c.address);
  if (!scanAddr || !compAddr) return true;
  return scanAddr.includes(compAddr) || compAddr.includes(scanAddr);
}

/*
 * Rank colours, one set for the whole page (pins, bars, tiles, badges, thumbnails): green for the first 3, amber
 * for 4–10, orange for 11–20, red when the business is not in the first 20. Each colour always carries its number
 * or words beside it, so the colour is never the only signal. The business itself is the brand navy with an
 * orange ring.
 */
type RankBand = "top3" | "top10" | "top20" | "none";
const BANDS: Record<RankBand, { bg: string; fg: string; label: string; words: string }> = {
  top3: { bg: "#16a34a", fg: "#fff", label: "1-3", words: "in the top 3" },
  top10: { bg: "#fbbf24", fg: "#1f2328", label: "4-10", words: "4th to 10th" },
  top20: { bg: "#ea580c", fg: "#fff", label: "11-20", words: "11th to 20th" },
  none: { bg: "#dc2626", fg: "#fff", label: "20+", words: "not in the first 20" },
};
const BAND_ORDER: RankBand[] = ["top3", "top10", "top20", "none"];
const NAVY = "hsl(var(--sidebar))";
const BRAND_ORANGE = "#f57c00";

function rankBand(rank: number | null | undefined): RankBand {
  if (rank == null || rank <= 0 || rank > 20) return "none";
  return rank <= 3 ? "top3" : rank <= 10 ? "top10" : "top20";
}

function getRankBgColor(rank: number | null): string {
  return BANDS[rankBand(rank)].bg;
}

function getRankTextColor(rank: number | null): string {
  return BANDS[rankBand(rank)].fg;
}

function getRankLabel(rank: number | null): string {
  if (rank === null) return "×";
  return String(rank);
}

/** A rank (or an average rank) as a pill in its band's colour. */
function RankPill({ value, className = "", testId }: { value: number | null | undefined; className?: string; testId?: string }) {
  const band = BANDS[rankBand(value == null ? null : Math.round(value))];
  return (
    <span className={`inline-flex min-w-[2.25rem] items-center justify-center rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums shadow-sm ${className}`}
      style={{ background: band.bg, color: band.fg }} data-testid={testId}>
      {value == null ? "—" : String(Number(value.toFixed(2)))}
    </span>
  );
}

/**
 * A small heatmap of a scan: one square per grid point in its rank colour, the business in the middle. Decoration
 * beside the real figures, so it is one image with its summary as the label.
 */
function HeatThumb({ size, ranks, px = 72, className = "", testId }: {
  size: number;
  /** ranks[row][col]; undefined = not checked yet */
  ranks: (number | null | undefined)[][];
  px?: number;
  className?: string;
  testId?: string;
}) {
  const center = Math.floor(size / 2);
  const flat = ranks.flat().filter((r) => r !== undefined);
  const top3 = flat.filter((r) => rankBand(r) === "top3").length;
  const gap = size > 9 ? 1 : 2;
  return (
    <div role="img" aria-label={`Heatmap: ${top3} of ${flat.length} points in the top 3`}
      className={`grid shrink-0 rounded-lg p-1 ring-1 ring-black/5 ${className}`}
      style={{ width: px, height: px, gap, gridTemplateColumns: `repeat(${size}, 1fr)`, background: NAVY }} data-testid={testId}>
      {Array.from({ length: size * size }, (_, i) => {
        const r = Math.floor(i / size), c = i % size;
        const rank = ranks[r]?.[c];
        const isCenter = r === center && c === center;
        return (
          <span key={i} className="rounded-[2px]" style={{
            background: rank === undefined ? "rgba(255,255,255,0.18)" : getRankBgColor(rank),
            boxShadow: isCenter ? `0 0 0 1.5px ${BRAND_ORANGE}` : undefined,
          }} />
        );
      })}
    </div>
  );
}

/** A scan's results as rows of ranks, for HeatThumb. */
function ranksOf(size: number, results: RankingGridResult[]): (number | null | undefined)[][] {
  const out: (number | null | undefined)[][] = Array.from({ length: size }, () => Array<number | null | undefined>(size).fill(undefined));
  for (const r of results) if (out[r.gridRow] && r.gridCol < size) out[r.gridRow][r.gridCol] = r.rank;
  return out;
}

/** A coloured number tile: a band of colour on top, a tinted icon chip, the figure and one line under it. */
function ColorStat({ label, value, hint, color, icon: Icon, testId }: {
  label: string; value: ReactNode; hint?: ReactNode; color: string; icon: LucideIcon; testId?: string;
}) {
  return (
    <div className="relative h-full overflow-hidden rounded-xl border bg-card p-3.5 sm:p-4" data-testid={testId} data-ui="stat">
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: color }} aria-hidden="true" />
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }} aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 truncate text-2xl font-semibold tabular-nums tracking-tight" data-ui="stat-value">{value}</div>
      {hint && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function getDefaultZoom(gridSize: number, distanceMiles: number): number {
  const totalSpanMiles = (gridSize - 1) * distanceMiles;
  if (totalSpanMiles <= 1) return 15;
  if (totalSpanMiles <= 2) return 14;
  if (totalSpanMiles <= 5) return 13;
  if (totalSpanMiles <= 10) return 12;
  if (totalSpanMiles <= 25) return 11;
  if (totalSpanMiles <= 50) return 10;
  if (totalSpanMiles <= 100) return 9;
  if (totalSpanMiles <= 200) return 8;
  if (totalSpanMiles <= 500) return 7;
  return 6;
}

const ZOOM_BUTTON = "w-9 h-9 rounded-lg text-white shadow-sm ring-1 ring-white/25 flex items-center justify-center transition-[filter] hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The colour key under a map (and the business's own marker). */
function RankLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-xs ${className}`} data-testid="rank-legend">
      {BAND_ORDER.map((b) => (
        <span key={b} className="inline-flex items-center gap-1.5 rounded-full border bg-card py-0.5 pl-1 pr-2.5">
          <span className="h-3.5 w-3.5 rounded-full ring-2 ring-white/70 dark:ring-white/20" style={{ background: BANDS[b].bg }} aria-hidden="true" />
          <span className="font-medium tabular-nums">{BANDS[b].label}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 rounded-full border bg-card py-0.5 pl-1 pr-2.5">
        <span className="h-3.5 w-3.5 rounded-[4px]" style={{ background: NAVY, boxShadow: `0 0 0 2px ${BRAND_ORANGE}` }} aria-hidden="true" />
        <span className="font-medium">Your business</span>
      </span>
    </div>
  );
}

function MapGridView({ scan, results }: { scan: RankingGridScan; results: RankingGridResult[] }) {
  // The panel element doubles as the tooltips' collision boundary: by default Radix only
  // avoids the viewport, so a point on the right edge got a tooltip that ran off the map.
  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [mapFailed, setMapFailed] = useState(false);
  const defaultZoom = getDefaultZoom(scan.gridSize, parseFloat(scan.gridDistance));
  const [zoom, setZoom] = useState(defaultZoom);

  useEffect(() => {
    if (!mapEl) return;
    const el = mapEl;
    function updateSize() {
      setContainerWidth(el.offsetWidth);
    }
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [mapEl]);

  const grid: (RankingGridResult | null)[][] = [];
  for (let r = 0; r < scan.gridSize; r++) {
    grid[r] = [];
    for (let c = 0; c < scan.gridSize; c++) {
      grid[r][c] = results.find(res => res.gridRow === r && res.gridCol === c) || null;
    }
  }

  const center = Math.floor(scan.gridSize / 2);
  const mapW = containerWidth;
  const aspectRatio = 0.65;
  const mapH = Math.max(400, Math.floor(mapW * aspectRatio));

  const zoomDiff = zoom - defaultZoom;
  const scaleFactor = Math.pow(2, zoomDiff);

  const baseCellW = Math.floor((mapW - 48) / scan.gridSize);
  const baseCellH = Math.floor((mapH - 48) / scan.gridSize);
  const baseCellSize = Math.min(baseCellW, baseCellH);

  const cellSize = Math.max(12, Math.floor(baseCellSize * scaleFactor));
  const gridPixelW = cellSize * scan.gridSize;
  const gridPixelH = cellSize * scan.gridSize;
  const padX = Math.floor((mapW - gridPixelW) / 2);
  const padY = Math.floor((mapH - gridPixelH) / 2);

  const reqW = Math.min(mapW * 2, 1280);
  const reqH = Math.min(mapH * 2, 1280);
  const mapUrl = `/api/ranking-grid/map/${scan.id}?w=${reqW}&h=${reqH}&zoom=${zoom}`;

  return (
    <div ref={setMapEl} className="w-full relative">
      {/* Keep zoom controls outside the point area at every viewport width. */}
      <div className="flex justify-end gap-1 mb-2 print:hidden">
        <button
          className={ZOOM_BUTTON}
          style={{ background: NAVY }}
          onClick={() => setZoom(z => Math.min(z + 1, 20))}
          aria-label="Zoom in"
          data-testid="button-zoom-in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          className={ZOOM_BUTTON}
          style={{ background: NAVY }}
          onClick={() => setZoom(z => Math.max(z - 1, 5))}
          aria-label="Zoom out"
          data-testid="button-zoom-out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          className={ZOOM_BUTTON}
          style={{ background: NAVY }}
          onClick={() => setZoom(defaultZoom)}
          aria-label="Reset zoom"
          data-testid="button-zoom-reset"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div
        className="relative rounded-2xl overflow-hidden shadow-lg border border-border"
        style={{ width: "100%", height: mapH }}
      >
        {/* The Static Maps proxy 500s when no Places key is configured; on failure the
            grid still stands on a plain panel with a small note instead of a broken image. */}
        {!mapFailed ? (
          <img
            src={mapUrl}
            alt="Map"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: "saturate(0.55) brightness(1.03)" }}
            onError={() => setMapFailed(true)}
            data-testid="img-ranking-map"
          />
        ) : (
          <>
            <div className="absolute inset-0 bg-muted" aria-hidden="true" />
            <div className="absolute top-3 left-3 rounded-lg px-2.5 py-1.5" style={{ background: NAVY }} data-testid="text-map-unavailable">
              <span className="text-[10px] text-white font-medium">Map unavailable</span>
            </div>
          </>
        )}

        <div
          className="absolute grid"
          style={{
            top: padY,
            left: padX,
            width: gridPixelW,
            height: gridPixelH,
            gridTemplateColumns: `repeat(${scan.gridSize}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${scan.gridSize}, ${cellSize}px)`,
          }}
        >
          {grid.map((row, rIdx) =>
            row.map((cell, cIdx) => {
              const isCenter = rIdx === center && cIdx === center;
              const competitors = (cell?.topCompetitors as Array<{ name: string; address: string; rank: number }>) || [];
              const dotSize = Math.max(14, Math.min(cellSize - 6, 56));
              return (
                <Tooltip key={`${rIdx}-${cIdx}`}>
                  <TooltipTrigger asChild>
                    <div
                      className="flex items-center justify-center"
                      style={{ width: cellSize, height: cellSize }}
                      data-testid={`grid-cell-${rIdx}-${cIdx}`}
                    >
                      <div
                        className="flex items-center justify-center font-bold cursor-pointer transition-transform hover:scale-125"
                        style={{
                          width: dotSize,
                          height: dotSize,
                          borderRadius: isCenter ? "4px" : "50%",
                          background: isCenter ? NAVY : (cell ? `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${getRankBgColor(cell.rank)} 70%, #fff), ${getRankBgColor(cell.rank)} 60%)` : "rgba(100,100,100,0.5)"),
                          color: isCenter ? "#fff" : (cell ? getRankTextColor(cell.rank) : "#ccc"),
                          fontSize: dotSize > 36 ? "16px" : dotSize > 24 ? "13px" : dotSize > 16 ? "10px" : "8px",
                          border: isCenter ? `${Math.max(2, Math.min(3, Math.floor(dotSize / 12)))}px solid ${BRAND_ORANGE}` : `${Math.max(1, Math.min(2, Math.floor(dotSize / 14)))}px solid rgba(255,255,255,0.9)`,
                          boxShadow: isCenter
                            ? `0 0 0 4px color-mix(in srgb, ${BRAND_ORANGE} 35%, transparent), 0 2px 8px rgba(0,0,0,0.4)`
                            : "0 2px 6px rgba(0,0,0,0.35)",
                        }}
                      >
                        {cell ? getRankLabel(cell.rank) : (
                          <Loader2 className="h-3 w-3 animate-spin" style={{ color: "#ccc" }} />
                        )}
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" collisionBoundary={mapEl ?? []} collisionPadding={8} className="max-w-[280px] z-[100]">
                    {isCenter && <p className="font-semibold text-xs mb-1">📍 Business location</p>}
                    {cell ? (
                      <div className="space-y-1">
                        <p className="text-xs font-medium">
                          Rank: {cell.rank ? `#${cell.rank} of ${cell.totalResults}` : "Not found in top 20"}
                        </p>
                        {competitors.length > 0 && (
                          <div className="text-xs">
                            <p className="font-medium mb-0.5">Top results:</p>
                            {competitors.slice(0, 3).map((c, i) => (
                              <p key={i} className="truncate text-muted-foreground">
                                {c.rank}. {c.name}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs">Checking...</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            })
          )}
        </div>

        <div className="hidden sm:block absolute bottom-3 right-3 rounded-lg px-2 py-1" style={{ background: NAVY }}>
          <span className="text-[10px] text-white font-medium">Zoom: {zoom}</span>
        </div>
      </div>
      <RankLegend className="mt-3" />
    </div>
  );
}

function computeCompetitors(results: RankingGridResult[], scan: RankingGridScan): CompetitorAgg[] {
  const map = new Map<string, { ranks: number[]; address: string; bestRank: number }>();
  const totalLocations = results.length;

  for (const r of results) {
    const comps = ((r.topCompetitors as Array<{ name: string; address: string; rank: number }>) || []).filter(
      (c) => !isScannedBusiness(c, scan)
    );
    for (const c of comps) {
      const existing = map.get(c.name);
      if (existing) {
        existing.ranks.push(c.rank);
        if (c.rank < existing.bestRank) existing.bestRank = c.rank;
      } else {
        map.set(c.name, { ranks: [c.rank], address: c.address, bestRank: c.rank });
      }
    }
  }

  const agg: CompetitorAgg[] = [];
  map.forEach((val, name) => {
    agg.push({
      name,
      address: val.address,
      foundAt: val.ranks.length,
      totalLocations,
      avgRank: parseFloat((val.ranks.reduce((a, b) => a + b, 0) / val.ranks.length).toFixed(2)),
      bestRank: val.bestRank,
    });
  });

  agg.sort((a, b) => b.foundAt - a.foundAt || a.avgRank - b.avgRank);
  return agg;
}

function computeRankDistribution(results: RankingGridResult[]) {
  let rank1to3 = 0;
  let rank4to10 = 0;
  let rank11to20 = 0;
  let notRanked = 0;

  for (const r of results) {
    if (r.rank === null || r.rank === 0) notRanked++;
    else if (r.rank <= 3) rank1to3++;
    else if (r.rank <= 10) rank4to10++;
    else rank11to20++;
  }

  return { rank1to3, rank4to10, rank11to20, notRanked, total: results.length };
}

function RankDistributionChart({ results }: { results: RankingGridResult[] }) {
  const dist = computeRankDistribution(results);
  const counts: Record<RankBand, number> = { top3: dist.rank1to3, top10: dist.rank4to10, top20: dist.rank11to20, none: dist.notRanked };
  const segments = BAND_ORDER.map((b) => ({
    band: b, label: BANDS[b].label, count: counts[b], color: BANDS[b].bg, fg: BANDS[b].fg,
    pct: dist.total ? Math.round((counts[b] / dist.total) * 100) : 0,
  }));

  return (
    <div className="space-y-3" data-testid="rank-distribution-chart">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <BarChart3 className="h-4 w-4" style={{ color: BRAND_ORANGE }} />
        Rank distribution
      </h3>
      <div className="w-full h-8 rounded-xl overflow-hidden flex gap-0.5 bg-muted p-0.5">
        {segments.map((seg) => (
          seg.count > 0 && (
            <Tooltip key={seg.label}>
              <TooltipTrigger asChild>
                <div
                  style={{ width: `${seg.pct}%`, backgroundColor: seg.color, minWidth: seg.pct > 0 ? "14px" : 0 }}
                  className="h-full rounded-[9px] flex items-center justify-center cursor-pointer transition-opacity hover:opacity-85"
                >
                  {seg.pct >= 10 && (
                    <span className="text-[11px] font-bold" style={{ color: seg.fg }}>{seg.pct}%</span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Rank {seg.label}: {seg.count} locations ({seg.pct}%)</p>
              </TooltipContent>
            </Tooltip>
          )
        ))}
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))" }}>
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
            style={{ background: `color-mix(in srgb, ${seg.color} 10%, transparent)`, borderColor: `color-mix(in srgb, ${seg.color} 35%, transparent)` }}>
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: seg.color }} />
            <span className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{seg.label}</span>: {seg.count} ({seg.pct}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScanReport({ scan, results, onBack }: { scan: RankingGridScan; results: RankingGridResult[]; onBack: () => void }) {
  const competitors = useMemo(() => computeCompetitors(results, scan), [results, scan]);
  const dist = computeRankDistribution(results);

  const rankedResults = results.filter(r => r.rank !== null && r.rank > 0);
  const avgRank = rankedResults.length > 0
    ? (rankedResults.reduce((s, r) => s + (r.rank || 0), 0) / rankedResults.length).toFixed(2)
    : "0.00";
  const avgTotalRank = results.length > 0
    ? (results.reduce((s, r) => s + (r.rank || 0), 0) / results.length).toFixed(2)
    : "0.00";
  const bestRank = rankedResults.length > 0
    ? Math.min(...rankedResults.map(r => r.rank!))
    : 0;
  const maxDistanceMiles = ((scan.gridSize - 1) * parseFloat(scan.gridDistance) * Math.sqrt(2) / 2).toFixed(2);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 print:space-y-4" data-testid="scan-report">
      <PageHeader title={<span data-testid="text-report-title">Local rankings · {scan.businessName}</span>}
        description="Your Google Maps visibility across the scanned area."
        actions={<><Button className="text-white hover:brightness-110" style={{ background: BRAND_ORANGE }} onClick={handlePrint} data-testid="button-print-report"><Printer className="mr-2 h-4 w-4" />Print / PDF</Button><Button variant="ghost" onClick={onBack} data-testid="button-back-to-scans"><ArrowLeft className="mr-2 h-4 w-4" />Back to scans</Button></>} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          {/* The scan at a glance, on the brand navy. */}
          <section className="relative overflow-hidden rounded-2xl p-5 text-white shadow-md ring-1 ring-white/10" style={{ background: `linear-gradient(135deg, ${NAVY}, color-mix(in srgb, ${NAVY} 78%, ${BRAND_ORANGE}))` }}>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: BRAND_ORANGE }}>
                <Building className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-lg leading-6" data-testid="text-report-business">{scan.businessName}</p>
                <p className="text-sm text-white/75">{scan.address}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <ReportChip label="Keyword" value={scan.keyword} />
              <ReportChip label="Date" value={new Date(scan.createdAt!).toLocaleDateString()} />
              <ReportChip label="Grid" value={`${scan.gridSize}×${scan.gridSize} (${scan.gridSize * scan.gridSize} points)`} />
              <ReportChip label="Spacing" value={`${scan.gridDistance} mi`} />
            </div>
          </section>

          <Section title="Rank summary" icon={Target}>
            <div className="grid grid-cols-2 gap-2.5">
              <SummaryTile label="Average Rank" value={avgRank} color={BANDS[rankBand(Math.round(parseFloat(avgRank)))].bg} big />
              <SummaryTile label="Best Rank" value={bestRank > 0 ? String(bestRank) : "N/A"} color={bestRank > 0 ? BANDS[rankBand(bestRank)].bg : undefined} big />
              <SummaryTile label="Top 3 Count" value={String(dist.rank1to3)} color={dist.rank1to3 > 0 ? BANDS.top3.bg : undefined} />
              <SummaryTile label="Ranked Locations" value={`${rankedResults.length} / ${results.length}`} color={rankedResults.length > 0 ? BANDS.top3.bg : undefined} />
              <SummaryTile label="Un-Ranked Locations" value={String(dist.notRanked)} color={dist.notRanked > 0 ? BANDS.none.bg : undefined} />
              <SummaryTile label="Total Locations" value={String(results.length)} />
              <SummaryTile label="Avg Total Rank" value={avgTotalRank} />
              <SummaryTile label="Max Distance" value={`${maxDistanceMiles} Mi`} />
            </div>
          </Section>

          <Section>
            <RankDistributionChart results={results} />
          </Section>
        </div>

        <div>
          <MapGridView scan={scan} results={results} />
        </div>
      </div>

      <Section flush title="Top competitors" icon={Trophy} description="Competitors found across all grid locations, sorted by frequency">
          <div className="overflow-x-auto">
            <table className={appTable.table} data-testid="table-competitors">
              <thead className={appTableCards.thead}>
                <tr className={appTableCards.tr + " border-b bg-muted/50"}>
                  <th className="text-left py-2.5 px-4 font-medium text-muted-foreground w-10">#</th>
                  <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Name</th>
                  <th className="text-center py-2.5 px-4 font-medium text-muted-foreground">Found at</th>
                  <th className="text-center py-2.5 px-4 font-medium text-muted-foreground">AR</th>
                  <th className="text-center py-2.5 px-4 font-medium text-muted-foreground">Best</th>
                </tr>
              </thead>
              <tbody>
                {competitors.slice(0, 10).map((comp, idx) => {
                  const pct = comp.totalLocations > 0
                    ? Math.round((comp.foundAt / comp.totalLocations) * 100)
                    : 0;
                  return (
                    <tr key={idx} className={appTableCards.tr + " border-b last:border-0 hover:bg-muted/30 transition-colors"} data-testid={`row-competitor-${idx}`}>
                      <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">#: </span>
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                          style={idx < 3 ? { background: ["#f5b301", "#a7b1bd", "#c47a3d"][idx], color: idx === 0 ? "#1f2328" : "#fff" } : { background: "var(--muted, #eee)" }}>{idx + 1}</span>
                      </td>
                      <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Name: </span>
                        <p className="font-medium truncate max-w-[300px]">{comp.name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 truncate max-w-[300px]">
                          <MapPin className="h-3 w-3 shrink-0" />
                          {comp.address}
                        </p>
                      </td>
                      <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Found At: </span>
                        <div className="flex flex-col items-center gap-1">
                          <span className="font-semibold">{comp.foundAt}</span>
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: BRAND_ORANGE }} />
                          </div>
                          <span className="text-[10px] font-medium text-muted-foreground">{pct}% Locations</span>
                        </div>
                      </td>
                      <td className={appTableCards.td + " min-w-0 break-words text-center"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">AR: </span>
                        <RankPill value={comp.avgRank} />
                      </td>
                      <td className={appTableCards.td + " min-w-0 break-words text-center"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Best: </span>
                        <RankPill value={comp.bestRank} />
                      </td>
                    </tr>
                  );
                })}
                {competitors.length === 0 && (
                  <tr>
                    <td colSpan={5} className={appTableCards.td + " min-w-0 break-words"}>
                      No competitor data available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
      </Section>
    </div>
  );
}

function ReportChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
      <span className="text-white/65">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </span>
  );
}

/** One figure of the rank summary: tinted in its rank colour when the figure has one. */
function SummaryTile({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }) {
  return (
    <div className="rounded-xl border border-l-4 px-3 py-2.5"
      style={color ? { background: `color-mix(in srgb, ${color} 9%, transparent)`, borderColor: `color-mix(in srgb, ${color} 30%, transparent)`, borderLeftColor: color } : undefined}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`${big ? "text-2xl" : "text-lg"} font-bold tabular-nums`}>{value}</p>
    </div>
  );
}

// Each size's cost in ranking-grid credits, as the server charges it (gridCreditCost).
const GRID_SIZE_VALUES = [3, 5, 7, 9, 11, 13, 15];
const GRID_SIZES = GRID_SIZE_VALUES.map((n) => ({
  value: String(n),
  label: `${n}×${n} (${n * n} points) · ${creditsLabel(gridCreditCost(n))}`,
}));

const DISTANCE_OPTIONS = [
  { value: "0.5", label: "0.5 miles" },
  { value: "1", label: "1 mile" },
  { value: "2", label: "2 miles" },
  { value: "3", label: "3 miles" },
  { value: "5", label: "5 miles" },
  { value: "7", label: "7 miles" },
  { value: "10", label: "10 miles" },
  { value: "15", label: "15 miles" },
  { value: "20", label: "20 miles" },
  // The server rejects spacing above 20 miles (POST /api/ranking-grid/scans).
];

export default function RankingGridPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [businessSearch, setBusinessSearch] = useState("");
  const [searchResults, setSearchResults] = useState<BusinessResult[]>([]);
  const [selectedBusiness, setSelectedBusiness] = useState<{ placeId: string; name: string; address: string; lat: number; lon: number } | null>(null);
  const [keyword, setKeyword] = useState("");
  const [gridSize, setGridSize] = useState("3");
  const [gridDistance, setGridDistance] = useState("1");
  // Typed values are allowed beside the presets (owner 2026-10-15), within what the server accepts
  // (server/routes.ts POST /api/ranking-grid/scans): a size from the list, a spacing over 0 and up to 20 miles.
  const gridSizeValid = GRID_SIZE_VALUES.includes(Number(gridSize));
  const gridDistanceValid = Number.isFinite(Number(gridDistance)) && Number(gridDistance) > 0 && Number(gridDistance) <= 20;
  const spacingPreset = DISTANCE_OPTIONS.some((d) => d.value === gridDistance);
  const [expandedScan, setExpandedScan] = useState<number | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [viewingReport, setViewingReport] = useState<number | null>(null);

  const { data: scans = [], isLoading: scansLoading, isError: scansError } = useQuery<RankingGridScan[]>({
    queryKey: ["/api/ranking-grid/scans"],
    refetchInterval: 5000,
  });
  // This month's ranking-grid credits, as the server counts them.
  const { data: entitlements } = useQuery<EntitlementsInfo>({ queryKey: ["/api/entitlements"] });
  // The account's own businesses (Locations): one click picks one instead of typing it again (review w2-agent10 #12).
  const { data: myLocations } = useQuery<{ id: number; businessName: string; placeId?: string | null; address?: string | null; city?: string | null; state?: string | null }[]>({ queryKey: ["/api/locations"] });
  const creditsUsage = usageLine(entitlements?.usage?.rankings, entitlements?.isPlatformAdmin === true);

  const searchBusinessMutation = useMutation({
    mutationFn: async (query: string) => {
      const res = await apiRequest("POST", "/api/photos/business-search", { query });
      return res.json();
    },
    onSuccess: (data) => {
      setSearchResults(data.results || []);
      setIsSearching(false);
    },
    onError: (err: any) => {
      setIsSearching(false);
      toast({ title: "Search failed", description: apiErrorMessage(err, "Could not search for businesses"), variant: "destructive" });
    },
  });

  const selectBusinessMutation = useMutation({
    mutationFn: async (placeId: string) => {
      const res = await apiRequest("POST", "/api/photos/business-details", { placeId });
      return res.json();
    },
    onSuccess: (data: BusinessDetails, placeId: string) => {
      setSelectedBusiness({
        placeId,
        name: data.companyName,
        address: data.address,
        lat: data.lat || 0,
        lon: data.lon || 0,
      });
      setSearchResults([]);
      setBusinessSearch(data.companyName);
      fetchGeocodeForPlace(placeId);
    },
  });

  async function fetchGeocodeForPlace(placeId: string) {
    try {
      const res = await apiRequest("POST", "/api/ranking-grid/geocode", { placeId });
      const data = await res.json();
      if (data.lat && data.lon) {
        setSelectedBusiness(prev => prev ? { ...prev, lat: data.lat, lon: data.lon } : null);
      }
    } catch {}
  }

  const startScanMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBusiness || !keyword.trim()) throw new Error("Missing data");
      const res = await apiRequest("POST", "/api/ranking-grid/scans", {
        businessName: selectedBusiness.name,
        placeId: selectedBusiness.placeId,
        address: selectedBusiness.address,
        lat: selectedBusiness.lat,
        lon: selectedBusiness.lon,
        gridSize: parseInt(gridSize),
        gridDistance: gridDistance,
        keyword: keyword.trim(),
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ranking-grid/scans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
      setExpandedScan(data.id);
      toast({ title: "Scan started", description: `Checking "${keyword}" across ${gridSize}×${gridSize} grid` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to start scan", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const [scanToDelete, setScanToDelete] = useState<RankingGridScan | null>(null);
  const deleteScanMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ranking-grid/scans/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ranking-grid/scans"] });
      toast({ title: "Scan deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Could not delete scan", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  if (viewingReport !== null) {
    return <ReportView scanId={viewingReport} onBack={() => setViewingReport(null)} />;
  }

  // The newest finished scan leads the page (its heatmap and figures); the tiles add up all of them.
  const latestDone = scans.find((x) => x.status === "completed") ?? null;
  const averages = scans.filter((x) => x.status === "completed" && x.averageRank).map((x) => parseFloat(x.averageRank!)).filter((n) => Number.isFinite(n));
  const bestAverage = averages.length ? Math.min(...averages) : null;
  const running = scans.filter((x) => x.status === "running").length;
  const sizeN = gridSizeValid ? parseInt(gridSize) : 0;
  const canStart = !!selectedBusiness && !!keyword.trim() && gridSizeValid && gridDistanceValid && !startScanMutation.isPending;

  return (
    <GoogleSurface page><AppPage className="before:hidden [&_button]:min-h-10 max-sm:[&_.g-pill]:!min-h-11 max-sm:[&_button.g-chip]:!min-h-11">
      <PageHeader title={<span data-testid="text-page-title">GMB ranking grid</span>} description="See where your business ranks on Google Maps across your service area." />
        {latestDone && <LatestScanHero scan={latestDone} onViewReport={() => setViewingReport(latestDone.id)} />}
        {scans.length > 0 && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ColorStat label="Scans run" value={scans.length.toLocaleString()} icon={Grid3X3} color={BRAND_ORANGE} testId="stat-scans-run" />
            <ColorStat label="Running now" value={<span className="flex items-center gap-2">{running.toLocaleString()}{running > 0 && <Loader2 className="h-4 w-4 animate-spin" style={{ color: BRAND_ORANGE }} />}</span>} icon={Clock} color="#0ea5e9" testId="stat-scans-running" />
            <ColorStat label="Best average rank" value={bestAverage == null ? "—" : bestAverage.toFixed(1)} hint={bestAverage == null ? "Shows once a scan finishes" : "Your strongest scan so far"} icon={Trophy} color={bestAverage == null ? "#94a3b8" : BANDS[rankBand(Math.round(bestAverage))].bg} testId="stat-best-rank" />
            <ColorStat label="Credits this month" value={creditsUsage || "—"} hint="Ranking-grid credits reset monthly" icon={Target} color="#f59e0b" testId="stat-scans-credits" />
          </div>
        )}
        <Section title="New scan" icon={Target} description="Pick your business, the search your customers type, and how wide to look." contentClassName="space-y-5">
            <div className="space-y-2">
              <StepLabel n={1} htmlFor="input-business-search">Business</StepLabel>
              {(myLocations ?? []).length > 0 && (
                <div className="flex flex-wrap items-center gap-2" data-testid="ranking-grid-my-locations">
                  <span className="text-sm text-muted-foreground">Your locations:</span>
                  {(myLocations ?? []).slice(0, 6).map((loc) => {
                    const where = [loc.city, loc.state].filter(Boolean).join(", ");
                    const chosen = !!loc.placeId && selectedBusiness?.placeId === loc.placeId;
                    return (
                      <Button key={loc.id} type="button" size="sm" variant={chosen ? "default" : "outline"}
                        disabled={selectBusinessMutation.isPending || isSearching}
                        onClick={() => {
                          // A location linked to its Google listing is picked straight away; otherwise its name and town are looked up.
                          if (loc.placeId) { selectBusinessMutation.mutate(loc.placeId); return; }
                          const q = [loc.businessName, where].filter(Boolean).join(", ");
                          setBusinessSearch(q);
                          setIsSearching(true);
                          searchBusinessMutation.mutate(q);
                        }}
                        data-testid={`button-use-location-${loc.id}`}>
                        {loc.businessName}{where ? ` · ${where}` : ""}
                      </Button>
                    );
                  })}
                </div>
              )}
              <div className="relative">
                <div className="flex gap-2">
                  <Input
                    id="input-business-search"
                    placeholder="Business name, address, or Google Maps URL..."
                    value={businessSearch}
                    onChange={(e) => setBusinessSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && businessSearch.trim().length >= 2) {
                        setIsSearching(true);
                        searchBusinessMutation.mutate(businessSearch.trim());
                      }
                    }}
                    data-testid="input-business-search"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={businessSearch.trim().length < 2 || isSearching}
                    onClick={() => {
                      setIsSearching(true);
                      searchBusinessMutation.mutate(businessSearch.trim());
                    }}
                    aria-label="Search business"
                    data-testid="button-search-business"
                  >
                    {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>

                {searchResults.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-60 overflow-auto">
                    {searchResults.map((biz) => (
                      <button
                        key={biz.placeId}
                        className="w-full text-left px-3 py-2 hover:bg-accent transition-colors border-b border-border/50 last:border-0"
                        onClick={() => selectBusinessMutation.mutate(biz.placeId)}
                        data-testid={`button-select-business-${biz.placeId}`}
                      >
                        <p className="font-medium text-sm">{biz.companyName}</p>
                        <p className="text-xs text-muted-foreground truncate">{biz.address}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedBusiness && (
                <div className="flex items-center gap-2.5 rounded-xl border p-2.5"
                  style={{ background: `color-mix(in srgb, ${BRAND_ORANGE} 8%, transparent)`, borderColor: `color-mix(in srgb, ${BRAND_ORANGE} 35%, transparent)` }}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: NAVY }}>
                    <Building className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{selectedBusiness.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{selectedBusiness.address}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 h-6 w-6 p-0"
                    onClick={() => {
                      setSelectedBusiness(null);
                      setBusinessSearch("");
                    }}
                    aria-label="Clear the chosen business"
                    data-testid="button-clear-business"
                  >
                    ×
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <StepLabel n={2} htmlFor="input-keyword">Keyword</StepLabel>
              <Input
                id="input-keyword"
                placeholder="e.g. Roofing Contractor, Plumber Near Me..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                data-testid="input-keyword"
              />
            </div>

            <details className="group rounded-xl border px-3"><summary className="flex cursor-pointer list-none items-center gap-2 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <StepNumber n={3} />Grid size and spacing <span className="font-normal text-muted-foreground">· {gridSize}×{gridSize}, {gridDistance} mi apart</span>
              <ChevronDown className="ml-auto h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 pt-1">
              <div className="space-y-2">
                <Label htmlFor="select-grid-size">Grid size</Label>
                <Select value={gridSizeValid ? gridSize : ""} onValueChange={setGridSize}>
                  <SelectTrigger id="select-grid-size" data-testid="select-grid-size">
                    <SelectValue placeholder="Choose a size" />
                  </SelectTrigger>
                  <SelectContent>
                    {GRID_SIZES.map(gs => (
                      <SelectItem key={gs.value} value={gs.value}>{gs.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label htmlFor="input-grid-size" className="text-xs text-muted-foreground font-normal">Or type the points per side (an odd number from 3 to 15)</Label>
                <Input id="input-grid-size" type="number" inputMode="numeric" min={3} max={15} step={2} value={gridSize} aria-invalid={!gridSizeValid}
                  onChange={(e) => setGridSize(e.target.value)} data-testid="input-grid-size" />
                {!gridSizeValid && <p role="alert" className="text-xs text-destructive">Use 3, 5, 7, 9, 11, 13 or 15 points per side.</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="select-grid-distance">Point spacing</Label>
                <Select value={spacingPreset ? gridDistance : (gridDistanceValid ? "custom" : "")} onValueChange={(v) => { if (v !== "custom") setGridDistance(v); }}>
                  <SelectTrigger id="select-grid-distance" data-testid="select-grid-distance">
                    <SelectValue placeholder="Choose a spacing" />
                  </SelectTrigger>
                  <SelectContent>
                    {DISTANCE_OPTIONS.map(d => (
                      <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                    ))}
                    {!spacingPreset && gridDistanceValid && <SelectItem value="custom">{gridDistance} miles (typed)</SelectItem>}
                  </SelectContent>
                </Select>
                <Label htmlFor="input-grid-distance" className="text-xs text-muted-foreground font-normal">Or type the miles between points (over 0, up to 20)</Label>
                <Input id="input-grid-distance" type="number" inputMode="decimal" min={0.1} max={20} step={0.1} value={gridDistance} aria-invalid={!gridDistanceValid}
                  onChange={(e) => setGridDistance(e.target.value)} data-testid="input-grid-distance" />
                {!gridDistanceValid && <p role="alert" className="text-xs text-destructive">Spacing must be more than 0 and at most 20 miles.</p>}
              </div>
            </div>

            </details>
            <div className="flex flex-col gap-4 rounded-xl border p-3.5 sm:flex-row sm:items-center"
              style={{ background: `color-mix(in srgb, ${BRAND_ORANGE} 6%, transparent)`, borderColor: `color-mix(in srgb, ${BRAND_ORANGE} 25%, transparent)` }}>
              {gridSizeValid && (
                <div className="grid shrink-0 self-center rounded-lg p-1.5" aria-hidden="true"
                  style={{ gridTemplateColumns: `repeat(${sizeN}, 1fr)`, gap: sizeN > 9 ? 2 : 3, width: 72, height: 72, background: NAVY }}>
                  {Array.from({ length: sizeN * sizeN }, (_, i) => {
                    const isCenter = i === Math.floor((sizeN * sizeN) / 2);
                    return <span key={i} className="rounded-full" style={{ background: isCenter ? BRAND_ORANGE : "rgba(255,255,255,0.55)" }} />;
                  })}
                </div>
              )}
              {gridSizeValid && gridDistanceValid ? <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                <p>
                  This scan will check <strong>{parseInt(gridSize) * parseInt(gridSize)} grid points</strong> in a {gridSize}×{gridSize} pattern,
                  with <strong>{gridDistance} mile spacing</strong> between each point.
                  Total coverage: ~{((parseInt(gridSize) - 1) * parseFloat(gridDistance)).toFixed(1)} miles across.
                </p>
                <p className="mt-1.5" data-testid="text-grid-credits">
                  Uses <strong>{creditsLabel(gridCreditCost(parseInt(gridSize)))}</strong> of your monthly ranking-grid credits
                  {creditsUsage ? ` (${creditsUsage} this month)` : ""}.
                </p>
              </div> : <div className="min-w-0 flex-1" />}
              <Button
                className="w-full border-transparent text-white shadow-md hover:brightness-110 sm:w-auto"
                style={{ background: BRAND_ORANGE }}
                disabled={!canStart}
                onClick={() => startScanMutation.mutate()}
                data-testid="button-start-scan"
              >
                {startScanMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Target className="h-4 w-4 mr-2" />
                )}
                Start ranking scan
              </Button>
            </div>


        </Section>

        {scansLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : scansError && scans.length === 0 ? (
          <Section flush>
            <CardContent className="py-8 text-center" role="alert" data-testid="text-scans-error">
              <p className="text-sm text-destructive">Couldn't load your scans — refresh to try again.</p>
            </CardContent>
          </Section>
        ) : showSample({ isLoading: scansLoading, isError: scansError, total: scans.length }) ? (
          <div className="space-y-4">
            <Section flush>
              <CardContent className="py-10 text-center">
                <Grid3X3 className="h-12 w-12 mx-auto mb-3" style={{ color: `color-mix(in srgb, ${BRAND_ORANGE} 55%, transparent)` }} />
                <p className="text-muted-foreground">No scans yet. Start your first ranking scan above.</p>
              </CardContent>
            </Section>
            <SamplePreview what="what a finished scan looks like in your history" testId="sample-scan">
              <div className="space-y-3">
                <HeroPanel
                  eyebrow="Sample · finished scan"
                  title="Sample Roofing Co."
                  keyword="roofing contractor"
                  meta="5×5 grid · 1 mi spacing"
                  thumb={<HeatThumb size={5} ranks={SAMPLE_RANKS} px={132} />}
                  figures={sampleFigures()}
                />
                <ScanRow
                  title="Sample Roofing Co." keyword="roofing contractor" meta="5×5 grid · 1 mi spacing" average={SAMPLE_AVERAGE} pctRanked={SAMPLE_PCT}
                  status="completed" thumb={<HeatThumb size={5} ranks={SAMPLE_RANKS} px={56} />}
                  trailing={<><Button variant="outline" size="sm" className="h-7 text-xs gap-1 hidden sm:flex" tabIndex={-1}><FileText className="h-3 w-3" />Report</Button><ChevronDown className="h-4 w-4" /></>}
                />
              </div>
            </SamplePreview>
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="flex items-center gap-2 text-base font-semibold" data-testid="text-scan-history">
              Scan history
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white ring-1 ring-white/20" style={{ background: BRAND_ORANGE }}>{scans.length}</span>
            </h2>
            {scans.map((scan, i) => (
              <ScanCard
                key={scan.id}
                scan={scan}
                thumb={i < 12}
                isExpanded={expandedScan === scan.id}
                onToggle={() => setExpandedScan(expandedScan === scan.id ? null : scan.id)}
                onDelete={() => setScanToDelete(scan)}
                onViewReport={() => setViewingReport(scan.id)}
              />
            ))}
          </div>
        )}

      <AlertDialog open={!!scanToDelete} onOpenChange={o => { if (!o) setScanToDelete(null); }}>
        <AlertDialogContent data-testid="dialog-delete-scan">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this ranking scan?</AlertDialogTitle>
            <AlertDialogDescription>
              {scanToDelete
                ? `The "${scanToDelete.keyword}" scan for ${scanToDelete.businessName} (${scanToDelete.gridSize}×${scanToDelete.gridSize} grid) and all of its grid results and report will be permanently deleted. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-scan">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (scanToDelete) deleteScanMutation.mutate(scanToDelete.id); setScanToDelete(null); }}
              data-testid="button-confirm-delete-scan"
            >
              Delete scan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppPage></GoogleSurface>
  );
}

function StepNumber({ n }: { n: number }) {
  return <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: BRAND_ORANGE }} aria-hidden="true">{n}</span>;
}

function StepLabel({ n, htmlFor, children }: { n: number; htmlFor: string; children: ReactNode }) {
  return <Label htmlFor={htmlFor} className="flex items-center gap-2"><StepNumber n={n} />{children}</Label>;
}

// The empty page's sample: a made-up 5×5 scan, strong near the office and weaker toward the edges.
const SAMPLE_RANKS: number[][] = [
  [9, 7, 6, 8, 24],
  [5, 3, 2, 4, 11],
  [4, 2, 1, 3, 9],
  [6, 3, 2, 5, 12],
  [12, 8, 7, 13, 22],
];
const SAMPLE_FLAT = SAMPLE_RANKS.flat();
const SAMPLE_FOUND = SAMPLE_FLAT.filter((r) => r <= 20);
const SAMPLE_AVERAGE = Math.round((SAMPLE_FOUND.reduce((a, b) => a + b, 0) / SAMPLE_FOUND.length) * 10) / 10;
const SAMPLE_PCT = Math.round((SAMPLE_FOUND.length / SAMPLE_FLAT.length) * 100);
function sampleFigures(): HeroFigure[] {
  return [
    { label: "Average rank", value: SAMPLE_AVERAGE.toFixed(1), color: BANDS[rankBand(Math.round(SAMPLE_AVERAGE))].bg },
    { label: "In the top 3", value: `${SAMPLE_FLAT.filter((r) => r <= 3).length} of ${SAMPLE_FLAT.length}`, color: BANDS.top3.bg },
    { label: "Found in the first 20", value: `${SAMPLE_PCT}%`, color: BRAND_ORANGE },
  ];
}

type HeroFigure = { label: string; value: string; color: string };

/** The navy panel at the top of the page: a scan's heatmap beside its three headline figures. */
function HeroPanel({ eyebrow, title, keyword, meta, thumb, figures, action, testId }: {
  eyebrow: string; title: string; keyword: string; meta: string; thumb: ReactNode; figures: HeroFigure[]; action?: ReactNode; testId?: string;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl p-4 text-white shadow-md ring-1 ring-white/10 sm:p-6" data-testid={testId}
      style={{ background: `radial-gradient(120% 140% at 100% 0%, color-mix(in srgb, ${BRAND_ORANGE} 30%, ${NAVY}) 0%, ${NAVY} 55%)` }}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="self-center rounded-2xl bg-white/10 p-2 ring-1 ring-white/15">{thumb}</div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#ffb74d" }}>{eyebrow}</p>
            <p className="mt-1 truncate text-xl font-semibold sm:text-2xl">{title}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-white/75">
              <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-[#1f2328]" style={{ background: "#ffb74d" }}>{keyword}</span>
              <span>{meta}</span>
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {figures.map((f) => (
              <div key={f.label} className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/10">
                <p className="flex items-center gap-1.5 text-[11px] text-white/70"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: f.color }} aria-hidden="true" /><span className="truncate">{f.label}</span></p>
                <p className="text-lg font-bold tabular-nums sm:text-2xl">{f.value}</p>
              </div>
            ))}
          </div>
        </div>
        {action && <div className="sm:self-end">{action}</div>}
      </div>
    </section>
  );
}

/** The newest finished scan as the page's hero (its results are the same request the scan's card makes). */
function LatestScanHero({ scan, onViewReport }: { scan: RankingGridScan; onViewReport: () => void }) {
  const { data } = useQuery<{ scan: RankingGridScan; results: RankingGridResult[] }>({ queryKey: ["/api/ranking-grid/scans", scan.id] });
  const results = data?.results ?? [];
  const found = results.filter((r) => r.rank !== null && r.rank > 0).length;
  const top3 = results.filter((r) => r.rank !== null && r.rank > 0 && r.rank <= 3).length;
  const avg = scan.averageRank ? parseFloat(scan.averageRank) : null;
  return (
    <HeroPanel
      testId="ranking-grid-hero"
      eyebrow={`Latest scan · ${new Date(scan.createdAt!).toLocaleDateString()}`}
      title={scan.businessName}
      keyword={scan.keyword}
      meta={`${scan.gridSize}×${scan.gridSize} grid · ${scan.gridDistance} mi spacing`}
      thumb={<HeatThumb size={scan.gridSize} ranks={ranksOf(scan.gridSize, results)} px={132} testId="hero-heatmap" />}
      figures={[
        { label: "Average rank", value: avg == null || !Number.isFinite(avg) ? "—" : avg.toFixed(1), color: BANDS[rankBand(avg == null ? null : Math.round(avg))].bg },
        { label: "In the top 3", value: results.length ? `${top3} of ${results.length}` : "—", color: BANDS.top3.bg },
        { label: "Found in the first 20", value: results.length ? `${Math.round((found / results.length) * 100)}%` : "—", color: BRAND_ORANGE },
      ]}
      action={<Button className="w-full text-white shadow-md hover:brightness-110 sm:w-auto" style={{ background: BRAND_ORANGE }} onClick={onViewReport} data-testid="button-hero-report"><FileText className="h-4 w-4 mr-2" />View full report</Button>}
    />
  );
}

const STATUS_COLORS: Record<string, string> = { completed: "#16a34a", running: BRAND_ORANGE, pending: "#0ea5e9" };

/** A scan's row in the history (and the sample's): heatmap, business, keyword, figures, status. */
function ScanRow({ title, keyword, meta, average, pctRanked, status, thumb, trailing, onClick }: {
  title: string; keyword: string; meta: string; average: number | null; pctRanked: number | null; status: string;
  thumb: ReactNode; trailing: ReactNode; onClick?: () => void;
}) {
  const statusColor = STATUS_COLORS[status] ?? "#dc2626";
  const stripe = average == null ? statusColor : BANDS[rankBand(Math.round(average))].bg;
  return (
    <div className="relative flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3 pl-4 transition-colors hover:bg-accent/40 sm:flex-nowrap"
      style={{ cursor: onClick ? "pointer" : undefined }} onClick={onClick}>
      <span className="absolute inset-y-2 left-0 w-1 rounded-r-full" style={{ background: stripe }} aria-hidden="true" />
      <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto sm:flex-1">
        {thumb}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold">{title}</p>
            <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ background: `color-mix(in srgb, ${BRAND_ORANGE} 14%, transparent)`, color: `color-mix(in srgb, ${BRAND_ORANGE} 75%, currentColor)` }}>{keyword}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">{meta}</span>
            {average != null && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <TrendingUp className="h-3 w-3" />Avg rank <RankPill value={average} className="!px-2 !py-0 !text-xs" />
              </span>
            )}
            {pctRanked != null && (
              <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: pctRanked >= 50 ? BANDS.top3.bg : pctRanked >= 25 ? BANDS.top20.bg : BANDS.none.bg }}>
                {pctRanked}% Ranked
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
          style={{ background: `color-mix(in srgb, ${statusColor} 14%, transparent)`, color: `color-mix(in srgb, ${statusColor} 80%, currentColor)` }}>
          {status === "running" ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />}
          {status}
        </span>
        {trailing}
      </div>
    </div>
  );
}

function ScanCard({ scan, thumb, isExpanded, onToggle, onDelete, onViewReport }: {
  scan: RankingGridScan;
  /** Load the scan's points for its heatmap thumbnail (the first rows of the history). */
  thumb: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onViewReport: () => void;
}) {
  const { data } = useQuery<{ scan: RankingGridScan; results: RankingGridResult[] }>({
    queryKey: ["/api/ranking-grid/scans", scan.id],
    refetchInterval: scan.status === "running" ? 2000 : false,
    enabled: isExpanded || scan.status === "running" || thumb,
  });

  const results = data?.results || [];
  const latestScan = data?.scan || scan;

  const rankedCount = results.filter(r => r.rank !== null && r.rank > 0).length;
  const pctRanked = results.length > 0 ? Math.round((rankedCount / results.length) * 100) : 0;
  const average = latestScan.averageRank ? parseFloat(latestScan.averageRank) : null;

  return (
    <div className="space-y-0" data-testid={`card-scan-${scan.id}`}>
      <ScanRow
        title={scan.businessName}
        keyword={scan.keyword}
        meta={`${scan.gridSize}×${scan.gridSize} grid · ${scan.gridDistance} mi spacing`}
        average={average != null && Number.isFinite(average) ? average : null}
        pctRanked={latestScan.status === "completed" && results.length > 0 ? pctRanked : null}
        status={latestScan.status}
        onClick={onToggle}
        thumb={results.length > 0
          ? <HeatThumb size={latestScan.gridSize} ranks={ranksOf(latestScan.gridSize, results)} px={56} testId={`thumb-scan-${scan.id}`} />
          : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: NAVY }} aria-hidden="true">
              {latestScan.status === "running" ? <Loader2 className="h-5 w-5 animate-spin" style={{ color: BRAND_ORANGE }} /> : <Grid3X3 className="h-5 w-5" style={{ color: BRAND_ORANGE }} />}
            </span>}
        trailing={<>
          {latestScan.status === "completed" && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 hidden sm:flex"
              onClick={(e) => { e.stopPropagation(); onViewReport(); }}
              data-testid={`button-view-report-${scan.id}`}
            >
              <FileText className="h-3 w-3" />
              Report
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            aria-label="Delete scan"
            data-testid={`button-delete-scan-${scan.id}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </>}
      />

      {isExpanded && (
        <div className="-mt-2 rounded-b-xl border border-t-0 bg-card px-4 pb-4 pt-5">
            {results.length === 0 && latestScan.status === "running" ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin mr-2" style={{ color: BRAND_ORANGE }} />
                <span className="text-sm text-muted-foreground">
                  Scanning grid points... ({latestScan.gridSize * latestScan.gridSize} total)
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <MapGridView scan={latestScan} results={results} />

                {latestScan.status === "running" && results.length > 0 && (
                  <div className="w-full">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>Scanning...</span>
                      <span>{results.length} / {latestScan.gridSize * latestScan.gridSize}</span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${(results.length / (latestScan.gridSize * latestScan.gridSize)) * 100}%`, background: `linear-gradient(90deg, ${BRAND_ORANGE}, #ffb74d)` }}
                      />
                    </div>
                  </div>
                )}

                {latestScan.status === "completed" && (
                  <>
                    <div className="grid w-full grid-cols-2 gap-3 lg:grid-cols-4">
                      <ColorStat label="Grid points" value={String(latestScan.gridSize * latestScan.gridSize)} icon={Grid3X3} color={BRAND_ORANGE} />
                      <ColorStat label="Average rank" value={latestScan.averageRank || "N/A"} icon={TrendingUp} color={average == null ? "#94a3b8" : BANDS[rankBand(Math.round(average))].bg} />
                      <ColorStat label="Ranked" value={`${rankedCount} / ${results.length}`} icon={Target} color="#0ea5e9" />
                      <ColorStat label="Top 3" value={String(results.filter(r => r.rank !== null && r.rank <= 3).length)} icon={Trophy} color={BANDS.top3.bg} />
                    </div>

                    <div className="w-full">
                      <RankDistributionChart results={results} />
                    </div>

                    <Button
                      className="w-full text-white shadow-md hover:brightness-110 sm:w-auto"
                      style={{ background: BRAND_ORANGE }}
                      onClick={onViewReport}
                      data-testid={`button-full-report-${scan.id}`}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      View full report
                    </Button>
                  </>
                )}
              </div>
            )}
        </div>
      )}
    </div>
  );
}

function ReportView({ scanId, onBack }: { scanId: number; onBack: () => void }) {
  const { data, isLoading } = useQuery<{ scan: RankingGridScan; results: RankingGridResult[] }>({
    queryKey: ["/api/ranking-grid/scans", scanId],
  });

  if (isLoading || !data) {
    return (
      <div className="h-full overflow-auto">
        <div className="max-w-6xl mx-auto p-4 sm:p-6">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <GoogleSurface page><AppPage className="before:hidden [&_button]:min-h-10 max-sm:[&_.g-pill]:!min-h-11 max-sm:[&_button.g-chip]:!min-h-11"><ScanReport scan={data.scan} results={data.results} onBack={onBack} /></AppPage></GoogleSurface>
  );
}
