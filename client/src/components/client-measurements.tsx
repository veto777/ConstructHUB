/**
 * Measurements section for the CRM client detail page.
 *
 * Shows every measurement row linked to the customer — HOVER-ingested jobs
 * (roof/siding sqft, windows, the 3D model link and the gated measurement
 * PDF) alongside manual entries. Data comes from
 * GET /api/crm/customers/:id/measurements (server/crm/hover.ts).
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Download, ExternalLink, Ruler } from "lucide-react";
import { View3DButton } from "@/components/hover-3d-dialog";
import { EmptyState, SectionTitle, StatusPill } from "@/components/crm-ui";

const fmt = (n?: number | null) =>
  n === null || n === undefined ? null : n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function CustomerMeasurements({ customerId }: { customerId: string }) {
  const { data } = useQuery<any>({
    queryKey: [`/api/crm/customers/${customerId}/measurements`],
    enabled: !!customerId,
  });
  const measurements: any[] = data?.measurements ?? [];

  return (
    <Card data-testid="card-measurements">
      <CardHeader>
        <SectionTitle
          icon={Ruler}
          title="Measurements"
          description="HOVER reports and manual measurements for this client's property."
          infoKey="measurements"
        />
      </CardHeader>
      <CardContent className="space-y-2">
        {!measurements.length && (
          <EmptyState
            compact
            icon={Ruler}
            title="No measurements yet"
            description="Connect HOVER in Settings and completed jobs appear here automatically."
          />
        )}
        {measurements.map((m) => (
          <div key={m.id} className="rounded-lg border px-4 py-3 space-y-1.5" data-testid={`measurement-${m.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium flex items-center gap-2.5">
                  <span className="capitalize">{m.provider} report</span>
                  <StatusPill tone={m.status === "ready" ? "success" : "neutral"}>{m.status}</StatusPill>
                </div>
                <div className="text-xs text-muted-foreground">
                  {[m.addressLine1, m.city, m.state].filter(Boolean).join(", ") || "—"}
                  {m.date ? ` · ${new Date(m.date).toLocaleDateString()}` : ""}
                  {["address", "email", "phone", "name"].includes(m.matchedVia) && (
                    <span data-testid={`measurement-matchedvia-${m.id}`}> · matched by {m.matchedVia}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* The in-app viewer: the 3D model, HOVER's wireframes and (with a live share link) the design
                    studio — all inside ConstructHUB, no HOVER login. */}
                {m.provider === "hover" && m.hoverJobId && (
                  <View3DButton source={{ kind: "crm", measurementId: m.id }} variant="outline" className="h-7 px-2.5 text-xs"
                    testid={`measurement-view3d-${m.id}`} />
                )}
                {/* hover.to/3d/<id> needs the contractor's HOVER login — a small secondary link, never a client link. */}
                {m.model3dUrl && (
                  <a href={m.model3dUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                    data-testid={`measurement-3d-${m.id}`}>
                    Open in HOVER <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {m.pdfUrl && (
                  <a href={m.pdfUrl}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    data-testid={`measurement-pdf-${m.id}`}>
                    <Download className="h-3.5 w-3.5" /> PDF
                  </a>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground tabular-nums">
              {fmt(m.roofAreaSf) && <span>Roof {fmt(m.roofAreaSf)} sq ft{m.squares !== null ? ` (${fmt(m.squares)} sq)` : ""}</span>}
              {fmt(m.sidingSqft) && <span>Siding {fmt(m.sidingSqft)} sq ft</span>}
              {m.windowsCount !== null && m.windowsCount !== undefined && <span>{m.windowsCount} windows</span>}
              {m.stories !== null && m.stories !== undefined && <span>{m.stories} {m.stories === 1 ? "story" : "stories"}</span>}
              {m.pitch && <span>Pitch {m.pitch}</span>}
              {m.wastePercent !== null && m.wastePercent !== undefined && <span>Waste {m.wastePercent}%</span>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
