/**
 * The place box of the rank tracker (client/src/pages/seo/location-picker.tsx): text typed there is a place only
 * once it is chosen from the list. Text that was never chosen must not go out with the form as "no place" — that
 * would quietly make a town's rank check a country-wide one. Pure, shared with the tests.
 */
export function unresolvedPlaceMessage(typed: string, defaultLabel: string): string | null {
  const t = String(typed ?? "").trim();
  if (!t) return null;
  return `"${t}" isn't a chosen place yet: pick it from the list, or clear the box to check from ${defaultLabel}.`;
}
