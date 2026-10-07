import { AppPage, PageHeader, Section } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
/**
 * CRM gateway — the pathway from the growth platform (constructhub.us) into
 * ConstructHub CRM (portal.constructhub.us). The CRM is a separate product
 * with its own plans (seats per CRM plan, shared/crm-plans.ts); this page is the bridge:
 *   - already in a workspace → "Open your CRM" jumps to the portal host
 *   - in a workspace, no active CRM plan → "See CRM plans" (never "Your CRM is active")
 *   - no workspace found     → what the CRM is, that it has its own plans, and who to email
 *   - signed out             → sign in (?next=/crm-app), then this page routes them
 *
 * Membership is decided by /api/crm/me returning an org the user belongs to.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { inNativeApp } from "@/lib/app-shell";
import {
  KanbanSquare, ArrowRight, Loader2, Check, Users, FileText, MessageSquare,
  CreditCard, Camera, Building2, ExternalLink, LogIn, Mail,
} from "lucide-react";
import { portalUrl } from "@/lib/site";
import { PublicPageFooter, PublicPageHeader } from "@/components/public-page-chrome";
import { CRM_FROM_PRICE, CRM_SEATS_LINE } from "@shared/plan-copy";
import { StandingGator } from "@/components/mascot";
import { BTN_LG, BTN_OUTLINE, BTN_PRIMARY, Kicker, TEXT_LINK } from "@/components/feature-landing/primitives";

const CRM_ACCESS_MAILTO =
  "mailto:support@constructhub.us?subject=" + encodeURIComponent("ConstructHub CRM access request");

const FEATURES = [
  { icon: Users, label: "Clients & their own portals", desc: "Every client gets a branded portal the moment you add them." },
  { icon: FileText, label: "Estimates & invoices", desc: "HCP-style estimates, e-sign approval, deposits and ACH/card payments." },
  { icon: KanbanSquare, label: "Pipeline & scheduling", desc: "Drag jobs across sales → production → billing, with crew scheduling." },
  { icon: MessageSquare, label: "Two-way messaging", desc: "Client messages, notifications and team activity in one inbox." },
  { icon: Camera, label: "HOVER sync", desc: "Measurements and before-photos flow onto client profiles automatically." },
  { icon: CreditCard, label: "Payments & financing", desc: "Take deposits and progress payments; offer financing at the point of sale." },
];

export default function CrmGatewayPage() {
  const { data: user, isLoading: userLoading } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const { data, isLoading: crmLoading, error } = useQuery<any>({
    queryKey: ["/api/crm/me"],
    retry: false,
    enabled: !!user,
  });

  // Query errors read "401: …" — a lapsed session counts as signed out.
  const signedOut = (!userLoading && !user) || /^401\b/.test(String((error as any)?.message ?? ""));
  const isLoading = userLoading || (!!user && crmLoading);
  const isMember = !signedOut && !!data?.org?.id;
  const orgName = data?.org?.name as string | undefined;
  // A workspace exists as soon as the CRM is first opened (server/crm/tenancy.ts ensureOrgForUser), but it only
  // opens on an active CRM plan — the org owner's (GET /api/crm/me → crm.active). Without one the portal shows the
  // CRM plans, so this page must not say "Your CRM is active".
  const crmActive = isMember && data?.crm?.active !== false;
  const isOwner = data?.crm?.isOwner !== false;
  const needsPlan = isMember && !crmActive;
  const openCrm = () => { window.location.href = portalUrl("/crm"); };

  // The iPhone apps sell nothing (owner, 2026-10-04 — App Store 3.1.3(f)):
  // no "included with every plan", seats-per-plan line, or See-plans buttons.
  // What stays: opening the CRM you already have, signing in, or asking for a
  // workspace — none of that is a sale.
  if (inNativeApp()) return (
    <AppPage testId="page-crm-gateway">
      <PageHeader title="ConstructHub CRM" description="Clients, jobs and payments — all in one place." actions={isLoading || signedOut ? undefined : isMember ?
        <Button onClick={openCrm} data-testid="button-open-crm">Open your CRM <ArrowRight className="ml-2 h-4 w-4" /></Button> :
        <Button asChild><a href={CRM_ACCESS_MAILTO} data-testid="button-crm-get-access">Request access</a></Button>
      } />
      <Section title={isLoading ? "Checking your access…" : needsPlan ? "Your CRM workspace" : isMember ? "Your CRM is active" : signedOut ? "Sign in to open your CRM" : "Get your CRM workspace"} testId="card-crm-gateway-action">
        <p className="text-sm text-muted-foreground">{isMember ? <>You're in <strong className="text-foreground">{orgName || "your workspace"}</strong>.</> : signedOut ? "Sign in with your ConstructHUB account and we'll check whether your company has a CRM workspace." : "We couldn't find a CRM workspace for your account. Email us and we'll sort it out."}</p>
        {!isLoading && (signedOut || !isMember) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {signedOut && <Button asChild><Link href={`/auth?next=${encodeURIComponent("/crm-app")}`} data-testid="button-crm-signin">Sign in <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>}
            {!signedOut && !isMember && <Button asChild variant="outline"><a href={CRM_ACCESS_MAILTO} data-testid="button-crm-get-access">Request access</a></Button>}
          </div>
        )}
      </Section>
      <details className="rounded-xl border bg-card p-4 sm:p-5">
        <summary className="cursor-pointer text-sm font-medium">Explore CRM features</summary>
        <p className="mt-3 text-sm text-muted-foreground" data-testid="text-crm-bubble">Clients, jobs and payments — all in one place.</p>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{FEATURES.map(f => <li key={f.label}><h2 className="text-sm font-semibold">{f.label}</h2><p className="mt-1 text-sm text-muted-foreground">{f.desc}</p></li>)}</ul>
      </details>
    </AppPage>
  );

  if (user && !signedOut) return (
    <AppPage testId="page-crm-gateway">
      <PageHeader title="ConstructHub CRM" description="Clients, jobs and payments — all in one place." actions={isLoading ? undefined : isMember ?
        <Button onClick={openCrm} data-testid="button-open-crm">Open your CRM <ArrowRight className="ml-2 h-4 w-4" /></Button> :
        <Button asChild><a href={CRM_ACCESS_MAILTO} data-testid="button-crm-get-access">Request access</a></Button>
      } />
      <Section title={isLoading ? "Checking your access…" : needsPlan ? "Choose a CRM plan to open your CRM" : isMember ? "Your CRM is active" : "Get your CRM workspace"} testId="card-crm-gateway-action">
        <p className="text-sm text-muted-foreground">{isMember ? <>You're in <strong className="text-foreground">{orgName || "your workspace"}</strong>.{needsPlan && !inNativeApp() ? (isOwner ? " It opens once you choose a CRM plan." : " It opens once the account owner chooses a CRM plan.") : ""}</> : "We couldn't find a CRM workspace for your account. Email us and we'll sort it out."}</p>
        <p className="mt-3 text-sm text-muted-foreground" data-testid="text-crm-included">
          {/* The iPhone apps sell nothing (App Store 3.1.3(f)): no plan names or seat-per-plan lines. */}
          {inNativeApp() ? "Your CRM runs on your ConstructHUB account." : <>The CRM is a separate product with its own plans, from {CRM_FROM_PRICE}. Seats per CRM plan: {CRM_SEATS_LINE}.</>}
        </p>
        {!isLoading && (!isMember || needsPlan) && <div className="mt-4 flex flex-wrap gap-2">
          {!inNativeApp() && <Button asChild variant="outline"><Link href="/pricing#crm" data-testid="button-crm-plans">See CRM plans</Link></Button>}
          <Button asChild variant="ghost"><a href={portalUrl("/crm")} target="_blank" rel="noopener noreferrer" data-testid="button-crm-preview">Visit CRM <ExternalLink className="ml-2 h-4 w-4" /></a></Button>
        </div>}
      </Section>
      <details className="rounded-xl border bg-card p-4 sm:p-5">
        <summary className="cursor-pointer text-sm font-medium">Explore CRM features</summary>
        <p className="mt-3 text-sm text-muted-foreground" data-testid="text-crm-bubble">Clients, jobs and payments — all in one place.</p>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{FEATURES.map(f => <li key={f.label}><h2 className="text-sm font-semibold">{f.label}</h2><p className="mt-1 text-sm text-muted-foreground">{f.desc}</p></li>)}</ul>
      </details>
    </AppPage>
  );

  return (
    <div className="flex flex-col min-h-full">
      <PublicPageHeader next="/crm-app" />
      <div className="mkt-editorial mkt-shadcn flex-1 bg-mkt-paper text-mkt-ink overflow-x-clip" data-testid="page-crm-gateway">
        <section className="relative">
          <div className="absolute inset-0 mkt-grid-paper [mask-image:linear-gradient(to_bottom,black_0%,black_40%,transparent_100%)]" aria-hidden />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 lg:grid lg:grid-cols-12 lg:gap-10 lg:items-center">
            <div className="lg:col-span-7 pt-8 sm:pt-12 lg:pt-16 pb-8 lg:pb-16">
              <Kicker n="">
                <span className="inline-flex items-center gap-1.5"><KanbanSquare className="h-3.5 w-3.5" aria-hidden /> A separate product with its own plans</span>
              </Kicker>
              <h1 className="font-display mt-5 font-semibold text-[2.6rem] leading-[1.02] sm:text-[3.4rem] lg:text-[3.9rem] tracking-[-0.02em]">
                ConstructHub <span className="mkt-marker">CRM</span>
              </h1>
              <p className="mt-5 text-base sm:text-lg text-mkt-ink-soft max-w-[36rem] leading-relaxed" data-testid="text-crm-included">
                The contractor CRM — clients, estimates, invoices, pipeline, messaging and payments — is
                a separate product with its own plans, from {CRM_FROM_PRICE}. Your CRM plan sets the number of team seats:
                {" "}{CRM_SEATS_LINE}.
              </p>
            </div>
            <div className="pb-10 lg:py-10 lg:col-span-5" aria-hidden>
              <div className="relative overflow-hidden rounded-[28px] lg:rounded-[32px] bg-mkt-panel text-mkt-panel-ink">
                <div className="absolute inset-0 mkt-grid-paper-panel" />
                <div className="relative flex lg:flex-col items-center gap-4 lg:gap-5 p-5 sm:p-6 lg:px-8 lg:pt-9 lg:pb-0">
                  <p className="flex-1 lg:flex-none mkt-bubble px-4 py-3 lg:px-5 lg:py-4 text-[15px] sm:text-[17px] lg:text-[19px] leading-snug lg:-rotate-1" data-testid="text-crm-bubble">
                    Clients, jobs and payments — all in one place.
                  </p>
                  <StandingGator height={112} className="shrink-0 lg:hidden" />
                  <StandingGator height={260} className="hidden lg:block shrink-0 -mb-1" />
                </div>
              </div>
            </div>
          </div>
          <div className="mkt-ruler" aria-hidden />
        </section>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          {/* Primary action — member vs prospect. */}
          <div className="relative overflow-hidden rounded-2xl border-2 border-mkt-ink bg-mkt-card" data-testid="card-crm-gateway-action">
            <div className="mkt-hazard h-2" aria-hidden />
            <div className="p-6 sm:p-8">
              {isLoading ? (
                <div className="flex items-center gap-3 text-mkt-ink-soft">
                  <Loader2 className="h-5 w-5 animate-spin" /> Checking your access…
                </div>
              ) : signedOut ? (
                <div className="flex flex-wrap items-center justify-between gap-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-display font-semibold text-[1.45rem] leading-tight">
                      <LogIn className="h-5 w-5 text-mkt-orange-ink" /> Sign in to open your CRM
                    </div>
                    <p className="text-[15px] text-mkt-ink-soft mt-2 max-w-md leading-relaxed">
                      Sign in with your ConstructHUB account and we'll check whether your company has a
                      CRM workspace.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
                    <Link href={`/auth?next=${encodeURIComponent("/crm-app")}`} className={`${BTN_PRIMARY} ${BTN_LG}`} data-testid="button-crm-signin">
                      Sign in <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link href={`/auth?mode=signup&next=${encodeURIComponent("/crm-app")}`} className={`${BTN_OUTLINE} ${BTN_LG}`} data-testid="button-crm-signup">
                      Create an account
                    </Link>
                  </div>
                </div>
              ) : isMember ? (
                <div className="flex flex-wrap items-center justify-between gap-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-display font-semibold text-[1.45rem] leading-tight">
                      <Check className="h-5 w-5 text-mkt-orange-ink" /> {needsPlan ? "Choose a CRM plan to open your CRM" : "Your CRM is active"}
                    </div>
                    <p className="text-[15px] text-mkt-ink-soft mt-2">
                      {orgName ? <>You're in <strong className="text-mkt-ink">{orgName}</strong>. </> : null}
                      {needsPlan ? (isOwner ? "The workspace opens once you choose a CRM plan." : "The workspace opens once the account owner chooses a CRM plan.") : "It lives at your portal address."}
                    </p>
                  </div>
                  {needsPlan
                    ? <Link href="/pricing#crm" className={`${BTN_PRIMARY} ${BTN_LG}`} data-testid="button-crm-plans">See CRM plans <ArrowRight className="h-4 w-4" /></Link>
                    : <button type="button" onClick={openCrm} className={`${BTN_PRIMARY} ${BTN_LG}`} data-testid="button-open-crm">
                    Open your CRM <ArrowRight className="h-4 w-4" />
                  </button>}
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-display font-semibold text-[1.45rem] leading-tight">
                      <Building2 className="h-5 w-5 text-mkt-orange-ink" /> Get your CRM workspace
                    </div>
                    <p className="text-[15px] text-mkt-ink-soft mt-2 max-w-md leading-relaxed">
                      We couldn't find a CRM workspace for your account. The CRM is a separate
                      product with its own plans; a workspace is normally created the first time you open the
                      CRM — email us and we'll sort it out.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 w-full sm:w-auto">
                    <a href={CRM_ACCESS_MAILTO} className={`${BTN_PRIMARY} ${BTN_LG}`} data-testid="button-crm-get-access">
                      <Mail className="h-4 w-4" /> Request access
                    </a>
                    <Link href="/pricing#crm" className={`${BTN_OUTLINE} ${BTN_LG}`} data-testid="button-crm-plans">
                      See CRM plans <ArrowRight className="h-4 w-4" />
                    </Link>
                    <a href={portalUrl("/crm")} target="_blank" rel="noopener noreferrer" className={`${TEXT_LINK} inline-flex items-center justify-center gap-1.5 h-12 px-2`} data-testid="button-crm-preview">
                      Visit CRM <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-12 flex items-baseline justify-between gap-4">
            <Kicker n="01">What's in it</Kicker>
          </div>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-mkt-rule border border-mkt-rule rounded-2xl overflow-hidden">
            {FEATURES.map((f, i) => (
              <div key={f.label} className="group bg-mkt-paper p-6 transition-colors hover:bg-mkt-card">
                <div className="flex items-start justify-between mb-4">
                  <div className="h-10 w-10 rounded-lg border border-mkt-rule bg-mkt-card flex items-center justify-center text-mkt-ink group-hover:border-mkt-orange group-hover:text-mkt-orange-ink transition-colors">
                    <f.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </div>
                  <span className="font-display italic text-mkt-muted text-lg leading-none" aria-hidden>{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="font-display font-semibold text-[1.15rem] leading-tight">{f.label}</h3>
                <p className="mt-2 text-[14.5px] text-mkt-ink-soft leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-[14px] text-mkt-ink-soft mt-8 max-w-2xl leading-relaxed">
            One ConstructHUB plan covers both your growth tools (permits, Google Business, Google Ads,
            IP Tracker) and the CRM. Extra CRM seats are an add-on.
          </p>
        </div>
      </div>
      <PublicPageFooter />
    </div>
  );
}
