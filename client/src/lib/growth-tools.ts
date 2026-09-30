/**
 * The growth-platform toolkit shown on the dashboard home. The marketing pages
 * count tools from this same list, so "N Pro Tools" is the same number
 * everywhere (it used to read 12 on the landing page and 15+ on home).
 */
import {
  Search, Database, Building2, Camera, Eye, Grid3X3, Shield,
  ShieldOff, Fingerprint, Crosshair, GraduationCap, Megaphone,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SHOW_COMPETITOR_INTEL } from "@/lib/features";

export interface ToolShowcase {
  title: string;
  tagline: string;
  description: string;
  whyItMatters: string;
  icon: LucideIcon;
  url: string;
  stats?: string;
}

const TOOLS: ToolShowcase[] = [
  {
    title: "Permit Database Search",
    tagline: "Spot new permits before your competitors do",
    description: "Search permit records on the county and city portals we can query directly, and find the permit office for any jurisdiction in our directory — all 50 states and DC.",
    whyItMatters: "While your competitors wait for word of mouth, you're identifying new construction projects as permits are filed. Every permit is a warm lead — a homeowner who already committed to spending money on construction.",
    icon: Search,
    url: "/search",
  },
  {
    title: "Database Directory",
    tagline: "Permit offices across America, organized by state",
    description: "Browse county and city permit offices organized by state. A portal link appears once we've found it and checked it — otherwise you get a search shortcut, never a guessed URL.",
    whyItMatters: "No more Googling for hours trying to find where a county keeps its permits. Unconfirmed links are labeled with their last check, and where no link is on record you get a search shortcut instead of a guess.",
    icon: Database,
    url: "/databases",
  },
  {
    title: "Property Records",
    tagline: "Know the property before you knock on the door",
    description: "Find the county assessor or property appraiser office for a property, with a link to its official records site where we've checked one. Look up ownership, values, and assessment history there.",
    whyItMatters: "When you know a property's value, square footage, and owner before making contact, you walk in with confidence. You can tailor your pitch, estimate accurately, and close faster because you already did your homework.",
    icon: Building2,
    url: "/property",
  },
  {
    title: "GMB Monitor",
    tagline: "See what changed on your Google profile",
    description: "Check your Google Business Profile against Google on demand and keep a history of every change a check finds — name, address, photos, hours, categories. Includes an AI-powered review response generator that crafts professional replies in seconds.",
    whyItMatters: "Google can change your business profile without telling you. Anyone can suggest edits. One wrong change to your hours or address and you lose customers without knowing why. Run a check to see what changed.",
    icon: Eye,
    url: "/gmb-monitor",
  },
  {
    title: "GMB Ranking Grid",
    tagline: "See exactly where you rank on Google Maps",
    description: "Generate visual ranking grid reports showing your Google Business position across your entire service area. Track how you rank for specific keywords at every point in your coverage zone.",
    whyItMatters: "You might rank #1 at your office but #15 two miles away. Most contractors have no idea their rankings drop off a cliff outside their immediate area. This tool shows you the blind spots so you can fix them.",
    icon: Grid3X3,
    url: "/ranking-grid",
  },
  {
    title: "SEO Photo Optimizer",
    tagline: "Job site photos, ready to post",
    description: "Watermark, rename, geotag and describe your job photos in one batch. Google strips EXIF on upload, so geotags don't promise a ranking benefit.",
    whyItMatters: "Consistent names, captions and watermarks keep your photos organized and branded wherever you post them.",
    icon: Camera,
    url: "/photos",
  },
  {
    title: "Google Click Guard",
    tagline: "Stop competitors from draining your ad budget",
    description: "Review script-observed visits and unusual traffic patterns. Build an IP exclusion list and apply it with the separate Google Ads script; signals do not prove fraud or identify a person.",
    whyItMatters: "Some ad clicks come from bots, competitors, or people who will never hire you. For construction companies spending thousands a month on ads, even a small share adds up. Use observed traffic patterns to investigate possible waste; detection and savings are not guaranteed.",
    icon: Shield,
    url: "/google-ads",
  },
  {
    title: "IP Tracker",
    tagline: "Understand script-observed website visits",
    description: "Real-time visitor tracking with device fingerprinting, geo-location, traffic source analysis, browser/OS detection, and detailed visitor activity timelines. A modern replacement for TraceMyIP, built for contractors.",
    whyItMatters: "Your website is your digital storefront. Knowing who visits, where they came from, and what pages they viewed gives you intelligence most contractors never have.",
    icon: Fingerprint,
    url: "/ip-tracker",
  },
  {
    title: "VPN Shield",
    tagline: "Review possible proxy traffic",
    description: "Flag possible proxy traffic using browser reports and a limited IP-prefix list. Optional page overlays or redirects run after load and can be bypassed.",
    whyItMatters: "VPN use can be legitimate, and heuristic signals can produce false positives. User-agent crawler exemptions are not identity verification.",
    icon: ShieldOff,
    url: "/vpn-shield",
  },
  {
    title: "Competitor Intelligence",
    tagline: "Understand your local market",
    description: "Research public Google Business profiles in your market, find signals worth a closer look in sampled reviews with our BS Meter, and run market scans to benchmark your own presence.",
    whyItMatters: "Knowing where you stand in your market helps you invest in the right things. Public business listings and selected review samples provide context. The BS Meter highlights signals worth a closer look; it cannot establish review authenticity.",
    icon: Crosshair,
    url: "/competitors",
  },
  {
    title: "Master Class",
    tagline: "The complete guide to building a construction business",
    description: "State-by-state guides for LLC formation, licensing, bonding, and insurance. Plus expert modules on subcontractor management, sales strategies, hiring, branding, website & SEO, and vetting other contractors.",
    whyItMatters: "Starting a construction business without proper licensing, bonding, or insurance can get you fined, sued, or shut down. Every state has different rules. This is the playbook that shows you exactly what to do in your state, step by step.",
    icon: GraduationCap,
    url: "/master-class",
  },
  {
    title: "Google Ads Master Class",
    tagline: "Stop wasting money on Google Ads",
    description: "12 detailed sections covering everything from campaign setup to click fraud protection. Learn which Google features to avoid, how to write ads that convert, proper bidding strategies, and the costly mistakes most contractors make.",
    whyItMatters: "Bad settings, the wrong keywords, and features Google turns on by default can waste a large share of a contractor's ad budget. This guide was written by someone who's managed millions in construction ad spend.",
    icon: Megaphone,
    url: "/google-ads-guide",
  },
];

/** The tools currently offered (feature flags applied). */
export const GROWTH_TOOLS: ToolShowcase[] = TOOLS.filter(
  (tool) => SHOW_COMPETITOR_INTEL || tool.title !== "Competitor Intelligence",
);
