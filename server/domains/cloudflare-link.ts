/** Merge seam for lane a5: bind an owner-scoped, cached (no network calls) implementation when constructing domain routes. */
export interface CloudflareZoneLink {
  zoneNameservers(domain: string): Promise<string[] | null>;
}
export const cloudflareZoneLink: CloudflareZoneLink = {
  async zoneNameservers() {
    return null;
  },
};
