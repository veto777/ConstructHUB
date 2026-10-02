/**
 * The done-for-you registry: one page per service our team does for a
 * contractor, at /done-for-you/<slug>, in the same template as the feature
 * pages (client/src/components/feature-landing/**).
 *
 *   /done-for-you          the catalogue, with what a feature is and what a service is
 *   /done-for-you/<slug>   one service (signed out: public chrome; signed in: the app frame)
 *   /admin/feature-pages   platform admins: every page — features, then these — with status and links
 *
 * "Features" are the software tools (shared/feature-pages); "Done-For-You
 * Services" are work the team does (server/catalog.ts dfy_* items, the SEO
 * contracts, GBP reinstatement). Each service's copy lives in its own file,
 * shared/dfy-pages/<key>.ts, under the feature pages' writing guide
 * (shared/feature-pages/WRITING-GUIDE.md). GBP Reinstatement keeps its own
 * hand-built page (/reinstatement, which carries the request form) and is
 * listed as an external entry.
 */
import type { DfyPage, ExternalDfyPage } from "./types";

import formation from "./formation";
import gmbWebsite from "./gmbWebsite";
import seoAds from "./seoAds";
import seoContracts from "./seoContracts";
import businessBuild from "./businessBuild";

export type { DfyPage, DfyPricing, ExternalDfyPage } from "./types";

export const DFY_PATH = "/done-for-you";

/** Every template page, in catalogue (and menu) order: the parts, the ongoing SEO, then the whole build. */
export const DFY_PAGES: readonly DfyPage[] = [formation, gmbWebsite, seoAds, seoContracts, businessBuild];

/** Services whose page is not the template — listed on /done-for-you, in the menu and on the admin index. */
export const EXTERNAL_DFY_PAGES: readonly ExternalDfyPage[] = [
  {
    key: "gbpReinstatement",
    title: "GBP Reinstatement",
    lede: "Suspended Google Business Profile? Our team reviews your case, fixes guideline issues and writes and submits the appeal.",
    path: "/reinstatement",
    // One price per project from the price book (shared/plans.ts GBP_REINSTATEMENT_CENTS), as on /features/reinstatement.
    pricing: { kind: "service", service: "gbpReinstatement" },
    icon: "shield-alert",
    blurb: "Help with a suspended Google Business Profile",
  },
];

/** /done-for-you/<slug> */
export const dfyPagePath = (page: Pick<DfyPage, "slug">) => `${DFY_PATH}/${page.slug}`;

const BY_SLUG = new Map(DFY_PAGES.map((p) => [p.slug, p]));
const BY_KEY = new Map(DFY_PAGES.map((p) => [p.key, p]));

export const dfyPageBySlug = (slug: string): DfyPage | undefined => BY_SLUG.get(slug);
export const dfyPageByKey = (key: string): DfyPage | undefined => BY_KEY.get(key);

/** One card on /done-for-you, one item in the menu, one row on the admin index. */
export type DfyCatalogueEntry = {
  key: string;
  title: string;
  lede: string;
  /** The public page. */
  path: string;
  /** "external" = its own hand-built page (/reinstatement). */
  status: DfyPage["status"] | "external";
  pricing: DfyPage["pricing"];
  icon: DfyPage["icon"];
  /** The menu's short line. */
  blurb: string;
};

/** Every service in catalogue order: the template pages, then the external ones. */
export const DFY_CATALOGUE: readonly DfyCatalogueEntry[] = [
  ...DFY_PAGES.map((p) => ({
    key: p.key, title: p.title, lede: p.lede, path: dfyPagePath(p), status: p.status, pricing: p.pricing, icon: p.icon,
    blurb: p.blurb,
  })),
  ...EXTERNAL_DFY_PAGES.map((e) => ({ ...e, status: "external" as const })),
];

/** Pages written and checked (status "ready") — the ones in the sitemap and prerendered. */
export const READY_DFY_PAGES: readonly DfyPage[] = DFY_PAGES.filter((p) => p.status === "ready");
