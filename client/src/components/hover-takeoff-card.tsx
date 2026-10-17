/**
 * HOVER report card — the details imported from a client's HOVER report, as the numbers an estimator quotes from.
 * Mounted on the client page (right under Quick actions), the project page and the estimate page.
 *
 * Data: GET /api/crm/{customers|projects|estimates}/:id/takeoff (server/crm/hover.ts) → { takeoff, takeoffs }.
 * Each takeoff (shared/hover-takeoff.ts) already carries the owner's rules: siding rounded up to the next 100 ft²,
 * roof + at least 5 % waste (squares = ft² / 100). Several reports → the best one is shown, with a picker.
 * Renders nothing when the client has no HOVER measurements.
 *
 * "Open report" shows HOVER's measurement PDF inside ConstructHUB (the gated file route, ?inline=1) with a
 * Download button; a report not stored yet can be fetched from HOVER (POST /api/crm/measurements/:id/hover-pdf).
 *
 * Slots: `onFill` (estimate editors) adds "Fill from HOVER"; `renderModel3dAction` lets the in-app 3D viewer put
 * its "View 3D model" button in the header (without it the card links to the contractor's HOVER viewer).
 */
import { View3DButton } from "@/components/hover-3d-dialog";
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, FileText, Loader2, Ruler, Wand2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionTitle } from "@/components/crm-ui";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import type { HoverTakeoff } from "@shared/hover-takeoff";

const n = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: digits });

/** 188.67 → 188′ 8″ */
export function feetInches(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  let ft = Math.floor(v);
  let inch = Math.round((v - ft) * 12);
  if (inch === 12) { ft += 1; inch = 0; }
  return `${ft.toLocaleString("en-US")}′ ${inch}″`;
}

const wh = (w: number | null, h: number | null) => (w === null || h === null ? "—" : `${n(w, 1)}″ × ${n(h, 1)}″`);
const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString() : null);
const street = (t: HoverTakeoff) => t.source?.address?.split(",")[0]?.trim() || null;

