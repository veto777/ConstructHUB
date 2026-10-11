/**
 * Master Class course access and the state guides — the pure rules behind the
 * course routes in server/routes.ts (/api/state-guides*, /api/course-access,
 * /api/course-catalog). Nothing here touches the database, so every rule is
 * unit-tested in server/state-guides.test.ts.
 *
 *   courseUnlocks()     which module homes an account may open: an included
 *                       Master Class (plan module, server/entitlements.ts) or a
 *                       bundle purchase opens all four; a module purchase opens
 *                       the module whose category it bought (never a database
 *                       id assumed by the page). The dev preview bypass opens
 *                       everything on a developer's machine only.
 *   publicStateGuide()  the free part of a state guide: the comparison-table
 *                       facts the marketing calls free (shared/feature-pages/
 *                       masterClass.ts). Agency links, notes, the overview and
 *                       the steps are the paid guide and never leave here.
 *   The lesson bodies of every module (text, not state data) are served by
 *   server/master-class/routes.ts under the same courseUnlocks() answer, resolved
 *   per module by server/master-class/lessons.ts lessonModuleOpen().
 *
 *   agencyChecklist()   the ordered checklist for a state that has no written
 *                       walkthrough yet, built ONLY from that state's own agency
 *                       records (server/data/state-guides.json: names, checked
 *                       links, flags, notes). It states no fact the record does
 *                       not hold — no fee, form, deadline or office is invented
 *                       (CLAUDE.md hard rule).
 */
import type { StateGuide, StateGuideStep } from "@shared/schema";

export const MODULE_CATEGORIES = ["licensing", "gmb", "website", "seo"] as const;
export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];
/** The module whose purchase opens the full state guides (Business Formation & Licensing). */
export const STATE_GUIDE_CATEGORY: ModuleCategory = "licensing";

export type CourseAccess = {
  included: boolean;
  purchases: { moduleId: number | null; isBundle: boolean | null }[];
};
export type ModuleRef = { id: number; category: string };
export type CourseUnlocks = {
  /** Per module category: may this account open that module's lessons? */
  unlocked: Record<ModuleCategory, boolean>;
  /** Every module is open (included on the plan, the bundle, or the dev preview). */
  all: boolean;
  /** At least one purchase or an included course — what opens the Google Ads guide and the vetting lessons. */
  any: boolean;
  /** True only under DEV_AUTH_BYPASS: the page says so instead of pretending a purchase exists. */
  devPreview: boolean;
};

export function courseUnlocks(access: CourseAccess, modules: readonly ModuleRef[], devPreview = false): CourseUnlocks {
  const all = devPreview || access.included || access.purchases.some((p) => p.isBundle === true);
  const bought = new Set<string>();
  for (const p of access.purchases) {
    const mod = p.moduleId == null ? undefined : modules.find((m) => m.id === p.moduleId);
    if (mod) bought.add(mod.category);
  }
  const unlocked = Object.fromEntries(MODULE_CATEGORIES.map((c) => [c, all || bought.has(c)])) as Record<ModuleCategory, boolean>;
  return { unlocked, all, any: all || access.purchases.length > 0, devPreview };
}

export type PublicStateGuide = Pick<StateGuide,
  "id" | "stateCode" | "stateName" | "sosName" | "licensingRequired" | "workersCompType" | "salesTaxOnLabor" | "bAndOTax" | "bondRequired" | "linksCheckedAt"> & {
  /** Written walkthrough steps on file for this state (server/data/state-guide-steps.json); 0 = checklist only. */
  stepCount: number;
  /** "written": a walkthrough written for this state · "checklist": the checklist built from its agency records. */
  walkthrough: "written" | "checklist";
};

/** The free comparison facts for one state — nothing a buyer pays for. */
export function publicStateGuide(row: StateGuide, stepCount: number): PublicStateGuide {
  return {
    id: row.id,
    stateCode: row.stateCode,
    stateName: row.stateName,
    sosName: row.sosName,
    licensingRequired: row.licensingRequired,
    workersCompType: row.workersCompType,
    salesTaxOnLabor: row.salesTaxOnLabor,
    bAndOTax: row.bAndOTax,
    bondRequired: row.bondRequired,
    linksCheckedAt: row.linksCheckedAt,
    stepCount,
    walkthrough: stepCount > 0 ? "written" : "checklist",
  };
}

/** A checklist item built from the state's agency record; same shape as a written step, minus the database id. */
export type ChecklistStep = Omit<StateGuideStep, "id" | "stateGuideId"> & { source: "agency-data" };

/** A link the check found dead is never handed out (the tile searches the web instead). */
const usableUrl = (url: string | null, status: string | null) => (url && status !== "dead" ? url : null);

