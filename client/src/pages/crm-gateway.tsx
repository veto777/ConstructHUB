/**
 * CRM gateway — the pathway from the growth platform (constructhub.us) into
 * ConstructHub CRM (portal.constructhub.us). The CRM is a SEPARATE product on
 * a separate membership; this page is the bridge:
 *   - already a member  → "Open your CRM" jumps to the portal host
 *   - not a member yet  → what the CRM is + how to get access (separate plan)
 *   - signed out        → sign in, then this page routes them
 *
 * Membership is decided by /api/crm/me returning an org the user belongs to.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  KanbanSquare, ArrowRight, Loader2, Check, Users, FileText, MessageSquare,
  CreditCard, Camera, Building2, ExternalLink,
} from "lucide-react";
import { portalUrl } from "@/lib/site";

const FEATURES = [
  { icon: Users, label: "Clients & their own portals", desc: "Every client gets a branded portal the moment you add them." },
  { icon: FileText, label: "Estimates & invoices", desc: "HCP-style estimates, e-sign approval, deposits and ACH/card payments." },
  { icon: KanbanSquare, label: "Pipeline & scheduling", desc: "Drag jobs across sales → production → billing, with crew scheduling." },
  { icon: MessageSquare, label: "Two-way messaging", desc: "Client messages, notifications and team activity in one inbox." },
  { icon: Camera, label: "HOVER sync", desc: "Measurements and before-photos flow onto client profiles automatically." },
  { icon: CreditCard, label: "Payments & financing", desc: "Take deposits and progress payments; offer financing at the point of sale." },
];

export default function CrmGatewayPage() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/crm/me"],
    retry: false,
  });

  const isMember = !!data?.org?.id;
  const orgName = data?.org?.name as string | undefined;
  const openCrm = () => { window.location.href = portalUrl("/crm"); };

  return (
    <div className="min-h-full bg-gradient-to-b from-background to-muted/30">
      <div className="max-w-4xl mx-auto px-5 py-10 sm:py-14">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-semibold">
            <KanbanSquare className="h-3.5 w-3.5" /> Separate membership
          </span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">ConstructHub CRM</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          The contractor CRM — clients, estimates, invoices, pipeline, messaging and payments —
          runs as its own product on its own subscription, separate from your growth tools.
        </p>

        {/* Primary action — member vs prospect. */}
        <Card className="mt-7 border-primary/30" data-testid="card-crm-gateway-action">
          <CardContent className="p-5 sm:p-6">
            {isLoading ? (
              <div className="flex items-center gap-3 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> Checking your access…
              </div>
            ) : isMember ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold">
                    <Check className="h-5 w-5 text-emerald-600" /> Your CRM is active
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {orgName ? <>You're in <strong>{orgName}</strong>. </> : null}
                    It lives at your portal address.
                  </p>
                </div>
                <Button size="lg" onClick={openCrm} data-testid="button-open-crm">
                  Open your CRM <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold">
                    <Building2 className="h-5 w-5 text-primary" /> Get your CRM workspace
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 max-w-md">
                    The CRM isn't part of your current plan. Start a CRM membership to get a
                    brand-new, empty workspace for your company.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link href="/pricing">
                    <Button size="lg" data-testid="button-crm-get-access">
                      See CRM plans <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </Link>
                  <a href={portalUrl("/crm")} target="_blank" rel="noopener noreferrer">
                    <Button size="lg" variant="outline" data-testid="button-crm-preview">
                      Visit CRM <ExternalLink className="h-4 w-4 ml-2" />
                    </Button>
                  </a>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid sm:grid-cols-2 gap-3 mt-8">
          {FEATURES.map((f) => (
            <div key={f.label} className="flex items-start gap-3 rounded-xl border bg-card p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                <f.icon className="h-4 w-4" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm">{f.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground mt-8">
          Your growth-platform tools (permits, Google Business, Google Ads, IP Tracker) and the CRM
          are billed separately. Signing in to one does not add the other.
        </p>
      </div>
    </div>
  );
}
