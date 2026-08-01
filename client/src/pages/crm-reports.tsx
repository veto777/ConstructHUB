import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Ruler, Upload, Loader2, FileText, Download, ClipboardPaste, UserPlus, Link2,
} from "lucide-react";
import {
  CrmPage, CrmPageHeader, EmptyState, ErrorCard, SectionTitle, StatusPill,
  crmTable, statusTone,
} from "@/components/crm-ui";

/**
 * Measurement report imports. Upload a HOVER PDF or paste the report text —
 * the parse is previewed first and NOTHING is created until you confirm.
 * Confirming dedupe-matches (or creates) the client and files the report
 * where the client portal can show it.
 */

interface ParsedReport {
  provider: "hover" | "other";
  contact: {
    name: string | null; email: string | null; phone: string | null;
    addressLine1: string | null; city: string | null; state: string | null; postalCode: string | null;
  };
  measurements: {
    squares: number | null; roofAreaSf: number | null; pitch: string | null;
    facetCount: number | null; wastePercent: number | null;
    ridgeLf: number | null; hipLf: number | null; valleyLf: number | null;
    eaveLf: number | null; rakeLf: number | null;
  };
  warnings: string[];
}

interface ReportRow {
  id: string;
  provider: string;
  status: string;
  date: string | null;
  customerId: string | null;
  fileName: string | null;
  contact: ParsedReport["contact"] | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  squares: number | null;
  pitch: string | null;
  facetCount: number | null;
  downloadUrl: string | null;
}

const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");
const fmt = (v: number | null | undefined, suffix = "") =>
  v === null || v === undefined ? "—" : `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}${suffix}`;

