/**
 * Normalize a city name for matching an address against a state's published
 * location names: case, punctuation, "City of"/"Town of", Saint/St./Ste.,
 * Mount/Mt., Fort/Ft. and spacing. "St. Louis" = "Saint Louis" = "st louis";
 * "Sedro-Woolley" = "Sedro Woolley". Pure, no imports.
 */
export function cityKey(name: string): string {
  return name
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(city|town|village|borough|township) of\s+/g, "")
    .replace(/\s*\((city|town|village|cdp)\)\s*$/g, "")
    .replace(/[.'’]/g, "")
    .replace(/[-–/,]/g, " ")
    .replace(/\bsaint\b/g, "st")
    .replace(/\bsainte\b/g, "ste")
    .replace(/\bmount\b/g, "mt")
    .replace(/\bfort\b/g, "ft")
    .replace(/\s+/g, " ")
    .trim();
}
