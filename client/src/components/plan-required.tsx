import { useState } from "react";
import { Link } from "wouter";
import { Lock } from "lucide-react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { CREDENTIAL_SOURCES, disconnectMessage, fetchOptionalList, type SavedCredential } from "@/lib/saved-credentials";
import { VerificationCancelled } from "@/components/recent-auth";
import { Button } from "@/components/ui/button";
import { AppLocked } from "@/components/app-locked";
import { inNativeApp } from "@/lib/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  MODULE_NAMES,
  PLANS,
  PLAN_KEYS,
  planForModule,
  showsPrice,
  type ModuleKey,
  type PlanKey,
} from "@shared/plans";

/** The server's 402 body for "your plan doesn't include this" (server/entitlements.ts → sendPlanRequired). */
export type PlanRequiredBody = { code: "plan_required"; requiredPlan: PlanKey; message: string };

/**
 * Reads a plan_required answer out of an apiRequest / default-queryFn error ("402: {json}").
 * Anything else (another status, another body) is not a plan gate and returns null.
 */
export function planRequiredFrom(error: unknown): PlanRequiredBody | null {
  const raw = typeof (error as any)?.message === "string" ? (error as any).message : "";
  const match = /^402:\s*([\s\S]*)$/.exec(raw);
  if (!match) return null;
  try {
    const body = JSON.parse(match[1]);
    if (body?.code === "plan_required" && (PLAN_KEYS as readonly string[]).includes(body.requiredPlan))
      return { code: "plan_required", requiredPlan: body.requiredPlan, message: String(body.message ?? "") };
  } catch { /* not our JSON body */ }
  return null;
}

/** refetchInterval that stops polling once the server says the plan doesn't include the module. */
export const pollUnlessPlanRequired =
  (ms: number) => (query: { state: { error: unknown } }) =>
    planRequiredFrom(query.state.error) ? false : ms;

/** What each Agency-only module does, in the product's own terms (keep in step with the module's pages). */
const MODULE_DETAILS: Record<ModuleKey, string[]> = {
  agencyWorkspace: [
    "Client workspaces with folders, tags and per-client location lists.",
    "Team roles (owner, admin, manager, viewer), with access to every client or only the ones you assign.",
    "Bulk actions across locations: sync, link, Profile Guard mode, AI reply settings, scheduled posts and Site Scans.",
    "Email onboarding: clients add your agency Google account as a Manager, and matching invitations are accepted and linked.",
    "CSV export of any filtered location list.",
  ],
  adsManager: [
    "Connect your Google Ads manager (MCC) account and request manager access to client accounts.",
    "Health audits across client accounts, with Local Services campaigns identified.",
    "Protections — negative keywords, placement exclusions, ad schedules, presence-only targeting and Click Guard IP exclusions — previewed before anything is written, with undo.",
  ],
  cloudflareSearchConsole: [
    "Connect client Cloudflare accounts with a limited token (a Global API Key is used once and never saved).",
    "Per-site Cloudflare traffic, bot and security-event data, and edge rules previewed before they are applied, with undo.",
    "Google Search Console properties: search performance, sitemaps and URL inspection results.",
  ],
  domainsMailAlerts: [
    "Connect Porkbun or Name.com and preview DNS and nameserver changes before they are made.",
    "Daily checks for DNS or nameserver changes, upcoming expiry, auto-renew turned off, and HTTPS or SSL problems.",
    "A private forwarding address for provider alert emails (Google, Cloudflare, registrars), matched to your clients and kept for 30 days.",
  ],
};

/**
 * Credentials saved before the plan changed stay removable: their list and disconnect routes are the only
 * ones in each module that answer without the plan (lib/saved-credentials.ts). Disconnecting still asks for
 * a recent sign-in. Settings → API keys lists the same credentials for every module.
 */
