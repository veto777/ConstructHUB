/**
 * The Social Media tool shell: under /social-media the app sidebar is not rendered (owner, 2026-10-12, "like SEO
 * SUITE"); the generic <ToolShell> carries the views from ./nav.ts and "All tools" lists the rest of ConstructHUB.
 * The page puts its business switcher in the bar`s second row (<ToolBarSlot>).
 */
import { useMemo, type ReactNode } from "react";
import { Link } from "wouter";
import { CHLogo } from "@/components/ch-logo";
import { useSidebar } from "@/components/ui/sidebar";
import { ToolShell } from "@/components/tool/shell";
import { AllTools } from "@/components/seo-tool/layout";
import { socialNav } from "./nav";

export function SocialToolLayout({ actions, banner, footer, children }: { actions?: ReactNode; banner?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  const { setOpenMobile } = useSidebar();
  const config = useMemo(() => socialNav(), []);
  return (
    <ToolShell config={config} testId="social-tool-shell"
      brand={<Link href="/" aria-label="ConstructHUB home" title="ConstructHUB home" data-testid="link-tool-home"><CHLogo height={26} /></Link>}
      allToolsNote="Everything else in ConstructHUB. Social Media stays where you left it." allTools={(close) => <AllTools close={close} />} onAllToolsPhone={() => setOpenMobile(true)}
      actions={actions} banner={banner} footer={footer}>
      {children}
    </ToolShell>
  );
}
