/**
 * The console/network audit fixes (W3-R5, 2026-10-15): pages must not fire requests that can only fail, and every
 * dialog must be described for screen readers. Static source checks (the project's pattern for UI contracts that
 * need no browser), plus the one pure server helper.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { signInConfigured } from "./cloudflare/routes";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("CRM billing card", () => {
  const card = read("client/src/components/crm-billing-card.tsx");
  it("shows Manage billing only when a CRM subscription exists in Stripe (the portal 400s without a customer)", () => {
    expect(card).toMatch(/\{sub\?\.hasStripeSubscription && \(\s*<Button[^>]*data-testid="button-crm-manage-billing"/);
  });
  it("keeps 'Choose a CRM plan' as the action without one, and nothing at all in the iPhone apps", () => {
    expect(card).toContain('"Choose a CRM plan"');
    expect(card).toContain("if (inNativeApp()) return null;");
  });
  it("the subscription summary reports the flag", () => {
    expect(read("server/crm/billing.ts")).toContain("hasStripeSubscription: Boolean(row?.stripe_subscription_id)");
  });
});

describe("analytics tracker", () => {
  const src = read("client/src/components/cookie-consent.tsx");
  it("goes quiet after a 429 until Retry-After passes, across reloads", () => {
    expect(src).toContain("if (Date.now() < pausedUntil) return;");
    expect(src).toContain("r.status !== 429");
    expect(src).toContain('r.headers.get("retry-after")');
    expect(src).toContain("sessionStorage.setItem(PAUSE_KEY");
    // sendBeacon cannot read the response, so it could never back off.
    expect(src).not.toContain("sendBeacon(");
  });
});

describe("Cloudflare / Search Console connect", () => {
  it("signInConfigured follows each provider's own credentials", () => {
    expect(signInConfigured("gsc", {} as NodeJS.ProcessEnv)).toBe(false);
    expect(signInConfigured("gsc", { GOOGLE_CLIENT_ID: "x" } as NodeJS.ProcessEnv)).toBe(false);
    expect(signInConfigured("gsc", { GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "y" } as NodeJS.ProcessEnv)).toBe(true);
    expect(signInConfigured("cloudflare", {} as NodeJS.ProcessEnv)).toBe(false);
  });
  it("the connections list reports it and both connect routes use it", () => {
    expect(read("server/cloudflare/routes.ts")).toContain("signInConfigured: signInConfigured(provider)");
    expect(read("server/cloudflare/routes.ts")).toContain('if (!signInConfigured("cloudflare")) throw');
    expect(read("server/gsc/routes.ts")).toContain('if (!signInConfigured("gsc"))');
  });
  it("the page disables both buttons with a plain sentence instead of sending a request that 503s", () => {
    const page = read("client/src/pages/site-connections.tsx");
    expect(page).toContain("const signInOff = config.data?.signInConfigured === false;");
    expect(page.match(/disabled=\{busy \|\| signInOff\}/g)?.length).toBe(2);
    expect(page).toContain('data-testid="text-cloudflare-signin-off"');
    expect(page).toContain('data-testid="text-search-console-signin-off"');
  });
});

describe("client page", () => {
  it("loads the message thread only after the client itself resolved", () => {
    const src = read("client/src/pages/crm-client.tsx");
    expect(src).toMatch(/queryKey: \[`\/api\/crm\/inbox\/\$\{id\}`\],\s*enabled: !!id && !!data && canManageCustomers/);
  });
});

describe("/admin on the app host", () => {
  const app = read("client/src/App.tsx");
  it("redirects to the portal host's /admin, signed in or out, without a reload loop on the portal", () => {
    expect(app).toContain('<Route path="/admin" component={PortalAdminRedirect} />');
    expect(app).toContain('if (location === "/admin") return <PortalAdminRedirect />;');
    expect(app).toContain("portalUrl(`/admin${window.location.search}`)");
    expect(app).toMatch(/if \(\/\^https\?:\\\/\\\/\/\.test\(target\)\) window\.location\.replace\(target\)/);
  });
});

describe("every dialog and sheet is described", () => {
  // Content components whose title/description live in a child component mounted inside them.
  const DESCRIBED_BY_CHILD = new Set([
    "client/src/pages/crm-client.tsx:dialog-edit-appointment", // AppointmentForm
    "client/src/pages/crm-schedule.tsx:dialog-appointment", // AppointmentForm
    "client/src/pages/crm-pipeline.tsx:dialog-edit-project", // EditProjectDialog
  ]);
  const PAIRS: [string, string][] = [
    ["DialogContent", "DialogDescription"],
    ["SheetContent", "SheetDescription"],
    ["AlertDialogContent", "AlertDialogDescription"],
    ["DrawerContent", "DrawerDescription"],
  ];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (rel !== "client/src/components/ui") walk(rel); }
      else if (e.name.endsWith(".tsx")) files.push(rel);
    }
  };
  walk("client/src");

  it("has a Description or an explicit aria-describedby={undefined}", () => {
    const missing: string[] = [];
    for (const file of files) {
      const src = read(file);
      for (const [content, description] of PAIRS) {
        for (const m of src.matchAll(new RegExp(`<${content}\\b`, "g"))) {
          const open = src.slice(m.index!, src.indexOf(">", m.index!) + 1);
          const close = src.indexOf(`</${content}>`, m.index!);
          const body = src.slice(m.index!, close < 0 ? undefined : close);
          if (open.includes("aria-describedby") || new RegExp(`<${description}\\b`).test(body)) continue;
          const testId = open.match(/data-testid="([^"]+)"/)?.[1];
          if (testId && DESCRIBED_BY_CHILD.has(`${file}:${testId}`)) continue;
          missing.push(`${file}:${src.slice(0, m.index!).split("\n").length}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("the child components that carry a dialog's header describe it", () => {
    expect(read("client/src/components/crm-appointment-form.tsx")).toContain("<DialogDescription>");
    expect(read("client/src/pages/crm-pipeline.tsx")).toMatch(/<DialogTitle>Edit project<\/DialogTitle><DialogDescription>/);
  });
});
