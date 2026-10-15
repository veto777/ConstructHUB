/**
 * The real logo of every third-party company the app names (owner, 2026-10-13: "make sure all company references
 * has their logos everywhere as reference. It looks better and easier to see what is what"). One place, so a
 * brand looks the same in the sidebar, a tool rail, a page header, a connection card and a settings row.
 * Logos come from Simple Icons / Font Awesome (react-icons); the colours are each brand's own.
 */
import type { IconType } from "react-icons";
import type { LucideIcon } from "lucide-react";
import { FaGoogle, FaYoutube, FaYelp } from "react-icons/fa6";
import { SiCloudflare, SiDropbox, SiGoogleads, SiGoogleanalytics, SiGooglesearchconsole, SiHouzz, SiQuickbooks, SiStripe, SiZapier } from "react-icons/si";
import { NETWORK_ICON } from "@/components/social-week";

export const BRAND: Record<string, { icon: IconType; color: string; name: string }> = {
  cloudflare: { icon: SiCloudflare, color: "#F38020", name: "Cloudflare" },
  search_console: { icon: SiGooglesearchconsole, color: "#458CF5", name: "Google Search Console" },
  google_ads: { icon: SiGoogleads, color: "#4285F4", name: "Google Ads" },
  google_analytics: { icon: SiGoogleanalytics, color: "#E37400", name: "Google Analytics" },
  google: { icon: FaGoogle, color: "#4285F4", name: "Google" },
  google_business: { icon: FaGoogle, color: "#4285F4", name: "Google Business Profile" },
  stripe: { icon: SiStripe, color: "#635BFF", name: "Stripe" },
  yelp: { icon: FaYelp, color: "#FF1A1A", name: "Yelp" },
  youtube: { icon: FaYoutube, color: "#FF0000", name: "YouTube" },
  quickbooks: { icon: SiQuickbooks, color: "#2CA01C", name: "QuickBooks" },
  zapier: { icon: SiZapier, color: "#FF4F00", name: "Zapier" },
  houzz: { icon: SiHouzz, color: "#4DBC15", name: "Houzz" },
  dropbox: { icon: SiDropbox, color: "#0061FF", name: "Dropbox" },
  // The social networks share the same table (social-week.tsx), so "facebook" works here too.
  ...NETWORK_ICON,
};

export type Brand = keyof typeof BRAND;

/** The logo on its own, in the brand's colour. `className` sizes it (default 1rem). */
export function BrandIcon({ brand, className = "h-4 w-4", title }: { brand: string; className?: string; title?: string }) {
  const b = BRAND[brand];
  if (!b) return null;
  return <b.icon className={`${className} shrink-0`} style={{ color: b.color }} aria-label={title ?? b.name} role="img" />;
}

/** A logo component for places that take one (the tool rail, the sidebar, a page header's icon): `brandIcon("cloudflare")`. */
export const brandIcon = (brand: string): LucideIcon => {
  const Icon = ({ className }: { className?: string }) => <BrandIcon brand={brand} className={className ?? "h-5 w-5"} />;
  Icon.displayName = `BrandIcon(${brand})`;
  // The props the rail and headers pass (className, strokeWidth, aria-hidden) are all optional on our side.
  return Icon as unknown as LucideIcon;
};

/** Logo + name, for a row or a line of text. */
export function BrandBadge({ brand, label, className = "", iconClassName = "h-4 w-4" }: { brand: string; label?: string; className?: string; iconClassName?: string }) {
  return <span className={`inline-flex items-center gap-1.5 ${className}`}><BrandIcon brand={brand} className={iconClassName} /><span>{label ?? BRAND[brand]?.name ?? brand}</span></span>;
}
