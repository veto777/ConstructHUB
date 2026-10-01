/**
 * The LocalBusiness JSON-LD a scanned site should carry, built from the synced
 * GBP profile snapshot. Pure data; no provider. Lives on its own so
 * ./guidance.ts (and through it ./audit.ts and the public API's Site Scan
 * route) never imports ./providers.ts, the AI provider.
 */
export function businessSchema(profile: any) {
  if (!profile) return null;
  return {
    "@context": "https://schema.org",
    "@type": "HomeAndConstructionBusiness",
    name: profile.business_name,
    ...(profile.phone ? { telephone: profile.phone } : {}),
    ...(profile.website ? { url: profile.website } : {}),
    ...(profile.address
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: profile.address,
            ...(profile.city ? { addressLocality: profile.city } : {}),
            ...(profile.state ? { addressRegion: profile.state } : {}),
            ...(profile.zip_code ? { postalCode: profile.zip_code } : {}),
            ...(profile.country ? { addressCountry: profile.country } : {}),
          },
        }
      : {}),
    ...(profile.service_areas?.length
      ? { areaServed: profile.service_areas }
      : {}),
  };
}
