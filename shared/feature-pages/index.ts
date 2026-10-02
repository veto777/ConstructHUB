/**
 * The feature-page registry: one intro page per feature, at /features/<slug>,
 * in the /call-assistant page's look (client/src/components/feature-landing/**),
 * so a client can compare every feature and decide what they want.
 *
 *   /features              the catalogue, grouped like the signed-in dashboard
 *   /features/<slug>       one feature (signed out: public chrome; signed in: the app frame)
 *   /admin/feature-pages   platform admins: every page, its status and links
 *
 * Each feature's copy lives in its own file, shared/feature-pages/<key>.ts, so
 * writers never touch each other's work. Writing rules: WRITING-GUIDE.md here.
 * The AI Call Assistant keeps its own hand-built page (/call-assistant) and is
 * listed as an external entry.
 */
import { DASHBOARD_GROUPS, DASHBOARD_TILES } from "../dashboard";
import type { ExternalFeaturePage, FeatureGroupKey, FeatureIcon, FeaturePage } from "./types";

import gbp from "./gbp";
import reviews from "./reviews";
import profileGuard from "./profileGuard";
import rankingGrid from "./rankingGrid";
import gbpContent from "./gbpContent";
import social from "./social";
import siteScan from "./siteScan";
import media from "./media";
import clickGuard from "./clickGuard";
import ipTracker from "./ipTracker";
import vpnShield from "./vpnShield";
import cloudflare from "./cloudflare";
import searchConsole from "./searchConsole";
import domains from "./domains";
import mailAlerts from "./mailAlerts";
import permits from "./permits";
import property from "./property";
import competitors from "./competitors";
import adsManager from "./adsManager";
import lsaLeads from "./lsaLeads";
import crm from "./crm";
import crmSchedule from "./crmSchedule";
import crmLeads from "./crmLeads";
import texting from "./texting";
import agency from "./agency";
import masterClass from "./masterClass";
import guides from "./guides";
import reinstatement from "./reinstatement";
import gabe from "./gabe";
import customerApi from "./customerApi";

export type { ExternalFeaturePage, FeatureGroupKey, FeaturePage } from "./types";

export const FEATURES_PATH = "/features";
export const ADMIN_FEATURE_PAGES_PATH = "/admin/feature-pages";

const CATALOGUE_BLURBS: Partial<Record<FeatureGroupKey, string>> = {
  run: "Your CRM, schedule, leads, texting, call answering and your team.",
};

/** The catalogue's groups: the dashboard's five, then the platform pieces with no tile. */
export const FEATURE_GROUPS: readonly { key: FeatureGroupKey; label: string; blurb: string }[] = [
  // Same labels as the dashboard; a blurb that talks about the dashboard itself gets a catalogue version.
  ...DASHBOARD_GROUPS.map((g) => ({ ...g, blurb: CATALOGUE_BLURBS[g.key] ?? g.blurb })),
  { key: "platform", label: "The platform", blurb: "Gabe, the assistant on every page, and the API for your own tools." },
];

/** Every template page, in catalogue order (the dashboard's tile order within each group). */
export const FEATURE_PAGES: readonly FeaturePage[] = [
  // Grow
  gbp, reviews, profileGuard, rankingGrid, gbpContent, social, siteScan, media,
  // Protect
  clickGuard, ipTracker, vpnShield, cloudflare, searchConsole, domains, mailAlerts,
  // Win jobs
  permits, property, competitors, adsManager, lsaLeads,
  // Run the business
  crm, crmSchedule, crmLeads, texting, agency,
  // Learn
  masterClass, guides, reinstatement,
  // The platform
  gabe, customerApi,
];

const callAssistantTile = DASHBOARD_TILES.find((t) => t.key === "callAssistant");

/** Features whose page is not the template — listed on /features and the admin index, linked to their own page. */
export const EXTERNAL_FEATURE_PAGES: readonly ExternalFeaturePage[] = [
  {
    key: "callAssistant",
    group: "run",
    title: "AI Call Assistant",
    lede: callAssistantTile?.description ?? "An assistant that answers your calls 24/7 and files the lead in your CRM.",
    path: "/call-assistant",
    app: { href: "/call-assistant", surface: "app" },
    pricing: { kind: "addon", addon: "call_assistant" },
  },
];

/** /features/<slug> */
export const featurePagePath = (page: Pick<FeaturePage, "slug">) => `${FEATURES_PATH}/${page.slug}`;

const BY_SLUG = new Map(FEATURE_PAGES.map((p) => [p.slug, p]));
const BY_KEY = new Map(FEATURE_PAGES.map((p) => [p.key, p]));
const EXTERNAL_BY_KEY = new Map(EXTERNAL_FEATURE_PAGES.map((p) => [p.key, p]));

export const featurePageBySlug = (slug: string): FeaturePage | undefined => BY_SLUG.get(slug);
export const featurePageByKey = (key: string): FeaturePage | undefined => BY_KEY.get(key);

/**
 * The public intro page for a registry key (a dashboard tile key): the
 * template page, or an external page such as /call-assistant; undefined when
 * the key has none.
 */
export function featureIntroPath(key: string): string | undefined {
  const page = BY_KEY.get(key);
  if (page) return featurePagePath(page);
  return EXTERNAL_BY_KEY.get(key)?.path;
}

/** One card on /features or one row on the admin index. */
export type FeatureCatalogueEntry = {
  key: string;
  group: FeatureGroupKey;
  title: string;
  lede: string;
  /** The public intro page. */
  path: string;
  /** "external" = its own hand-built page (/call-assistant). */
  status: FeaturePage["status"] | "external";
  app: FeaturePage["app"];
  pricing: FeaturePage["pricing"];
  /** The first "what you get" card's icon, when the page has one. */
  icon?: FeatureIcon;
  flag?: FeaturePage["flag"];
};

/** Every entry in catalogue order: template pages, with external pages slotted in at their dashboard position. */
export const FEATURE_CATALOGUE: readonly FeatureCatalogueEntry[] = (() => {
  const entries: FeatureCatalogueEntry[] = FEATURE_PAGES.map((p) => ({
    key: p.key, group: p.group, title: p.title, lede: p.lede, path: featurePagePath(p), status: p.status, app: p.app,
    pricing: p.pricing, ...(p.cards[0] ? { icon: p.cards[0].icon } : {}), ...(p.flag ? { flag: p.flag } : {}),
  }));
  const tileOrder = new Map(DASHBOARD_TILES.map((t, i) => [t.key as string, i]));
  for (const ext of EXTERNAL_FEATURE_PAGES) {
    const at = tileOrder.get(ext.key) ?? Infinity;
    // After the last template entry of the same group whose tile comes before it.
    let index = entries.findIndex((e) => e.group === ext.group && (tileOrder.get(e.key) ?? -1) > at);
    if (index === -1) index = entries.reduce((last, e, i) => (e.group === ext.group ? i + 1 : last), entries.length);
    entries.splice(index, 0, {
      key: ext.key, group: ext.group, title: ext.title, lede: ext.lede, path: ext.path, status: "external", app: ext.app,
      pricing: ext.pricing, icon: "phone",
    });
  }
  return entries;
})();

/** Pages written and checked (status "ready") — the ones in the sitemap. */
export const READY_FEATURE_PAGES: readonly FeaturePage[] = FEATURE_PAGES.filter((p) => p.status === "ready");
