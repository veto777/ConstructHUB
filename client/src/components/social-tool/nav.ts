/**
 * Social Media as its own tool (owner, 2026-10-12: "the sidebar with all features should vanish when accessing this
 * like SEO SUITE"). Every view is a route under /social-media; the chosen
 * business (?business=) carries from view to view. The views are pages/social-media.tsx`s own sections.
 */
import { BarChart3, BookOpenText, Bot, CalendarDays, FileText, Inbox, LayoutDashboard, PenSquare, Users } from "lucide-react";
import type { ToolNavCtx, ToolShellConfig } from "@/components/tool/shell";

export const SOCIAL_VIEWS = ["overview", "calendar", "compose", "posts", "analytics", "inbox", "accounts", "auto", "guides"] as const;
export type SocialView = (typeof SOCIAL_VIEWS)[number];

/** The address of a view, keeping the chosen business. */
export function socialHref(view: SocialView, business?: string | null, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (business) p.set("business", business);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const s = p.toString();
  return `${view === "overview" ? "/social-media" : `/social-media/${view}`}${s ? `?${s}` : ""}`;
}

/** The view an address is on; the old ?tab= links (compose, queue, auto, guides) land on their new views. */
export function socialViewOf(path: string, tab?: string | null): SocialView {
  const seg = path.replace(/^\/social-media\/?/, "").split("/")[0];
  if ((SOCIAL_VIEWS as readonly string[]).includes(seg)) return seg as SocialView;
  if (tab === "queue") return "posts";
  if (path === "/social-media" && typeof window !== "undefined" && /[?&](session|connected|connect_error|youtube)=/.test(window.location.search)) return "accounts";
  if (tab === "compose" || tab === "auto" || tab === "guides") return tab;
  return "overview";
}

const keep = (view: SocialView, extra: Record<string, string> = {}) => (c: ToolNavCtx) => socialHref(view, c.params.get("business"), extra);
const POST_STATES: [string, string][] = [["", "All posts"], ["draft", "Drafts"], ["queued", "Scheduled"], ["published", "Published"], ["failed", "Failed"]];

export function socialNav(): ToolShellConfig {
  const tool = (key: SocialView, label: string, icon: any, rail?: string, foot?: boolean) => ({
    key, label, rail, icon, foot, path: key === "overview" ? "/social-media" : `/social-media/${key}`, to: keep(key), groups: [],
  });
  return {
    key: "social", label: "Social Media",
    tools: [
      tool("overview", "Overview", LayoutDashboard),
      tool("calendar", "Calendar", CalendarDays),
      tool("compose", "New post", PenSquare),
      { ...tool("posts", "Posts", FileText), groups: [{ key: "state", items: POST_STATES.map(([state, label]) => ({ key: state || "all", label, to: keep("posts", { state }), params: state ? { state } : undefined })) }] },
      tool("analytics", "Analytics", BarChart3),
      tool("inbox", "Inbox", Inbox),
      tool("accounts", "Accounts", Users),
      tool("auto", "Auto mode", Bot, "Auto"),
      tool("guides", "Guides", BookOpenText, undefined, true),
    ],
  };
}
