import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Grid3X3, Search, Loader2, Trash2, Target, TrendingUp, ChevronDown, ChevronUp, Building, ZoomIn, ZoomOut, RotateCcw, FileText, BarChart3, Trophy, MapPin, ArrowLeft, Printer } from "lucide-react";
import type { RankingGridScan, RankingGridResult } from "@shared/schema";

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

function getRankBgColor(rank: number | null): string {
  if (rank === null) return "rgba(156,163,175,0.85)";
  if (rank <= 3) return "rgba(16,185,129,0.9)";
  if (rank <= 10) return "rgba(250,204,21,0.9)";
  if (rank <= 20) return "rgba(239,68,68,0.9)";
  return "rgba(156,163,175,0.85)";
}

function getRankTextColor(rank: number | null): string {
  if (rank === null) return "#fff";
  if (rank <= 3) return "#fff";
  if (rank <= 10) return "#1a1a1a";
  return "#fff";
}

function getRankLabel(rank: number | null): string {
  if (rank === null) return "×";
  return String(rank);
}

function getRankBadgeVariant(rank: number): "default" | "secondary" | "destructive" {
  if (rank <= 3) return "default";
  if (rank <= 10) return "secondary";
  return "destructive";
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

function MapGridView({ scan, results }: { scan: RankingGridScan; results: RankingGridResult[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const defaultZoom = getDefaultZoom(scan.gridSize, parseFloat(scan.gridDistance));
  const [zoom, setZoom] = useState(defaultZoom);

  useEffect(() => {
    function updateSize() {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    }
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

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
    <div ref={containerRef} className="w-full">
      <div
        className="relative rounded-xl overflow-hidden shadow-lg border border-border"
        style={{ width: "100%", height: mapH }}
      >
        <img
          src={mapUrl}
          alt="Map"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: "brightness(0.85) contrast(1.1)" }}
          data-testid="img-ranking-map"
        />

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
                          backgroundColor: isCenter ? "rgba(74,108,247,0.9)" : (cell ? getRankBgColor(cell.rank) : "rgba(100,100,100,0.5)"),
                          color: isCenter ? "#fff" : (cell ? getRankTextColor(cell.rank) : "#ccc"),
                          fontSize: dotSize > 36 ? "16px" : dotSize > 24 ? "13px" : dotSize > 16 ? "10px" : "8px",
                          border: isCenter ? `${Math.max(2, Math.min(3, Math.floor(dotSize / 12)))}px solid #fff` : `${Math.max(1, Math.min(2, Math.floor(dotSize / 14)))}px solid rgba(255,255,255,0.6)`,
                          boxShadow: isCenter
                            ? "0 0 0 3px rgba(74,108,247,0.4), 0 2px 8px rgba(0,0,0,0.4)"
                            : "0 2px 6px rgba(0,0,0,0.35)",
                        }}
                      >
                        {cell ? getRankLabel(cell.rank) : (
                          <Loader2 className="h-3 w-3 animate-spin" style={{ color: "#ccc" }} />
                        )}
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[280px] z-[100]">
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

        <div className="absolute top-3 right-3 flex flex-col gap-1">
          <button
            className="w-9 h-9 rounded-lg bg-black/60 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/80 transition-colors"
            onClick={() => setZoom(z => Math.min(z + 1, 20))}
            data-testid="button-zoom-in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            className="w-9 h-9 rounded-lg bg-black/60 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/80 transition-colors"
            onClick={() => setZoom(z => Math.max(z - 1, 5))}
            data-testid="button-zoom-out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            className="w-9 h-9 rounded-lg bg-black/60 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/80 transition-colors"
            onClick={() => setZoom(defaultZoom)}
            data-testid="button-zoom-reset"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-sm rounded-lg px-2.5 py-1.5 flex items-center gap-2.5">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "rgba(16,185,129,0.9)" }} />
            <span className="text-[10px] text-white">1-3</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "rgba(250,204,21,0.9)" }} />
            <span className="text-[10px] text-white">4-10</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "rgba(239,68,68,0.9)" }} />
            <span className="text-[10px] text-white">11-20</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "rgba(156,163,175,0.85)" }} />
            <span className="text-[10px] text-white">20+</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: "rgba(74,108,247,0.9)", border: "1px solid #fff" }} />
            <span className="text-[10px] text-white">Business</span>
          </div>
        </div>

        <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm rounded-lg px-2 py-1">
          <span className="text-[10px] text-white font-medium">Zoom: {zoom}</span>
        </div>
      </div>
    </div>
  );
}

