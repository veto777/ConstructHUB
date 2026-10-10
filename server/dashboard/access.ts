/**
 * Which dashboard tiles an account may see numbers for — a pure function of
 * the tile's gate (shared/dashboard.ts) and the account's entitlements, so the
 * fixture, the real aggregator and the tests agree. It mirrors the server's
 * own gates (requirePlan / requireModule / the allowance tests in
 * server/routes.ts); it never grants what those routes would refuse.
 */
import { ADDONS, ADDON_MODULES, PLANS, PLAN_KEYS, planForModule, type ModuleKey, type PlanKey, type PlanLimits, type PlanModules, type AddonKey, type AddonModuleKey } from "@shared/plans";
import type { DashboardTileDef } from "@shared/dashboard";

/** The slice of server/entitlements.ts Entitlements a tile gate reads. */
export type TileAccessInput = {
  accessPlan: PlanKey | null;
  allowances: PlanLimits | null;
  modules: PlanModules;
  /** The user is an active member of a CRM org (read-only lookup — never creates one). */
  hasCrmOrg: boolean;
  /** Add-on modules that are on (Entitlements.addonModules: every one for platform admins). */
  addonModules?: Partial<Record<AddonModuleKey, boolean>>;
};

export type TileAccess = {
  entitled: boolean;
  requiredPlan?: PlanKey;
  module?: ModuleKey;
  addon?: AddonKey | "call_assistant";
  /** Listed but not for sale yet (a `preview` add-on): the tile is "coming_soon". */
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
      // An account on à la carte items alone has allowances without a plan (shared/alacarte.ts).
      return ent.accessPlan || ent.allowances ? { entitled: true } : { entitled: false, requiredPlan: PLAN_KEYS[0] };
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
    case "addon": {
      // The add-on module is on (a platform admin, or the Call Assistant's own subscription running): the
      // tile opens it, as requireModule would let the account in. Otherwise locked — with no "required plan",
      // because the service is bought on its own subscription, with or without a plan (owner, 2026-10-08).
      const module = (Object.keys(ADDON_MODULES) as AddonModuleKey[]).find((k) => ADDON_MODULES[k] === gate.addon);
      if (module && ent.addonModules?.[module]) return { entitled: true, addon: gate.addon };
      // Not bought: "coming soon" only while the add-on is still `preview` in the price book;
      // once it is for sale the tile is locked like any other and links to its page.
      return { entitled: false, addon: gate.addon, ...(ADDONS[gate.addon as AddonKey]?.preview ? { comingSoon: true } : {}) };
    }
  }
}
