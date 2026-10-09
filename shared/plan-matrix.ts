/**
 * The plan comparison matrices — the ONE source behind the comparison tables
 * on /pricing and docs/pricing/PLAN-MATRIX.md (generated: `npm run
 * pricing:matrix`, script/pricing-matrix-md.ts). Every cell is DERIVED from
 * the price book — shared/plans.ts (PLANS, ADDONS, COMING_MODULES,
 * GBP_REINSTATEMENT_CENTS) and shared/crm-plans.ts (CRM_PLANS, CRM_ADDONS) —
 * so a number can never drift between the page, the docs and checkout.
 *
 * To add a row, add one entry to BUSINESS_TOOLS_ROWS or CRM_ROWS below. To
 * mark a whole row "Coming" (promised, enforcement or build pending), set
 * `coming: true` on the row. To reprice or change a limit, edit
 * shared/plans.ts — never a cell here.
 *
 * Cell values: true | false | number | "unlimited" (any -1 limit) | a short
 * string | { coming: true } for a promised module that is not live yet
 * (shared/plans.ts COMING_MODULES). Rendering: ✅ / ❌ / a purple "Unlimited"
 * pill / the number or string / a "Coming" badge (client/src/components/
 * plan-comparison-table.tsx and the markdown generator agree on this).
 */
import {
  PLANS, PLAN_KEYS, ADDONS, COMING_MODULES, GBP_REINSTATEMENT_CENTS, isUnlimited, gridCreditCost,
  type ModuleKey, type Plan, type PlanKey,
} from "./plans";
import {
  CRM_PLANS, CRM_PLAN_KEYS, CRM_ADDONS, CRM_TRIAL_DAYS, type CrmPlan, type CrmPlanKey,
} from "./crm-plans";

export const UNLIMITED_CELL = "unlimited" as const;

/** A promised-but-not-live cell (COMING_MODULES) or row (`coming: true`). */
export type PlanMatrixComing = { coming: true };

export type PlanMatrixCell = boolean | number | typeof UNLIMITED_CELL | string | PlanMatrixComing;

export type PlanMatrixRow = {
  key: string;
  label: string;
  /** "All plans · enforcement coming" — a short qualifier shown under the label (docs) and as a title (page). */
  note?: string;
  /** The whole row is promised but not fully live yet (shown as a Coming badge). */
  coming?: true;
  cells: Record<PlanKey, PlanMatrixCell>;
};

export type PlanMatrixSection = { title: string; rows: PlanMatrixRow[] };

export type PlanMatrixColumn = {
  key: PlanKey;
  name: string;
  tagline: string;
  monthlyCents: number;
  annualCents: number;
  /** The hero column (Unlimited): highlighted on the page and in the docs. */
  hero: boolean;
};

const n = (v: number) => v.toLocaleString("en-US");
/** Cents to "$29" / "$1,990" — a label-only twin of plan-copy's formatUsd (kept here so this module stays leaf-level). */
const usd = (cents: number) =>
  "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });

/** A count limit as a cell: 0 → not included, -1 → the unlimited pill, otherwise the number. */
const count = (v: number): PlanMatrixCell => (v === 0 ? false : isUnlimited(v) ? UNLIMITED_CELL : v);

/** A plan module as a cell: off → ❌, on but in COMING_MODULES → Coming, otherwise ✅. */
const moduleCell = (p: Plan, m: ModuleKey): PlanMatrixCell =>
  p.modules[m] ? (COMING_MODULES.includes(m) ? { coming: true } : true) : false;

/**
 * The plan's effective marketing bullets: its own first, then every cheaper
 * plan's down the ladder. Each plan's "Everything in …" bullet means it
 * inherits all the lower plan's features (Team gets Solo's, Pro gets Team's,
 * …), so a feature test runs against this list — never the plan's own bullets
 * alone, which is what made Team look like it lacked review alerts and support.
 */
const inheritedFeatures = (p: Plan): string[] => {
  const i = PLAN_KEYS.indexOf(p.key);
  return PLAN_KEYS.slice(0, i + 1).reverse().flatMap((k) => PLANS[k].features);
};

/** A feature the plan states itself or inherits down the ladder, as a boolean cell. */
const inheritsFeature = (p: Plan, test: (line: string) => boolean): boolean => inheritedFeatures(p).some(test);

/** The plan's own support line ("Priority email support", …), or the one it inherits — false only if the ladder states none. */
const supportCell = (p: Plan): PlanMatrixCell => inheritedFeatures(p).find((f) => /support/i.test(f)) ?? false;