function computeCompetitors(results: RankingGridResult[]): CompetitorAgg[] {
  const map = new Map<string, { ranks: number[]; address: string; bestRank: number }>();
  const totalLocations = results.length;

  for (const r of results) {
    const comps = (r.topCompetitors as Array<{ name: string; address: string; rank: number }>) || [];
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
  const segments = [
    { label: "1-3", count: dist.rank1to3, color: "#10b981", pct: dist.total ? Math.round((dist.rank1to3 / dist.total) * 100) : 0 },
    { label: "4-10", count: dist.rank4to10, color: "#facc15", pct: dist.total ? Math.round((dist.rank4to10 / dist.total) * 100) : 0 },
    { label: "11-20", count: dist.rank11to20, color: "#ef4444", pct: dist.total ? Math.round((dist.rank11to20 / dist.total) * 100) : 0 },
    { label: "20+", count: dist.notRanked, color: "#9ca3af", pct: dist.total ? Math.round((dist.notRanked / dist.total) * 100) : 0 },
  ];

  return (
    <div className="space-y-3" data-testid="rank-distribution-chart">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <BarChart3 className="h-4 w-4" />
        Rank Distribution
      </h3>
      <div className="w-full h-6 rounded-full overflow-hidden flex bg-muted">
        {segments.map((seg) => (
          seg.count > 0 && (
            <Tooltip key={seg.label}>
              <TooltipTrigger asChild>
                <div
                  style={{ width: `${seg.pct}%`, backgroundColor: seg.color, minWidth: seg.pct > 0 ? "12px" : 0 }}
                  className="h-full flex items-center justify-center cursor-pointer transition-opacity hover:opacity-80"
                >
                  {seg.pct >= 10 && (
                    <span className="text-[10px] font-bold text-white drop-shadow-sm">{seg.pct}%</span>
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
      <div className="flex flex-wrap gap-3">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: seg.color }} />
            <span className="text-xs text-muted-foreground">
              {seg.label}: {seg.count} ({seg.pct}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScanReport({ scan, results, onBack }: { scan: RankingGridScan; results: RankingGridResult[]; onBack: () => void }) {
  const competitors = useMemo(() => computeCompetitors(results), [results]);
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
      <div className="flex items-center justify-between print:hidden">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-to-scans">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Scans
        </Button>
        <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-report">
          <Printer className="h-4 w-4 mr-1" />
          Print / PDF
        </Button>
      </div>

      <div className="text-center print:text-left">
        <h2 className="text-xl font-bold" data-testid="text-report-title">
          LOCAL RANKINGS SCAN REPORT | {scan.businessName.toUpperCase()}
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Building className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-base" data-testid="text-report-business">{scan.businessName}</p>
                  <p className="text-sm text-muted-foreground">{scan.address}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Keyword:</span>
                  <span className="ml-1 font-medium">{scan.keyword}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Date:</span>
                  <span className="ml-1 font-medium">{new Date(scan.createdAt!).toLocaleDateString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Grid:</span>
                  <span className="ml-1 font-medium">{scan.gridSize}×{scan.gridSize} ({scan.gridSize * scan.gridSize} points)</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Spacing:</span>
                  <span className="ml-1 font-medium">{scan.gridDistance} mi</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4" />
                Rank Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-2 gap-3">
                <SummaryRow label="Total Locations" value={String(results.length)} />
                <SummaryRow label="Ranked Locations" value={`${rankedResults.length} / ${results.length}`} highlight={rankedResults.length > 0 ? "green" : undefined} />
                <SummaryRow label="Un-Ranked Locations" value={String(dist.notRanked)} />
                <SummaryRow label="Average Rank" value={avgRank} highlight={parseFloat(avgRank) <= 5 ? "green" : parseFloat(avgRank) <= 10 ? "yellow" : "red"} />
                <SummaryRow label="Avg Total Rank" value={avgTotalRank} />
                <SummaryRow label="Best Rank" value={bestRank > 0 ? String(bestRank) : "N/A"} highlight={bestRank === 1 ? "green" : bestRank <= 3 ? "green" : bestRank <= 10 ? "yellow" : undefined} />
                <SummaryRow label="Max Distance" value={`${maxDistanceMiles} Mi`} />
                <SummaryRow label="Top 3 Count" value={String(dist.rank1to3)} highlight={dist.rank1to3 > 0 ? "green" : undefined} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <RankDistributionChart results={results} />
            </CardContent>
          </Card>
        </div>

        <div>
          <MapGridView scan={scan} results={results} />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            Top Competitors
          </CardTitle>
          <CardDescription>
            Competitors found across all grid locations, sorted by frequency
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-competitors">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2.5 px-4 font-medium text-muted-foreground w-10">#</th>
                  <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Name</th>
                  <th className="text-center py-2.5 px-4 font-medium text-muted-foreground">Found At</th>
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
                    <tr key={idx} className="border-b last:border-0 hover:bg-muted/30 transition-colors" data-testid={`row-competitor-${idx}`}>
                      <td className="py-2.5 px-4 text-muted-foreground font-medium">{idx + 1}</td>
                      <td className="py-2.5 px-4">
                        <p className="font-medium truncate max-w-[300px]">{comp.name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 truncate max-w-[300px]">
                          <MapPin className="h-3 w-3 shrink-0" />
                          {comp.address}
                        </p>
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="font-semibold">{comp.foundAt}</span>
                          <Badge
                            variant={pct >= 50 ? "default" : pct >= 25 ? "secondary" : "destructive"}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {pct}% Locations
                          </Badge>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <Badge variant={getRankBadgeVariant(Math.round(comp.avgRank))} className="text-sm font-bold px-2.5">
                          {comp.avgRank.toFixed(2)}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <Badge variant={getRankBadgeVariant(comp.bestRank)} className="text-sm font-bold px-2.5">
                          {comp.bestRank}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
                {competitors.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      No competitor data available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryRow({ label, value, highlight }: { label: string; value: string; highlight?: "green" | "yellow" | "red" }) {
  const colorClass = highlight === "green" ? "text-emerald-600 dark:text-emerald-400"
    : highlight === "yellow" ? "text-yellow-600 dark:text-yellow-400"
    : highlight === "red" ? "text-red-600 dark:text-red-400"
    : "";

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold ${colorClass}`}>{value}</span>
    </div>
  );
}

const GRID_SIZES = [
  { value: "3", label: "3×3 (9 points)" },
  { value: "5", label: "5×5 (25 points)" },
  { value: "7", label: "7×7 (49 points)" },
  { value: "9", label: "9×9 (81 points)" },
  { value: "11", label: "11×11 (121 points)" },
  { value: "13", label: "13×13 (169 points)" },
  { value: "15", label: "15×15 (225 points)" },
];

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
  { value: "25", label: "25 miles" },
  { value: "30", label: "30 miles" },
  { value: "40", label: "40 miles" },
  { value: "50", label: "50 miles" },
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
  const [expandedScan, setExpandedScan] = useState<number | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [viewingReport, setViewingReport] = useState<number | null>(null);

  const { data: scans = [], isLoading: scansLoading } = useQuery<RankingGridScan[]>({
    queryKey: ["/api/ranking-grid/scans"],
    refetchInterval: 5000,
  });

  const searchBusinessMutation = useMutation({
    mutationFn: async (query: string) => {
      const res = await apiRequest("POST", "/api/photos/business-search", { query });
      return res.json();
    },
    onSuccess: (data) => {
      setSearchResults(data.results || []);
      setIsSearching(false);
    },
    onError: () => {
      setIsSearching(false);
      toast({ title: "Search failed", description: "Could not search for businesses", variant: "destructive" });
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
      setExpandedScan(data.id);
      toast({ title: "Scan started", description: `Checking "${keyword}" across ${gridSize}×${gridSize} grid` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to start scan", description: err.message, variant: "destructive" });
    },
  });

  const deleteScanMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ranking-grid/scans/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ranking-grid/scans"] });
    },
  });

  if (viewingReport !== null) {
    return <ReportView scanId={viewingReport} onBack={() => setViewingReport(null)} />;
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Grid3X3 className="h-6 w-6 text-primary" />
            GMB Ranking Grid
          </h1>
          <div className="h-1 w-16 rounded-full bg-gradient-to-r from-[#4A6CF7] to-[#F97316] mt-1" />
          <p className="text-muted-foreground text-sm mt-1 max-w-lg">
            You might rank #1 from your office but #15 from 5 miles away. See exactly where you rank on Google Maps across your entire service area with a visual heatmap grid.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">New Scan</CardTitle>
            <CardDescription>Search for your business, pick a keyword, and see your rankings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Business</Label>
              <div className="relative">
                <div className="flex gap-2">
                  <Input
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
                <div className="flex items-center gap-2 p-2 bg-primary/5 rounded-lg border border-primary/20">
                  <Building className="h-4 w-4 text-primary shrink-0" />
                  <div className="min-w-0">
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
                    data-testid="button-clear-business"
                  >
                    ×
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Keyword</Label>
              <Input
                placeholder="e.g. Roofing Contractor, Plumber Near Me..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                data-testid="input-keyword"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Grid Size / Locations</Label>
                <Select value={gridSize} onValueChange={setGridSize}>
                  <SelectTrigger data-testid="select-grid-size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GRID_SIZES.map(gs => (
                      <SelectItem key={gs.value} value={gs.value}>{gs.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Distance from Grid Center</Label>
                <Select value={gridDistance} onValueChange={setGridDistance}>
                  <SelectTrigger data-testid="select-grid-distance">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISTANCE_OPTIONS.map(d => (
                      <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
              <p>
                This scan will check <strong>{parseInt(gridSize) * parseInt(gridSize)} grid points</strong> in a {gridSize}×{gridSize} pattern,
                with <strong>{gridDistance} mile spacing</strong> between each point.
                Total coverage: ~{((parseInt(gridSize) - 1) * parseFloat(gridDistance)).toFixed(1)} miles across.
              </p>
            </div>

            <Button
              className="w-full"
              disabled={!selectedBusiness || !keyword.trim() || startScanMutation.isPending}
              onClick={() => startScanMutation.mutate()}
              data-testid="button-start-scan"
            >
              {startScanMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Target className="h-4 w-4 mr-2" />
              )}
              Start Ranking Scan
            </Button>
          </CardContent>
        </Card>

        {scansLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : scans.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Grid3X3 className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">No scans yet. Start your first ranking scan above.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold" data-testid="text-scan-history">Scan History</h2>
            {scans.map((scan) => (
              <ScanCard
                key={scan.id}
                scan={scan}
                isExpanded={expandedScan === scan.id}
                onToggle={() => setExpandedScan(expandedScan === scan.id ? null : scan.id)}
                onDelete={() => deleteScanMutation.mutate(scan.id)}
                onViewReport={() => setViewingReport(scan.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScanCard({ scan, isExpanded, onToggle, onDelete, onViewReport }: {
  scan: RankingGridScan;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onViewReport: () => void;
}) {
  const { data } = useQuery<{ scan: RankingGridScan; results: RankingGridResult[] }>({
    queryKey: ["/api/ranking-grid/scans", scan.id],
    refetchInterval: scan.status === "running" ? 2000 : false,
    enabled: isExpanded || scan.status === "running",
  });

  const results = data?.results || [];
  const latestScan = data?.scan || scan;

  const rankedCount = results.filter(r => r.rank !== null && r.rank > 0).length;
  const pctRanked = results.length > 0 ? Math.round((rankedCount / results.length) * 100) : 0;

  return (
    <Card data-testid={`card-scan-${scan.id}`}>
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-accent/50 transition-colors rounded-t-lg"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0">
            {latestScan.status === "running" ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : latestScan.status === "completed" ? (
              <Target className="h-5 w-5 text-emerald-500" />
            ) : (
              <Target className="h-5 w-5 text-red-500" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm truncate">{scan.businessName}</p>
              <Badge variant="secondary" className="text-xs shrink-0">
                {scan.keyword}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <span>{scan.gridSize}×{scan.gridSize} grid</span>
              <span>·</span>
              <span>{scan.gridDistance} mi spacing</span>
              {latestScan.averageRank && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-0.5">
                    <TrendingUp className="h-3 w-3" />
                    Avg rank: {latestScan.averageRank}
                  </span>
                </>
              )}
              {latestScan.status === "completed" && results.length > 0 && (
                <>
                  <span>·</span>
                  <Badge variant={pctRanked >= 50 ? "default" : pctRanked >= 25 ? "secondary" : "destructive"} className="text-[10px] px-1 py-0">
                    {pctRanked}% Ranked
                  </Badge>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={latestScan.status === "completed" ? "default" : latestScan.status === "running" ? "secondary" : "destructive"}>
            {latestScan.status}
          </Badge>
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
            data-testid={`button-delete-scan-${scan.id}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </div>

      {isExpanded && (
        <CardContent className="pt-0 pb-4">
          <div className="border-t border-border pt-4">
            {results.length === 0 && latestScan.status === "running" ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
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
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${(results.length / (latestScan.gridSize * latestScan.gridSize)) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {latestScan.status === "completed" && (
                  <>
                    <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                      <StatBox label="Grid Points" value={String(latestScan.gridSize * latestScan.gridSize)} />
                      <StatBox label="Avg Rank" value={latestScan.averageRank || "N/A"} />
                      <StatBox label="Ranked" value={`${rankedCount} / ${results.length}`} />
                      <StatBox label="Top 3" value={String(results.filter(r => r.rank !== null && r.rank <= 3).length)} />
                    </div>

                    <div className="w-full">
                      <RankDistributionChart results={results} />
                    </div>

                    <Button
                      variant="default"
                      className="w-full sm:w-auto"
                      onClick={onViewReport}
                      data-testid={`button-full-report-${scan.id}`}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      View Full Report
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
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
    <div className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        <ScanReport scan={data.scan} results={data.results} onBack={onBack} />
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 rounded-lg p-3 text-center">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
