import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CreditCard, LayoutGrid, RefreshCw, SlidersHorizontal } from "lucide-react";
import { ADMIN_FEATURE_PAGES_PATH } from "@shared/feature-pages";
import type { DashboardAccount } from "@shared/dashboard";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "./dash-link";
import { UsageStrip } from "./usage-strip";
import { greetingFor, relativeTime, shortDate } from "./format";

function PlanChip({ account }: { account: DashboardAccount }) {
  const name = account.planName ?? "Your";
  let text: string, href: string, dot: string;
  switch (account.status) {
    case "trialing":
      text = account.trialEndsAt ? `${name} trial · ends ${relativeTime(account.trialEndsAt)}` : `${name} trial`;
      href = "/pricing"; dot = "bg-primary";
      break;
    case "past_due":
      text = `${name} · Payment past due`;
      href = "/settings?tab=billing"; dot = "bg-amber-500";
      break;
    case "active":
      text = `${name} · Active`;
      href = "/settings?tab=billing"; dot = "bg-emerald-500";
      break;
    default:
      text = "No plan yet · Choose a plan";
      href = "/pricing"; dot = "bg-muted-foreground/60";
  }
  return (
    <Link
      href={href}
      className={cn(
        badgeVariants({ variant: "outline" }),
        "min-h-8 gap-2 rounded-full px-3 font-medium",
        account.status === "past_due" && "border-amber-500/50 text-amber-700 dark:text-amber-400",
        FOCUS_RING,
      )}
      data-testid="badge-dashboard-plan"
      data-plan-status={account.status}
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      {text}
    </Link>
  );
}

/**
 * Re-render once a minute so "Updated 3 min ago" and the greeting stay true
 * while the tab sits open, and re-read the clock whenever new data lands
 * (`resetKey`): a payload newer than the last tick is "just now", never "in a moment".
 */
function useMinuteClock(resetKey: string): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { setNow(new Date()); }, [resetKey]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

export function DashboardHeader({
  account, generatedAt, fixture, refreshing, onRefresh, onCustomize,
}: {
  account: DashboardAccount;
  generatedAt: string;
  fixture: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  /** Opens "Customize dashboard" (tiles, order, sections). */
  onCustomize?: () => void;
}) {
  const now = useMinuteClock(generatedAt);
  // The server's clock can run a little ahead of this one: "Updated" is never in the future.
  const updatedNow = new Date(Math.max(now.getTime(), Date.parse(generatedAt) || 0));
  const greeting = `${greetingFor(now)}${account.firstName ? `, ${account.firstName}` : ""}`;
  const meta: string[] = [];
  if (account.status === "active" && account.renewsAt) meta.push(`Renews ${shortDate(account.renewsAt, now)}`);
  // A Stripe plan set to cancel: renewsAt is null and endsAt says when it stops.
  else if (account.endsAt) meta.push(`Plan ends ${shortDate(account.endsAt, now)}`);
  if (account.usage.some((u) => u.period === "monthly")) meta.push(`Usage resets ${shortDate(account.resetsAt, now, true)}`);
  meta.push(`Updated ${relativeTime(generatedAt, updatedNow)}`);

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" data-testid="text-dashboard-greeting">
              {account.firstName ? greeting : "Welcome back"}
            </h1>
            {fixture && (
              <Badge variant="secondary" className="font-medium" data-testid="badge-dashboard-fixture" title="These numbers are a sample, not your account's.">
                Sample data
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Here's your business today.</p>
          <p className="mt-0.5 text-xs text-muted-foreground" data-testid="text-dashboard-meta">{meta.join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PlanChip account={account} />
          {/* Platform admins: every feature's intro page, in one list. */}
          {account.isPlatformAdmin && (
            <Button asChild variant="outline" size="sm" className="min-h-10 sm:min-h-8">
              <Link href={ADMIN_FEATURE_PAGES_PATH} data-testid="link-dashboard-feature-pages">
                <LayoutGrid className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Feature pages
              </Link>
            </Button>
          )}
          {account.status !== "none" && (
            <Button asChild variant="outline" size="sm" className="min-h-10 sm:min-h-8">
              <Link href="/settings?tab=billing" data-testid="link-dashboard-manage-plan">
                <CreditCard className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Manage plan
              </Link>
            </Button>
          )}
          {onCustomize && (
            <Button
              variant="outline"
              size="sm"
              className="min-h-10 sm:min-h-8"
              onClick={onCustomize}
              aria-haspopup="dialog"
              data-testid="button-dashboard-customize"
            >
              <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Customize
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="min-h-10 min-w-10 px-2.5 sm:min-h-8 sm:px-3"
            onClick={onRefresh}
            disabled={refreshing}
            aria-busy={refreshing}
            data-testid="button-dashboard-refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 sm:mr-1.5 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{refreshing ? "Refreshing…" : "Refresh"}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

/** This month's meters, in their own card (home.tsx places it below the action items). */
export function UsageCard({ account }: { account: DashboardAccount }) {
  if (!account.usage.length) return null;
  return (
    <Card className="px-4 py-3 sm:px-5 sm:py-4" role="region" aria-labelledby="dashboard-usage-title" data-testid="card-dashboard-usage">
      <h2 id="dashboard-usage-title" className="mb-3 text-sm font-semibold">Plan usage</h2>
      <UsageStrip usage={account.usage} />
    </Card>
  );
}
