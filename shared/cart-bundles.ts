/**
 * Bundles and the cart items they already include.
 *
 * One source of truth for both sides of checkout:
 *   - the client cart swaps a bundle's parts out when the bundle is added and
 *     treats a part as "in cart" while its bundle is there;
 *   - the server's cart checkout rejects a cart holding a bundle together with
 *     one of its parts, so nobody is charged twice for the same service.
 *
 * Items are matched by the same keys the server prices them by (see
 * server/stripe.ts create-cart-checkout): Master Class modules and the course
 * bundle by `type`, done-for-you services and their bundle by `id`.
 */

export type BundleId = "dfy_bundle" | "course_bundle";

export interface BundleCartItem {
  id: string;
  type?: string;
}

/** What the done-for-you Complete Business Build contains. */
export const DFY_BUNDLE_PARTS: ReadonlySet<string> = new Set([
  "dfy_formation",
  "dfy_gmb_website",
  "dfy_seo_ads",
]);

export const BUNDLE_NAMES: Record<BundleId, string> = {
  dfy_bundle: "Complete Business Build",
  course_bundle: "Master Class Complete Bundle",
};

const isCourseModule = (item: BundleCartItem) =>
  item.type === "course_module" || (item.type === undefined && item.id.startsWith("course_module_"));

const isCourseType = (item: BundleCartItem) =>
  item.type === "course_module" || item.type === "course_bundle";

/** The bundle this item IS, or null when it is not a bundle. */
export function bundleIdOf(item: BundleCartItem): BundleId | null {
  if (item.type === "course_bundle" || (item.type === undefined && item.id === "course_bundle")) return "course_bundle";
  if (item.id === "dfy_bundle" && !isCourseType(item)) return "dfy_bundle";
  return null;
}

/** The bundle that already INCLUDES this item, or null. */
export function coveringBundleOf(item: BundleCartItem): BundleId | null {
  if (isCourseModule(item)) return "course_bundle";
  if (DFY_BUNDLE_PARTS.has(item.id) && !isCourseType(item)) return "dfy_bundle";
  return null;
}

/** Every item in `items` that a bundle also in `items` already includes. */
export function bundleOverlaps<T extends BundleCartItem>(items: T[]): { bundleId: BundleId; part: T }[] {
  const bundles = new Set(items.map(bundleIdOf).filter((b): b is BundleId => b !== null));
  const out: { bundleId: BundleId; part: T }[] = [];
  for (const item of items) {
    const bundleId = coveringBundleOf(item);
    if (bundleId && bundles.has(bundleId)) out.push({ bundleId, part: item });
  }
  return out;
}

/** `items` without the parts a bundle in the same cart already includes. */
export function withoutBundledParts<T extends BundleCartItem>(items: T[]): T[] {
  const parts = new Set<T>(bundleOverlaps(items).map((o) => o.part));
  return parts.size ? items.filter((i) => !parts.has(i)) : items;
}
