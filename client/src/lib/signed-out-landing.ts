/**
 * Where a signed-out visitor who opens a tool's URL lands: that feature's landing page, with its sign-up
 * (owner, 2026-10-25: "each page should have a landing page that's visible to potential clients … all features
 * should have a sign up area landing page with all the details"). Before this, a signed-out /press-releases was a
 * 404 and every other tool URL went straight to the sign-in form, which a potential client can't use.
 *
 * Order: a path with its own entry below, then the tool's access rule (lib/tool-access.ts, the landing a locked
 * account sees), then the feature page whose in-app link the path is under. null = an account page (Settings,
 * admin) with nothing to sell: App.tsx keeps sending those to sign in.
 */
import { FEATURE_PAGES, featurePagePath } from "@shared/feature-pages";
import { toolRuleFor } from "./tool-access";

/** Tools with no access rule and no feature page of their own path. */
const OWN_LANDING: Record<string, string> = {
  "/tutorials": "/features/guides",
  "/listings": "/features/gbp",
  "/my-reputation": "/reputation",
};

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

export function signedOutLanding(url: string): string | null {
  const path = url.split(/[?#]/)[0];
  for (const [base, landing] of Object.entries(OWN_LANDING)) if (under(path, base)) return landing;
  const ruled = toolRuleFor(path)?.landing;
  if (ruled) return ruled;
  // The deepest feature page whose in-app link this path sits under (/seo/keywords → the SEO Suite page).
  const page = FEATURE_PAGES
    .filter((p) => p.app.surface === "app" && p.app.href !== "/" && under(path, p.app.href.split(/[?#]/)[0]))
    .sort((a, b) => b.app.href.length - a.app.href.length)[0];
  return page ? featurePagePath(page) : null;
}
