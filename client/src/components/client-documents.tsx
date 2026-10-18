/**
 * Documents — the client's whole paper trail on one card (owner, 2026-10-18): every estimate, the signed contract for
 * each approved one (or a plain "no file on record"), every invoice, and a receipt for every payment — Housecall Pro
 * imports included. Receipts open as a printable page (Print → Save as PDF); the client sees the same ones in their
 * portal and on the invoice page.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionTitle, StatusPill, statusTone } from "@/components/crm-ui";
import { FileText, FileSignature, Receipt, ReceiptText, ExternalLink, Loader2, AlertTriangle } from "lucide-react";

const money = (c?: number | null) => `$${((c ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : null);
const METHOD: Record<string, string> = { cash: "Cash", check: "Check", wire: "Wire", credit_card: "Credit card", ach: "ACH", card: "Card", other: "Other" };

type Docs = {
  estimates: { id: string; number: string | null; title: string; status: string; totalCents: number; sentAt: string | null; approvedAt: string | null; link: string; clientLink: string; imported: boolean; contract: { id: string; fileName: string; downloadUrl: string } | null }[];
  contracts: { estimateId: string; estimateNumber: string | null; title: string; approvedAt: string | null; totalCents: number; attachmentId: string | null; fileName: string | null; downloadUrl: string | null }[];
  invoices: { id: string; number: string | null; title: string; status: string; totalCents: number; paidCents: number; dueCents: number; paidAt: string | null; link: string; clientLink: string; imported: boolean; receipts: number }[];
  receipts: { paymentId: string; invoiceId: string; invoiceNumber: string | null; amountCents: number; method: string | null; paidAt: string | null; provider: string; link: string }[];
};

export function ClientDocuments({ customerId }: { customerId: string }) {
  const { data, isLoading, isError } = useQuery<Docs>({ queryKey: [`/api/crm/customers/${customerId}/documents`] });
  const counts = data ? { e: data.estimates.length, c: data.contracts.filter((c) => c.downloadUrl).length, cMissing: data.contracts.filter((c) => !c.downloadUrl).length, i: data.invoices.length, r: data.receipts.length } : null;
  return (
    <Card data-testid="section-documents">
      <CardHeader>
        <SectionTitle icon={FileText} title="Documents"
          description={counts ? `${counts.e} estimate${counts.e === 1 ? "" : "s"} · ${counts.c} signed contract${counts.c === 1 ? "" : "s"} · ${counts.i} invoice${counts.i === 1 ? "" : "s"} · ${counts.r} receipt${counts.r === 1 ? "" : "s"}` : "Every estimate, signed contract, invoice and receipt for this client."} />
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          : isError || !data ? <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Couldn't load this client's documents.</p>
          : (
          <>
            <DocGroup icon={FileText} title="Estimates" empty="No estimates yet." testId="docs-estimates">
              {data.estimates.map((e) => (
                <Row key={e.id} testId={`doc-estimate-${e.id}`}
                  main={<><Link href={e.link} className="font-medium text-primary hover:underline">{e.number ?? "Estimate"}</Link> · {e.title}</>}
                  sub={`${money(e.totalCents)}${e.approvedAt ? ` · signed ${day(e.approvedAt)}` : e.sentAt ? ` · sent ${day(e.sentAt)}` : ""}${e.imported ? " · from Housecall Pro" : ""}`}
                  right={<><StatusPill tone={statusTone(e.status)}>{e.status}</StatusPill><Open href={e.clientLink} label="Client view" /></>} />
              ))}
            </DocGroup>
            <DocGroup icon={FileSignature} title="Signed contracts" empty="No signed estimates yet." testId="docs-contracts">
              {data.contracts.map((c) => (
                <Row key={c.estimateId} testId={`doc-contract-${c.estimateId}`}
                  main={<>{c.estimateNumber ?? "Estimate"} · {c.title}</>}
                  sub={`${money(c.totalCents)} · signed ${day(c.approvedAt) ?? "—"}`}
                  right={c.downloadUrl
                    ? <Button asChild size="sm" variant="outline"><a href={c.downloadUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-contract-${c.estimateId}`}><FileSignature className="h-4 w-4 mr-1.5" /> Contract PDF</a></Button>
                    : <span className="text-xs text-amber-700 dark:text-amber-400" title="Signed in Housecall Pro; the file was not in the export" data-testid={`text-contract-missing-${c.estimateId}`}>No file on record</span>} />
              ))}
            </DocGroup>
            <DocGroup icon={ReceiptText} title="Invoices" empty="No invoices yet." testId="docs-invoices">
              {data.invoices.map((i) => (
                <Row key={i.id} testId={`doc-invoice-${i.id}`}
                  main={<><Link href={i.link} className="font-medium text-primary hover:underline">{i.number ?? "Invoice"}</Link> · {i.title}</>}
                  sub={`${money(i.totalCents)} · ${i.dueCents > 0 ? `${money(i.dueCents)} due` : `paid${i.paidAt ? ` ${day(i.paidAt)}` : ""}`}${i.receipts ? ` · ${i.receipts} receipt${i.receipts === 1 ? "" : "s"}` : ""}${i.imported ? " · from Housecall Pro" : ""}`}
                  right={<><StatusPill tone={statusTone(i.status)}>{i.status}</StatusPill><Open href={i.clientLink} label="Client view" /></>} />
              ))}
            </DocGroup>
            <DocGroup icon={Receipt} title="Receipts" empty="No payments on file yet — a receipt appears for every payment." testId="docs-receipts">
              {data.receipts.map((r) => (
                <Row key={r.paymentId} testId={`doc-receipt-${r.paymentId}`}
                  main={<>{money(r.amountCents)} · {r.invoiceNumber ?? "Invoice"}</>}
                  sub={`${METHOD[r.method ?? ""] ?? r.method ?? "Payment"} · ${day(r.paidAt) ?? "—"}${r.provider === "hcp_import" ? " · from Housecall Pro" : ""}`}
                  right={<Button asChild size="sm" variant="outline"><a href={r.link} target="_blank" rel="noopener noreferrer" data-testid={`link-receipt-${r.paymentId}`}><Receipt className="h-4 w-4 mr-1.5" /> Receipt</a></Button>} />
              ))}
            </DocGroup>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DocGroup({ icon: Icon, title, empty, testId, children }: { icon: any; title: string; empty: string; testId: string; children: React.ReactNode[] }) {
  return (
    <section className="space-y-1.5" data-testid={testId}>
      <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"><Icon className="h-3 w-3" /> {title} <span className="font-normal normal-case tracking-normal">({children.length})</span></div>
      {children.length ? children : <p className="text-sm text-muted-foreground">{empty}</p>}
    </section>
  );
}

function Row({ main, sub, right, testId }: { main: React.ReactNode; sub: string; right: React.ReactNode; testId: string }) {
  return (
    <div className="rounded-lg border px-3 py-2 flex flex-wrap items-center justify-between gap-2" data-testid={testId}>
      <div className="min-w-0">
        <div className="text-sm truncate">{main}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  );
}

function Open({ href, label }: { href: string; label: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline" title={label}><ExternalLink className="h-3.5 w-3.5" /> {label}</a>;
}
