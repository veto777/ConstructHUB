/**
 * HOVER 3D model cards.
 *
 *   Hover3DCard — contractor side (project page, estimate page). Lists the client's HOVER captures for the scope
 *     (GET /api/crm/projects/:id/hover-models or /api/crm/estimates/:id/hover-models — the scope's own project and
 *     address first), shows how each one was linked, the homeowner share link (found at HOVER on sync, or pasted
 *     here), and the contractor's own "Open in HOVER" link, which needs their HOVER login.
 *   Home3DCard — client side (public estimate, client portal). Renders ONLY a live share link
 *     (https://hover.to/shared/<token>); the server never sends anything else to a client.
 *
 * Both open HOVER in a new tab, never an iframe: HOVER ships its viewer as a standalone page.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, ExternalLink, Link2, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionTitle, StatusPill } from "@/components/crm-ui";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiIssueMessage } from "@/lib/api-issue-message";

export interface Home3D {
  url: string;
  imageUrl: string | null;
  expiresAt: string | null;
  address?: string | null;
}

interface HoverModel {
  id: string;
  hoverJobId: string | null;
  date: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  projectId: string | null;
  matchedVia: string | null;
  hoverAppUrl: string | null;
  share: { url: string; imageUrl: string | null; expiresAt: string | null; source: "hover-api" | "manual"; live: boolean } | null;
}

/** Same rule as the server: only https://hover.to/shared/<token> opens for a homeowner. */
const SHARE_RE = /^https:\/\/hover\.to\/shared\/[A-Za-z0-9_-]{8,128}\/?(\?model_id=\d{1,12})?$/;
const isShareUrl = (u: unknown): u is string => typeof u === "string" && SHARE_RE.test(u.trim());
const isLive = (expiresAt: string | null | undefined) => !expiresAt || new Date(expiresAt).getTime() > Date.now();

const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString() : null);

const VIA_LABEL: Record<string, string> = {
  address: "matched by address",
  email: "matched by email",
  phone: "matched by phone",
  name: "matched by name",
  created: "client created from the HOVER job",
};

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  return (
    <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)}
      className="h-24 w-36 shrink-0 rounded-md border object-cover" />
  );
}

// ── Client side ─────────────────────────────────────────────────────────────

/** "Your home in 3D" — renders nothing unless a valid, unexpired share link exists. */
export function Home3DCard({ home3d, companyName }: { home3d: Home3D | null | undefined; companyName?: string | null }) {
  if (!home3d || !isShareUrl(home3d.url) || !isLive(home3d.expiresAt)) return null;
  return (
    <Card data-testid="card-home-3d">
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <Thumb src={home3d.imageUrl} alt="3D model of your home" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 font-semibold">
            <Box className="h-4 w-4 text-muted-foreground" /> Your home in 3D
          </div>
          <p className="text-sm text-muted-foreground">
            {companyName ? `${companyName} measured your home with HOVER.` : "Your home was measured with HOVER."}{" "}
            Spin the model and try colors and materials on it.
          </p>
          {home3d.expiresAt && (
            <p className="text-xs text-muted-foreground">Link available until {day(home3d.expiresAt)}.</p>
          )}
        </div>
        <a href={home3d.url} target="_blank" rel="noopener noreferrer" className="shrink-0" data-testid="link-home-3d">
          <Button><ExternalLink className="mr-2 h-4 w-4" /> Explore in 3D &amp; try designs</Button>
        </a>
      </CardContent>
    </Card>
  );
}

// ── Contractor side ─────────────────────────────────────────────────────────

type Scope = { projectId: string; estimateId?: never } | { estimateId: string; projectId?: never };

