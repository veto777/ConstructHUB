/**
 * Every route App.tsx declares has its own browser-tab title (audit w3-r6): a growth-app route is in
 * client/src/lib/page-titles.ts APP_PAGE_TITLES or has the server-written marketing title (shared/route-meta.ts),
 * a CRM portal route is in CRM_PAGE_TITLES — or it is listed below with the reason it has none. Static: reads
 * App.tsx's <Route path="…"> declarations, no browser.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { APP_PAGE_TITLES, CRM_PAGE_TITLES, CRM_BRAND, appPageTitle, crmPageTitle } from "@/lib/page-titles";
import { CRM_NAME } from "@/lib/site";
import { pageMetaFor } from "@shared/route-meta";

const APP_SRC = fs.readFileSync(path.resolve(import.meta.dirname, "../client/src/App.tsx"), "utf8");

/** The <Route path="…"> values inside one router function of App.tsx. */
function routesOf(fn: string): string[] {
  const start = APP_SRC.indexOf(`function ${fn}(`);
  expect(start, `App.tsx has no function ${fn}`).toBeGreaterThan(-1);
  const end = APP_SRC.indexOf("\n}\n", start);
  return [...new Set([...APP_SRC.slice(start, end).matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]))];
}

/** Token pages a homeowner opens: each titles itself from its document (or keeps the neutral default). */
const TOKEN_PAGES = ["/e/:token", "/i/:token", "/co/:token", "/jc/:token", "/lead-form/:token", "/portal/:token", "/review/:token", "/review/:token/unsubscribe", "/contract/sign/:token"];
/** Legal pages title themselves (pages/crm-legal.tsx, data-deletion.tsx). */
const SELF_TITLED_LEGAL = ["/crm-terms", "/crm-privacy", "/data-deletion"];

const APP_EXEMPT: Record<string, string> = {
  ...Object.fromEntries(TOKEN_PAGES.map((p) => [p, "client-facing token page"])),
  ...Object.fromEntries(SELF_TITLED_LEGAL.map((p) => [p, "legal page titles itself"])),
  "/listings": "redirect to /directories",
  "/admin/listings": "redirect to /admin/directories",
  "/individual-pricing": "redirect to /pricing",
  "/settings/billing": "redirect into /settings",
  "/settings/api": "redirect into /settings",
  "/features/:slug": "feature page titles itself from its seo.title (and has route-meta)",
  "/done-for-you/:slug": "done-for-you page titles itself from its seo.title (and has route-meta)",
  "/google-ads-landing": "marketing ad landing page",
  "/permits-landing": "marketing ad landing page",
  "/competitors-landing": "marketing ad landing page",
  "/master-class-landing": "marketing ad landing page",
  "/googleads-features": "Google Ads landing alias of /features",
  "/googleads-crm": "Google Ads landing page",
  "/googleads-pricing": "Google Ads landing alias of /pricing",
};

const CRM_EXEMPT: Record<string, string> = {
  ...Object.fromEntries(["/e/:token", "/i/:token", "/co/:token", "/jc/:token", "/lead-form/:token", "/portal/:token"].map((p) => [p, "client-facing token page"])),
  "/crm-terms": "legal page titles itself", "/crm-privacy": "legal page titles itself",
  "/crm/call-assistant": "redirect to constructhub.us/call-assistant",
  "/call-assistant": "redirect to constructhub.us/call-assistant",
};

describe("page titles: every route has its own", () => {
  const appRoutes = routesOf("DashboardRouter");
  const crmRoutes = routesOf("PortalRouter");

  it("reads a realistic number of routes from App.tsx", () => {
    expect(appRoutes.length).toBeGreaterThan(100);
    expect(crmRoutes.length).toBeGreaterThan(25);
  });

  it("every growth-app route has a title entry, a route-meta title, or a listed reason", () => {
    const missing = appRoutes.filter((p) => !APP_PAGE_TITLES[p] && !pageMetaFor(p) && !APP_EXEMPT[p]);
    expect(missing).toEqual([]);
  });

  it("every CRM portal route has a title entry or a listed reason", () => {
    const missing = crmRoutes.filter((p) => !CRM_PAGE_TITLES[p] && !CRM_EXEMPT[p]);
    expect(missing).toEqual([]);
  });

  it("no stale entries: every titled or exempted route is still declared", () => {
    expect(Object.keys(APP_PAGE_TITLES).filter((p) => !appRoutes.includes(p))).toEqual([]);
    expect(Object.keys(CRM_PAGE_TITLES).filter((p) => !crmRoutes.includes(p))).toEqual([]);
    expect(Object.keys(APP_EXEMPT).filter((p) => !appRoutes.includes(p))).toEqual([]);
    expect(Object.keys(CRM_EXEMPT).filter((p) => !crmRoutes.includes(p))).toEqual([]);
  });

  it("no two growth-app routes share a title (a sub-page never wears its tool's title)", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const [p, t] of Object.entries(APP_PAGE_TITLES)) {
      if (seen.has(t)) dupes.push(`${seen.get(t)} + ${p}: ${t}`);
      else seen.set(t, p);
    }
    expect(dupes).toEqual([]);
  });

  it("composes '<Page> · <Tool> · ConstructHUB', resolving :params and deeper links", () => {
    expect(appPageTitle("/seo/alerts")).toBe("Alerts · SEO Suite · ConstructHUB");
    expect(appPageTitle("/social-media/inbox?x=1")).toBe("Inbox · Social Media · ConstructHUB");
    expect(appPageTitle("/seo")).toBe("SEO Suite · ConstructHUB");
    expect(appPageTitle("/admin/tickets/42")).toBe("Support ticket · Admin · ConstructHUB");
    expect(appPageTitle("/gbp-photos")).toBe("Photos · Posts & Photos · ConstructHUB");
    expect(appPageTitle("/yelp")).toBe("Yelp · ConstructHUB");
    expect(appPageTitle("/no-such-page")).toBeUndefined();
  });

  it("CRM pages are '<Page> · ConstructHub CRM'; an unknown CRM path is Home (that is what renders)", () => {
    expect(CRM_BRAND).toBe(CRM_NAME);
    expect(crmPageTitle("/crm/clients")).toBe("Clients · ConstructHub CRM");
    expect(crmPageTitle("/crm/clients/12")).toBe("Client · ConstructHub CRM");
    expect(crmPageTitle("/crm/estimates/new")).toBe("New estimate · Estimates · ConstructHub CRM");
    expect(crmPageTitle("/crm/projects/7/jobcam")).toBe("Project photos · JobCam · ConstructHub CRM");
    expect(crmPageTitle("/crm/jobcam/capture")).toBe("JobCam · ConstructHub CRM");
    expect(crmPageTitle("/crm/nowhere")).toBe("Home · ConstructHub CRM"); // unknown CRM routes render Home
    expect(crmPageTitle("/elsewhere")).toBe(CRM_BRAND);
  });
});
