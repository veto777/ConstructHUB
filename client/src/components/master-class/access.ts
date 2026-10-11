/**
 * What the Master Class page knows about access and the catalog — the client half of server/state-guides.ts.
 *
 * The server resolves purchases into `unlocked` per module CATEGORY (never a database id the page would have
 * to guess), so the page only maps its tabs to categories. The unlock rule for a tab lives here, in one pure
 * function, and server/course-access.test.ts exercises it.
 */
export type ModuleCategory = "licensing" | "gmb" | "website" | "seo";

export type CoursePurchase = {
  id: number;
  userId: number;
  moduleId: number | null;
  isBundle: boolean | null;
  stripeSessionId: string | null;
  purchasedAt: string;
};

/** GET /api/course-access (server/routes.ts → server/state-guides.ts courseUnlocks). */
export type CourseAccess = {
  included: boolean;
  purchases: CoursePurchase[];
  unlocked: Record<ModuleCategory, boolean>;
  all: boolean;
  any: boolean;
  devPreview: boolean;
  signedIn: boolean;
};

export type MasterClassModule = {
  id: number;
  title: string;
  description: string;
  /** Cents. */
  price: number;
  category: ModuleCategory | string;
  features: string[] | null;
  sortOrder?: number;
};

/** GET /api/course-catalog: the modules and the bundle, priced by server/catalog.ts. */
export type CourseCatalog = {
  modules: MasterClassModule[];
  bundle: { id: "course_bundle"; name: string; priceCents: number; salesOnly: boolean };
};

export const MASTER_CLASS_TABS = ["overview", "state-guide", "gmb", "website", "seo", "vetting", "pricing"] as const;
export type MasterClassTab = (typeof MASTER_CLASS_TABS)[number];

/** Older links: "?tab=website-seo" was the one tab that held modules 3 and 4. */
const LEGACY_TABS: Record<string, MasterClassTab> = { "website-seo": "website" };

export function resolveTab(param: string | null | undefined): MasterClassTab {
  if (!param) return "overview";
  if ((MASTER_CLASS_TABS as readonly string[]).includes(param)) return param as MasterClassTab;
  return LEGACY_TABS[param] ?? "overview";
}

/** Each module home and the module category that opens it. */
export const TAB_CATEGORY: Partial<Record<MasterClassTab, ModuleCategory>> = {
  "state-guide": "licensing",
  gmb: "gmb",
  website: "website",
  seo: "seo",
};
export const CATEGORY_TAB: Record<ModuleCategory, MasterClassTab> = { licensing: "state-guide", gmb: "gmb", website: "website", seo: "seo" };

/** The tab's label in the tab bar and in links. */
export const TAB_LABELS: Record<MasterClassTab, string> = {
  overview: "Overview",
  "state-guide": "State guide",
  gmb: "Google Business",
  website: "Website",
  seo: "SEO & ads",
  vetting: "Vetting contractors",
  pricing: "Enroll",
};

/**
 * May this tab's lessons be read? Without a successful access answer (loading, error, signed out) nothing paid
 * is unlocked — and the page shows WHY (checking, failed, locked) rather than treating the gap as "not bought".
 * The vetting lessons come with any module or the bundle.
 */
export function tabUnlocked(access: CourseAccess | undefined | null, tab: MasterClassTab): boolean {
  if (tab === "overview" || tab === "pricing") return true;
  if (!access) return false;
  if (tab === "vetting") return access.any;
  const category = TAB_CATEGORY[tab];
  return category ? access.unlocked?.[category] === true : true;
}

/** "Included in your plan" / "Purchased" / "Dev preview" — why a module is open, in the words the page uses. */
export function unlockReason(access: CourseAccess | undefined | null, category: ModuleCategory): "included" | "purchased" | "preview" | null {
  if (!access || !access.unlocked?.[category]) return null;
  if (access.included) return "included";
  if (access.purchases.length > 0) return "purchased";
  return access.devPreview ? "preview" : null;
}
