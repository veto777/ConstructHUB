import { useQuery } from "@tanstack/react-query";
import { Phone, Navigation, Globe, MessageSquare, Store } from "lucide-react";
import { GoogleLocalCard, GooglePill, openNowFromHours } from "@/components/google";
import { fullAddress } from "@/lib/address";

/** The columns of business_locations the card reads (camel-cased rows from /api/locations?paged=true). */
export type LocationCardRow = {
  id: number; businessName: string; gbpLocationName?: string | null; placeId?: string | null; googleCid?: string | null;
  address?: string | null; city?: string | null; state?: string | null; zipCode?: string | null;
  phone?: string | null; website?: string | null; categories?: string[] | null; hours?: unknown;
  openingDate?: string | null; openStatus?: string | null; avgRating?: number | null; reviewCount?: number | null;
  businessPhotoCount?: number | null;
};

export type LatestReview = { comment?: string | null; reviewerPhotoUrl?: string | null } | null | undefined;

/** "7+ years in business" from Google's opening date ("2017", "2017-03", "2017-03-15"); null when unknown. */
export function yearsInBusiness(openingDate: string | null | undefined, now = new Date()): string | null {
  if (!openingDate) return null;
  const m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(openingDate.trim());
  if (!m) return null;
  const opened = new Date(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, m[3] ? Number(m[3]) : 1);
  if (Number.isNaN(opened.getTime()) || opened > now) return null;
  const years = Math.floor((now.getTime() - opened.getTime()) / (365.25 * 24 * 3600 * 1000));
  return years >= 1 ? `${years}+ year${years === 1 ? "" : "s"} in business` : null;
}

/** A Google Maps link for Directions: the Maps URL Google gave us, else a Maps search for the real address/place. */
export function directionsUrl(l: LocationCardRow): string | null {
  if (l.googleCid && /^https:\/\//i.test(l.googleCid)) return l.googleCid;
  const address = fullAddress(l);
  if (!address && !l.placeId) return null;
  const u = new URL("https://www.google.com/maps/search/?api=1");
  u.searchParams.set("query", address || l.businessName);
  if (l.placeId) u.searchParams.set("query_place_id", l.placeId);
  return u.toString();
}

/**
 * A business location as a Google local-pack entry, built from our own stored data only: rating and
 * count from the last Google sync, open/closed from the synced hours (viewer's clock) or Google's
 * closed status, years from the opening date, photos from the synced media, the latest review's text.
 * Anything we don't have is omitted.
 */
export function LocationLocalCard({ location: l, latestReview, onOpen, testId, withPhotos = true }: {
  location: LocationCardRow;
  latestReview?: LatestReview;
  onOpen: () => void;
  testId?: string;
  withPhotos?: boolean;
}) {
  const linked = !!l.gbpLocationName;
  const { data: media } = useQuery<{ items: { thumbnail_url?: string | null; google_url?: string | null; description?: string | null }[] }>({
    queryKey: [`/api/gbp/locations/${l.id}/media?source=business&limit=2`],
    enabled: withPhotos && linked && (l.businessPhotoCount ?? 0) > 0,
    staleTime: 5 * 60 * 1000,
  });
  const photos = (media?.items ?? [])
    .filter((m) => m.thumbnail_url || m.google_url)
    .map((m) => ({ src: (m.thumbnail_url || m.google_url)!, href: m.google_url ?? null, alt: m.description ?? "" }));

  // Open/closed: Google's own closed statuses first; otherwise the synced hours on the viewer's clock.
  let open: boolean | null = null, hours: string | null = null, closedLabel: string | undefined, statusTitle: string | undefined;
  if (linked && l.openStatus === "CLOSED_PERMANENTLY") { open = false; closedLabel = "Permanently closed"; }
  else if (linked && l.openStatus === "CLOSED_TEMPORARILY") { open = false; closedLabel = "Temporarily closed"; }
  else {
    const now = openNowFromHours(l.hours);
    if (now) { open = now.open; hours = now.hint; statusTitle = `Today: ${now.today} (judged on this device's clock)`; }
  }

  const address = fullAddress(l) || null;
  const maps = directionsUrl(l);
  const website = l.website && /^https?:\/\//i.test(l.website) ? l.website : l.website ? `https://${l.website}` : null;
  const snippet = latestReview?.comment?.trim();

  return (
    <GoogleLocalCard
      testId={testId}
      nameTestId={`text-location-name-${l.id}`}
      name={l.businessName}
      onOpen={onOpen}
      rating={linked ? l.avgRating : null}
      reviewCount={linked ? l.reviewCount : null}
      category={l.categories?.[0] ?? null}
      open={open}
      hours={hours}
      address={address}
      statusTitle={statusTitle}
      closedLabel={closedLabel}
      yearsInBusiness={yearsInBusiness(l.openingDate)}
      meta={linked ? "Synced from your Google Business Profile" : "Not linked to Google yet"}
      snippet={snippet ? { text: snippet.length > 160 ? `${snippet.slice(0, 160).trim()}…` : snippet, avatarSrc: latestReview?.reviewerPhotoUrl } : null}
      photos={photos}
      actions={<>
        {l.phone && <GooglePill icon={Phone} label="Call" href={`tel:${l.phone.replace(/[^\d+]/g, "")}`} testId={`button-call-location-${l.id}`} />}
        {maps && <GooglePill icon={Navigation} label="Directions" href={maps} external testId={`button-directions-location-${l.id}`} />}
        {website && <GooglePill icon={Globe} label="Website" href={website} external testId={`button-website-location-${l.id}`} />}
        {linked && <GooglePill icon={MessageSquare} label="Reviews" href={`/google-reviews?tab=profile-reviews&location=${l.id}`} testId={`button-reviews-location-${l.id}`} />}
        <GooglePill icon={Store} label="Open profile" onClick={onOpen} testId={`button-open-location-${l.id}`} />
      </>}
    />
  );
}
