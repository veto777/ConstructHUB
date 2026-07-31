import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, FileText, Hammer, Phone, Mail, ArrowRight, Receipt, ShieldCheck } from "lucide-react";
import { StatusPill, EmptyState, ErrorCard, statusTone } from "@/components/crm-ui";
import { PrintLockdown } from "@/components/print-lockdown";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : null);

/**
 * The client's own portal, created automatically with the client record.
 * One link, no password — shows every estimate and project of theirs.
 */
export default function PublicPortalPage() {
  const [, params] = useRoute("/portal/:token");
  const token = params?.token;

  const { data, isLoading, error } = useQuery<any>({
    queryKey: [`/api/public/portal/${token}`],
    enabled: !!token,
    retry: false,
  });

  if (isLoading) {
    return <div className="flex justify-center p-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-muted/40 flex items-start justify-center py-16 px-4">
        <ErrorCard title="This link isn't valid" description={String((error as Error).message)} />
      </div>
    );
  }

  const { customer, company, estimates, invoices = [], projects } = data;
  const needsAction = estimates.filter((e: any) => !e.approvedAt && !e.declinedAt);
  const openInvoices = invoices.filter((i: any) => !i.paidAt && i.dueCents > 0);

  return (
    <main className="min-h-screen bg-muted/40 py-10 px-4">
      <PrintLockdown />
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="text-center space-y-1.5 pb-2">
          {company.logoUrl && <img src={company.logoUrl} alt={company.name} className="h-14 mx-auto object-contain" />}
          <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
          <p className="text-muted-foreground">Welcome, {customer.displayName}</p>
          <div className="text-sm text-muted-foreground flex flex-wrap justify-center gap-x-4">
            {company.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{company.phone}</span>}
            {company.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{company.email}</span>}
          </div>
          {company.licenseNumber && (
            <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              License {company.licenseNumber}{company.licenseState ? ` (${company.licenseState})` : ""}
            </div>
          )}
        </div>

        {needsAction.length > 0 && (
          <Card className="shadow-md border-primary/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                {needsAction.length === 1 ? "You have an estimate to review" : `You have ${needsAction.length} estimates to review`}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {needsAction.map((e: any) => (
                <a key={e.id} href={e.link} data-testid={`portal-estimate-${e.id}`}>
                  <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 hover:bg-accent hover:border-primary/40 transition-colors cursor-pointer">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{e.number} · {e.title}</div>
                      <div className="text-sm text-muted-foreground tabular-nums">
                        {money(e.totalCents)}{e.expiresAt ? ` · expires ${day(e.expiresAt)}` : ""}
                      </div>
                    </div>
                    <Button size="sm" className="shrink-0">Review <ArrowRight className="h-4 w-4 ml-1" /></Button>
                  </div>
                </a>
              ))}
            </CardContent>
          </Card>
        )}

        {openInvoices.length > 0 && (
          <Card className="shadow-md border-primary/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                {openInvoices.length === 1 ? "You have an invoice to pay" : `You have ${openInvoices.length} invoices to pay`}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {openInvoices.map((i: any) => (
                <a key={i.id} href={i.link} data-testid={`portal-invoice-${i.id}`}>
                  <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 hover:bg-accent hover:border-primary/40 transition-colors cursor-pointer">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{i.number} · {i.title}</div>
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

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" /> Your estimates
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!estimates.length && (
              <EmptyState compact icon={FileText} title="Nothing here yet"
                description={`When ${company.name} sends an estimate, it shows up here.`} />
            )}
            {estimates.map((e: any) => (
              <a key={e.id} href={e.link}>
                <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 hover:bg-accent transition-colors cursor-pointer">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{e.number} · {e.title}</div>
                    <div className="text-sm text-muted-foreground tabular-nums">{money(e.totalCents)}</div>
                  </div>
                  <StatusPill tone={e.approvedAt ? "success" : e.declinedAt ? "danger" : statusTone(e.status)}>
                    {e.approvedAt ? "approved" : e.declinedAt ? "declined" : e.status}
                  </StatusPill>
                </div>
              </a>
            ))}
          </CardContent>
        </Card>

        {projects.length > 0 && (
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Hammer className="h-4 w-4 text-muted-foreground" /> Your projects
              </CardTitle>
              <CardDescription>Where your work stands right now.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {projects.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    {p.startDate && <div className="text-sm text-muted-foreground">Starts {day(p.startDate)}</div>}
                  </div>
                  <StatusPill tone="info">{p.stageLabel}</StatusPill>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground/70 pb-4">
          Secure link — only people with this URL can see this page.
        </p>
      </div>
    </main>
  );
}
