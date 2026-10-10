/**
 * A signed-in account that lacks a tool and lands on the tool's URL (a
 * bookmark, a link, the address bar) gets the tool's landing page — the case
 * for adding it on or moving up — instead of the tool's own 402 card (owner,
 * 2026-10-10). The decision is lib/tool-access.ts, the same rules the sidebar
 * uses, with the same "never a wrong lock" escapes: loading, platform admins
 * and members of another owner's workspace all fall through to the tool.
 *
 * Not in the iPhone apps: the landing pages sell things (App Store 3.1.3(f)),
 * so there the tool renders and says it is not on the account (AppLocked).
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { inNativeApp } from "@/lib/app-shell";
import { lockedFeatureSlug, toolAccess, type ToolAccessContext } from "@/lib/tool-access";
import type { EntitlementsInfo } from "@/lib/pricing-display";
import { featurePageBySlug } from "@shared/feature-pages";
import { FeatureLanding, featureVisible } from "@/components/feature-landing/feature-landing";

export function ToolRouteGate({ location, children }: { location: string; children: ReactNode }) {
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const { data: entitlements } = useQuery<EntitlementsInfo | null>({ queryKey: ["/api/entitlements"], enabled: !!user });
  const { data: agencyMe } = useQuery<{ owner?: number; actor?: number; teamEntitled?: boolean } | null>({ queryKey: ["/api/agency/me"], enabled: !!user });
  const { data: crmSub } = useQuery<{ access?: { active?: boolean } } | null>({ queryKey: ["/api/crm/billing/subscription"], enabled: !!user });
  if (!user || inNativeApp()) return <>{children}</>;
  const ctx: ToolAccessContext = {
    entitlements,
    agencyMember: !!agencyMe && typeof agencyMe.owner === "number" && typeof agencyMe.actor === "number" && agencyMe.owner !== agencyMe.actor,
    agencyWorkspace: agencyMe ? agencyMe.teamEntitled === true : undefined,
    crmActive: crmSub ? crmSub.access?.active === true : undefined,
  };
  if (toolAccess(location, ctx) !== "locked") return <>{children}</>;
  const slug = lockedFeatureSlug(location);
  const page = slug ? featurePageBySlug(slug) : undefined;
  if (!page || !featureVisible(page.flag)) return <>{children}</>;
  return <FeatureLanding key={page.slug} page={page} />;
}
