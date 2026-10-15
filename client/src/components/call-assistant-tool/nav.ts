/**
 * The AI Call Assistant as its own full-screen tool (owner, 2026-10-12: "create the same format for all other pages
 * like call assistant …"). Every view is a route under /call-assistant (signed in; signed out /call-assistant stays
 * the feature page); the panels are pages/crm-call-assistant`s own. Notifications still link ?tab=calls&call=<id> —
 * the page moves those to /call-assistant/calls?call=<id>.
 */
import { Bot, FlaskConical, LayoutDashboard, PhoneCall, PhoneIncoming } from "lucide-react";
import type { ToolNavCtx, ToolShellConfig } from "@/components/tool/shell";

export const CALL_ASSISTANT_VIEWS = ["overview", "calls", "numbers", "studio", "simulator"] as const;
export type CallAssistantView = (typeof CALL_ASSISTANT_VIEWS)[number];

export const CALL_ASSISTANT_VIEW_HEAD: Record<CallAssistantView, [string, string]> = {
  overview: ["Overview", "Is your assistant answering, what it did with this month's calls, and what to do next."],
  calls: ["Calls", "Every call it answered, with the outcome, a summary, the transcript and the recording."],
  numbers: ["Numbers", "The numbers your assistant answers, and how to forward your existing line to one."],
  studio: ["Agent studio", "Teach the assistant your business, choose its voice and questions, then publish."],
  simulator: ["Simulator", "Type a test call and read every decision before real callers hear it."],
};

/** The address of a view (extra query parameters kept: ?call=, ?view=, ?outcome=). */
export function callAssistantHref(view: CallAssistantView, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const s = p.toString();
  return `${view === "overview" ? "/call-assistant" : `/call-assistant/${view}`}${s ? `?${s}` : ""}`;
}

export function callAssistantViewOf(path: string, tab?: string | null): CallAssistantView {
  const seg = path.replace(/^\/call-assistant\/?/, "").split("/")[0];
  if ((CALL_ASSISTANT_VIEWS as readonly string[]).includes(seg)) return seg as CallAssistantView;
  if ((CALL_ASSISTANT_VIEWS as readonly string[]).includes(tab ?? "")) return tab as CallAssistantView;
  return "overview";
}

export function callAssistantNav(): ToolShellConfig {
  const tool = (key: CallAssistantView, label: string, icon: any, rail?: string) => ({
    key, label, rail, icon, path: key === "overview" ? "/call-assistant" : `/call-assistant/${key}`, to: (_c: ToolNavCtx) => callAssistantHref(key), groups: [],
  });
  return {
    key: "call-assistant", label: "Call Assistant",
    tools: [
      tool("overview", "Overview", LayoutDashboard),
      // Calls keeps its own Calls / Spam blocked / Escalations switch (it carries the live counts): no second menu here.
      tool("calls", "Calls", PhoneIncoming),
      tool("numbers", "Numbers", PhoneCall),
      tool("studio", "Agent studio", Bot, "Studio"),
      tool("simulator", "Simulator", FlaskConical),
    ],
  };
}
