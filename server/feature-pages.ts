/**
 * GET /api/admin/feature-pages — the admin index of every feature intro page
 * (/admin/feature-pages): title, group, stub/ready status, the public page and
 * the in-app page, plus the hand-built pages (/call-assistant, the home
 * landing). Platform admins only (server/admin.ts — the same check behind the
 * sidebar's "Account Manager · ADMIN" entry): 401 signed out, 403 for anyone
 * else. The pages themselves are public; this list is the admins' map of them.
 */
import type { Express } from "express";
import { FEATURE_CATALOGUE, FEATURE_GROUPS, FEATURE_PAGES, FEATURES_PATH, featurePageByKey } from "@shared/feature-pages";
import { isPlatformAdmin } from "./admin";

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

export function adminFeaturePageRows(): { catalogue: string; pages: AdminFeaturePageRow[]; counts: { ready: number; stub: number } } {
  const label = new Map(FEATURE_GROUPS.map((g) => [g.key as string, g.label]));
  const pages: AdminFeaturePageRow[] = FEATURE_CATALOGUE.map((e) => {
    const page = featurePageByKey(e.key);
    return {
      key: e.key, group: e.group, groupLabel: label.get(e.group) ?? e.group, title: e.title, status: e.status, path: e.path,
      app: e.app, legacyPath: page?.legacyPath ?? null, sources: page?.sources ?? [],
    };
  });
  // The marketing home (signed-in visitors reach it at /landing; / is their dashboard).
  pages.push({
    key: "landing", group: "site", groupLabel: "Site", title: "Home landing page", status: "page", path: "/landing",
    app: null, legacyPath: null, sources: ["client/src/pages/landing.tsx"],
  });
  return {
    catalogue: FEATURES_PATH,
    pages,
    counts: {
      ready: FEATURE_PAGES.filter((p) => p.status === "ready").length,
      stub: FEATURE_PAGES.filter((p) => p.status === "stub").length,
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