/**
 * Grid scans are metered in ranking-grid CREDITS, not one per scan — a bigger
 * grid costs more than one credit (shared/plans.ts gridCreditCost: one credit
 * per 25 grid points). One line, shown under the row in the docs and as the
 * footnote under the table on /pricing.
 */
export const GRID_CREDITS_NOTE = `Grid scans are metered in credits — larger grids use more than one credit (7x7 = ${gridCreditCost(7)}, 9x9 = ${gridCreditCost(9)}).`;

/** The Unlimited bullet behind the "seats on new products" row (there is no PlanLimits number for it). */
const NEW_PRODUCT_BULLET = PLANS.agency.features.find((f) => /new product/i.test(f)) ?? "";
// "Two seats on every new product we launch (Call Assistant minutes excluded)" → label + note, never typed here.
const NEW_PRODUCT_LABEL = NEW_PRODUCT_BULLET.replace(/\s*\([^)]*\)\s*$/, "") || "Seats on every new product we launch";
const NEW_PRODUCT_NOTE = NEW_PRODUCT_BULLET.match(/\(([^)]*)\)/)?.[1] ?? "";
const NEW_PRODUCT_CELL = NEW_PRODUCT_NOTE ? `2 seats (${NEW_PRODUCT_NOTE})` : "2 seats";

/** The Unlimited bullet's Master Class price note "($2,499)" — derived, not retyped. */
const masterClassPriceNote = (): string => {
  const bullet = PLANS.agency.features.find((f) => /master class/i.test(f)) ?? "";
  return bullet.match(/\(\$[\d,]+\)/)?.[0] ?? "";
};

type RowDef = { key: string; label: string; note?: string; coming?: true; cell: (p: Plan) => PlanMatrixCell };

const row = ({ key, label, note, coming, cell }: RowDef): PlanMatrixRow => {
  const cells = {} as Record<PlanKey, PlanMatrixCell>;
  for (const k of PLAN_KEYS) cells[k] = cell(PLANS[k]);
  return { key, label, ...(note ? { note } : {}), ...(coming ? { coming: true } : {}), cells };
};

/**
 * Business Tools rows, in display order (one section per group; the groups in
 * order are exactly the owner's list). Every value reads PLANS/ADDONS — no
 * plan number is typed here.
 */
