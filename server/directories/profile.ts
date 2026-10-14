import { z } from "zod";
const text = z.string().trim().min(1).max(10000).nullable();
const texts = z.array(z.string().trim().min(1).max(2000)).max(500).nullable();
const json = z.union([z.record(z.unknown()), z.array(z.unknown())]).nullable();
export const profileInput = z
  .object({
    name: text,
    street_address: text,
    address_line2: text,
    city: text,
    state: text,
    postal_code: text,
    country: text,
    service_area_only: z.boolean().nullable(),
    service_areas: json,
    phone: text,
    website: z.string().url().max(2048).nullable(),
    hours: json,
    holiday_hours: json,
    primary_category: text,
    secondary_categories: texts,
    short_description: text,
    long_description: text,
    services: json,
    logo_key: text,
    cover_photo_key: text,
    photo_keys: texts,
    year_founded: z.number().int().min(1000).max(9999).nullable(),
    licence_numbers: texts,
    insurance_numbers: texts,
    payment_methods: texts,
    social_links: json,
    quote_link: z.string().url().max(2048).nullable(),
    review_link: z.string().url().max(2048).nullable(),
  })
  .strict()
  .partial();
export const profileFields = Object.keys(profileInput.shape);
export const jsonFields = new Set([
  "service_areas",
  "hours",
  "holiday_hours",
  "services",
  "social_links",
]);

/** Raw business_locations row plus an actual GBP read. No guessed media, licences or service-area flag. */
export function importedProfile(
  location: Record<string, any>,
  google?: Record<string, any>,
) {
  const profile: Record<string, any> = Object.fromEntries(
    profileFields.map((field) => [field, null]),
  );
  Object.assign(profile, {
    name: location.business_name ?? null,
    street_address: location.address ?? null,
    city: location.city ?? null,
    state: location.state ?? null,
    postal_code: location.zip_code ?? null,
    country: location.country ?? null,
    phone: location.phone ?? null,
    website: location.website ?? null,
    hours: location.hours ?? null,
    primary_category: location.categories?.[0] ?? null,
    secondary_categories: location.categories?.slice(1) ?? null,
    long_description: location.description ?? null,
    services: location.services ?? null,
    service_areas: location.service_areas ?? null,
    social_links: location.social_profiles ?? null,
  });
  if (google) {
    const address = google.storefrontAddress;
    Object.assign(profile, {
      name: google.title ?? null,
      street_address: address?.addressLines?.[0] ?? null,
      address_line2: address?.addressLines?.slice(1).join(", ") || null,
      city: address?.locality ?? null,
      state: address?.administrativeArea ?? null,
      postal_code: address?.postalCode ?? null,
      country: address?.regionCode ?? null,
      service_area_only:
        google.serviceArea?.businessType === "CUSTOMER_LOCATION_ONLY"
          ? true
          : google.serviceArea?.businessType ===
                "CUSTOMER_AND_BUSINESS_LOCATION" ||
              address?.addressLines?.length
            ? false
            : null,
      service_areas: google.serviceArea?.places?.placeInfos ?? null,
      phone: google.phoneNumbers?.primaryPhone ?? null,
      website: google.websiteUri ?? null,
      hours: google.regularHours ?? null,
      holiday_hours: google.specialHours ?? null,
      primary_category: google.categories?.primaryCategory?.displayName ?? null,
      secondary_categories:
        google.categories?.additionalCategories
          ?.map((c: any) => c.displayName)
          .filter(Boolean) ?? null,
      long_description: google.profile?.description ?? null,
      services: google.serviceItems ?? null,
      review_link: google.metadata?.newReviewUri ?? null,
    });
    // A hidden address must never leak from the local cache into the distribution profile.
    if (profile.service_area_only === true)
      profile.street_address = profile.address_line2 = null;
  }
  return profile;
}
export function mergeImport(
  current: Record<string, any> | undefined,
  incoming: Record<string, any>,
) {
  const owned = new Set<string>(current?.owner_edited_fields ?? []);
  return Object.fromEntries(
    profileFields.map((field) => [
      field,
      owned.has(field) ? (current?.[field] ?? null) : (incoming[field] ?? null),
    ]),
  );
}
