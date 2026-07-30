import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, FileText, Hammer, Phone, Mail, ArrowRight } from "lucide-react";

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
      <div className="p-6 max-w-lg mx-auto mt-10">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> This link isn't valid
            </CardTitle>
            <CardDescription>{String((error as Error).message)}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const { customer, company, estimates, invoices = [], projects } = data;
  const needsAction = estimates.filter((e: any) => !e.approvedAt && !e.declinedAt);
  const openInvoices = invoices.filter((i: any) => !i.paidAt && i.dueCents > 0);

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="text-center space-y-1">
          {company.logoUrl && <img src={company.logoUrl} alt={company.name} className="h-14 mx-auto object-contain" />}
          <h1 className="text-2xl font-bold">{company.name}</h1>
          <p className="text-muted-foreground">Welcome, {customer.displayName}</p>
          <div className="text-sm text-muted-foreground flex flex-wrap justify-center gap-x-4">
            {company.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{company.phone}</span>}
            {company.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{company.email}</span>}
          </div>
        </div>

        {needsAction.length > 0 && (
          <Card className="border-primary">
            <CardHeader>
              <CardTitle className="text-lg">
                {needsAction.length === 1 ? "You have an estimate to review" : `You have ${needsAction.length} estimates to review`}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {needsAction.map((e: any) => (
                <a key={e.id} href={e.link} data-testid={`portal-estimate-${e.id}`}>
                  <div className="flex items-center justify-between gap-2 border rounded-md p-3 hover:bg-accent cursor-pointer">
                    <div>
                      <div className="font-medium">{e.number} · {e.title}</div>
                      <div className="text-sm text-muted-foreground">
                        {money(e.totalCents)}{e.expiresAt ? ` · expires ${day(e.expiresAt)}` : ""}
                      </div>
                    </div>
                    <Button size="sm">Review <ArrowRight className="h-4 w-4 ml-1" /></Button>
                  </div>
                </a>
              ))}
            </CardContent>
          </Card>
        )}

        {openInvoices.length > 0 && (
          <Card className="border-primary">
            <CardHeader>
              <CardTitle className="text-lg">
                {openInvoices.length === 1 ? "You have an invoice to pay" : `You have ${openInvoices.length} invoices to pay`}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {openInvoices.map((i: any) => (
                <a key={i.id} href={i.link} data-testid={`portal-invoice-${i.id}`}>
                  <div className="flex items-center justify-between gap-2 border rounded-md p-3 hover:bg-accent cursor-pointer">
                    <div>
                      <div className="font-medium">{i.number} · {i.title}</div>
                      <div className="text-sm text-muted-foreground">
                        {money(i.dueCents)} due{i.dueAt ? ` · by ${day(i.dueAt)}` : ""}
                      </div>
                    </div>
                    <Button size="sm">Pay <ArrowRight className="h-4 w-4 ml-1" /></Button>
                  </div>
                </a>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><FileText className="h-5 w-5" /> Your estimates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!estimates.length && <p className="text-sm text-muted-foreground">Nothing here yet.</p>}
            {estimates.map((e: any) => (
              <a key={e.id} href={e.link}>
                <div className="flex items-center justify-between gap-2 border rounded-md p-3 hover:bg-accent cursor-pointer">
                  <div>
                    <div className="font-medium">{e.number} · {e.title}</div>
                    <div className="text-sm text-muted-foreground">{money(e.totalCents)}</div>
                  </div>
                  <Badge variant={e.approvedAt ? "default" : e.declinedAt ? "destructive" : "outline"}>
                    {e.approvedAt ? "approved" : e.declinedAt ? "declined" : e.status}
                  </Badge>
                </div>
              </a>
            ))}
          </CardContent>
        </Card>

        {projects.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Hammer className="h-5 w-5" /> Your projects</CardTitle>
              <CardDescription>Where your work stands right now.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {projects.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between gap-2 border rounded-md p-3">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    {p.startDate && <div className="text-sm text-muted-foreground">Starts {day(p.startDate)}</div>}
                  </div>
                  <Badge variant="secondary">{p.stageLabel}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
