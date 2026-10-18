/**
 * Google Reviews as its own full-screen tool (owner, 2026-10-12: "create the same format for all other pages like
 * call assistant, GOogle Reviews … more spiffy"). Every view is a route under /google-reviews; the sections are
 * pages/google-reviews.tsx`s own. Old ?tab=profile-reviews links land on Google reviews.
 */
import { MessageSquareText, Send, Settings2, Store } from "lucide-react";
import type { ToolNavCtx, ToolShellConfig } from "@/components/tool/shell";

export const REVIEWS_VIEWS = ["requests", "reviews", "profiles", "settings"] as const;
export type ReviewsView = (typeof REVIEWS_VIEWS)[number];

export const REVIEWS_VIEW_HEAD: Record<ReviewsView, [string, string]> = {
  requests: ["Review requests", "Hear it first. Set the score that comes to you privately; everything above it goes straight to Google."],
  reviews: ["Google reviews", "Read and reply to the reviews on your Google Business Profiles."],
  profiles: ["Profiles & links", "Each Google Business Profile gets its own review link. Other review sites are listed here too."],
  settings: ["Settings", "Which ratings reach Google and your other review sites, the sites themselves, and when reminders are sent."],
};

/** The address of a view (extra query parameters kept, e.g. ?location= for Google reviews). */
export function reviewsHref(view: ReviewsView, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const s = p.toString();
  return `${view === "requests" ? "/google-reviews" : `/google-reviews/${view}`}${s ? `?${s}` : ""}`;
}

export function reviewsViewOf(path: string, tab?: string | null): ReviewsView {
  const seg = path.replace(/^\/google-reviews\/?/, "").split("/")[0];
  if ((REVIEWS_VIEWS as readonly string[]).includes(seg)) return seg as ReviewsView;
  if (tab === "profile-reviews") return "reviews";
  return "requests";
}

const keepLocation = (view: ReviewsView) => (c: ToolNavCtx) => reviewsHref(view, view === "reviews" ? { location: c.params.get("location") ?? "" } : {});

export function reviewsNav(): ToolShellConfig {
  const tool = (key: ReviewsView, label: string, icon: any, rail?: string, foot?: boolean) => ({
    key, label, rail, icon, foot, path: key === "requests" ? "/google-reviews" : `/google-reviews/${key}`, to: keepLocation(key), groups: [],
  });
  return {
    key: "google-reviews", label: "Google Reviews",
    tools: [
      tool("requests", "Review requests", Send, "Requests"),
      tool("reviews", "Google reviews", MessageSquareText, "Reviews"),
      tool("profiles", "Profiles & links", Store, "Profiles"),
      tool("settings", "Settings", Settings2, undefined, true),
    ],
  };
}
