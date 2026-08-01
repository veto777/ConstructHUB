import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle, Phone, Mail } from "lucide-react";
import { StatusPill, ErrorCard, statusTone } from "@/components/crm-ui";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

/** Public change-order page — token-authorised (like /portal/:token), so no
 *  email gate. The homeowner approves or declines right here. */
export default function PublicChangeOrderPage() {
  const [, params] = useRoute("/co/:token");
  const token = params?.token;
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [done, setDone] = useState<"approved" | "declined" | null>(null);

  const { data, isLoading, error } = useQuery<any>({
    queryKey: [`/api/public/change-orders/${token}`], enabled: !!token, retry: false,
  });

  const respond = useMutation({
    mutationFn: async (decision: "approve" | "decline") => {
      const r = await fetch(`/api/public/change-orders/${token}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          signatureName: decision === "approve" ? name : undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Something went wrong");
      return r.json();
    },
    onSuccess: (_r, decision) => setDone(decision === "approve" ? "approved" : "declined"),
    onError: (e: any) => toast({ title: "Could not submit", description: String(e.message ?? e), variant: "destructive" }),
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

  const { changeOrder: co, company, project } = data;
  const settled = done ?? (co.approvedAt ? "approved" : co.declinedAt ? "declined" : null);

  return (
    <main className="min-h-screen bg-muted/40 py-6 px-3 sm:py-10 sm:px-4" data-testid="public-change-order-root">
      <div className="max-w-2xl mx-auto space-y-5">
        {settled && (
          <Card className={settled === "approved" ? "border-emerald-500/50 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}>
            <CardContent className="p-5 flex items-start gap-3">
              {settled === "approved"
                ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                : <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />}
              <div>
                <div className="font-semibold">
                  {settled === "approved" ? "Change order approved — thank you!" : "Change order declined"}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{company.name} has been notified.</p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="shadow-md overflow-hidden" data-testid="change-order-document">
          <div className="border-b p-6 sm:p-8 space-y-4">
            <div className="flex flex-wrap justify-between gap-x-8 gap-y-4">
              <div className="space-y-1.5 min-w-0">
                {company.logoUrl && <img src={company.logoUrl} alt={company.name} className="h-12 object-contain mb-1" />}
                <h1 className="text-xl font-semibold tracking-tight">{company.name}</h1>
                <div className="text-sm text-muted-foreground space-y-0.5">
                  {company.phone && <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" />{company.phone}</div>}
                  {company.email && <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" />{company.email}</div>}
                </div>
              </div>
              <div className="sm:text-right space-y-1.5 shrink-0">
                <div className="text-3xl font-bold tracking-tight text-primary" data-testid="doc-wordmark">CHANGE ORDER</div>
                {co.number && <div className="font-medium">{co.number}</div>}
                <div>
                  <StatusPill tone={settled === "approved" ? "success" : settled ? "danger" : statusTone(co.status)}>
                    {settled ?? co.status}
                  </StatusPill>
                </div>
                <div className="pt-1">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Amount</div>
                  <div className="text-2xl font-bold tabular-nums" data-testid="doc-total">{money(co.amountCents)}</div>
                </div>
              </div>
            </div>
            {project?.name && (
              <div className="text-sm text-muted-foreground" data-testid="text-project">
                Project: {[project.name, project.number].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
          <CardContent className="p-6 sm:p-8 space-y-4">
            <CardTitle className="text-xl">{co.title}</CardTitle>
            {co.description && <p className="whitespace-pre-wrap text-sm leading-relaxed">{co.description}</p>}
            {co.scheduleImpactDays ? (
              <p className="text-sm text-muted-foreground" data-testid="text-schedule-impact">
                Schedule impact: {co.scheduleImpactDays > 0 ? "+" : ""}{co.scheduleImpactDays} day{Math.abs(co.scheduleImpactDays) === 1 ? "" : "s"}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {!settled && (
          <Card className="shadow-md border-primary/30">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-lg">Approve this change order?</CardTitle>
              <CardDescription>Type your name to approve. This is your signature.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0 space-y-3">
              <div>
                <Label htmlFor="sig">Your full name</Label>
                <Input id="sig" value={name} onChange={(ev) => setName(ev.target.value)}
                  data-testid="input-signature" className="h-12 text-base" />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button disabled={name.trim().length < 2 || respond.isPending}
                  className="w-full sm:w-auto h-12 sm:h-10"
                  onClick={() => respond.mutate("approve")} data-testid="button-approve">
                  {respond.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  Approve change order
                </Button>
                <Button variant="outline" className="w-full sm:w-auto h-12 sm:h-10"
                  disabled={respond.isPending}
                  onClick={() => respond.mutate("decline")} data-testid="button-decline">
                  Decline
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground/70 pb-4">
          Private document — it opens only from the link {company.name} sent you.
        </p>
      </div>
    </main>
  );
}
