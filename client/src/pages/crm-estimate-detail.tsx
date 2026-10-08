import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import {
  CrmPage, CrmPageHeader, StatusPill, EmptyState, ErrorCard, statusTone, crmTable, crmTableCards,
} from "@/components/crm-ui";
import { EstimateDiscounts } from "@/components/crm-discounts";
import { money } from "@/lib/estimate-math";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, CheckCircle2, ClipboardCopy, Clock, Eye, FileText, Loader2,
  Pencil, Plus, Save, Send, Trash2, XCircle,
} from "lucide-react";

/**
 * Estimate detail — the missing edit surface. Every estimate (draft or SENT)
 * can be opened here from the Documents Center, edited end to end (title,
 * client message, per-line scope text, prices, tax, division letterhead),
 * re-sent, and — for owners — deleted. The one hard wall is a client
 * signature: an approved estimate is a contract and renders read-only.
 *
 * Writes go through PATCH /api/crm/estimates/:id; totals are always
 * recomputed server-side (the numbers below are a preview of that math).
 */

interface EditLine {
  kind: string;
  name: string;
  description: string;
  qtyText: string;
  unit: string;
  priceText: string;
  taxable: boolean;
  hiddenFromClient: boolean;
}

const BLANK: EditLine = {
  kind: "labor", name: "", description: "", qtyText: "1", unit: "",
  priceText: "0.00", taxable: true, hiddenFromClient: false,
};

const KINDS = ["labor", "material", "equipment", "subcontractor", "fee", "discount"];
/**
 * Statuses a person may set by hand (the server enforces the same). "viewed"
 * and "expired" are recorded by the system — an estimate that has one keeps
 * it in the list, but nobody picks it. "sent" here records a hand-delivered
 * bid (the send clock starts); it does not email anyone.
 */
const MANUAL_STATUSES = ["draft", "sent", "declined", "cancelled"];
const TAX_MAX_PCT = 30; // server: taxRateBps ≤ 3000
const TITLE_MAX = 200;

const dayTime = (d?: string | null) => (d ? new Date(d).toLocaleString() : "—");
const pctText = (bps?: number | null) =>
  bps == null ? "" : ` (−${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%)`;

/** Editable-line math, same rounding as the server's recalcEstimate. */
function lineCents(l: EditLine): number {
  const qty = Math.max(0, Math.round((parseFloat(l.qtyText) || 0) * 1000));
  const price = Math.max(0, Math.round((parseFloat(l.priceText) || 0) * 100));
  return Math.round((price * qty) / 1000);
}

/** A line the user never touched (no name, no scope, no price) — safe to drop on save. */
const isBlankLine = (l: EditLine) =>
  !l.name.trim() && !l.description.trim() && lineCents(l) === 0 && !l.unit.trim();

/**
 * The save error in words. A 400 from the PATCH carries zod issues; name the
 * field ("Tax rate — Number must be less than or equal to 3000") instead of
 * the generic "Invalid estimate".
 */
function describeSaveError(err: any): string {
  const raw = String(err?.message ?? "");
  try {
    const body = JSON.parse(raw.replace(/^\d{3}:\s*/, ""));
    const issue = Array.isArray(body?.issues) ? body.issues[0] : null;
    if (issue && Array.isArray(issue.path)) {
      const p = issue.path;
      const field = p[0] === "items" && typeof p[1] === "number"
        ? `Line ${p[1] + 1}${p[2] ? ` ${String(p[2]).replace(/Cents|Milli/, "")}` : ""}`
        : ({ title: "Title", taxRateBps: "Tax rate", depositCents: "Deposit", introText: "Message" } as Record<string, string>)[p[0]] ?? String(p[0] ?? "");
      return `${field ? `${field} — ` : ""}${issue.message}`;
    }
  } catch { /* not JSON — fall through */ }
  return apiErrorMessage(err);
}