export function businessToolsMatrix(): PlanMatrixSection[] {
  const rows: RowDef[] = [
    // ── Locations & people ────────────────────────────────────────────────
    { key: "locations", label: "Google Business Profile locations", cell: (p) => count(p.limits.locations) },
    { key: "teamSeats", label: "Team seats", cell: (p) => count(p.limits.agencySeats) },
    { key: "clientWorkspaces", label: "Client workspaces, roles, bulk actions, email onboarding", cell: (p) => count(p.limits.clientWorkspaces) },
    // ── Google Business Profile & reviews ─────────────────────────────────
    { key: "guardCadence", label: "Profile Guard check cadence", cell: (p) => `Every ${p.limits.guardCadenceMinutes} min` },
    {
      key: "reviewAlerts", label: "Review alerts + AI reply drafts",
      // Stated on Solo; every plan above inherits it through its "Everything in …" bullet.
      cell: (p) => inheritsFeature(p, (f) => /review alerts/i.test(f)),
    },
    { key: "autoPublish", label: "AI review replies publish automatically", cell: (p) => p.limits.autoPublishAiReplies },
    { key: "autoPosts", label: "AI posts and photo captions on a schedule", cell: (p) => moduleCell(p, "autoPosts") },
    { key: "replyTemplates", label: "Review reply templates", cell: (p) => count(p.limits.reviewTemplates) },
    { key: "reviewReminders", label: "Review reminders to customers (email; text coming soon)", cell: (p) => moduleCell(p, "reviewReminders") },
    // ── Permits & property ────────────────────────────────────────────────
    { key: "permitSearches", label: "Permit searches / month", cell: (p) => count(p.limits.permitSearches) },
    { key: "permitAlerts", label: "Permit alerts for new filings in a territory", cell: (p) => moduleCell(p, "permitAlerts") },
    { key: "propertyRecords", label: "Property records lookup", cell: (p) => moduleCell(p, "propertyRecords") },
    // ── Websites & scans ──────────────────────────────────────────────────
    { key: "clickGuardSites", label: "Click Guard + IP Tracker + VPN Shield sites", cell: (p) => count(p.limits.protectedSites) },
    { key: "siteScans", label: "Site Scans / month", cell: (p) => count(p.limits.siteScans) },
    { key: "gridScans", label: "Grid scans / month", note: GRID_CREDITS_NOTE, cell: (p) => count(p.limits.gridCredits) },
    { key: "competitorScans", label: "Competitor Intel scans / month", cell: (p) => count(p.limits.competitorScans) },
    // ── Texting ───────────────────────────────────────────────────────────
    { key: "teamTexts", label: "Team text alert segments / month", cell: (p) => count(p.limits.teamTextSegments) },
    {
      key: "clientTextingNumber", label: "Client-texting number on our carrier",
      cell: (p) =>
        p.limits.clientTexting === "none" ? false
          : p.limits.clientTexting === "included" ? `${p.limits.textingNumbersIncluded} included`
          : `Add-on ${usd(ADDONS.texting_number.monthlyCents)}`,
    },
    // ── Growth tools ──────────────────────────────────────────────────────
    { key: "adsLsaManager", label: "Google Ads and LSA manager, IP exclusions", cell: (p) => moduleCell(p, "adsManager") },
    {
      key: "cloudflareDomains", label: "Cloudflare, Search Console, Domains, Gmail forwarding",
      cell: (p) => p.modules.cloudflareSearchConsole && p.modules.domainsMailAlerts,
    },
    { key: "socialPublishing", label: "YouTube & social publishing", cell: (p) => moduleCell(p, "socialPublishing") },
    { key: "publicApi", label: "Public API (units / month)", cell: (p) => count(p.limits.apiUnitsPerMonth) },
    { key: "csvExport", label: "CSV export of every report", cell: (p) => moduleCell(p, "csvExport") },
    {
      key: "history", label: "Scan & ranking history", coming: true,
      note: "Retention is not enforced yet — nothing is deleted today.",
      cell: (p) => {
        const days = p.limits.historyDays;
        if (isUnlimited(days)) return UNLIMITED_CELL;
        // 365 days reads as "12 months" everywhere else; anything else shows its day count.
        return days % 365 === 0 ? `${Math.round(days / 30.44)} months` : `${n(days)} days`;
      },
    },
    { key: "scheduledReports", label: "Scheduled client email reports", cell: (p) => moduleCell(p, "scheduledReports") },
    {
      key: "seoSuite", label: "SEO suite: rank tracker, explorer, keywords, backlinks",
      cell: (p) => {
        if (p.limits.seoKeywords <= 0) return `Add-on from ${usd(ADDONS.seo_basic.monthlyCents)}`;
        return `${n(p.limits.seoKeywords)} keywords + ${usd(p.limits.seoCreditCents)} data/mo`;
      },
    },
    { key: "gridWatches", label: "Weekly scheduled grid watches", cell: (p) => moduleCell(p, "gridWatches") },
    { key: "whiteLabel", label: "White-label reports", cell: (p) => moduleCell(p, "whiteLabel") },
    // ── Hub & extras ──────────────────────────────────────────────────────
    { key: "gabeQuestions", label: "Gabe questions / month", cell: (p) => count(p.limits.gabeQuestions) },
    { key: "masterClass", label: `Master Class course${masterClassPriceNote() ? ` ${masterClassPriceNote()}` : ""}`, cell: (p) => moduleCell(p, "masterClass") },
    {
      key: "gbpReinstatement", label: "GBP reinstatement help / project",
      cell: (p) => (p.key === "agency" ? `${usd(GBP_REINSTATEMENT_CENTS / 2)} — half price` : usd(GBP_REINSTATEMENT_CENTS)),
    },
    {
      key: "newProductSeats", label: NEW_PRODUCT_LABEL,
      // Not a PlanLimits number: the Unlimited card's own marketing bullet is the source — the label,
      // the cell and the Call Assistant exclusion all derive from it (see the constants above the rows).
      cell: (p) => (p.key === "agency" ? NEW_PRODUCT_CELL : false),
    },
    { key: "support", label: "Support", cell: (p) => supportCell(p) },
  ];

  const sections: { title: string; keys: string[] }[] = [
    { title: "Locations & people", keys: ["locations", "teamSeats", "clientWorkspaces"] },
    { title: "Google Business Profile & reviews", keys: ["guardCadence", "reviewAlerts", "autoPublish", "autoPosts", "replyTemplates", "reviewReminders"] },
    { title: "Permits & property", keys: ["permitSearches", "permitAlerts", "propertyRecords"] },
    { title: "Websites & scans", keys: ["clickGuardSites", "siteScans", "gridScans", "competitorScans"] },
    { title: "Texting", keys: ["teamTexts", "clientTextingNumber"] },
    { title: "Growth tools", keys: ["adsLsaManager", "cloudflareDomains", "socialPublishing", "publicApi", "csvExport", "history", "scheduledReports", "seoSuite", "gridWatches", "whiteLabel"] },
    { title: "Hub & extras", keys: ["gabeQuestions", "masterClass", "gbpReinstatement", "newProductSeats", "support"] },
  ];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return sections.map((s) => ({ title: s.title, rows: s.keys.map((k) => row(byKey.get(k)!)) }));
}

