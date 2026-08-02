import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2, FileText, Receipt, ShieldCheck, Mail, ArrowRight, LogOut, Inbox, Ruler,
  LayoutDashboard, Camera, MessageSquare, FolderOpen, Image as ImageIcon, type LucideIcon,
} from "lucide-react";
import {
  CrmPage, StatusPill, EmptyState, ErrorCard, SectionTitle, crmTable, statusTone,
} from "@/components/crm-ui";
import { InfoTip } from "@/components/info-tip";
import { PortalPamphlets, PortalPhotoShare, PortalCommentBox } from "@/components/client-uploads";
import { ContractorPreviewBanner, PortalFinancing } from "@/components/crm-client-360";
import { CrmLogo } from "@/components/crm-logo";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { orgThemeStyle } from "@/lib/org-theme";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : null);

/**
 * The homeowner client portal (client.constructhub.*), in the CRM's visual
 * idiom: ConstructHUB-branded sidebar on desktop, a bottom ribbon on mobile
 * whose raised center button captures photos of the house straight to the
 * contractor. Two states:
 *   - no session  → brand-neutral magic-link request (never reveals whether
 *                   the email exists)
 *   - session     → every estimate, invoice and signed contract of theirs,
 *                   linking out to the existing public token pages (/e/:token,
 *                   /i/:token) which handle approve/pay.
 */
export default function ClientPortalPage() {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/client/documents"],
    retry: false,
  });

  if (isLoading) {
    return <div className="flex justify-center p-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  // 401 is not an error here — it IS the signed-out state.
  if (error) {
    if (String((error as Error).message).startsWith("401")) return <RequestLink />;
    return (
      <div className="min-h-screen bg-muted/40 flex items-start justify-center py-16 px-4">
        <ErrorCard title="Couldn't load your documents" description="Please try again in a moment." />
      </div>
    );
  }

  return <Dashboard data={data} />;
}

/* ── Signed out: request a magic link ────────────────────────────────────── */

