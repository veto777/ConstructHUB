import { PageHeader, Section } from "@/components/app-ui";
import { inNativeApp } from "@/lib/app-shell";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
  if (account.usage.some((u) => u.period === "monthly")) meta.push(`Usage resets ${new Date(account.resetsAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`); // midnight UTC, on the viewer's clock
  meta.push(`Updated ${relativeTime(generatedAt, updatedNow)}`);

  return (
    <PageHeader
      title={<span data-testid="text-dashboard-greeting">{account.firstName ? greeting : "Welcome back"}</span>}
      description={
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-1">
          {/* The iPhone apps sell nothing (App Store 3.1.3(f)): no plan name, trial or billing link there. */}
          {!inNativeApp() && <PlanChip account={account} />}
          <span className="text-xs text-muted-foreground" data-testid="text-dashboard-meta">{meta.join(" · ")}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={onRefresh} disabled={refreshing}
            title={refreshing ? "Refreshing…" : "Refresh"} aria-label={refreshing ? "Refreshing" : "Refresh"} data-testid="button-dashboard-refresh">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden="true" />
          </Button>
        </span>
      }
      meta={fixture ? <Badge variant="secondary" data-testid="badge-dashboard-fixture">Sample data</Badge> : undefined}
      actions={<>
        <Button asChild><Link href="/crm-app">Open CRM</Link></Button>
        {onCustomize && <Button variant="outline" onClick={onCustomize} aria-haspopup="dialog" data-testid="button-dashboard-customize">Customize</Button>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline">More</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)] [&_[role=menuitem]]:min-h-10">
            {account.status !== "none" && !inNativeApp() && <DropdownMenuItem asChild><Link href="/settings?tab=billing" data-testid="link-dashboard-manage-plan">Manage plan</Link></DropdownMenuItem>}
            {account.isPlatformAdmin && <DropdownMenuItem asChild><Link href={ADMIN_FEATURE_PAGES_PATH} data-testid="link-dashboard-feature-pages">Feature pages</Link></DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </>}
    />
  );
}

/** This month's meters, in their own card (home.tsx places it below the action items). */
export function UsageCard({ account }: { account: DashboardAccount }) {
  if (!account.usage.length) return null;
  return (
    <Card className="px-4 py-3 sm:px-5 sm:py-4" role="region" aria-labelledby="dashboard-usage-title" data-testid="card-dashboard-usage">
      <h2 id="dashboard-usage-title" className="mb-3 text-sm font-semibold">{inNativeApp() ? "This month's usage" : "Plan usage"}</h2>
      <UsageStrip usage={account.usage} />
    </Card>
  );
}
