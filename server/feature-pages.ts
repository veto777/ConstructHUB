/**
 * GET /api/admin/feature-pages — the admin index of every feature intro page
 * (/admin/feature-pages): title, group, stub/ready status, the public page and
 * the in-app page, then every done-for-you service page as a second group
 * (shared/dfy-pages), plus the hand-built pages (/call-assistant,
 * /reinstatement, the home landing). Platform admins only (server/admin.ts — the same check behind the
 * sidebar's "Account Manager · ADMIN" entry): 401 signed out, 403 for anyone
 * else. The pages themselves are public; this list is the admins' map of them.
 */
import type { Express } from "express";
import { FEATURE_CATALOGUE, FEATURE_GROUPS, FEATURE_PAGES, FEATURES_PATH, featurePageByKey } from "@shared/feature-pages";
import { DFY_CATALOGUE, DFY_PAGES, DFY_PATH, dfyPageByKey } from "@shared/dfy-pages";
import { isPlatformAdmin } from "./admin";

/** The admin index's group for the done-for-you services. */
export const DFY_ADMIN_GROUP = { key: "dfy", label: "Done-For-You Services" } as const;

export type AdminFeaturePageRow = {
  key: string;
  group: string;
  groupLabel: string;
  title: string;
  status: "stub" | "ready" | "external" | "page";
  /** The public intro page. */
  path: string;
  /** The feature inside the app ("portal" = on the CRM host). */
  app: { href: string; surface: "app" | "portal" } | null;
  /** A retired landing page this one replaces (redirects once "ready"). */
  legacyPath: string | null;
  sources: string[];
};

type Counts = { ready: number; stub: number };

export function adminFeaturePageRows(): {
  catalogue: string;
  /** The done-for-you catalogue page. */
  services: string;
  pages: AdminFeaturePageRow[];
  /** Feature pages written / still stubs. */
  counts: Counts;
  /** Service pages written / still stubs. */
  serviceCounts: Counts;
} {
  const label = new Map(FEATURE_GROUPS.map((g) => [g.key as string, g.label]));
  const pages: AdminFeaturePageRow[] = FEATURE_CATALOGUE.map((e) => {
    const page = featurePageByKey(e.key);
    return {
      key: e.key, group: e.group, groupLabel: label.get(e.group) ?? e.group, title: e.title, status: e.status, path: e.path,
      app: e.app, legacyPath: page?.legacyPath ?? null, sources: page?.sources ?? [],
    };
  });
  // The second group: every done-for-you service (no in-app page — it's work our team does).
  for (const e of DFY_CATALOGUE) {
    pages.push({
      key: e.key, group: DFY_ADMIN_GROUP.key, groupLabel: DFY_ADMIN_GROUP.label, title: e.title, status: e.status, path: e.path,
      app: null, legacyPath: null, sources: dfyPageByKey(e.key)?.sources ?? ["client/src/pages/reinstatement.tsx"],
    });
  }
  // The marketing home (signed-in visitors reach it at /landing; / is their dashboard).
  pages.push({
    key: "landing", group: "site", groupLabel: "Site", title: "Home landing page", status: "page", path: "/landing",
    app: null, legacyPath: null, sources: ["client/src/pages/landing.tsx"],
  });
  return {
    catalogue: FEATURES_PATH,
    services: DFY_PATH,
    pages,
    counts: {
      ready: FEATURE_PAGES.filter((p) => p.status === "ready").length,
      stub: FEATURE_PAGES.filter((p) => p.status === "stub").length,
    },
    serviceCounts: {
      ready: DFY_PAGES.filter((p) => p.status === "ready").length,
      stub: DFY_PAGES.filter((p) => p.status === "stub").length,
    },
  };
}

export function registerFeaturePageRoutes(app: Express): void {
  app.get("/api/admin/feature-pages", (req, res) => {
    const user = (req as any).user;
    if (!user) return void res.status(401).json({ message: "Not authenticated" });
    if (!isPlatformAdmin(user)) return void res.status(403).json({ message: "Platform admin access required" });
    res.setHeader("Cache-Control", "private, no-store");
    res.json(adminFeaturePageRows());
  });
}