function RequestLink() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invalidLink =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("auth") === "invalid";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiRequest("POST", "/api/client/auth/request-link", { email });
      setSent(true);
    } catch (err: any) {
      setError(String(err?.message || "Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-muted/40 flex items-start justify-center py-16 px-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center space-y-1 pb-2">
          <div className="flex justify-center pb-3">
            <CrmLogo height={34} testid="client-portal-brand" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Your documents, in one place</h1>
          <p className="text-sm text-muted-foreground">
            Estimates, invoices and signed contracts from your contractor.
          </p>
        </div>

        <Card className="shadow-md">
          <CardContent className="p-6 space-y-4">
            {invalidLink && (
              <div
                data-testid="text-auth-invalid"
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400"
              >
                That sign-in link is invalid or has expired. Request a new one below.
              </div>
            )}
            {sent ? (
              <div className="text-center space-y-2 py-4" data-testid="text-link-sent">
                <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Inbox className="h-5 w-5" strokeWidth={1.6} />
                </div>
                <div className="font-medium">Check your inbox</div>
                <p className="text-sm text-muted-foreground">
                  If that email is on file with a contractor, a secure sign-in link is on its way.
                  The link expires in 30 minutes.
                </p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Enter the email your contractor has on file — we'll send you a secure sign-in
                  link. No password needed.
                </p>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  data-testid="input-client-email"
                />
                {error && <p className="text-sm text-destructive" data-testid="text-request-error">{error}</p>}
                <Button type="submit" className="w-full" disabled={busy} data-testid="button-request-link">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4 mr-1.5" />}
                  Email me a sign-in link
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground/70">
          Secure sign-in by email — only you can open the link.
        </p>
        <p className="text-center text-xs text-muted-foreground/70">
          <a href="/crm-terms" className="hover:underline" data-testid="link-portal-terms">Terms</a>
          <span className="mx-1.5">·</span>
          <a href="/crm-privacy" className="hover:underline" data-testid="link-portal-privacy">Privacy</a>
        </p>
      </div>
    </main>
  );
}

/* ── Signed in: CRM-style shell + views ──────────────────────────────────── */

type ViewKey = "home" | "estimates" | "invoices" | "contracts" | "reports" | "photos" | "messages" | "documents";

const SIDEBAR_NAV: { key: ViewKey; title: string; icon: LucideIcon }[] = [
  { key: "home", title: "Home", icon: LayoutDashboard },
  { key: "estimates", title: "Estimates", icon: FileText },
  { key: "invoices", title: "Invoices & receipts", icon: Receipt },
  { key: "contracts", title: "Signed contracts", icon: ShieldCheck },
  { key: "reports", title: "Measurement reports", icon: Ruler },
  { key: "photos", title: "Photos", icon: Camera },
  { key: "messages", title: "Messages", icon: MessageSquare },
];

function Dashboard({ data }: { data: any }) {
  const {
    customer, orgs = [], estimates = [], invoices = [], contracts = [], reports = [],
    accounts = [], pamphlets = [], photos = [], financing = [],
  } = data;
  const { toast } = useToast();
  const [view, setView] = useState<ViewKey>("home");
  const captureRef = useRef<HTMLInputElement>(null);
  const preview = data.contractorPreview === true;

  // Signed-contract PDFs, minted server-side at approval and keyed by
  // estimate id — each signed contract gets a download link when its PDF exists.
  const { data: contractPdfs } = useQuery<any>({
    queryKey: ["/api/client/contracts"],
    retry: false,
  });
  const pdfByEstimate = new Map<string, any>(
    (contractPdfs?.contracts ?? []).map((p: any) => [p.estimateId, p]),
  );

  const now = Date.now();
  const awaitingEstimates = estimates.filter(
    (e: any) => !e.approvedAt && !e.declinedAt && (!e.expiresAt || new Date(e.expiresAt).getTime() > now),
  );
  const unpaidInvoices = invoices.filter((i: any) => !i.paidAt && i.dueCents > 0);
  const actionCount = awaitingEstimates.length + unpaidInvoices.length;

  async function signOut() {
    await apiRequest("POST", "/api/client/auth/logout");
    await queryClient.invalidateQueries({ queryKey: ["/api/client/documents"] });
  }

  // The center ribbon button: open the camera, ship the shot straight to the
  // contractor (same endpoint as the Photos section), then land on Photos.
  const customerId = accounts?.[0]?.id;
  const capture = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("customerId", customerId);
      fd.append("file", file);
      const r = await fetch("/api/client/photos", { method: "POST", body: fd, credentials: "same-origin" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || `Upload failed (${r.status})`);
      return j;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client/documents"] });
      setView("photos");
      toast({ title: "Photo shared", description: "Your contractor can see it now." });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: String(e.message ?? e), variant: "destructive" }),
  });

  const oneOrg = orgs.length === 1 ? orgs[0] : null;
  // The contractor's company theme — black + their accent. Only a single-org
  // client gets a themed portal; a multi-org homeowner keeps the neutral
  // default rather than picking one company's colour over another's.
  const themeStyle = orgThemeStyle(oneOrg?.theme);

  const badge = (k: ViewKey) =>
    k === "home" && actionCount ? actionCount
    : k === "estimates" && awaitingEstimates.length ? awaitingEstimates.length
    : k === "invoices" && unpaidInvoices.length ? unpaidInvoices.length
    : null;

  /* ── Section blocks (identical content to the old single page) ─────────── */

  const needsAction = actionCount > 0 && (
    <Card className="shadow-md border-primary/40" data-testid="section-needs-action">
      <CardContent className="p-5 space-y-3">
        <SectionTitle title="Needs your action" />
        {awaitingEstimates.map((e: any) => (
          <a key={`e-${e.id}`} href={e.link} data-testid={`action-estimate-${e.id}`}>
            <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 hover:bg-accent hover:border-primary/40 transition-colors cursor-pointer">
              <div className="min-w-0">
                <div className="font-medium truncate">{e.number ? `${e.number} · ` : ""}{e.title}</div>
                <div className="text-sm text-muted-foreground tabular-nums">
                  {money(e.totalCents)}{e.expiresAt ? ` · expires ${day(e.expiresAt)}` : ""}
                </div>
              </div>
              <Button size="sm" className="shrink-0">Review <ArrowRight className="h-4 w-4 ml-1" /></Button>
            </div>
          </a>
        ))}
        {unpaidInvoices.map((i: any) => (
          <a key={`i-${i.id}`} href={i.link} data-testid={`action-invoice-${i.id}`}>
            <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 hover:bg-accent hover:border-primary/40 transition-colors cursor-pointer">
              <div className="min-w-0">
                <div className="font-medium truncate">{i.number ? `${i.number} · ` : ""}{i.title}</div>
                <div className="text-sm text-muted-foreground tabular-nums">
                  {money(i.dueCents)} due{i.dueAt ? ` · by ${day(i.dueAt)}` : ""}
                </div>
              </div>
              <Button size="sm" className="shrink-0">Pay <ArrowRight className="h-4 w-4 ml-1" /></Button>
            </div>
          </a>
        ))}
      </CardContent>
    </Card>
  );

  const estimatesSection = (
    <section className="space-y-3" data-testid="section-estimates">
      <SectionTitle icon={FileText} title="Estimates" infoKey="portal-estimates" />
      {!estimates.length ? (
        <Card><EmptyState compact icon={FileText} title="No estimates yet"
          description="When your contractor sends an estimate, it shows up here." /></Card>
      ) : (
        <div className={crmTable.wrapper}>
          <table className={crmTable.table}>
            <thead className={crmTable.thead}>
              <tr>
                <th className={crmTable.th}>Estimate</th>
                <th className={crmTable.th}>Status</th>
                <th className={crmTable.th}>Sent</th>
                <th className={crmTable.thRight}>Total</th>
              </tr>
            </thead>
            <tbody>
              {estimates.map((e: any) => (
                <tr key={e.id} className={crmTable.tr}>
                  <td className={crmTable.td}>
                    <a href={e.link} className="font-medium hover:underline" data-testid={`client-estimate-${e.id}`}>
                      {e.number ? `${e.number} · ` : ""}{e.title}
                    </a>
                    {orgs.length > 1 && e.orgName && (
                      <div className="text-xs text-muted-foreground">{e.orgName}</div>
                    )}
                    {e.attachments?.length > 0 && (
                      <div className="text-xs mt-0.5 flex flex-wrap gap-x-3">
                        {e.attachments.map((a: any) => (
                          <a key={a.id} href={a.downloadUrl} className="text-primary hover:underline"
                            data-testid={`client-estimate-attachment-${a.id}`}>
                            {a.fileName}
                          </a>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className={crmTable.td}>
                    <StatusPill tone={e.approvedAt ? "success" : e.declinedAt ? "danger" : statusTone(e.status)}>
                      {e.approvedAt ? "approved" : e.declinedAt ? "declined" : e.status}
                    </StatusPill>
                  </td>
                  <td className={crmTable.td}>{day(e.sentAt) ?? "—"}</td>
                  <td className={crmTable.tdRight}>{money(e.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const invoicesSection = (
    <section className="space-y-3" data-testid="section-invoices">
      <SectionTitle icon={Receipt} title="Invoices & receipts" infoKey="portal-invoices" />
      {!invoices.length ? (
        <Card><EmptyState compact icon={Receipt} title="No invoices yet"
          description="Invoices and receipts from your contractor appear here." /></Card>
      ) : (
        <div className={crmTable.wrapper}>
          <table className={crmTable.table}>
            <thead className={crmTable.thead}>
              <tr>
                <th className={crmTable.th}>Invoice</th>
                <th className={crmTable.th}>Status</th>
                <th className={crmTable.th}>Due date</th>
                <th className={crmTable.thRight}>Amount due</th>
                <th className={crmTable.thRight}>Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i: any) => (
                <tr key={i.id} className={crmTable.tr}>
                  <td className={crmTable.td}>
                    <a href={i.link} className="font-medium hover:underline" data-testid={`client-invoice-${i.id}`}>
                      {i.number ? `${i.number} · ` : ""}{i.title}
                    </a>
                    {orgs.length > 1 && i.orgName && (
                      <div className="text-xs text-muted-foreground">{i.orgName}</div>
                    )}
                  </td>
                  <td className={crmTable.td}>
                    <StatusPill tone={i.paidAt ? "success" : statusTone(i.status)}>
                      {i.paidAt ? "paid" : i.status}
                    </StatusPill>
                  </td>
                  <td className={crmTable.td}>{day(i.dueAt) ?? "—"}</td>
                  <td className={crmTable.tdRight}>{i.paidAt ? "—" : money(i.dueCents)}</td>
                  <td className={crmTable.tdRight}>{money(i.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const contractsSection = (
    <section className="space-y-3" data-testid="section-contracts">
      <SectionTitle icon={ShieldCheck} title="Signed contracts" infoKey="signed-contracts" />
      {!contracts.length ? (
        <Card><EmptyState compact icon={ShieldCheck} title="No signed contracts yet"
          description="Estimates you approve become your signed contracts." /></Card>
      ) : (
        <div className={crmTable.wrapper}>
          <table className={crmTable.table}>
            <thead className={crmTable.thead}>
              <tr>
                <th className={crmTable.th}>Contract</th>
                <th className={crmTable.th}>Signed by</th>
                <th className={crmTable.th}>Signed on</th>
                <th className={crmTable.thRight}>Value</th>
                <th className={crmTable.thRight}>Contract PDF</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c: any) => (
                <tr key={c.id} className={crmTable.tr}>
                  <td className={crmTable.td}>
                    <a href={c.link} className="font-medium hover:underline" data-testid={`client-contract-${c.id}`}>
                      {c.number ? `${c.number} · ` : ""}{c.title}
                    </a>
                    {orgs.length > 1 && c.orgName && (
                      <div className="text-xs text-muted-foreground">{c.orgName}</div>
                    )}
                  </td>
                  <td className={crmTable.td}>{c.signedName ?? "—"}</td>
                  <td className={crmTable.td}>{day(c.signedAt) ?? "—"}</td>
                  <td className={crmTable.tdRight}>{money(c.totalCents)}</td>
                  <td className={crmTable.tdRight}>
                    {pdfByEstimate.get(c.id) && (
                      <a href={pdfByEstimate.get(c.id).downloadUrl}
                        className="font-medium text-primary hover:underline"
                        data-testid={`client-contract-download-${c.id}`}>
                        Download
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const reportsSection = (
    <section className="space-y-3" data-testid="section-reports">
      <SectionTitle icon={Ruler} title="Measurement reports" infoKey="portal-reports" />
      {!reports.length ? (
        <Card><EmptyState compact icon={Ruler} title="No measurement reports yet"
          description="Roof or property measurement reports your contractor files for you appear here." /></Card>
      ) : (
        <div className={crmTable.wrapper}>
          <table className={crmTable.table}>
            <thead className={crmTable.thead}>
              <tr>
                <th className={crmTable.th}>Report</th>
                <th className={crmTable.th}>Date</th>
                <th className={crmTable.thRight}>Roof size</th>
                <th className={crmTable.thRight}></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r: any) => (
                <tr key={r.id} className={crmTable.tr} data-testid={`client-report-${r.id}`}>
                  <td className={crmTable.td}>
                    <span className="font-medium capitalize">{r.provider} report</span>
                    <div className="text-xs text-muted-foreground">
                      {[r.addressLine1, r.city, r.state].filter(Boolean).join(", ") || "—"}
                      {orgs.length > 1 && r.orgName ? ` · ${r.orgName}` : ""}
                    </div>
                  </td>
                  <td className={crmTable.td}>{day(r.date) ?? "—"}</td>
                  <td className={crmTable.tdRight}>
                    {r.squares !== null && r.squares !== undefined
                      ? `${r.squares.toLocaleString("en-US", { maximumFractionDigits: 2 })} sq`
                      : "—"}
                    {r.pitch ? <span className="text-xs text-muted-foreground"> · {r.pitch}</span> : null}
                    {(r.sidingSqft || r.windowsCount) && (
                      <div className="text-xs text-muted-foreground">
                        {[
                          r.sidingSqft ? `siding ${Number(r.sidingSqft).toLocaleString("en-US", { maximumFractionDigits: 0 })} sq ft` : null,
                          r.windowsCount ? `${r.windowsCount} windows` : null,
                        ].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className={crmTable.tdRight}>
                    <div className="flex flex-col items-end gap-1">
                      {/* The 3D viewer opens in a NEW TAB, not an iframe:
                          hover.to/3d/<jobId> currently sends no
                          X-Frame-Options / frame-ancestors (checked
                          2026-08), but HOVER ships the viewer as a
                          standalone page — iframing adds nothing and any
                          future XFO change would break it silently. */}
                      {r.model3dUrl && (
                        <a href={r.model3dUrl} target="_blank" rel="noopener noreferrer"
                          className="font-medium text-primary hover:underline" data-testid={`client-report-3d-${r.id}`}>
                          View 3D model
                        </a>
                      )}
                      {r.pdfDownloadUrl && (
                        <a href={r.pdfDownloadUrl} className="font-medium text-primary hover:underline" data-testid={`client-report-pdf-${r.id}`}>
                          Measurement PDF
                        </a>
                      )}
                      {r.downloadUrl && (
                        <a href={r.downloadUrl} className="font-medium text-primary hover:underline" data-testid={`client-report-download-${r.id}`}>
                          Download
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const viewBody: Record<ViewKey, React.ReactNode> = {
    home: (
      <>
        {needsAction}
        {/* Financing — clicks are recorded before the lender link opens. */}
        <PortalFinancing financing={financing} preview={preview} />
        {/* From <company> — org pamphlets (brochures, warranties) */}
        <PortalPamphlets pamphlets={pamphlets} />
        {!actionCount && !financing?.length && !pamphlets?.length && (
          <Card><EmptyState compact icon={LayoutDashboard} title="You're all caught up"
            description="Estimates, invoices and contracts live in the menu. Anything needing your action shows up here." /></Card>
        )}
      </>
    ),
    estimates: estimatesSection,
    invoices: invoicesSection,
    contracts: contractsSection,
    reports: reportsSection,
    photos: <PortalPhotoShare accounts={accounts} photos={photos} />,
    messages: <PortalCommentBox accounts={accounts} />,
    // The mobile ribbon's "Docs" tab: everything, stacked.
    documents: (
      <>
        {estimatesSection}
        {invoicesSection}
        {contractsSection}
        {reportsSection}
      </>
    ),
  };

  const navButton = (item: { key: ViewKey; title: string; icon: LucideIcon }) => {
    const active = view === item.key;
    const n = badge(item.key);
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => setView(item.key)}
        data-testid={`portal-nav-${item.key}`}
        className={`flex w-full items-center gap-3 rounded-lg px-3 h-9 text-[13px] font-medium transition-colors ${
          active
            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
            : "text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent"
        }`}
      >
        <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.9} />
        <span className="flex-1 text-left">{item.title}</span>
        {n != null && (
          <span className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center">
            {n}
          </span>
        )}
      </button>
    );
  };

  return (
    <main className="min-h-screen bg-muted/40" style={themeStyle} data-testid="client-portal-root">
      {/* Camera capture — fed by the mobile ribbon's center button. */}
      <input
        ref={captureRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="input-portal-capture"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) capture.mutate(f);
          e.target.value = "";
        }}
      />

      {/* ── Desktop sidebar — the CRM's chrome, client-portal edition ─────── */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-30 w-60 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="px-4 pt-5 pb-4">
          <CrmLogo height={26} testid="client-portal-brand" />
          {oneOrg && (
            <span className="flex items-center gap-1.5 mt-1.5 min-w-0">
              {oneOrg.logoUrl && (
                <img src={oneOrg.logoUrl} alt="" className="h-4 w-4 rounded-sm object-contain bg-white shrink-0" />
              )}
              <span className="text-[11px] text-sidebar-foreground/50 truncate leading-tight" data-testid="text-sidebar-org">
                {oneOrg.name}
              </span>
            </span>
          )}
        </div>
        <div className="h-px bg-sidebar-border" />
        <nav className="flex-1 overflow-y-auto py-3">
          <div className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40 px-4 pb-2">
            Your project
          </div>
          <div className="px-2 space-y-1">{SIDEBAR_NAV.map(navButton)}</div>
        </nav>
        <div className="p-3">
          <div className="flex items-center justify-between gap-1 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/25 text-[11px] font-semibold">
                {(customer?.displayName || "?")[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium truncate leading-tight" data-testid="text-portal-user">
                  {customer?.displayName ?? "You"}
                </div>
                <div className="text-[10px] text-sidebar-foreground/50 leading-tight">Homeowner</div>
              </div>
            </div>
            <button
              type="button"
              onClick={signOut}
              title="Sign out"
              aria-label="Sign out"
              data-testid="button-client-logout"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="md:pl-60 pb-24 md:pb-0">
        <CrmPage className="max-w-5xl">
          {/* Header: the contractor's branding up top; sign-out lives in the
              sidebar on desktop and here on mobile. */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              {oneOrg?.logoUrl && (
                <img src={oneOrg.logoUrl} alt={oneOrg.name} className="h-11 w-11 rounded-xl object-contain bg-card border" />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <h1 className="text-2xl font-semibold tracking-tight leading-tight" data-testid="text-org-name">
                    {oneOrg ? oneOrg.name : "Your documents"}
                  </h1>
                  <InfoTip k="portal" />
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Welcome, {customer?.displayName ?? "there"}
                  {orgs.length > 1 ? ` · ${orgs.map((o: any) => o.name).join(" · ")}` : ""}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={signOut} className="md:hidden" data-testid="button-client-logout-mobile">
              <LogOut className="h-4 w-4 mr-1.5" /> Sign out
            </Button>
          </div>

          {/* Read-only banner when the contractor opens this portal as the client. */}
          {preview && <ContractorPreviewBanner customerName={customer?.displayName} />}

          {viewBody[view]}

          <div className="flex flex-col items-center gap-2.5 pb-4">
            {/* The CRM powers this portal; the header above stays the contractor's. */}
            <CrmLogo height={20} className="opacity-60" />
            <p className="text-center text-xs text-muted-foreground/70">
              Signed in by secure email link · your documents only
              <span className="mx-1.5">·</span>
              <a href="/crm-terms" className="hover:underline" data-testid="link-portal-terms-footer">Terms</a>
              <span className="mx-1.5">·</span>
              <a href="/crm-privacy" className="hover:underline" data-testid="link-portal-privacy-footer">Privacy</a>
            </p>
          </div>
        </CrmPage>
      </div>

      {/* ── Mobile bottom ribbon — raised center button captures the house ── */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-sidebar text-sidebar-foreground border-t border-sidebar-border pb-[env(safe-area-inset-bottom)]"
        data-testid="portal-ribbon"
      >
        <div className="grid grid-cols-5 items-end h-16">
          {([
            { key: "home" as ViewKey, title: "Home", icon: LayoutDashboard },
            { key: "documents" as ViewKey, title: "Docs", icon: FolderOpen },
          ]).map((t) => (
            <RibbonTab key={t.key} title={t.title} icon={t.icon} active={view === t.key} badge={badge(t.key)} onTap={() => setView(t.key)} />
          ))}
          <div className="relative flex justify-center">
            <button
              type="button"
              disabled={preview || capture.isPending || !customerId}
              onClick={() => captureRef.current?.click()}
              data-testid="button-portal-capture"
              aria-label="Capture a photo of the house"
              title={preview ? "Uploads are disabled in contractor preview" : "Capture a photo"}
              className="absolute -top-6 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background flex items-center justify-center disabled:opacity-60 active:scale-95 transition-transform"
            >
              {capture.isPending
                ? <Loader2 className="h-6 w-6 animate-spin" />
                : <Camera className="h-6 w-6" strokeWidth={2} />}
            </button>
            <span className="pb-1.5 text-[10px] font-medium text-sidebar-foreground/60">Capture</span>
          </div>
          {([
            { key: "photos" as ViewKey, title: "Photos", icon: ImageIcon },
            { key: "messages" as ViewKey, title: "Messages", icon: MessageSquare },
          ]).map((t) => (
            <RibbonTab key={t.key} title={t.title} icon={t.icon} active={view === t.key} badge={badge(t.key)} onTap={() => setView(t.key)} />
          ))}
        </div>
      </nav>
    </main>
  );
}

function RibbonTab({ title, icon: Icon, active, badge, onTap }: {
  title: string; icon: LucideIcon; active: boolean; badge: number | null; onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      data-testid={`ribbon-${title.toLowerCase()}`}
      className={`flex flex-col items-center justify-end gap-1 pb-1.5 h-full ${
        active ? "text-primary" : "text-sidebar-foreground/60"
      }`}
    >
      <span className="relative">
        <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.9} />
        {badge != null && (
          <span className="absolute -top-1.5 -right-2.5 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
            {badge}
          </span>
        )}
      </span>
      <span className="text-[10px] font-medium">{title}</span>
    </button>
  );
}
