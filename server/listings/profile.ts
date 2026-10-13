import { z } from 'zod';
const text = z.string().trim().min(1).max(10000).nullable();
const texts = z.array(z.string().trim().min(1).max(2000)).max(500).nullable();
const json = z.union([z.record(z.unknown()), z.array(z.unknown())]).nullable();
export const profileInput = z.object({
  name: text, street_address: text, address_line2: text, city: text, state: text, postal_code: text,
  country: text, service_area_only: z.boolean().nullable(), service_areas: json,
  phone: text, website: z.string().url().max(2048).nullable(), hours: json, holiday_hours: json,
  primary_category: text, secondary_categories: texts, short_description: text, long_description: text,
  services: json, logo_key: text, cover_photo_key: text, photo_keys: texts,
  year_founded: z.number().int().min(1000).max(9999).nullable(), licence_numbers: texts,
  insurance_numbers: texts, payment_methods: texts, social_links: json,
  quote_link: z.string().url().max(2048).nullable(), review_link: z.string().url().max(2048).nullable(),
}).strict().partial();
export const profileFields = Object.keys(profileInput.shape);
export const jsonFields = new Set(['service_areas', 'hours', 'holiday_hours', 'services', 'social_links']);

/** Raw business_locations row plus an actual GBP read. No guessed media, licences or service-area flag. */
export function importedProfile(l: Record<string, any>, g?: Record<string, any>) {
  const p: Record<string, any> = Object.fromEntries(profileFields.map(k => [k, null]));
  Object.assign(p, { name: l.business_name ?? null, street_address: l.address ?? null,
    city: l.city ?? null, state: l.state ?? null, postal_code: l.zip_code ?? null, country: l.country ?? null,
    phone: l.phone ?? null, website: l.website ?? null, hours: l.hours ?? null,
    primary_category: l.categories?.[0] ?? null, secondary_categories: l.categories?.slice(1) ?? null,
    long_description: l.description ?? null, services: l.services ?? null,
    service_areas: l.service_areas ?? null, social_links: l.social_profiles ?? null });
  if (g) {
    const a = g.storefrontAddress;
    Object.assign(p, { name: g.title ?? null, street_address: a?.addressLines?.[0] ?? null,
      address_line2: a?.addressLines?.slice(1).join(', ') || null, city: a?.locality ?? null,
      state: a?.administrativeArea ?? null, postal_code: a?.postalCode ?? null, country: a?.regionCode ?? null,
      service_area_only: g.serviceArea?.businessType === 'CUSTOMER_LOCATION_ONLY' ? true :
        g.serviceArea?.businessType === 'CUSTOMER_AND_BUSINESS_LOCATION' || a?.addressLines?.length ? false : null,
      service_areas: g.serviceArea?.places?.placeInfos ?? null, phone: g.phoneNumbers?.primaryPhone ?? null,
      website: g.websiteUri ?? null, hours: g.regularHours ?? null, holiday_hours: g.specialHours ?? null,
      primary_category: g.categories?.primaryCategory?.displayName ?? null,
      secondary_categories: g.categories?.additionalCategories?.map((c: any) => c.displayName).filter(Boolean) ?? null,
      long_description: g.profile?.description ?? null, services: g.serviceItems ?? null,
      review_link: g.metadata?.newReviewUri ?? null });
    // A hidden address must never leak from the local cache into the distribution profile.
    if (p.service_area_only === true) p.street_address = p.address_line2 = null;
  }
  return p;
}
export function mergeImport(current: Record<string, any> | undefined, incoming: Record<string, any>) {
  const owned = new Set<string>(current?.owner_edited_fields ?? []);
  return Object.fromEntries(profileFields.map(k => [k, owned.has(k) ? current?.[k] ?? null : incoming[k] ?? null]));
}
