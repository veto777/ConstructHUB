/**
 * Full-screen tools (owner, 2026-10-12: "create the same format for all other pages … to make this site look more
 * spiffy"): a tool listed in SHELLED_TOOLS renders inside the shared <ToolShell> with its own menu, and the app
 * sidebar is not shown (App.tsx). SEO keeps its own layout (components/seo-tool/layout.tsx), which this mirrors.
 *
 * To give a tool the shell: write its ToolShellConfig (one tool per view, each a real route of App.tsx) and add it
 * to SHELLED_TOOLS. The routes it claims are every tool `path`/`paths` and anything below them.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { CHLogo } from "@/components/ch-logo";
import { useSidebar } from "@/components/ui/sidebar";
import { ToolShell, type ToolShellConfig } from "@/components/tool/shell";
import { AllTools } from "@/components/seo-tool/layout";
import { socialNav } from "@/components/social-tool/nav";

export type ShelledTool = { nav: () => ToolShellConfig };
export const SHELLED_TOOLS: ShelledTool[] = [
  { nav: socialNav },
];

const owns = (config: ToolShellConfig, location: string) =>
  config.tools.some((t) => [t.path, ...(t.paths ?? [])].some((p) => location === p || location.startsWith(`${p}/`)));

/** The shelled tool an address belongs to, with its config (null: the page keeps the app sidebar). */
export function shelledToolFor(location: string): ToolShellConfig | null {
  for (const t of SHELLED_TOOLS) { const c = t.nav(); if (owns(c, location)) return c; }
  return null;
}

export function ProductToolLayout({ config, actions, banner, footer, children }: { config: ToolShellConfig; actions?: ReactNode; banner?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  const { setOpenMobile } = useSidebar();
  return (
    <ToolShell config={config} testId={`${config.key}-tool-shell`}
      brand={<Link href="/" aria-label="ConstructHUB home" title="ConstructHUB home" data-testid="link-tool-home"><CHLogo height={26} /></Link>}
      allToolsNote={`Everything else in ConstructHUB. ${config.label} stays where you left it.`} allTools={(close) => <AllTools close={close} />} onAllToolsPhone={() => setOpenMobile(true)}
      actions={actions} banner={banner} footer={footer}>
      {children}
    </ToolShell>
  );
}
