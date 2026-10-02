/**
 * Which dashboard tiles an account may see numbers for — a pure function of
 * the tile's gate (shared/dashboard.ts) and the account's entitlements, so the
 * fixture, the real aggregator and the tests agree. It mirrors the server's
 * own gates (requirePlan / requireModule / the allowance tests in
 * server/routes.ts); it never grants what those routes would refuse.
 */
import { PLANS, PLAN_KEYS, planForModule, type ModuleKey, type PlanKey, type PlanLimits, type PlanModules, type AddonKey } from "@shared/plans";
import type { DashboardTileDef } from "@shared/dashboard";

/** The slice of server/entitlements.ts Entitlements a tile gate reads. */
export type TileAccessInput = {
  accessPlan: PlanKey | null;
  allowances: PlanLimits | null;
  modules: PlanModules;
  /** The user is an active member of a CRM org (read-only lookup — never creates one). */
  hasCrmOrg: boolean;
};

export type TileAccess = {
  entitled: boolean;
  requiredPlan?: PlanKey;
  module?: ModuleKey;
  addon?: AddonKey | "call_assistant";
  /** Not built yet: the tile is "coming_soon" whatever the plan. */
  comingSoon?: boolean;
};

/** Cheapest plan whose published allowance for `limit` is not 0. */
export function cheapestPlanAllowing(limit: "protectedSites" | "competitorScans" | "teamTextSegments"): PlanKey {
  return PLAN_KEYS.find((k) => PLANS[k].limits[limit] !== 0) ?? PLAN_KEYS[PLAN_KEYS.length - 1];
}

export function tileAccess(def: DashboardTileDef, ent: TileAccessInput): TileAccess {
  const gate = def.gate;
  switch (gate.kind) {
    case "none":
      return { entitled: true };
    case "plan":
      return ent.accessPlan ? { entitled: true } : { entitled: false, requiredPlan: PLAN_KEYS[0] };
    case "allowance": {
      const ok = !!ent.allowances && ent.allowances[gate.limit] !== 0;
      return ok ? { entitled: true } : { entitled: false, requiredPlan: cheapestPlanAllowing(gate.limit) };
    }
    case "module":
      return ent.modules[gate.module]
        ? { entitled: true, module: gate.module }
        : { entitled: false, requiredPlan: planForModule(gate.module), module: gate.module };
    case "crmAllowance": {
      // In an org, the owner's plan decides, and the tile source reads it (orgSmsStatus).
      if (ent.hasCrmOrg) return { entitled: true };
      const ok = !!ent.allowances && ent.allowances[gate.limit] !== 0;
      return ok ? { entitled: true } : { entitled: false, requiredPlan: cheapestPlanAllowing(gate.limit) };
    }
    case "crm":
      // The CRM is included with every plan; a member of someone else's org
      // (a crew seat) has no plan of their own and still uses it.
      return ent.hasCrmOrg || ent.accessPlan ? { entitled: true } : { entitled: false, requiredPlan: PLAN_KEYS[0] };
    case "addon":
      return { entitled: false, requiredPlan: gate.requiredPlan, addon: gate.addon, comingSoon: true };
  }
}
