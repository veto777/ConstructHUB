import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2, FileText, Receipt, ShieldCheck, Mail, ArrowRight, LogOut, Inbox, Ruler,
} from "lucide-react";
import {
  CrmPage, StatusPill, EmptyState, ErrorCard, SectionTitle, crmTable, statusTone,
} from "@/components/crm-ui";
import { PortalPamphlets, PortalPhotoShare, PortalCommentBox } from "@/components/client-uploads";
import { ContractorPreviewBanner, PortalFinancing } from "@/components/crm-client-360";
import { CrmLogo } from "@/components/crm-logo";
import { apiRequest, queryClient } from "@/lib/queryClient";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : null);

/**
 * The homeowner client portal (client.constructhub.*). Two states:
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
      </div>
    </main>
  );
}

/* ── Signed in: the dashboard ────────────────────────────────────────────── */

function Dashboard({ data }: { data: any }) {
  const {
    customer, orgs = [], estimates = [], invoices = [], contracts = [], reports = [],
    accounts = [], pamphlets = [], photos = [], financing = [],
  } = data;

  const now = Date.now();
  const awaitingEstimates = estimates.filter(
    (e: any) => !e.approvedAt && !e.declinedAt && (!e.expiresAt || new Date(e.expiresAt).getTime() > now),
  );
  const unpaidInvoices = invoices.filter((i: any) => !i.paidAt && i.dueCents > 0);

  async function signOut() {
    await apiRequest("POST", "/api/client/auth/logout");
    await queryClient.invalidateQueries({ queryKey: ["/api/client/documents"] });
  }

  const oneOrg = orgs.length === 1 ? orgs[0] : null;

  return (
    <main className="min-h-screen bg-muted/40">
      <CrmPage className="max-w-4xl">
        {/* Header: the contractor's branding, never ConstructHUB's app chrome. */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            {oneOrg?.logoUrl && (
              <img src={oneOrg.logoUrl} alt={oneOrg.name} className="h-11 w-11 rounded-xl object-contain bg-card border" />
            )}
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight leading-tight" data-testid="text-org-name">
                {oneOrg ? oneOrg.name : "Your documents"}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Welcome, {customer?.displayName ?? "there"}
                {orgs.length > 1 ? ` · ${orgs.map((o: any) => o.name).join(" · ")}` : ""}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={signOut} data-testid="button-client-logout">
            <LogOut className="h-4 w-4 mr-1.5" /> Sign out
          </Button>
        </div>

        {/* Read-only banner when the contractor opens this portal as the client. */}
        {data.contractorPreview && (
          <ContractorPreviewBanner customerName={customer?.displayName} />
        )}

        {/* Needs your action */}
        {(awaitingEstimates.length > 0 || unpaidInvoices.length > 0) && (
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
        )}

        {/* Estimates */}
        <section className="space-y-3" data-testid="section-estimates">
          <SectionTitle icon={FileText} title="Estimates" />
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

        {/* Invoices & receipts */}
        <section className="space-y-3" data-testid="section-invoices">
          <SectionTitle icon={Receipt} title="Invoices & receipts" />
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

        {/* Signed contracts */}
        <section className="space-y-3" data-testid="section-contracts">
          <SectionTitle icon={ShieldCheck} title="Signed contracts" />
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Measurement reports */}
        <section className="space-y-3" data-testid="section-reports">
          <SectionTitle icon={Ruler} title="Measurement reports" />
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
                      </td>
                      <td className={crmTable.tdRight}>
                        {r.downloadUrl && (
                          <a href={r.downloadUrl} className="font-medium text-primary hover:underline" data-testid={`client-report-download-${r.id}`}>
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

        {/* Financing — clicks are recorded before the lender link opens. */}
        <PortalFinancing financing={financing} preview={data.contractorPreview === true} />

        {/* From <company> — org pamphlets (brochures, warranties) */}
        <PortalPamphlets pamphlets={pamphlets} />

        {/* Share photos with your contractor */}
        <PortalPhotoShare accounts={accounts} photos={photos} />

        {/* Questions? Send a note to your contractor */}
        <PortalCommentBox accounts={accounts} />

        <div className="flex flex-col items-center gap-2.5 pb-4">
          {/* The CRM powers this portal; the header above stays the contractor's. */}
          <CrmLogo height={20} className="opacity-60" />
          <p className="text-center text-xs text-muted-foreground/70">
            Signed in by secure email link · your documents only
          </p>
        </div>
      </CrmPage>
    </main>
  );
}
