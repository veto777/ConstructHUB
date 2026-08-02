import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Blocks, KeyRound, Webhook, Ruler, Loader2, Copy, Trash2, ArrowRight,
  RefreshCw, Unplug, CreditCard, CalendarDays, Sparkles, Magnet,
} from "lucide-react";
import {
  CrmPage, CrmPageHeader, StatusPill, EmptyState, SectionTitle,
} from "@/components/crm-ui";

/**
 * Integrations hub — every connection and API in one directory. HOVER lives
 * here end-to-end; Stripe and Google Calendar get summary cards that point at
 * the pages where their connect flows live; CladAI is the next slot. The
 * developer surface (API keys, outgoing webhooks) rounds out the page.
 *
 * Gated on manageSettings like Settings itself; the connect/manage surfaces
 * additionally need manageIntegrations (the API enforces both — the UI just
 * avoids asking for what it can't have). New integrations: add a card here,
 * keep the working flow wherever it already lives.
 */
export default function CrmIntegrationsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: me, isLoading: meLoading } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const allowed = me?.permissions?.manageSettings === true;
  const canIntegrations = me?.permissions?.manageIntegrations === true;

  useEffect(() => {
    if (me && !allowed) navigate("/");
  }, [me, allowed, navigate]);

  const { data: payStatus } = useQuery<any>({
    queryKey: ["/api/crm/payments/status"],
    enabled: allowed,
  });
  const { data: gcalStatus } = useQuery<any>({
    queryKey: ["/api/crm/calendar/google/status"],
    enabled: allowed,
  });
  const { data: apiKeys } = useQuery<any[]>({
    queryKey: ["/api/crm/api-keys"],
    enabled: allowed && canIntegrations,
  });
  const { data: webhookData } = useQuery<{ webhooks: any[]; events: string[] }>({
    queryKey: ["/api/crm/webhooks"],
    enabled: allowed && canIntegrations,
  });
  const { data: hoverStatus } = useQuery<any>({
    queryKey: ["/api/crm/integrations/hover/status"],
    enabled: allowed && canIntegrations,
  });
  const { data: leadCapture } = useQuery<{ token: string; formUrl: string; leads30d: number }>({
    queryKey: ["/api/crm/integrations/lead-capture"],
    enabled: allowed && canIntegrations,
  });

  // ── Lead capture ──────────────────────────────────────────────────────────
  const rotateLeadToken = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/integrations/lead-capture/rotate", {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/integrations/lead-capture"] });
      toast({ title: "Lead form link rotated", description: "Every old copy of the form link stopped working." });
    },
    onError: (e: any) => toast({ title: "Could not rotate the link", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── API keys ──────────────────────────────────────────────────────────────
  const [keyName, setKeyName] = useState("");
  const [freshKey, setFreshKey] = useState<{ name: string; key: string } | null>(null);

  const createKey = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/api-keys", { name: keyName.trim() || "API key" })).json(),
    onSuccess: (r: any) => {
      setFreshKey({ name: r.name, key: r.key });
      setKeyName("");
      queryClient.invalidateQueries({ queryKey: ["/api/crm/api-keys"] });
      toast({ title: "API key created" });
    },
    onError: (e: any) => toast({ title: "Could not create key", description: String(e.message ?? e), variant: "destructive" }),
  });

  const revokeKey = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/crm/api-keys/${id}`, undefined)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/api-keys"] });
      toast({ title: "API key revoked" });
    },
    onError: (e: any) => toast({ title: "Could not revoke key", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── Webhooks ──────────────────────────────────────────────────────────────
  const [hookUrl, setHookUrl] = useState("");
  const [hookEvents, setHookEvents] = useState<Record<string, boolean>>({});
  const [freshSecret, setFreshSecret] = useState<string | null>(null);

  const createHook = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/webhooks", {
      url: hookUrl.trim(),
      events: Object.entries(hookEvents).filter(([, v]) => v).map(([k]) => k),
    })).json(),
    onSuccess: (r: any) => {
      setFreshSecret(r.secret ?? null);
      setHookUrl("");
      setHookEvents({});
      queryClient.invalidateQueries({ queryKey: ["/api/crm/webhooks"] });
      toast({ title: "Webhook added" });
    },
    onError: (e: any) => toast({ title: "Could not add webhook", description: String(e.message ?? e), variant: "destructive" }),
  });

  const deleteHook = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/crm/webhooks/${id}`, undefined)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/webhooks"] });
      toast({ title: "Webhook deleted" });
    },
    onError: (e: any) => toast({ title: "Could not delete webhook", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── HOVER ─────────────────────────────────────────────────────────────────
  // The OAuth redirect lands back on /crm/integrations?hover=connected|error.
  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get("hover");
    if (flag === "connected") toast({ title: "HOVER connected", description: "Completed jobs will flow in automatically." });
    else if (flag === "error") toast({ title: "HOVER connection failed", description: "Please try connecting again.", variant: "destructive" });
    if (flag) window.history.replaceState({}, "", "/crm/integrations");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hoverInvalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/crm/integrations/hover/status"] });

  const hoverRegister = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/integrations/hover/register-webhook", {})).json(),
    onSuccess: (r: any) => {
      hoverInvalidate();
      toast(r.ok === false
        ? { title: "Webhook registration failed", variant: "destructive" }
        : { title: r.state === "verified" ? "HOVER webhook is live" : "HOVER webhook registered — verifying…" });
    },
    onError: (e: any) => toast({ title: "Could not register webhook", description: String(e.message ?? e), variant: "destructive" }),
  });

  const hoverSync = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/integrations/hover/sync", {})).json(),
    onSuccess: (r: any) => {
      hoverInvalidate();
      const attached = (r.attachedByEmail ?? 0) + (r.attachedByPhone ?? 0) + (r.attachedByAddress ?? 0);
      toast({
        title: "HOVER sync complete",
        description: `${r.scanned ?? 0} scanned — ${attached} matched to clients, ${r.created ?? 0} created, ${r.duplicates ?? 0} already up to date${r.ambiguous ? `, ${r.ambiguous} ambiguous` : ""}${r.errors?.length ? `, ${r.errors.length} failed` : ""}.`,
      });
    },
    onError: (e: any) => toast({ title: "HOVER sync failed", description: String(e.message ?? e), variant: "destructive" }),
  });

  const hoverDisconnect = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/integrations/hover/disconnect", {})).json(),
    onSuccess: () => {
      hoverInvalidate();
      toast({ title: "HOVER disconnected" });
    },
    onError: (e: any) => toast({ title: "Could not disconnect", description: String(e.message ?? e), variant: "destructive" }),
  });

  if (meLoading) {
    return <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!allowed) return null; // redirect effect above fires; nothing to render

  const acct = payStatus?.account;
  const gcal = gcalStatus?.connection ?? null;
  const hookEventChoices = webhookData?.events ?? [];
  const chosenEvents = Object.values(hookEvents).filter(Boolean).length;
  const leadFormUrl = leadCapture?.formUrl ?? "";
  const leadEmbed = leadFormUrl
    ? `<iframe src="${leadFormUrl}" style="width:100%;max-width:560px;height:640px;border:0;" title="Request an estimate"></iframe>`
    : "";

  return (
    <CrmPage className="max-w-4xl">
      <CrmPageHeader
        icon={Blocks}
        title="Integrations"
        subtitle="Every connection and API in one place — measurements, payments, calendars and your own tools."
      />

      {/* ── HOVER: measurements in, automatically ───────────────────────── */}
      <Card data-testid="card-hover">
        <CardHeader>
          <SectionTitle
            icon={Ruler}
            title="HOVER measurements"
            description="Connect HOVER once — every completed job lands here with roof & siding measurements, the PDF and the 3D model, and the client is matched automatically."
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {!canIntegrations ? (
            <p className="text-sm text-muted-foreground">
              You don't have the manageIntegrations permission — ask an admin.
            </p>
          ) : !hoverStatus ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !hoverStatus.configured ? (
            <EmptyState compact icon={Ruler} title="HOVER isn't configured"
              description="This deployment has no HOVER OAuth app credentials — ask the platform team." />
          ) : !hoverStatus.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground max-w-prose">
                Authorize ConstructHub with your HOVER account. Webhook registration and job
                ingest happen automatically after that — nothing else to set up.
              </p>
              <a href="/api/crm/integrations/hover/connect" data-testid="button-connect-hover">
                <Button><Ruler className="h-4 w-4 mr-2" /> Connect HOVER</Button>
              </a>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                <StatusPill tone="success" data-testid="pill-hover-connected">connected</StatusPill>
                <span className="text-muted-foreground">
                  since {hoverStatus.connectedAt ? new Date(hoverStatus.connectedAt).toLocaleDateString() : "—"}
                </span>
                {hoverStatus.webhook ? (
                  <span className="flex items-center gap-2" data-testid="text-hover-webhook">
                    webhook
                    <StatusPill tone={hoverStatus.webhook.verified ? "success" : "warning"}>
                      {hoverStatus.webhook.verified ? "verified" : "pending verification"}
                    </StatusPill>
                  </span>
                ) : (
                  <span className="text-muted-foreground" data-testid="text-hover-webhook">webhook not registered</span>
                )}
                {hoverStatus.lastSyncAt && (
                  <span className="text-muted-foreground" data-testid="text-hover-lastsync">
                    last sync {new Date(hoverStatus.lastSyncAt).toLocaleString()}
                  </span>
                )}
              </div>
              {hoverStatus.lastError && (
                <p className="text-sm text-destructive" data-testid="text-hover-error">{hoverStatus.lastError}</p>
              )}
              {hoverStatus.lastSyncReport && (
                <p className="text-xs text-muted-foreground" data-testid="text-hover-syncreport">
                  Last sync: {hoverStatus.lastSyncReport.scanned} scanned
                  {" · "}{hoverStatus.lastSyncReport.attachedByEmail} matched by email
                  {" · "}{hoverStatus.lastSyncReport.attachedByPhone} by phone
                  {" · "}{hoverStatus.lastSyncReport.attachedByAddress} by address
                  {" · "}{hoverStatus.lastSyncReport.created} created
                  {hoverStatus.lastSyncReport.ambiguous ? ` · ${hoverStatus.lastSyncReport.ambiguous} ambiguous` : ""}
                  {hoverStatus.lastSyncReport.errors?.length ? ` · ${hoverStatus.lastSyncReport.errors.length} errors` : ""}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => hoverSync.mutate()}
                  disabled={hoverSync.isPending} data-testid="button-hover-sync">
                  {hoverSync.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Sync now
                </Button>
                {(!hoverStatus.webhook || !hoverStatus.webhook.verified) && (
                  <Button size="sm" variant="outline" onClick={() => hoverRegister.mutate()}
                    disabled={hoverRegister.isPending} data-testid="button-hover-register">
                    {hoverRegister.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Register webhook
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                  onClick={() => {
                    if (window.confirm("Disconnect HOVER? Completed jobs will stop flowing in.")) hoverDisconnect.mutate();
                  }}
                  disabled={hoverDisconnect.isPending} data-testid="button-hover-disconnect">
                  <Unplug className="h-4 w-4 mr-2" /> Disconnect
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Lead capture: the embeddable website form ───────────────────── */}
      <Card data-testid="card-lead-capture">
        <CardHeader>
          <SectionTitle
            icon={Magnet}
            title="Lead capture"
            description="Embed this form on your website — every submission lands in Clients tagged website-lead, and the owner gets an email."
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {!canIntegrations ? (
            <p className="text-sm text-muted-foreground">
              You don't have the manageIntegrations permission — ask an admin.
            </p>
          ) : !leadCapture ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <div className="flex items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-muted-foreground" data-testid="text-lead-count">
                  {leadCapture.leads30d} lead{leadCapture.leads30d === 1 ? "" : "s"} in the last 30 days
                </span>
              </div>
              <div className="space-y-1.5">
                <Label>Direct link</Label>
                <div className="flex gap-2">
                  <Input readOnly value={leadFormUrl} data-testid="input-lead-form-url"
                    onFocus={(e) => e.target.select()} />
                  <Button size="sm" variant="outline" className="shrink-0" data-testid="button-copy-lead-link"
                    onClick={() => {
                      if (leadFormUrl) navigator.clipboard?.writeText(leadFormUrl).catch(() => {});
                      toast({ title: "Copied" });
                    }}>
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Embed on your site</Label>
                <div className="flex gap-2">
                  <code className="flex-1 rounded bg-muted px-2 py-1.5 text-xs font-mono break-all"
                    data-testid="text-lead-embed">{leadEmbed}</code>
                  <Button size="sm" variant="outline" className="shrink-0" data-testid="button-copy-lead-embed"
                    onClick={() => {
                      if (leadEmbed) navigator.clipboard?.writeText(leadEmbed).catch(() => {});
                      toast({ title: "Copied" });
                    }}>
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Anyone with the link can send you a lead — that's the point. If it ever ends up in the
                wrong hands, rotate it: every embedded copy and shared link of the old form stops working.
              </p>
              <div className="flex justify-end">
                <Button size="sm" variant="outline" data-testid="button-rotate-lead-token"
                  onClick={() => {
                    if (window.confirm("Rotate the lead form link? Every embedded copy and shared link of the old form will stop working.")) {
                      rotateLeadToken.mutate();
                    }
                  }}
                  disabled={rotateLeadToken.isPending}>
                  {rotateLeadToken.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                  Rotate link
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Directory: the rest of the connections ──────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Stripe connect lives on the payments page — this is the summary. */}
        <Card data-testid="card-stripe">
          <CardContent className="p-5 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CreditCard className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="font-medium">Stripe payments</div>
                {payStatus && (
                  <StatusPill tone={acct?.chargesEnabled ? "success" : "neutral"} data-testid="pill-stripe-status">
                    {acct ? (acct.chargesEnabled ? "Connected" : "Charges off") : "Not connected"}
                  </StatusPill>
                )}
              </div>
              <div className="text-xs text-muted-foreground">Online payments on invoices, straight to your Stripe account.</div>
            </div>
            <Link href="/crm/payments" data-testid="link-stripe-payments"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline shrink-0">
              Open <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>

        {/* Google Calendar connect lives in Settings — summary + pointer. */}
        <Card data-testid="card-google-calendar">
          <CardContent className="p-5 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarDays className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="font-medium">Google Calendar</div>
                {gcalStatus && (
                  <StatusPill tone={gcal ? "success" : "neutral"} data-testid="pill-gcal-status">
                    {gcal ? "Connected" : "Not connected"}
                  </StatusPill>
                )}
              </div>
              <div className="text-xs text-muted-foreground">Push your schedule to a dedicated Google calendar.</div>
            </div>
            <Link href="/crm/settings" data-testid="link-google-calendar-settings"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline shrink-0">
              Open <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>

        {/* CladAI: reserved slot — no fake connect button until it's real. */}
        <Card data-testid="card-cladai">
          <CardContent className="p-5 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Sparkles className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="font-medium">CladAI</div>
                <StatusPill tone="neutral" data-testid="pill-cladai-status">Coming soon</StatusPill>
              </div>
              <div className="text-xs text-muted-foreground">
                Direct CladAI measurement import is on the way — meanwhile you can import CladAI reports manually.
              </div>
            </div>
            <Link href="/crm/reports" data-testid="link-cladai-reports"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline shrink-0">
              Reports <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* ── Developer: API keys + outgoing webhooks ─────────────────────── */}
      <Card>
        <CardHeader>
          <SectionTitle
            icon={KeyRound}
            title="API keys"
            description="Read-only access to your data from your own tools, via /api/v1."
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {!canIntegrations ? (
            <p className="text-sm text-muted-foreground">
              You don't have the manageIntegrations permission — ask an admin.
            </p>
          ) : (
            <>
              {freshKey && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2"
                  data-testid="text-new-api-key">
                  <div className="text-sm font-medium">
                    {freshKey.name} — copy this key now. It is never shown again.
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded bg-muted px-2 py-1.5 text-xs font-mono break-all">
                      {freshKey.key}
                    </code>
                    <Button size="sm" variant="outline" data-testid="button-copy-api-key"
                      onClick={() => {
                        navigator.clipboard?.writeText(freshKey.key).catch(() => {});
                        toast({ title: "Copied" });
                      }}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <Input placeholder="Key name (e.g. Zapier, reporting script)"
                  data-testid="input-api-key-name"
                  value={keyName} onChange={(e) => setKeyName(e.target.value)} />
                <Button onClick={() => createKey.mutate()} disabled={createKey.isPending}
                  data-testid="button-create-api-key" className="shrink-0">
                  {createKey.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create key
                </Button>
              </div>
              {!apiKeys?.length ? (
                <EmptyState compact icon={KeyRound} title="No API keys yet"
                  description="Create one to read your clients, projects, estimates and invoices from your own tools." />
              ) : (
                <div className="space-y-2">
                  {apiKeys.map((k) => (
                    <div key={k.id} className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
                      data-testid={`row-api-key-${k.id}`}>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{k.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {k.keyPrefix}… · created {new Date(k.createdAt).toLocaleDateString()}
                          {k.lastUsedAt ? ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : ""}
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => revokeKey.mutate(k.id)}
                        disabled={revokeKey.isPending} data-testid={`button-revoke-api-key-${k.id}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle
            icon={Webhook}
            title="Webhooks"
            description="POST signed events to your own endpoint when things happen in the CRM."
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {!canIntegrations ? (
            <p className="text-sm text-muted-foreground">
              You don't have the manageIntegrations permission — ask an admin.
            </p>
          ) : (
            <>
              {freshSecret && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-1"
                  data-testid="text-new-webhook-secret">
                  <div className="text-sm font-medium">Copy this signing secret now. It is never shown again.</div>
                  <code className="block rounded bg-muted px-2 py-1.5 text-xs font-mono break-all">{freshSecret}</code>
                </div>
              )}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="webhook-url">Endpoint URL</Label>
                  <Input id="webhook-url" placeholder="https://example.com/webhooks/constructhub"
                    data-testid="input-webhook-url"
                    value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} />
                </div>
                {hookEventChoices.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
                    {hookEventChoices.map((ev) => (
                      <label key={ev} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox
                          checked={hookEvents[ev] === true}
                          onCheckedChange={(v) => setHookEvents((h) => ({ ...h, [ev]: v === true }))}
                          data-testid={`checkbox-webhook-event-${ev}`}
                        />
                        {ev}
                      </label>
                    ))}
                  </div>
                )}
                <div className="flex justify-end">
                  <Button onClick={() => createHook.mutate()}
                    disabled={createHook.isPending || !hookUrl.trim() || chosenEvents === 0}
                    data-testid="button-create-webhook">
                    {createHook.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Add webhook
                  </Button>
                </div>
              </div>
              {!webhookData?.webhooks?.length ? (
                <EmptyState compact icon={Webhook} title="No webhooks yet"
                  description="Add an endpoint and pick the events it should receive. Payloads are HMAC-signed." />
              ) : (
                <div className="space-y-2">
                  {webhookData.webhooks.map((w) => (
                    <div key={w.id} className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
                      data-testid={`row-webhook-${w.id}`}>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate font-mono">{w.url}</div>
                        <div className="text-xs text-muted-foreground">
                          {(w.events ?? []).join(", ")}
                          {w.failureCount > 0 ? ` · ${w.failureCount} failures` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusPill tone={w.active ? "success" : "danger"}>
                          {w.active ? "active" : "disabled"}
                        </StatusPill>
                        <Button size="sm" variant="ghost" onClick={() => deleteHook.mutate(w.id)}
                          disabled={deleteHook.isPending} data-testid={`button-delete-webhook-${w.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </CrmPage>
  );
}