export function Hover3DCard(scope: Scope) {
  const url = scope.projectId
    ? `/api/crm/projects/${scope.projectId}/hover-models`
    : `/api/crm/estimates/${scope.estimateId}/hover-models`;
  const { data, isLoading } = useQuery<{ models: HoverModel[] }>({ queryKey: [url] });
  const models = data?.models ?? [];
  // Nothing from HOVER for this client: no card (the page has enough empty states).
  if (isLoading || !models.length) return null;
  const [primary, ...others] = models;
  return (
    <Card data-testid="card-hover-3d">
      <CardHeader>
        <SectionTitle icon={Box} title="HOVER 3D model"
          description="The homeowner can open the share link without a HOVER account and try designs on their home." />
      </CardHeader>
      <CardContent className="space-y-3">
        <HoverModelRow model={primary} queryKey={url} />
        {others.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {others.length} more HOVER {others.length === 1 ? "capture" : "captures"} for this client
            </summary>
            <div className="mt-2 space-y-2">
              {others.map((m) => <HoverModelRow key={m.id} model={m} queryKey={url} />)}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function HoverModelRow({ model: m, queryKey }: { model: HoverModel; queryKey: string }) {
  const { toast } = useToast();
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const share = m.share;
  const live = !!share?.live && isShareUrl(share.url);

  const save = async (method: "PUT" | "DELETE", body?: unknown) => {
    setBusy(true);
    try {
      await apiRequest(method, `/api/crm/measurements/${m.id}/hover-share`, body);
      setPaste("");
      await queryClient.invalidateQueries({ queryKey: [queryKey] });
      toast({ title: method === "PUT" ? "Share link saved" : "Share link removed" });
    } catch (e: any) {
      toast({ title: "Couldn't save the link", description: apiIssueMessage(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-3" data-testid={`hover-model-${m.id}`}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Thumb src={live ? share!.imageUrl : null} alt="HOVER 3D model" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-sm font-medium">
            {[m.addressLine1, m.city, m.state].filter(Boolean).join(", ") || "HOVER capture"}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {m.date && <span>{day(m.date)}</span>}
            {m.matchedVia && VIA_LABEL[m.matchedVia] && (
              <span data-testid={`hover-model-via-${m.id}`}>{VIA_LABEL[m.matchedVia]}</span>
            )}
            {live
              ? <StatusPill tone="success">share link {share!.source === "manual" ? "pasted" : "from HOVER"}</StatusPill>
              : share
                ? <StatusPill tone="warning">share link expired</StatusPill>
                : <StatusPill tone="neutral">no share link yet</StatusPill>}
            {live && share!.expiresAt && <span>until {day(share!.expiresAt)}</span>}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {live && (
              <a href={share!.url} target="_blank" rel="noopener noreferrer" data-testid={`hover-model-share-${m.id}`}>
                <Button size="sm"><ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Explore in 3D &amp; try designs</Button>
              </a>
            )}
            {m.hoverAppUrl && (
              <a href={m.hoverAppUrl} target="_blank" rel="noopener noreferrer" data-testid={`hover-model-app-${m.id}`}>
                <Button size="sm" variant="outline"><Box className="mr-1.5 h-3.5 w-3.5" /> Open in HOVER (your login)</Button>
              </a>
            )}
            {share && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => save("DELETE")} data-testid={`hover-model-clear-${m.id}`}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove link
              </Button>
            )}
          </div>
        </div>
      </div>
      {!live && (
        <form className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => { e.preventDefault(); if (isShareUrl(paste)) void save("PUT", { url: paste.trim() }); }}>
          <Input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="https://hover.to/shared/…"
            aria-label="Paste share link" data-testid={`hover-model-paste-${m.id}`} />
          <Button type="submit" size="sm" variant="outline" disabled={busy || !isShareUrl(paste)} className="shrink-0">
            <Link2 className="mr-1.5 h-3.5 w-3.5" /> Paste share link
          </Button>
        </form>
      )}
      {!live && (
        <p className="text-xs text-muted-foreground">
          In HOVER tap Share on the job to create the homeowner link — we pick it up automatically on the next sync.
        </p>
      )}
    </div>
  );
}