function SavedConnections({ module }: { module: ModuleKey }) {
  const sources = CREDENTIAL_SOURCES.filter((s) => s.module === module);
  const results = useQueries({
    queries: sources.map((s) => ({ queryKey: [s.url], ...(s.optional ? { queryFn: () => fetchOptionalList(s.url) } : {}) })),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; failed: boolean } | null>(null);
  const items = results.flatMap((r, i) => sources[i].items(r.data));
  if (!items.length && !notice) return null;
  async function disconnect(item: SavedCredential) {
    setBusy(item.key);
    setNotice(null);
    try {
      const r = await (await apiRequest("POST", item.disconnect.url, item.disconnect.body)).json();
      setNotice({ text: disconnectMessage(r), failed: false });
      await Promise.all(sources.map((s) => queryClient.invalidateQueries({ queryKey: [s.url] })));
    } catch (e) {
      if (e instanceof VerificationCancelled) return;
      setNotice({ text: apiErrorMessage(e), failed: true });
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-2 border-t pt-4" data-testid="saved-connections">
      {items.length > 0 && (
        <>
          <h3 className="text-sm font-medium">Saved connections</h3>
          <p className="text-sm text-muted-foreground">
            These were connected earlier. They are not used without the plan, and you can remove them here.
          </p>
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0 break-all">{item.service}: {item.label}</span>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => disconnect(item)}>
                  {busy === item.key ? "Disconnecting…" : "Disconnect"}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {notice && (
        <p role={notice.failed ? "alert" : "status"} className={notice.failed ? "text-sm text-destructive" : "text-sm"}>
          {notice.text}
        </p>
      )}
    </div>
  );
}

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/**
 * Honest upgrade card for an Agency-only module: what the server said, what the module does, and a way to
 * the pricing page. `error` is the query/mutation error that carried the 402; without one the card is built
 * from the shared price book.
 */
export function PlanRequired({ module, error, className }: { module: ModuleKey; error?: unknown; className?: string }) {
  const body = planRequiredFrom(error);
  const plan = PLANS[body?.requiredPlan ?? planForModule(module)];
  // A paying customer whose last payment failed is not asked to buy a plan: they're asked to fix the card.
  const { data: ent } = useQuery<{ paymentNeeded?: boolean }>({ queryKey: ["/api/entitlements"], staleTime: 60_000 });
  const paymentNeeded = ent?.paymentNeeded === true;
  const message = paymentNeeded
    ? `Your last payment didn't go through, so ${MODULE_NAMES[module]} is paused. Update your card in Billing and it turns back on by itself.`
    : body?.message || `${MODULE_NAMES[module]} is included with the ${plan.name} plan.`;
  const locations = plan.limits.locations;
  const headingId = `plan-required-${module}`;
  // The iPhone apps sell nothing: no plan, price or upgrade — just that it isn't on this account.
  if (inNativeApp()) return <AppLocked name={MODULE_NAMES[module]} testId={`plan-required-${module}`} />;
  return (
    <Card role="region" aria-labelledby={headingId} className={className} data-testid={`plan-required-${module}`}>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <h2 id={headingId} className="text-base font-semibold leading-none tracking-tight">{MODULE_NAMES[module]}</h2>
          <Badge variant="secondary">{plan.name} plan</Badge>
        </div>
        <p className="text-sm" data-testid="text-plan-required-message">{message}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <details>
          <summary className="cursor-pointer py-2 text-sm font-medium">What it does</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {MODULE_DETAILS[module].map((line) => <li key={line}>{line}</li>)}
          </ul>
        </details>
        {showsPrice(plan.monthlyCents) && (
          <p className="text-sm">
            {plan.name} plan: {dollars(plan.monthlyCents)} a month, {locations} location{locations === 1 ? "" : "s"} included.
          </p>
        )}
        {paymentNeeded ? (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/settings?tab=billing" data-testid="link-plan-required-billing">Update card</Link>
          </Button>
        ) : (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/pricing" data-testid="link-plan-required-pricing">See plans and pricing</Link>
          </Button>
        )}
        <SavedConnections module={module} />
      </CardContent>
    </Card>
  );
}