export default function CrmReportsPage() {
  const { toast } = useToast();
  const [pasteText, setPasteText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<{ id: string; parsed: ParsedReport } | null>(null);
  const [confirmed, setConfirmed] = useState<{ customerId: string; created: boolean } | null>(null);

  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const canManage = me?.permissions?.manageCustomers === true;

  const { data: reports, isLoading, isError } = useQuery<ReportRow[]>({
    queryKey: ["/api/crm/reports"],
  });

  const parse = useMutation({
    mutationFn: async () => {
      let r: Response;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        r = await fetch("/api/crm/reports/upload", { method: "POST", body: fd, credentials: "include" });
      } else {
        r = await fetch("/api/crm/reports/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ text: pasteText, fileName: "pasted-report.txt" }),
        });
      }
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message || `Upload failed (${r.status})`);
      }
      return r.json();
    },
    onSuccess: (data) => {
      setDraft(data);
      setConfirmed(null);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/reports"] });
    },
    onError: (e: any) =>
      toast({ title: "Couldn't parse that report", description: String(e.message ?? e), variant: "destructive" }),
  });

  const confirm = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/crm/reports/${draft!.id}/confirm`, {})).json(),
    onSuccess: (data) => {
      setConfirmed({ customerId: data.customer.id, created: data.created });
      setDraft(null);
      setPasteText("");
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/customers"] });
      toast({
        title: data.created ? "Client created" : "Existing client matched",
        description: `${data.customer.displayName} — the report is now linked to their record and visible in their client portal.`,
      });
    },
    onError: (e: any) =>
      toast({ title: "Couldn't confirm the report", description: String(e.message ?? e), variant: "destructive" }),
  });

  if (isError) {
    return <ErrorCard title="Couldn't load reports" description="Check your connection and refresh the page." />;
  }

  const p = draft?.parsed;

  return (
    <CrmPage>
      <CrmPageHeader
        icon={Ruler}
        title="Measurement reports"
        subtitle="Import a HOVER or CladAI report — the client is matched or created from it automatically."
      />

      {/* ── Import ──────────────────────────────────────────────────────── */}
      {canManage && (
        <Card>
          <CardHeader>
            <SectionTitle
              icon={Upload}
              title="Import a report"
              description="Upload the PDF or paste the report text. You'll review the parse before anything is created."
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="report-file">Report file (PDF or text, up to 25MB)</Label>
                <input
                  id="report-file"
                  type="file"
                  accept=".pdf,.txt,text/plain,application/pdf"
                  data-testid="input-report-file"
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-accent"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    if (e.target.files?.[0]) setPasteText("");
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Some PDFs don't give up their text — if upload says so, open the report, copy everything, and paste it here.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="report-text">…or paste the report text</Label>
                <Textarea
                  id="report-text"
                  rows={6}
                  placeholder={"Prepared for: Jane Homeowner\n123 Main St\n…"}
                  value={pasteText}
                  data-testid="textarea-report-text"
                  onChange={(e) => {
                    setPasteText(e.target.value);
                    if (e.target.value) setFile(null);
                  }}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => parse.mutate()}
                disabled={parse.isPending || (!file && !pasteText.trim())}
                data-testid="button-parse-report"
              >
                {parse.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ClipboardPaste className="h-4 w-4 mr-2" />}
                Parse report
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Preview before anything is created ──────────────────────────── */}
      {draft && p && (
        <Card className="border-primary/40" data-testid="report-preview">
          <CardHeader>
            <SectionTitle
              icon={FileText}
              title="Review the import"
              description="This is what the report gave us. Confirm to create the client and file the report."
              actions={<StatusPill tone={p.provider === "hover" ? "info" : "neutral"} data-testid="pill-provider">{p.provider}</StatusPill>}
            />
          </CardHeader>
          <CardContent className="space-y-4">
            {p.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400" data-testid="text-parse-warnings">
                {p.warnings.join(" ")}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1 text-sm" data-testid="preview-contact">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Client</div>
                <div className="font-medium" data-testid="preview-name">{p.contact.name ?? "—"}</div>
                <div className="text-muted-foreground">{p.contact.email ?? "no email"}</div>
                <div className="text-muted-foreground">{p.contact.phone ?? "no phone"}</div>
                <div className="text-muted-foreground">
                  {[p.contact.addressLine1, [p.contact.city, p.contact.state].filter(Boolean).join(", "), p.contact.postalCode]
                    .filter(Boolean).join(" · ") || "no address"}
                </div>
              </div>
              <div className="space-y-1 text-sm" data-testid="preview-measurements">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Roof</div>
                <div><span className="font-medium tabular-nums">{fmt(p.measurements.squares)}</span> squares · {fmt(p.measurements.roofAreaSf)} SF</div>
                <div className="text-muted-foreground">
                  pitch {p.measurements.pitch ?? "—"} · {p.measurements.facetCount ?? "—"} facets · waste {fmt(p.measurements.wastePercent, "%")}
                </div>
                <div className="text-muted-foreground text-xs">
                  ridges {fmt(p.measurements.ridgeLf)} · hips {fmt(p.measurements.hipLf)} · valleys {fmt(p.measurements.valleyLf)} · rakes {fmt(p.measurements.rakeLf)} · eaves {fmt(p.measurements.eaveLf)}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDraft(null)} data-testid="button-discard-report">
                Discard
              </Button>
              <Button onClick={() => confirm.mutate()} disabled={confirm.isPending} data-testid="button-confirm-report">
                {confirm.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
                Confirm — create the client
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {confirmed && (
        <Card className="border-emerald-500/40" data-testid="report-confirmed">
          <CardContent className="p-5 flex flex-wrap items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
              <Link2 className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{confirmed.created ? "Client created and report filed." : "Matched the existing client — report filed."}</div>
              <div className="text-xs text-muted-foreground">The report now shows in their client portal too.</div>
            </div>
            <Link href={`/crm/clients/${confirmed.customerId}`} data-testid="link-confirmed-client"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline shrink-0">
              Open client
            </Link>
          </CardContent>
        </Card>
      )}

      {/* ── Past imports ────────────────────────────────────────────────── */}
      <section className="space-y-3" data-testid="section-report-list">
        <SectionTitle icon={FileText} title="Imported reports" description="Newest first. Drafts are parsed but not yet confirmed." />
        {isLoading ? (
          <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !reports?.length ? (
          <Card>
            <EmptyState compact icon={Ruler} title="No reports yet"
              description="Upload a HOVER PDF or paste a report above — the parsed client lands on your Clients page." />
          </Card>
        ) : (
          <div className={crmTable.wrapper}>
            <table className={crmTable.table}>
              <thead className={crmTable.thead}>
                <tr>
                  <th className={crmTable.th}>Report</th>
                  <th className={crmTable.th}>Client</th>
                  <th className={crmTable.th}>Status</th>
                  <th className={crmTable.th}>Date</th>
                  <th className={crmTable.thRight}>Squares</th>
                  <th className={crmTable.thRight}></th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className={crmTable.tr} data-testid={`report-row-${r.id}`}>
                    <td className={crmTable.td}>
                      <div className="font-medium">{r.fileName ?? "Pasted report"}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.provider} · {[r.addressLine1, r.city, r.state].filter(Boolean).join(", ") || "no address"}
                      </div>
                    </td>
                    <td className={crmTable.td}>
                      {r.customerId ? (
                        <Link href={`/crm/clients/${r.customerId}`} className="text-primary hover:underline" data-testid={`report-client-${r.id}`}>
                          {r.contact?.name ?? "Client"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{r.contact?.name ?? "—"}</span>
                      )}
                    </td>
                    <td className={crmTable.td}>
                      <StatusPill tone={statusTone(r.status)} data-testid={`report-status-${r.id}`}>{r.status}</StatusPill>
                    </td>
                    <td className={crmTable.td}>{day(r.date)}</td>
                    <td className={crmTable.tdRight}>{fmt(r.squares)}</td>
                    <td className={crmTable.tdRight}>
                      {r.downloadUrl && (
                        <a href={r.downloadUrl} className="inline-flex items-center gap-1 text-sm text-primary hover:underline" data-testid={`report-download-${r.id}`}>
                          <Download className="h-3.5 w-3.5" /> Text
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
    </CrmPage>
  );
}
