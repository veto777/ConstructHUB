/**
 * Per-page <title> and meta description for public marketing pages that need
 * their own (search results and link previews). The server writes them into
 * the HTML it sends for that path (server/static.ts), so crawlers that don't
 * run JavaScript see them; the page sets the same values in the browser.
 *
 * Pages without an entry keep client/index.html's defaults.
 */
import { FEATURE_PAGES, FEATURES_PATH, featurePagePath } from "./feature-pages";

export type RouteMeta = { title: string; description: string };

export const ROUTE_META: Readonly<Record<string, RouteMeta>> = {
  "/call-assistant": {
    title: "AI Call Assistant | ConstructHUB",
    description:
      "An AI receptionist for contractors: pick a woman's or man's voice, get a local number in your state, forward the lines you already have, and every call lands in your CRM with a transcript and recording.",
  },
  [FEATURES_PATH]: {
    title: "Features | ConstructHUB",
    description:
      "Every ConstructHUB feature for contractors in one place: Google Business Profile tools, click-fraud protection, permits, the CRM and more, with what each one does and which plan includes it.",
  },
  // One entry per feature intro page, from its content file (shared/feature-pages/<key>.ts).
  ...Object.fromEntries(FEATURE_PAGES.map((page) => [featurePagePath(page), { title: page.seo.title, description: page.seo.description }])),
};