const WORKERS_COMP_HOW: Record<string, (state: string) => string> = {
  state_fund: (s) => `${s} runs a state workers' compensation fund: coverage is bought through the state, not from a private insurer.`,
  private: () => "Coverage is bought from a private insurer licensed in the state; the agency below regulates it.",
  state_fund_or_private: (s) => `${s} lets you buy coverage from its state fund or from a private insurer.`,
  private_or_state: (s) => `${s} lets you buy coverage from a private insurer or from its state fund.`,
};

/**
 * The ordered checklist for a state, from its agency record alone. Steps follow the order a new company goes in
 * (form, license, bond, insure, taxes, payroll); a step is only added when the record names the agency or the
 * requirement it is about.
 */
export function agencyChecklist(g: StateGuide): ChecklistStep[] {
  const steps: ChecklistStep[] = [];
  const add = (step: Omit<ChecklistStep, "stepNumber" | "source">) => steps.push({ ...step, stepNumber: steps.length + 1, source: "agency-data" });
  const entity = g.entityTypes?.length ? ` ${g.stateName} registers ${g.entityTypes.join(", ")} entities.` : "";
  add({
    title: `Form your business entity with the ${g.sosName}`,
    description: `Register your company with the ${g.sosName} before any license, insurance or tax registration: each of them asks for the entity exactly as filed.${entity}`,
    url: usableUrl(g.sosUrl, g.sosUrlStatus),
    urlLabel: g.sosName,
    category: "formation",
    isRequired: true,
    tips: null,
  });
  if (g.licensingRequired) {
    const board = g.licensingBoardName || "state contractor licensing board";
    add({
      title: `Apply for your contractor license with the ${board}`,
      description: g.licensingNotes || `${g.stateName} requires a state contractor license. The ${board} publishes the classifications, the application and any exam or experience requirements.`,
      url: usableUrl(g.licensingBoardUrl, g.licensingBoardUrlStatus),
      urlLabel: board,
      category: "licensing",
      isRequired: true,
      tips: null,
    });
  } else {
    add({
      title: "Check city, county and trade licensing",
      description: g.licensingNotes || `${g.stateName} has no statewide contractor license. Cities, counties and trade boards (electrical, plumbing, HVAC) may still license the work you do — check each jurisdiction you work in before you bid.`,
      url: usableUrl(g.licensingBoardUrl, g.licensingBoardUrlStatus),
      urlLabel: g.licensingBoardUrl ? g.licensingBoardName || "Licensing information" : null,
      category: "licensing",
      isRequired: true,
      tips: null,
    });
  }
  if (g.bondRequired) {
    const amounts = [g.gcBondAmount && `general contractor ${g.gcBondAmount}`, g.specialtyBondAmount && `specialty ${g.specialtyBondAmount}`].filter(Boolean).join(", ");
    add({
      title: "Get your contractor bond",
      description: `${g.stateName} requires a contractor bond${amounts ? ` (${amounts} on file)` : ""}. Bonds are sold by surety companies; the licensing agency states the amount and form it accepts.`,
      url: null,
      urlLabel: null,
      category: "licensing",
      isRequired: true,
      tips: null,
    });
  }
  const wcAgency = g.workersCompAgency || "state workers' compensation agency";
  const how = g.workersCompType ? WORKERS_COMP_HOW[g.workersCompType]?.(g.stateName) : undefined;
  add({
    title: `Set up workers' compensation with the ${wcAgency}`,
    description: [how, g.insuranceNotes].filter(Boolean).join(" ") || `The ${wcAgency} sets when coverage is required and how it is bought.`,
    url: usableUrl(g.workersCompUrl, g.workersCompUrlStatus),
    urlLabel: g.workersCompAgency,
    category: "insurance",
    isRequired: true,
    tips: null,
  });
  const tax = g.taxBoardName || "state tax agency";
  const taxLines = [
    g.salesTaxOnLabor ? `${g.stateName} charges sales tax on construction labor, so register to collect and remit it before your first invoice.` : null,
    g.bAndOTax ? `${g.stateName} also charges a business and occupation (B&O) tax on gross receipts.` : null,
  ].filter(Boolean);
  add({
    title: `Register with the ${tax}`,
    description: taxLines.length ? taxLines.join(" ") : `Register your business for state taxes and any withholding with the ${tax} before your first invoice or hire.`,
    url: usableUrl(g.taxBoardUrl, g.taxBoardUrlStatus),
    urlLabel: g.taxBoardName,
    category: "tax",
    isRequired: true,
    tips: null,
  });
  if (g.payrollNotes) {
    add({
      title: "Set up payroll and employer reporting",
      description: g.payrollNotes,
      url: null,
      urlLabel: null,
      category: "payroll",
      isRequired: false,
      tips: null,
    });
  }
  return steps;
}