function Tile({ label, value, sub, testId }: { label: string; value: ReactNode; sub?: ReactNode; testId: string }) {
  return (
    <div className="rounded-lg border p-3 min-w-0" data-testid={testId}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums leading-snug">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm tabular-nums">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One expandable section (native <details>: keyboard + screen-reader friendly, no state). */
function Section({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border px-3 py-2" data-testid={testId}>
      <summary className="cursor-pointer select-none text-sm font-medium marker:text-muted-foreground">{title}</summary>
      <div className="pt-2 overflow-x-auto">{children}</div>
    </details>
  );
}

const th = "text-left font-normal py-1 pr-3";
const thr = "text-right font-normal py-1";

export function HoverTakeoffCard({
  projectId, estimateId, customerId, onFill, fillDisabled, renderModel3dAction,
}: {
  projectId?: string; estimateId?: string; customerId?: string;
  onFill?: (t: HoverTakeoff) => void; fillDisabled?: boolean;
  /** Slot for the in-app 3D viewer's "View 3D model" button. */
  renderModel3dAction?: (t: HoverTakeoff) => ReactNode;
}) {
  const { toast } = useToast();
  const path = projectId ? `/api/crm/projects/${projectId}/takeoff`
    : estimateId ? `/api/crm/estimates/${estimateId}/takeoff`
    : customerId ? `/api/crm/customers/${customerId}/takeoff` : null;
  const { data } = useQuery<{ takeoff: HoverTakeoff | null; takeoffs?: HoverTakeoff[] }>({
    queryKey: [path], enabled: !!path,
  });
  const all = useMemo(() => data?.takeoffs ?? (data?.takeoff ? [data.takeoff] : []), [data]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const t = all.find((x) => x.source?.measurementId === pickedId) ?? all[0] ?? null;

  const fetchPdf = useMutation({
    mutationFn: async (measurementId: string) =>
      (await apiRequest("POST", `/api/crm/measurements/${measurementId}/hover-pdf`, {})).json(),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).endsWith("/takeoff") || String(q.queryKey[0]).endsWith("/measurements") });
      if (r?.pdfUrl) setViewer(r.pdfUrl);
    },
    onError: (e: any) => toast({ title: "Could not fetch the report", description: apiErrorMessage(e), variant: "destructive" }),
  });

  if (!t) return null;
  const s = t.source;
  const L = t.roof.lengths;
  const R = t.reference;
  const addr = street(t);
  // Newest first in the picker.
  const options = [...all].sort((a, b) => (b.source?.capturedAt ?? "").localeCompare(a.source?.capturedAt ?? ""));

  return (
    <Card data-testid="card-hover-takeoff">
      <CardHeader className="space-y-3">
        <SectionTitle
          icon={Ruler}
          title={addr ? `HOVER report — ${addr}` : "HOVER report"}
          description={[s?.address, day(s?.capturedAt)].filter(Boolean).join(" · ") || "Imported from the client's HOVER capture"}
        />
        <div className="flex flex-wrap items-center gap-2">
          {s?.pdfUrl ? (
            <Button size="sm" onClick={() => setViewer(s.pdfUrl!)} data-testid="button-open-report">
              <FileText className="h-4 w-4 mr-1.5" /> Open report
            </Button>
          ) : s?.measurementId && (
            <Button size="sm" variant="outline" onClick={() => fetchPdf.mutate(s.measurementId)} disabled={fetchPdf.isPending}
              data-testid="button-fetch-report">
              {fetchPdf.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
              Fetch report from HOVER
            </Button>
          )}
          {renderModel3dAction ? renderModel3dAction(t) : s?.measurementId && (
            // The model opens inside ConstructHUB; HOVER's own viewer stays a small secondary link.
            <>
              <View3DButton source={{ kind: "crm", measurementId: s.measurementId }} variant="outline" testid="button-takeoff-view3d" />
              {s.hoverAppUrl && (
                <a href={s.hoverAppUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline" data-testid="link-takeoff-3d">
                  <ExternalLink className="h-3 w-3" /> Open in HOVER
                </a>
              )}
            </>
          )}
          {onFill && (
            <Button size="sm" variant="outline" onClick={() => onFill(t)} disabled={fillDisabled} data-testid="button-fill-from-hover">
              <Wand2 className="h-4 w-4 mr-1.5" /> Fill from HOVER
            </Button>
          )}
          {options.length > 1 && (
            <Select value={s?.measurementId ?? ""} onValueChange={setPickedId}>
              <SelectTrigger className="h-8 w-64 text-xs ml-auto" aria-label="HOVER report" data-testid="select-hover-report">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.source!.measurementId} value={o.source!.measurementId}>
                    {[day(o.source?.capturedAt), street(o) ?? `HOVER job ${o.source?.hoverJobId ?? ""}`].filter(Boolean).join(" · ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            testId="takeoff-siding"
            label="Siding"
            value={t.siding.areaSqft === null ? "—" : <>{n(t.siding.areaSqft)} ft² → quote {n(t.siding.quantitySqft)} ft²</>}
            sub={t.siding.areaSqft !== null ? `rounded up to the next ${t.rules.sidingRoundUpTo} ft²` : undefined}
          />
          <Tile
            testId="takeoff-roof"
            label="Roof"
            value={t.roof.areaSqft === null ? "—" : <>{n(t.roof.areaSqft)} ft² → {n(t.roof.quantitySqft)} ft² at {n(t.roof.wastePct)}%</>}
            sub={t.roof.squares !== null
              ? [`${n(t.roof.squares)} sq`, t.roof.predominantPitch && `${t.roof.predominantPitch} pitch`, t.roof.facets !== null && `${t.roof.facets} facets`].filter(Boolean).join(" · ")
              : undefined}
          />
          <Tile
            testId="takeoff-footprint"
            label="Footprint"
            value={t.footprint.areaSqft === null ? "—" : <>{n(t.footprint.areaSqft)} ft² / {feetInches(t.footprint.perimeterFt)}</>}
            sub={t.footprint.stories !== null ? `${t.footprint.stories} ${t.footprint.stories === 1 ? "story" : "stories"}` : undefined}
          />
          <Tile
            testId="takeoff-openings"
            label="Openings"
            value={`${t.counts.windows ?? "—"} windows · ${t.counts.doors ?? "—"} doors`}
            sub={t.totals.windowsAreaSqft !== null
              ? `windows ${n(t.totals.windowsAreaSqft)} ft² / ${n(t.totals.windowsUnitedInches)} UI${t.totals.doorsAreaSqft !== null ? ` · doors ${n(t.totals.doorsAreaSqft)} ft²` : ""}`
              : undefined}
          />
        </div>

        <div className="space-y-2">
          {t.windows.length > 0 && (
            <Section title={`Windows (${t.windows.length})`} testId="takeoff-section-windows">
              <table className="w-full text-sm tabular-nums" data-testid="table-takeoff-windows">
                <thead className="text-xs text-muted-foreground">
                  <tr><th className={th}>Opening</th><th className={th}>W × H</th><th className={thr}>United in.</th><th className={thr}>Area ft²</th></tr>
                </thead>
                <tbody>
                  {t.windows.map((w, i) => (
                    <tr key={`${w.id}-${i}`} className="border-t">
                      <td className="py-1 pr-3">{w.id ?? "—"}</td><td className="pr-3">{wh(w.widthIn, w.heightIn)}</td>
                      <td className="text-right">{n(w.unitedInches)}</td><td className="text-right">{n(w.areaSqft)}</td>
                    </tr>
                  ))}
                  <tr className="border-t font-medium">
                    <td className="py-1">Total</td><td />
                    <td className="text-right">{n(t.totals.windowsUnitedInches)}</td><td className="text-right">{n(t.totals.windowsAreaSqft)}</td>
                  </tr>
                </tbody>
              </table>
              {t.windowGroups.length > 0 && (
                <table className="mt-3 w-full text-sm tabular-nums" data-testid="table-takeoff-window-groups">
                  <thead className="text-xs text-muted-foreground">
                    <tr><th className={th}>Group</th><th className={th}>Windows</th><th className={th}>W × H</th><th className={thr}>United in.</th></tr>
                  </thead>
                  <tbody>
                    {t.windowGroups.map((g, i) => (
                      <tr key={`${g.name}-${i}`} className="border-t">
                        <td className="py-1 pr-3">{g.name ?? "—"}</td><td className="pr-3">{g.windows.join(", ") || "—"}</td>
                        <td className="pr-3">{wh(g.widthIn, g.heightIn)}</td><td className="text-right">{n(g.unitedInches)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          )}
          {t.doors.length > 0 && (
            <Section title={`Doors (${t.doors.length})`} testId="takeoff-section-doors">
              <table className="w-full text-sm tabular-nums" data-testid="table-takeoff-doors">
                <thead className="text-xs text-muted-foreground">
                  <tr><th className={th}>Opening</th><th className={th}>W × H</th><th className={thr}>Area ft²</th></tr>
                </thead>
                <tbody>
                  {t.doors.map((d, i) => (
                    <tr key={`${d.id}-${i}`} className="border-t">
                      <td className="py-1 pr-3">{d.id ?? "—"}</td><td className="pr-3">{wh(d.widthIn, d.heightIn)}</td><td className="text-right">{n(d.areaSqft)}</td>
                    </tr>
                  ))}
                  <tr className="border-t font-medium">
                    <td className="py-1">Entire doors</td><td /><td className="text-right">{n(t.totals.doorsAreaSqft)}</td>
                  </tr>
                </tbody>
              </table>
            </Section>
          )}
          <Section title="Roof lengths & pitch" testId="takeoff-section-roof">
            <KV rows={[
              ["Roof area", `${n(t.roof.areaSqft)} ft² (${n(t.roof.measuredSquares)} sq)`],
              [`With ${n(t.roof.wastePct)}% waste`, `${n(t.roof.quantitySqft)} ft² (${n(t.roof.squares)} sq)`],
              ["Ridges / hips (ft)", n(L.ridgesHips)], ["Valleys (ft)", n(L.valleys)], ["Rakes (ft)", n(L.rakes)],
              ["Eaves (ft)", n(L.eaves)], ["Drip edge — rakes + eaves (ft)", n(L.dripEdge)],
              ["Flashing (ft)", n(L.flashing)], ["Step flashing (ft)", n(L.stepFlashing)],
            ]} />
            {t.roof.pitch.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground" data-testid="takeoff-pitch">
                Pitch: {t.roof.pitch.map((p) => `${p.pitch} ${n(p.areaSqft)} ft²${p.percent !== null ? ` (${n(p.percent)}%)` : ""}`).join(" · ")}
              </p>
            )}
            {t.roof.hoverWasteTable && (
              <p className="mt-1 text-xs text-muted-foreground">
                HOVER waste table: {Object.entries(t.roof.hoverWasteTable).map(([k, v]) => `${k.replace(/_/g, " ")} ${n(v)} ft²`).join(" · ")}
              </p>
            )}
          </Section>
          <Section title="Siding breakdown & waste" testId="takeoff-section-siding">
            <KV rows={[
              ["Facades (ft²)", n(t.siding.facadesSqft)], ["Openings (ft²)", n(t.siding.openingsSqft)], ["Trim (ft²)", n(t.siding.trimSqft)],
              ["Total siding (ft²)", n(t.siding.areaSqft)], [`Quote — next ${t.rules.sidingRoundUpTo} (ft²)`, n(t.siding.quantitySqft)],
              ...(t.siding.otherSqft ? [["Other cladding (ft²)", n(t.siding.otherSqft)] as [string, ReactNode]] : []),
            ]} />
            {t.siding.wasteTable && (
              <p className="mt-2 text-xs text-muted-foreground">
                HOVER siding waste: {Object.entries(t.siding.wasteTable).map(([k, v]) => `${k.replace(/_/g, " ")} ${n(v)} ft²`).join(" · ")}
              </p>
            )}
            {Object.keys(R.elevations).length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Elevations: {Object.entries(R.elevations).map(([k, v]) => `${k} ${n(v)} ft²`).join(" · ")}
              </p>
            )}
          </Section>
          <Section title="Trim, corners & soffit" testId="takeoff-section-trim">
            <KV rows={[
              ["Siding starter (ft)", n(R.trim.levelStarterLf)], ["Sloped / vertical trim (ft)", `${n(R.trim.slopedLf)} / ${n(R.trim.verticalLf)}`],
              ["Outside corners", R.corners.outsideQty === null ? "—" : `${n(R.corners.outsideQty, 0)} · ${n(R.corners.outsideLf)} ft`],
              ["Inside corners", R.corners.insideQty === null ? "—" : `${n(R.corners.insideQty, 0)} · ${n(R.corners.insideLf)} ft`],
              ["Opening trim (ft)", R.openingTrim.perimeterLf === null ? "—" : `${n(R.openingTrim.perimeterLf)} (${n(R.openingTrim.quantity, 0)} openings)`],
              ["Soffit (ft²)", R.soffit.totalSqft === null ? "—" : `${n(R.soffit.totalSqft)} (eaves ${n(R.soffit.eavesSqft)} + rakes ${n(R.soffit.rakesSqft)})`],
              ["Fascia (ft)", `eaves ${n(R.fascia.eavesLf)} · rakes ${n(R.fascia.rakesLf)}`],
              ["Frieze board (ft)", `level ${n(R.frieze.levelLf)} · sloped ${n(R.frieze.slopedLf)}`],
            ]} />
          </Section>
        </div>
      </CardContent>

      {/* The report, inside ConstructHUB: the gated file route streams the PDF inline for the signed-in seat. */}
      <Dialog open={!!viewer} onOpenChange={(o) => { if (!o) setViewer(null); }}>
        <DialogContent className="max-w-5xl w-[calc(100vw-2rem)] h-[90vh] flex flex-col gap-3 p-4" data-testid="dialog-hover-report">
          <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0 pr-8">
            <div className="min-w-0">
              <DialogTitle className="truncate">{addr ? `HOVER report — ${addr}` : "HOVER report"}</DialogTitle>
              <DialogDescription>Measurements PDF from HOVER{day(s?.capturedAt) ? ` · ${day(s?.capturedAt)}` : ""}</DialogDescription>
            </div>
            {viewer && (
              <a href={viewer} download className="shrink-0" data-testid="link-download-report">
                <Button size="sm" variant="outline"><Download className="h-4 w-4 mr-1.5" /> Download</Button>
              </a>
            )}
          </DialogHeader>
          {viewer && (
            <iframe
              src={`${viewer}${viewer.includes("?") ? "&" : "?"}inline=1`}
              title={addr ? `HOVER report — ${addr}` : "HOVER report"}
              className="flex-1 w-full rounded-md border bg-muted"
              data-testid="iframe-hover-report"
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
