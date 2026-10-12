/**
 * Competitor Intel in the full-screen format (owner, 2026-10-12). One view (market scans), so one rail item and no
 * sub-menu; the shell only drops the app sidebar and adds "All tools". Not registered when SHOW_COMPETITOR_INTEL is off.
 */
import { Swords } from "lucide-react";
import type { ToolShellConfig } from "@/components/tool/shell";

export function competitorsNav(): ToolShellConfig {
  return { key: "competitors", label: "Competitor Intel", tools: [{ key: "competitors", label: "Market scans", rail: "Scans", icon: Swords, path: "/competitors", to: () => "/competitors", groups: [] }] };
}