export default function CrmEstimateDetailPage() {
  const [, params] = useRoute("/crm/estimates/:id");
  const id = params?.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const canEdit = me?.permissions?.manageEstimates === true && me?.permissions?.seePrices === true;
  // A price-blind seat (a field crew on their own job) reads the scope — items and quantities — and no
  // money: the API leaves every amount out, so the price columns and the totals are not drawn at all
  // (they used to render as "—" and "$0.00").
  const showMoney = me?.permissions?.seePrices === true;
  const isOwner = me?.member?.role === "owner";

  const { data, isLoading, isError, refetch } = useQuery<any>({
    queryKey: [`/api/crm/estimates/${id}`],
    enabled: !!id,
  });
  const { data: divisions } = useQuery<any[]>({ queryKey: ["/api/crm/divisions"] });

  const e = data?.estimate;
  const locked = !!e?.approvedAt;

  // ── Edit state ────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [intro, setIntro] = useState("");
  const [taxPct, setTaxPct] = useState("0");
  const [deposit, setDeposit] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [status, setStatus] = useState("draft");
  const [lines, setLines] = useState<EditLine[]>([]);

  const startEdit = () => {
    if (!e) return;
    setTitle(e.title ?? "");
    setIntro(e.introText ?? "");
    setTaxPct(((e.taxRateBps ?? 0) / 100).toString());
    setDeposit(e.depositCents != null ? (e.depositCents / 100).toString() : "");
    setDivisionId(e.divisionId ?? "");
    setStatus(e.status ?? "draft");
    setLines((data?.items ?? []).map((i: any) => ({
      kind: i.kind ?? "labor",
      name: i.name ?? "",
      description: i.description ?? "",
      qtyText: ((i.quantityMilli ?? 1000) / 1000).toString(),
      unit: i.unit ?? "",
      priceText: (((i.unitPriceCents ?? 0) as number) / 100).toString(),
      taxable: i.taxable ?? true,
      hiddenFromClient: i.hiddenFromClient ?? false,
    })));
    setEditing(true);
  };

  // Preview totals while editing — the server recomputes the real ones.
  const preview = useMemo(() => {
    let subtotal = 0, discount = 0, taxable = 0;
    for (const l of lines) {
      const c = lineCents(l);
      if (l.kind === "discount") { discount += c; continue; }
      subtotal += c;
      if (l.taxable) taxable += c;
    }
    const tax = Math.round((Math.max(0, taxable - discount) * Math.round((parseFloat(taxPct) || 0) * 100)) / 10000);
    return { subtotal, discount, tax, total: Math.max(0, subtotal - discount + tax) };
  }, [lines, taxPct]);

  // What stops a save, in words — checked BEFORE the PATCH so nothing the
  // preview counted is silently dropped and nothing out of the server's
  // range comes back as a bare "Invalid estimate".
  const depositCents = deposit.trim() ? Math.round((parseFloat(deposit) || 0) * 100) : null;
  const unnamedLines = lines
    .map((l, idx) => (!l.name.trim() && !isBlankLine(l) ? idx : -1))
    .filter((idx) => idx >= 0);
  const problems = useMemo(() => {
    const out: string[] = [];
    if (title.trim().length > TITLE_MAX) out.push(`The title can be at most ${TITLE_MAX} characters.`);
    const tax = taxPct.trim() === "" ? 0 : Number(taxPct);
    if (!Number.isFinite(tax) || tax < 0 || tax > TAX_MAX_PCT) out.push(`Tax must be between 0% and ${TAX_MAX_PCT}%.`);
    if (deposit.trim()) {
      const d = Number(deposit);
      if (!Number.isFinite(d) || d < 0) out.push("The deposit must be a dollar amount.");
      else if ((depositCents ?? 0) > preview.total) {
        out.push(`The deposit (${money(depositCents)}) can't be more than the total (${money(preview.total)}).`);
      }
    }
    for (const idx of unnamedLines) out.push(`Line ${idx + 1} needs a name — or remove it.`);
    if (!lines.some((l) => l.name.trim())) out.push("Add at least one named line.");
    return out;
  }, [title, taxPct, deposit, depositCents, preview.total, unnamedLines.join(","), lines]);

  // Leave edit mode AND drop ?edit=1, so a reload shows the saved estimate
  // instead of re-opening the editor.
  const exitEdit = () => {
    setEditing(false);
    if (new URLSearchParams(window.location.search).has("edit")) {
      setLocation(`/crm/estimates/${id}`, { replace: true });
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      // Only lines nobody touched are dropped; an unnamed line WITH a price
      // or scope blocks the save above instead of vanishing.
      const clean = lines.filter((l) => !isBlankLine(l));
      return (await apiRequest("PATCH", `/api/crm/estimates/${id}`, {
        title: title.trim() || "Estimate",
        introText: intro.trim() || null,
        taxRateBps: Math.round((parseFloat(taxPct) || 0) * 100),
        depositCents,
        divisionId: divisionId || null,
        // Only a status the person actually changed. An untouched select can
        // hold a status nobody may set by hand (an imported "approved" row
        // without a signature), which the PATCH would refuse outright.
        status: status !== e?.status ? status : undefined,
        items: clean.map((l, idx) => ({
          kind: l.kind,
          name: l.name.trim(),
          description: l.description.trim() || null,
          quantityMilli: Math.max(0, Math.round((parseFloat(l.qtyText) || 0) * 1000)),
          unit: l.unit.trim() || null,
          unitPriceCents: Math.max(0, Math.round((parseFloat(l.priceText) || 0) * 100)),
          taxable: l.taxable,
          hiddenFromClient: l.hiddenFromClient,
          sortOrder: idx,
        })),
      })).json();
    },
    onSuccess: () => {
      exitEdit();
      queryClient.invalidateQueries({ queryKey: [`/api/crm/estimates/${id}`] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/crm/estimates") });
      if (e?.customerId) queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${e.customerId}`] });
      toast({ title: "Estimate updated", description: e?.sentAt ? "The client link shows the new version immediately." : undefined });
    },
    onError: (err: any) => toast({ title: "Could not save", description: describeSaveError(err), variant: "destructive" }),
  });

  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/crm/estimates/${id}/send`, {})).json(),
    onSuccess: async (r: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/estimates/${id}`] });
      if (r.emailed) {
        toast({ title: "Estimate sent", description: `Emailed to ${r.estimate?.sentToEmail ?? "the client"}.` });
      } else {
        // Only say "copied" when the clipboard took it; otherwise show the link.
        // The send route returns an absolute link — resolve, never prefix it.
        const url = r.link ? new URL(r.link, window.location.origin).toString() : null;
        let copied = false;
        if (url) {
          try { await navigator.clipboard.writeText(url); copied = true; } catch { /* shown below */ }
        }
        toast(copied
          ? { title: "Email failed — link copied", description: "Send this link to your client directly.", variant: "destructive" }
          : { title: "Email failed", description: url ? `Send this link to your client directly: ${url}` : "Use Copy client link on this page and send it to your client directly.", variant: "destructive" });
      }
    },
    onError: (err: any) => toast({ title: "Could not send", description: apiErrorMessage(err), variant: "destructive" }),
  });

  const previewLink = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/crm/estimates/${id}/preview-link`, {})).json(),
    onSuccess: (r: any) => { if (r.url) window.open(r.url, "_blank", "noopener"); },
    onError: (err: any) => toast({ title: "Could not open preview", description: apiErrorMessage(err), variant: "destructive" }),
  });

  // ── Owner delete ──────────────────────────────────────────────────────────
  const [delOpen, setDelOpen] = useState(false);
  const del = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/crm/estimates/${id}`)).json(),
    onSuccess: () => {
      // Only the list — invalidating the detail key would refetch a deleted
      // estimate (404) before the navigation below lands.
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = String(q.queryKey[0]);
          return k === "/api/crm/estimates" || k.startsWith("/api/crm/estimates?");
        },
      });
      if (e?.customerId) queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${e.customerId}`] });
      toast({ title: "Estimate deleted" });
      setLocation("/crm/estimates");
    },
    onError: (err: any) => {
      setDelOpen(false);
      toast({ title: "Could not delete", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const setLine = (idx: number, patch: Partial<EditLine>) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  // Auto-enter edit mode on ?edit=1 — a fresh draft from the builder OR the
  // "Edit" button on a client's page. Sent estimates are editable too (only a
  // signed/approved estimate is locked), so this no longer excludes sent ones.
  useEffect(() => {
    if (e && !editing && !locked && canEdit &&
        new URLSearchParams(window.location.search).get("edit") === "1") {
      startEdit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e?.id, canEdit]);

  if (isLoading) {
    return <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (isError || !e) {
    return (
      <ErrorCard title="Estimate not found" description="It may have been deleted, or the link is wrong.">
        <Link href="/crm/estimates">
          <Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> All estimates</Button>
        </Link>
      </ErrorCard>
    );
  }

  const items: any[] = data.items ?? [];
  const events: any[] = data.events ?? [];
  const customer = data.customer;
  // What the client signed for: the approved total (after any optional
  // discounts they ticked) — the amount the invoice, the contract PDF and
  // the pay link all use.
  const signedTotal: number | null = e.approvedAt && e.approvedTotalCents != null ? e.approvedTotalCents : null;
  const signedDiffers = signedTotal != null && signedTotal !== e.totalCents;
  const signedDiscounts: any[] = e.approvedAt && Array.isArray(e.selectedDiscounts) ? e.selectedDiscounts : [];
  const divisionName = divisionId || e.divisionId
    ? divisions?.find((d) => d.id === (editing ? divisionId : e.divisionId))?.name ?? null
    : null;

  return (
    <CrmPage>
      <CrmPageHeader
        icon={FileText}
        title={
          <span className="flex items-center gap-2.5 flex-wrap">
            {e.number} · {e.title}
            {/* "expired" is derived server-side (out, unanswered, past its date). */}
            <StatusPill tone={statusTone(e.expired ? "expired" : e.status)}>{e.expired ? "expired" : e.status}</StatusPill>
          </span>
        }
        subtitle={
          <span>
            For{" "}
            <Link href={`/crm/clients/${e.customerId}`} className="text-primary hover:underline" data-testid="link-customer">
              {customer?.displayName ?? "client"}
            </Link>
            {divisionName ? ` · ${divisionName}` : ""}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/crm/estimates">
              <Button variant="ghost" size="sm" data-testid="link-all-estimates">
                <ArrowLeft className="h-4 w-4 mr-1" /> Estimates
              </Button>
            </Link>
            {canEdit && !editing && (
              <Button variant="outline" size="sm" onClick={() => previewLink.mutate()} disabled={previewLink.isPending}
                data-testid="button-preview-estimate">
                {previewLink.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
                Preview
              </Button>
            )}
            {canEdit && !locked && !editing && (
              <Button variant="outline" size="sm" onClick={startEdit} data-testid="button-edit-estimate">
                <Pencil className="h-4 w-4 mr-2" /> Edit
              </Button>
            )}
            {canEdit && !locked && !editing && (
              <Button size="sm" variant={e.sentAt ? "outline" : "default"}
                onClick={() => send.mutate()} disabled={send.isPending}
                data-testid="button-send-estimate">
                {send.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                {e.sentAt ? "Resend" : "Send"}
              </Button>
            )}
            {isOwner && !locked && !editing && (
              <Button variant="ghost" size="sm" onClick={() => setDelOpen(true)}
                data-testid="button-delete-estimate" aria-label="Delete estimate">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        }
      />

      {locked && (
        <Card className="border-emerald-500/50 bg-emerald-500/5">
          <CardContent className="p-4 flex items-start gap-3 text-sm">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Approved{e.signatureName ? ` by ${e.signatureName}` : ""} — this estimate is a signed contract.</div>
              <div className="text-muted-foreground mt-0.5">It can no longer be edited or deleted.</div>
            </div>
          </CardContent>
        </Card>
      )}
      {e.declinedAt && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 flex items-start gap-3 text-sm">
            <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Declined {dayTime(e.declinedAt)}</div>
              {e.declineReason && <div className="text-muted-foreground mt-0.5">{e.declineReason}</div>}
              {canEdit && <div className="text-muted-foreground mt-0.5">Edit it and hit Resend to put a fresh offer in front of the client.</div>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tracking strip. */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground" data-testid="tracking-strip">
        {e.sentAt && <span className="flex items-center gap-1"><Send className="h-3 w-3" /> Sent {dayTime(e.sentAt)}{e.sentToEmail ? ` to ${e.sentToEmail}` : ""}</span>}
        {e.firstViewedAt ? (
          <span className="flex items-center gap-1 text-foreground font-medium">
            <Eye className="h-3 w-3" /> Opened {dayTime(e.firstViewedAt)}{e.viewCount > 1 && ` · ${e.viewCount} views`}
          </span>
        ) : e.sentAt ? (
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Not opened yet</span>
        ) : null}
        {e.expiresAt && !locked && <span>Valid until {new Date(e.expiresAt).toLocaleDateString()}</span>}
        {data.publicPath && (
          <button
            type="button"
            className="flex items-center gap-1 text-primary hover:underline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.origin + data.publicPath);
                toast({ title: "Client link copied" });
              } catch {
                toast({ title: "Copy failed", description: data.publicPath, variant: "destructive" });
              }
            }}
            data-testid="button-copy-estimate-link"
          >
            <ClipboardCopy className="h-3 w-3" /> Copy client link
          </button>
        )}
      </div>

      {editing ? (
        /* ── Edit mode ────────────────────────────────────────────────────── */
        <Card data-testid="estimate-editor">
          <CardContent className="p-4 sm:p-6 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Title</Label>
                <Input value={title} maxLength={TITLE_MAX} onChange={(ev) => setTitle(ev.target.value)}
                  data-testid="input-edit-title" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Tax %</Label>
                  <Input type="number" step="0.01" min={0} max={TAX_MAX_PCT} value={taxPct}
                    onChange={(ev) => setTaxPct(ev.target.value)}
                    aria-invalid={Number(taxPct) > TAX_MAX_PCT || Number(taxPct) < 0}
                    data-testid="input-edit-tax" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Deposit $</Label>
                  <Input type="number" step="0.01" min={0} value={deposit} placeholder="none"
                    aria-invalid={(depositCents ?? 0) > preview.total}
                    onChange={(ev) => setDeposit(ev.target.value)} data-testid="input-edit-deposit" />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Message to the client</Label>
              <Textarea rows={3} value={intro} onChange={(ev) => setIntro(ev.target.value)}
                placeholder="Thanks for having us out — here's the scope we discussed."
                data-testid="textarea-edit-intro" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(divisions ?? []).length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Division (letterhead)</Label>
                  <select
                    value={divisionId}
                    onChange={(ev) => setDivisionId(ev.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid="select-edit-division"
                  >
                    <option value="">Auto — from the project</option>
                    {divisions!.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ""}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <select
                  value={status}
                  onChange={(ev) => setStatus(ev.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="select-edit-status"
                >
                  {(MANUAL_STATUSES.includes(e.status) ? MANUAL_STATUSES : [e.status, ...MANUAL_STATUSES])
                    .map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                {status === "sent" && e.status !== "sent" && (
                  <p className="text-[11px] text-muted-foreground" data-testid="text-status-sent-note">
                    Records that you delivered it another way (its validity clock starts if it isn't
                    running) — it doesn't email the client. Use Send for that.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Line items — name, full scope text, qty and price</Label>
              {lines.map((l, idx) => (
                <div key={idx} className="rounded-lg border p-3 space-y-2" data-testid={`edit-line-${idx}`}>
                  <div className="grid gap-2 sm:grid-cols-12 items-end">
                    <div className="sm:col-span-4">
                      <Label className="text-xs">Item</Label>
                      <Input value={l.name} maxLength={300} onChange={(ev) => setLine(idx, { name: ev.target.value })}
                        aria-invalid={unnamedLines.includes(idx)}
                        className={unnamedLines.includes(idx) ? "border-destructive" : undefined}
                        placeholder="Fiber-cement siding — front elevation" data-testid={`edit-line-name-${idx}`} />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Kind</Label>
                      <select
                        value={l.kind}
                        onChange={(ev) => setLine(idx, { kind: ev.target.value })}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs"
                        data-testid={`edit-line-kind-${idx}`}
                      >
                        {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>
                    <div className="sm:col-span-1">
                      <Label className="text-xs">Qty</Label>
                      <Input type="number" step="0.01" value={l.qtyText}
                        onChange={(ev) => setLine(idx, { qtyText: ev.target.value })}
                        data-testid={`edit-line-qty-${idx}`} />
                    </div>
                    <div className="sm:col-span-1">
                      <Label className="text-xs">Unit</Label>
                      <Input value={l.unit} maxLength={20} onChange={(ev) => setLine(idx, { unit: ev.target.value })}
                        placeholder="sf" data-testid={`edit-line-unit-${idx}`} />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Unit price $</Label>
                      <Input type="number" step="0.01" value={l.priceText}
                        onChange={(ev) => setLine(idx, { priceText: ev.target.value })}
                        data-testid={`edit-line-price-${idx}`} />
                    </div>
                    <div className="sm:col-span-2 flex items-center justify-end gap-2">
                      <span className="text-sm font-medium tabular-nums">{money(lineCents(l))}</span>
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground"
                        onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                        data-testid={`button-edit-line-remove-${idx}`} aria-label={`Remove line ${idx + 1}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    rows={2}
                    value={l.description}
                    onChange={(ev) => setLine(idx, { description: ev.target.value })}
                    placeholder="Scope of work — what's included, materials, prep, cleanup, warranty… (shows on the client's estimate)"
                    className="text-sm"
                    data-testid={`edit-line-scope-${idx}`}
                  />
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox checked={l.taxable} onCheckedChange={(v) => setLine(idx, { taxable: v === true })}
                        data-testid={`edit-line-taxable-${idx}`} />
                      Taxable
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox checked={l.hiddenFromClient} onCheckedChange={(v) => setLine(idx, { hiddenFromClient: v === true })}
                        data-testid={`edit-line-hidden-${idx}`} />
                      Hidden from client
                    </label>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { ...BLANK }])}
                data-testid="button-edit-add-line">
                <Plus className="h-4 w-4 mr-2" /> Add line
              </Button>
              <p className="text-xs text-muted-foreground">
                A <span className="font-medium">discount</span> line subtracts from the total — that's the manual discount.
              </p>
            </div>

            <div className="flex justify-end">
              <div className="w-full max-w-xs text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums font-medium" data-testid="text-edit-subtotal">{money(preview.subtotal)}</span>
                </div>
                {preview.discount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="tabular-nums font-medium">−{money(preview.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="tabular-nums font-medium" data-testid="text-edit-tax">{money(preview.tax)}</span>
                </div>
                <div className="flex justify-between border-t pt-1.5 text-lg font-bold">
                  <span>Total</span>
                  <span className="tabular-nums" data-testid="text-edit-total">{money(preview.total)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">The server recomputes these on save.</p>
              </div>
            </div>

            {problems.length > 0 && (
              <ul className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-sm text-destructive space-y-0.5"
                role="alert" data-testid="edit-problems">
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={exitEdit} data-testid="button-cancel-edit">Cancel</Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending || problems.length > 0}
                data-testid="button-save-estimate-edit">
                {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save changes{e.sentAt ? " (client sees them now)" : ""}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* ── Read mode ────────────────────────────────────────────────────── */
        <Card data-testid="estimate-detail">
          <CardContent className="p-4 sm:p-6 space-y-5">
            {e.introText && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed" data-testid="text-intro">{e.introText}</p>
            )}
            {items.length === 0 ? (
              <EmptyState compact icon={FileText} title="No line items"
                description={canEdit ? "Hit Edit to add the scope and pricing." : "No lines on this estimate yet."} />
            ) : (
              /* Below sm each line stacks as a card — name and scope, then
                 "qty × price", then the line total — so nothing is clipped
                 or needs sideways scrolling on a phone. Desktop is a table. */
              <div className={crmTable.wrapper}>
                <table className={cn(crmTable.table, "block sm:table")}>
                  <thead className={cn(crmTable.thead, crmTableCards.thead)}>
                    <tr>
                      <th className={crmTable.th}>Item</th>
                      <th className={crmTable.thRight}>Qty</th>
                      {showMoney && <th className={crmTable.thRight}>Price</th>}
                      {showMoney && <th className={crmTable.thRight}>Total</th>}
                    </tr>
                  </thead>
                  <tbody className="block sm:table-row-group">
                    {items.map((i: any, idx: number) => {
                      const qtyLabel = `${((i.quantityMilli ?? 0) / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })}${i.unit ? ` ${i.unit}` : ""}`;
                      return (
                        <tr key={i.id ?? idx} className={cn(crmTable.tr, crmTableCards.tr)} data-testid={`detail-line-${idx}`}>
                          <td className={cn(crmTableCards.td, "min-w-0")}>
                            <div className="font-medium flex flex-wrap items-center gap-2">
                              {i.name}
                              {i.kind === "discount" && <StatusPill tone="neutral">discount</StatusPill>}
                              {i.hiddenFromClient && <StatusPill tone="neutral">hidden</StatusPill>}
                            </div>
                            {i.description && (
                              <div className="text-xs text-muted-foreground whitespace-pre-wrap mt-0.5 leading-relaxed">
                                {i.description}
                              </div>
                            )}
                            <div className="sm:hidden mt-1 text-xs text-muted-foreground tabular-nums">
                              {showMoney ? `${qtyLabel} × ${money(i.unitPriceCents)}` : qtyLabel}
                            </div>
                          </td>
                          <td className={cn(crmTable.tdRight, "hidden sm:table-cell tabular-nums")}>{qtyLabel}</td>
                          {showMoney && (
                            <td className={cn(crmTable.tdRight, "hidden sm:table-cell tabular-nums")}>{money(i.unitPriceCents)}</td>
                          )}
                          {showMoney && (
                            <td className={cn(crmTableCards.td, "flex items-baseline justify-between sm:text-right tabular-nums font-medium")}>
                              <span className="sm:hidden text-xs font-normal text-muted-foreground">Line total</span>
                              {money(Math.round(((i.unitPriceCents ?? 0) * (i.quantityMilli ?? 0)) / 1000))}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!showMoney && (
              <p className="text-xs text-muted-foreground" data-testid="text-prices-hidden">
                Prices and totals are hidden for your seat — this is the scope of work. Ask your admin if you need to see pricing.
              </p>
            )}
            {showMoney && (
            <div className="flex justify-end">
              <div className="w-full max-w-xs text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums font-medium">{money(e.subtotalCents)}</span>
                </div>
                {(e.discountCents ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="tabular-nums font-medium">−{money(e.discountCents)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="tabular-nums font-medium">{money(e.taxCents)}</span>
                </div>
                {signedDiffers ? (
                  <>
                    <div className="flex justify-between border-t pt-1.5 text-muted-foreground">
                      <span>Total as quoted</span>
                      <span className="tabular-nums" data-testid="text-detail-total">{money(e.totalCents)}</span>
                    </div>
                    {signedDiscounts.length > 0 && (
                      <div className="flex justify-between gap-3" data-testid="row-signed-discounts">
                        <span className="text-muted-foreground shrink-0">Optional discounts</span>
                        <span className="font-medium text-right">
                          {signedDiscounts.map((d: any) => `${d.label}${pctText(d.percentBps)}`).join(", ")}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between border-t pt-1.5 text-lg font-bold">
                      <span>Signed total</span>
                      <span className="tabular-nums" data-testid="text-signed-total">{money(signedTotal)}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      What {e.signatureName ?? "the client"} approved — the optional discounts they ticked come off
                      the taxable amount, and tax is recalculated on what's left.
                    </p>
                  </>
                ) : (
                  <div className="flex justify-between border-t pt-1.5 text-lg font-bold">
                    <span>{signedTotal != null ? "Signed total" : "Total"}</span>
                    <span className="tabular-nums" data-testid="text-detail-total">{money(e.totalCents)}</span>
                  </div>
                )}
                {e.depositCents ? (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Deposit due</span>
                    <span className="tabular-nums font-medium">{money(e.depositCents)}</span>
                  </div>
                ) : null}
              </div>
            </div>
            )}

            {/* Client-selectable discount offers (the ones the owner likes) —
                self-contained component, same as on the client page. */}
            {canEdit && !locked && !e.declinedAt && (
              <div className="border-t pt-4">
                <EstimateDiscounts estimate={e} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Events trail — created/sent/viewed/updated, newest first. */}
      {events.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="text-sm font-medium">History</div>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs text-muted-foreground" data-testid="events-trail">
            {events.slice(0, 20).map((ev: any) => (
              <div key={ev.id} className="flex justify-between gap-3" data-testid={`event-${ev.type}`}>
                <span className="capitalize">{String(ev.type).replace(/_/g, " ")}</span>
                <span>{dayTime(ev.createdAt)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Owner-only hard delete. */}
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent data-testid="dialog-delete-estimate">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete estimate {e.number ?? ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {e.number ?? "this estimate"}
              {e.title ? ` ("${e.title}")` : ""}
              {customer?.displayName ? ` for ${customer.displayName}` : ""},
              with all of its line items, options, discounts and history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-estimate">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-delete-estimate"
              onClick={() => del.mutate()}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrmPage>
  );
}