/** The five platform columns, cheapest first — Unlimited is the hero. */
export function businessToolsColumns(): PlanMatrixColumn[] {
  return PLAN_KEYS.map((key) => ({
    key, name: PLANS[key].name, tagline: PLANS[key].tagline,
    monthlyCents: PLANS[key].monthlyCents, annualCents: PLANS[key].annualCents,
    hero: key === "agency",
  }));
}

// ── The CRM (a separate product: shared/crm-plans.ts) ───────────────────────

export type CrmMatrixRow = {
  key: string;
  label: string;
  note?: string;
  coming?: true;
  cells: Record<CrmPlanKey, PlanMatrixCell>;
};

export type CrmMatrixColumn = {
  key: CrmPlanKey;
  name: string;
  tagline: string;
  monthlyCents: number;
  annualCents: number;
  hero: boolean;
};

type CrmRowDef = { key: string; label: string; note?: string; coming?: true; cell: (p: CrmPlan) => PlanMatrixCell };

const crmRow = ({ key, label, note, coming, cell }: CrmRowDef): CrmMatrixRow => {
  const cells = {} as Record<CrmPlanKey, PlanMatrixCell>;
  for (const k of CRM_PLAN_KEYS) cells[k] = cell(CRM_PLANS[k]);
  return { key, label, ...(note ? { note } : {}), ...(coming ? { coming: true } : {}), cells };
};

const crmCount = (v: number): PlanMatrixCell => (v === 0 ? false : isUnlimited(v) ? UNLIMITED_CELL : v);

const crmSupportCell = (p: CrmPlan): PlanMatrixCell => p.features.find((f) => /support/i.test(f)) ?? false;

/** CRM rows, in display order — every value reads CRM_PLANS / CRM_ADDONS. */
export function crmMatrixRows(): CrmMatrixRow[] {
  return [
    crmRow({ key: "seats", label: "Team seats", cell: (p) => crmCount(p.limits.seats) }),
    crmRow({ key: "clients", label: "Clients & jobs", cell: (p) => crmCount(p.limits.clients) }),
    crmRow({
      key: "documents", label: "Estimates & invoices / month",
      note: "Online card and ACH payments on every plan.",
      cell: (p) => (isUnlimited(p.limits.documentsPerMonth) && p.limits.onlinePayments ? UNLIMITED_CELL : crmCount(p.limits.documentsPerMonth)),
    }),
    crmRow({ key: "scheduling", label: "Scheduling & dispatch calendar", cell: (p) => p.limits.scheduling }),
    crmRow({ key: "clientPortal", label: "Client portal", cell: (p) => p.limits.clientPortal }),
    crmRow({ key: "jobCosting", label: "Change orders + job costing", cell: (p) => p.limits.jobCosting }),
    crmRow({ key: "teamTexts", label: "Team text alert segments / month", cell: (p) => crmCount(p.limits.teamTextSegments) }),
    crmRow({
      key: "clientTexting", label: "Client texting",
      cell: (p) =>
        p.limits.clientTexting === "none" ? false
          : p.limits.clientTexting === "included" ? "1 number included"
          : "Your own SignalWire number or the texting add-on",
    }),
    crmRow({
      key: "jobcam", label: "JobCam — job photos & video",
      cell: (p) => (p.limits.jobcam ? true : `Add-on ${usd(CRM_ADDONS.jobcam.monthlyCents)}`),
    }),
    crmRow({ key: "apiUnits", label: "CRM API units / month", cell: (p) => crmCount(p.limits.apiUnitsPerMonth) }),
    crmRow({ key: "support", label: "Support", cell: (p) => crmSupportCell(p) }),
    crmRow({ key: "trial", label: "Free trial", cell: () => `${CRM_TRIAL_DAYS} days` }),
  ];
}

/** The three CRM columns, cheapest first — CRM Max is the hero. */
export function crmMatrixColumns(): CrmMatrixColumn[] {
  return CRM_PLAN_KEYS.map((key) => ({
    key, name: CRM_PLANS[key].name, tagline: CRM_PLANS[key].tagline,
    monthlyCents: CRM_PLANS[key].monthlyCents, annualCents: CRM_PLANS[key].annualCents,
    hero: key === "crm_max",
  }));
}
