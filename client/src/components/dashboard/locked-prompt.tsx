import { ArrowRight, Lock } from "lucide-react";
import { MODULE_NAMES, PLANS, type ModuleKey, type PlanKey } from "@shared/plans";
import type { DashboardSurface } from "@shared/dashboard";
import { featureIntroPath } from "@shared/feature-pages";
import { DashLink, FOCUS_RING } from "./dash-link";

/**
 * The plan_required prompt at tile size: the same words as the sidebar's
 * PlanBadge and components/plan-required.tsx ("Included with the <Plan> plan."),
 * with the module's name as the tooltip. The full PlanRequired card is
 * page-sized, so a tile never renders it. "See what it does" opens the
 * feature's intro page (/features/<slug>, shared/feature-pages), so a viewer
 * can decide before looking at plans.
 */
export function LockedPrompt({
  tileKey, requiredPlan, module, href = "/pricing", surface = "app", compact = false,
}: {
  tileKey: string;
  requiredPlan?: PlanKey;
  module?: ModuleKey;
  href?: string;
  surface?: DashboardSurface;
  compact?: boolean;
}) {
  const planName = requiredPlan ? PLANS[requiredPlan].name : null;
  const intro = featureIntroPath(tileKey);
  const tooltip = module ? `${MODULE_NAMES[module]} is included with the ${planName ?? "a paid"} plan` : undefined;
  return (
    <div
      className={`flex ${compact ? "flex-row flex-wrap items-center gap-x-3 gap-y-2" : "flex-col items-start gap-2"} rounded-lg border border-dashed bg-muted/40 px-3 py-2.5`}
      title={tooltip}
      data-testid={`locked-${tileKey}`}
    >
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          {planName ? <>Included with the <strong className="font-semibold text-foreground">{planName}</strong> plan.</> : "Included with a paid plan."}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-x-4">
        {intro && (
          <DashLink
            href={intro}
            surface="app"
            className={`inline-flex min-h-10 sm:min-h-8 items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline underline-offset-4 ${FOCUS_RING}`}
            data-testid={`link-tile-${tileKey}-intro`}
          >
            See what it does <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </DashLink>
        )}
        <DashLink
          href={href}
          surface={surface}
          className={`inline-flex min-h-10 sm:min-h-8 items-center gap-1 rounded-md text-sm font-medium ${intro ? "text-muted-foreground hover:text-foreground" : "text-primary"} hover:underline underline-offset-4 ${FOCUS_RING}`}
          data-testid={`link-tile-${tileKey}-plans`}
        >
          See plans {!intro && <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}
        </DashLink>
      </div>
    </div>
  );
}
