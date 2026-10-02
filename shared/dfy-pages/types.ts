/**
 * The content of one done-for-you service page (/done-for-you/<slug>): work
 * our team does for a contractor, as opposed to a feature (software they run
 * themselves, /features/<slug>). Same template, same writing rules
 * (shared/feature-pages/WRITING-GUIDE.md), same content shape for the hero and
 * the sections (LandingContent) — a service adds what it sells and how.
 *
 * Prices never live here. Every done-for-you item at or above the sales
 * threshold is "Talk to a sales rep" (owner decision 2026-09-30), and its
 * catalog price must not reach the browser, so a page names its catalog ids
 * and the vitest checks the server's price book decides the pricing kind.
 */
import type { FeatureIcon, FeaturePricing, LandingContent } from "../feature-pages/types";

/** How a service is sold: quoted by a sales rep, or a one-time service with its price in the price book. */
export type DfyPricing = Extract<FeaturePricing, { kind: "sales" } | { kind: "service" }>;

export type DfyPage = LandingContent & {
  /**
   * The server catalog entries this page sells (server/catalog.ts DFY_CATALOG
   * keys). Every catalog entry belongs to exactly one page; the vitest checks
   * an entry at or above the sales threshold makes the page `kind: "sales"`.
   */
  catalogIds: string[];
  pricing: DfyPricing;
  /** The card icon on the catalogue and in the menu. */
  icon: FeatureIcon;
  /** One short line under the name in the menu (a few words: what it covers). */
  blurb: string;
  /** Related pages: done-for-you keys or feature registry keys (shown as cards). */
  related: string[];
};

/**
 * A service whose page is NOT the template: the hand-built /reinstatement page
 * (it carries the request form). Listed on /done-for-you, in the menu and on
 * the admin index, linked to its own page.
 */
export type ExternalDfyPage = {
  key: string;
  title: string;
  lede: string;
  path: string;
  pricing: DfyPricing;
  icon: FeatureIcon;
  /** One short line under the name in the menu. */
  blurb: string;
};
