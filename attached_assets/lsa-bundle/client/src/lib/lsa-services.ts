// Source of truth for which Google LSA services Alpine Exteriors actually offers,
// taken directly from the "Manage industries and services" toggles in the Google
// Local Services account. Any lead whose service is NOT in OFFERED_SERVICE_IDS is
// for a service we don't provide and is eligible to dispute as
// "Service I don't offer" (JOB_TYPE_MISMATCH).
//
// IMPORTANT: keep this in sync with the toggles in Google Ads -> Local Services
// -> Manage industries and services. If a toggle is turned on/off there, update
// the matching id here.

// Google's internal industry category id -> the real industry name Google shows.
// (e.g. the "Window Service Provider" industry has the internal id
// xcat:service_area_business_window_repair, which is why a window INSTALL lead can
// look like a "window repair" if you only read the raw category.)
export const CATEGORY_LABELS: Record<string, string> = {
  "xcat:service_area_business_general_contractor": "General Contractor",
  "xcat:service_area_business_roofer": "Roofer",
  "xcat:service_area_business_siding_pro": "Siding Pro",
  "xcat:service_area_business_window_repair": "Window Service Provider",
};

// Human label for each Google service id seen on leads.
export const SERVICE_LABELS: Record<string, string> = {
  // General Contractor
  accessory_buildings: "Accessory buildings",
  decks_patio: "Decks & patio",
  exterior_finishing: "Exterior finishing",
  general_contractor_commercial_projects: "Commercial projects",
  home_addition: "Home addition",
  home_building: "Home building",
  home_remodel_renovation: "Home remodel & renovation",
  interior_finishing: "Interior finishing",
  // Roofer
  gutter_installation: "Gutter installation",
  gutter_repair: "Gutter repair",
  roof_inspection: "Roof inspection",
  roof_installation: "Roof installation",
  roof_repair: "Roof repair",
  storm_wind_damage_roof_repair: "Roof damage repair",
  // Siding Pro
  remodeling_siding_pro: "Remodeling",
  repair_maintenance_siding_pro: "Repair & maintenance",
  siding_installation: "Siding installation",
  siding_removal: "Siding removal",
  // Window Service Provider
  door_installation: "Door installation",
  door_repair: "Door repair",
  glass_installation: "Glass installation",
  skylight_installation: "Skylight installation",
  skylight_repair: "Skylight repair",
  window_installation: "Window installation",
  window_repair: "Window repair",
};

// The services that are toggled ON in the Google LSA account (the only ones we
// actually offer). Everything else is disputable as "Service I don't offer".
export const OFFERED_SERVICE_IDS: Set<string> = new Set([
  // General Contractor — ON: Exterior finishing, Roofing
  "exterior_finishing",
  // Roofer — ON: Roof inspection, Roof installation
  "roof_inspection",
  "roof_installation",
  // Siding Pro — ON: Remodeling, Siding installation, Siding removal
  "remodeling_siding_pro",
  "siding_installation",
  "siding_removal",
  // Window Service Provider — ON: Window installation
  "window_installation",
]);

// "roof_installation" -> "Roof installation" (falls back to title-casing).
export function serviceLabel(s?: string | null): string | null {
  if (!s) return null;
  return (
    SERVICE_LABELS[s] ||
    s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// "xcat:service_area_business_window_repair" -> "Window Service Provider".
export function categoryLabel(c?: string | null): string | null {
  if (!c) return null;
  if (CATEGORY_LABELS[c]) return CATEGORY_LABELS[c];
  const tail = c.split(":").pop() || c;
  return (
    tail
      .replace(/^service_area_business_/, "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (ch) => ch.toUpperCase())
      .trim() || null
  );
}

// True only when we positively know the lead is for a service we do NOT offer.
// A blank service id is "unknown" (Google didn't specify a sub-service), so we
// do NOT flag it — we only flag a known service that isn't in the offered set.
export function isNotOffered(serviceId?: string | null): boolean {
  if (!serviceId) return false;
  return !OFFERED_SERVICE_IDS.has(serviceId);
}
