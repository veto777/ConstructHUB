/**
 * The platform's paywall. A signed-in account with nothing on the platform (no plan, not even a trial; no tool
 * bought on its own; no CRM; no seat in someone's workspace) sees Pricing and the feature landing pages only. Every
 * other page, the dashboard included, sends it to Pricing (owner, 2026-10-16: "they are not even supposed to see the
 * features other than the landing page until the account is at least at trial phase … send them to pricing").
 *
 * The decision is lib/tool-access.ts hasAnyAccess, the same rules the sidebar and the tool routes use, and it never
 * locks on "can't tell yet": loading or a failed check shows the app as before. The server gates every paid API
 * on its own (server/entitlements.ts requirePlan/requireModule); this gate is what the account sees.
 *
 * In the iPhone apps nothing is sold (App Store 3.1.3(f)), so there the account gets a plain notice instead.
 */
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { inNativeApp } from "@/lib/app-shell";
import { hasAnyAccess } from "@/lib/tool-access";
import type { EntitlementsInfo } from "@/lib/pricing-display";

const AccountDeletePage = lazy(() => import("@/pages/account-delete"));

/** Pages an account without a plan can still open: the sales pages, the legal pages, joining a team. */
const OPEN_WITHOUT_PLAN = [
  "/pricing", "/individual-pricing", "/googleads-pricing", "/googleads-features", "/googleads-crm",
  "/features", "/done-for-you", "/master-class", "/master-class-landing", "/reinstatement",
  "/permits-landing", "/competitors-landing", "/google-ads-landing",
  "/invite", "/auth", "/privacy", "/terms", "/data-deletion", "/support", "/report-issue", "/developers",
];
export const openWithoutPlan = (location: string) =>
  OPEN_WITHOUT_PLAN.some((p) => location === p || location.startsWith(`${p}/`));

/** Back from a Stripe checkout: the webhook may land a moment after the redirect. */
const CHECKOUT_RETURN = ["success", "cart_success", "alacarte_success", "call_assistant_success", "crm_success"];

async function signOut() {
  try {
    await apiRequest("POST", "/api/auth/logout");
  } catch {
    void queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    return;
  }
  queryClient.clear();
  window.location.assign("/");
}

export function PlatformPlanGate({ location, gated, children }: { location: string; gated: ReactNode; children: ReactNode }) {
  const { data: entitlements } = useQuery<EntitlementsInfo | null>({ queryKey: ["/api/entitlements"] });
  const agency = useQuery<{ owner?: number; actor?: number; teamEntitled?: boolean } | null>({ queryKey: ["/api/agency/me"] });
  const crm = useQuery<{ access?: { active?: boolean } } | null>({ queryKey: ["/api/crm/billing/subscription"] });
  const agencyMe = agency.data;
  const access = hasAnyAccess({
    entitlements,
    agencyMember: !!agencyMe && typeof agencyMe.owner === "number" && typeof agencyMe.actor === "number" && agencyMe.owner !== agencyMe.actor,
    // A failed check reads as "none": the account still has to show a plan somewhere else to get in.
    agencyWorkspace: agencyMe ? agencyMe.teamEntitled === true : agency.isError || agencyMe === null ? false : undefined,
    crmActive: crm.data ? crm.data.access?.active === true : crm.isError || crm.data === null ? false : undefined,
  });

  const justPaid = typeof window !== "undefined" && CHECKOUT_RETURN.some((k) => new URLSearchParams(window.location.search).has(k));
  useEffect(() => {
    if (!justPaid || access !== false) return;
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/crm/billing/subscription"] });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [justPaid, access]);

  if (access !== false) return <>{children}</>;
  if (location === "/account/delete") return <Suspense fallback={null}><AccountDeletePage /></Suspense>;
  if (inNativeApp()) return <NoPlanInApp />;
  if (!openWithoutPlan(location)) return <Redirect to="/pricing" replace />;
  return (
    <>
      <div className="sticky top-0 z-[60] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-primary px-4 py-2 text-center text-sm text-primary-foreground" data-testid="banner-choose-plan">
        <span>{justPaid ? "Starting your plan…" : "Choose a plan to start your trial. Your tools open as soon as it starts."}</span>
        <button type="button" onClick={signOut} className="underline underline-offset-2 opacity-90 hover:opacity-100" data-testid="button-no-plan-sign-out">
          Sign out
        </button>
      </div>
      {gated}
    </>
  );
}

/** The iPhone apps sell nothing: an account without a plan is told so, and can sign out or delete the account. */
function NoPlanInApp() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 pt-[env(safe-area-inset-top)] text-center" data-testid="page-no-plan-app">
      <h1 className="text-xl font-semibold">This account doesn't have an active plan</h1>
      <p className="max-w-sm text-sm text-muted-foreground">Your tools appear here once the account has one.</p>
      <div className="flex gap-4 text-sm">
        <button type="button" onClick={signOut} className="underline underline-offset-2" data-testid="button-no-plan-app-sign-out">Sign out</button>
        <a href="/account/delete" className="underline underline-offset-2 text-muted-foreground" data-testid="link-no-plan-app-delete">Delete account</a>
      </div>
    </div>
  );
}
