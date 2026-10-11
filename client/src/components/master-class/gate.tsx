/**
 * The access states of a Master Class module home, in the order the page decides them:
 *   checking  → AccessChecking (a skeleton that says what it is waiting for)
 *   failed    → AccessError (the server's words and a retry; nothing is treated as "not bought")
 *   locked    → LockedModule (which module opens it, at what price or through whom, which plan includes it)
 *   open      → the lessons, with an UnlockBadge saying why they are open
 * A paywall is only shown after a SUCCESSFUL negative answer — never while the answer is loading or missing.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { GraduationCap, Lock } from "lucide-react";
import { Notice, Section } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiErrorMessage } from "@/lib/queryClient";
import { SALES_REP_LABEL, planNamesWhere, priceOrSalesRep } from "@shared/plan-copy";
import type { CourseAccess, MasterClassModule, ModuleCategory } from "./access";
import { unlockReason } from "./access";

/** The plans whose modules include the Master Class (shared/plans.ts PlanModules.masterClass) — read, never typed. */
export const MASTER_CLASS_PLANS = planNamesWhere((p) => p.modules.masterClass);

export function AccessChecking({ what = "your access" }: { what?: string }) {
  return (
    <Section testId="course-access-checking">
      <p className="mb-3 text-sm text-muted-foreground" role="status">Checking {what}…</p>
      <div className="space-y-2" aria-hidden="true">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    </Section>
  );
}

export function AccessError({ error, onRetry, what = "your access" }: { error: unknown; onRetry: () => void; what?: string }) {
  return (
    <Notice tone="danger" title={`Couldn't verify ${what}`} testId="course-access-error"
      action={<Button variant="outline" size="sm" onClick={onRetry} data-testid="button-course-access-retry">Try again</Button>}>
      {apiErrorMessage(error)} Your lessons stay closed until the check succeeds; nothing about your purchase changed.
    </Notice>
  );
}

/**
 * The paywall for one module home. It names the module that opens it (with its price from the catalog, or the
 * sales-rep label above the threshold), the bundle, and the plan that includes the course. `children` is the
 * public outline of the lessons behind it.
 */
export function LockedModule({ what, module, moduleTitle, opensWith, access, onEnroll, children }: {
  /** What is locked, in the user's words: "The full Washington guide", "The Google Business lessons". */
  what: string;
  module?: MasterClassModule | null;
  /** When the module row has not loaded, the module's name from the tab. */
  moduleTitle?: string;
  /** Replaces the "opens with the X module" sentence (the vetting lessons come with any module). */
  opensWith?: ReactNode;
  access: CourseAccess | undefined;
  onEnroll: () => void;
  children?: ReactNode;
}) {
  const name = module?.title ?? moduleTitle ?? "its module";
  const price = module ? priceOrSalesRep(module.price) : null;
  return (
    <>
      {children}
      <Section title={<span data-testid="text-paywall-title">Enrolled students only</span>} icon={Lock} testId="course-paywall">
        <p className="text-sm text-muted-foreground">
          {opensWith ?? <>{what} opens with the <b className="font-medium text-foreground">{name}</b> module{price ? (price === SALES_REP_LABEL ? ", quoted by a sales rep," : ` (${price})`) : ""} or the complete bundle.</>}
          {MASTER_CLASS_PLANS ? <> It is included with the {MASTER_CLASS_PLANS} plan.</> : null}
        </p>
        {access && !access.signedIn && (
          <p className="mt-2 text-sm text-muted-foreground" data-testid="text-paywall-signed-out">
            Already enrolled? <Link href="/auth?next=%2Fmaster-class" className="underline underline-offset-2 hover:text-foreground">Sign in</Link> to open your modules.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={onEnroll} data-testid="button-paywall-unlock"><GraduationCap className="mr-2 h-4 w-4" aria-hidden="true" /> How to enroll</Button>
        </div>
      </Section>
    </>
  );
}

/** Why a module is open: the badge beside its title. Nothing when it is not open. */
export function UnlockBadge({ access, category }: { access: CourseAccess | undefined; category: ModuleCategory }) {
  const reason = unlockReason(access, category);
  if (!reason) return null;
  const label = reason === "included" ? "Included in your plan" : reason === "purchased" ? "Purchased" : "Dev preview";
  return <Badge variant="outline" className="gap-1 font-normal" data-testid={`badge-unlocked-${category}`}>{label}</Badge>;
}
