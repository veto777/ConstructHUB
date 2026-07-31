import { expect, type Page, type Response } from "@playwright/test";

/** Network and console failures collected while a page does its thing. */
export interface PageGuards {
  consoleErrors: string[];
  pageErrors: string[];
  badResponses: string[];
  assertClean: (context?: string) => void;
}

const BENIGN_CONSOLE = [
  "Failed to load resource", // network 4xx/5xx are tracked via badResponses
  "Download the React DevTools",
  "favicon",
  "A PostCSS plugin",
  "[vite] connected",
];

/** Endpoints where a 4xx is the designed behaviour for the state under test. */
const EXPECTED_4XX: RegExp[] = [
  /\/api\/crm\/invitations\/lookup\//, // join page with a bogus/expired token
  /\/api\/crm\/invitations\/accept/, // accept while signed in as a different email → 403 by design
  /\/api\/public\/(estimates|invoices|portal)\/not-a-real-token/, // deliberate bogus-token probes
  /\/api\/client\/documents/, // 401 IS the signed-out state on the client portal
];

/** Designed 503s: online payment without a Stripe account is a friendly
 *  "not set up yet", rendered as a toast — not a crash. */
const EXPECTED_503: RegExp[] = [
  /\/api\/public\/estimates\/[^/]+\/pay/,
  /\/api\/public\/invoices\/[^/]+\/pay/,
];

export function watchPage(page: Page): PageGuards {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const badResponses: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (BENIGN_CONSOLE.some((b) => text.includes(b))) return;
    consoleErrors.push(text);
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("response", (r: Response) => {
    const url = r.url();
    if (!url.includes("/api/")) return;
    const s = r.status();
    if (s >= 500 && !(s === 503 && EXPECTED_503.some((re) => re.test(url)))) {
      badResponses.push(`${s} ${url}`);
    } else if (s >= 400 && s < 500 && !EXPECTED_4XX.some((re) => re.test(url))) {
      badResponses.push(`${s} ${url}`);
    }
  });
  // confirm()/alert() are part of real flows (e.g. Void invoice) — accept them.
  page.on("dialog", (d) => void d.accept().catch(() => {}));

  return {
    consoleErrors,
    pageErrors,
    badResponses,
    assertClean(context = "") {
      const where = context ? ` (${context})` : "";
      expect(pageErrors, `uncaught page errors${where}`).toEqual([]);
      expect(consoleErrors, `console errors${where}`).toEqual([]);
      expect(badResponses, `bad API responses${where}`).toEqual([]);
    },
  };
}

/** Navigate and wait until the SPA has settled past its loading spinner. */
export async function gotoCrm(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

export const ORGS = {
  alpine: "1e3050c1-3cfd-4d9b-ba5a-1c19ce074897", // Alpine Exteriors Test
  aspire: "b839980a-ad26-44d4-9e83-df427bd60fe8", // Aspire Interiors (seeded demo)
};

/**
 * The demo data lives in the Aspire org while the session defaults to Alpine.
 * Org choice is stored server-side in the session, and page.request shares the
 * browser context's cookies, so one POST pins every later navigation.
 */
export async function switchOrg(page: Page, orgId: string) {
  const r = await page.request.post("/api/crm/org/switch", { data: { orgId } });
  if (!r.ok()) throw new Error(`org switch failed: ${r.status()} ${await r.text()}`);
}

const SWEEP_SELECTOR =
  'main button:visible:enabled, main a:visible, header button:visible:enabled, header a:visible' +
  // The CRM's nav moved from the top bar into the shadcn sidebar — sweep it too.
  ', [data-slot="sidebar"] a:visible, [data-slot="sidebar"] button:visible:enabled';

/**
 * Guarded every-button sweep: click each visible, enabled button and link on
 * the page exactly once, reloading fresh between clicks so one control can
 * never mask another. Each iteration clicks the first not-yet-clicked
 * candidate, so lists that change after a mutation (dismiss, delete) can't
 * silently skip a control. Asserts no crash, no console errors, no bad API
 * responses; dialogs/menus get dismissed, navigations must render something.
 */
export async function sweepPage(
  page: Page,
  url: string,
  opts: {
    ready: string; // selector proving the page finished loading
    skip?: (info: { testid: string; text: string; href: string }) => boolean;
    beforeEach?: (page: Page) => Promise<void>;
    maxClicks?: number;
  },
): Promise<{ clicked: number; labels: string[] }> {
  const guards = watchPage(page);
  const seen = new Set<string>();
  const labels: string[] = [];

  for (let iter = 0; iter < (opts.maxClicks ?? 80); iter++) {
    await gotoCrm(page, url);
    await expect(page.locator(opts.ready).first()).toBeVisible({ timeout: 15_000 });
    if (opts.beforeEach) await opts.beforeEach(page);

    const els = page.locator(SWEEP_SELECTOR);
    const n = await els.count();
    let target = -1;
    let info = { testid: "", text: "", href: "" };
    for (let i = 0; i < n; i++) {
      const el = els.nth(i);
      const testid = (await el.getAttribute("data-testid")) ?? "";
      const text = ((await el.innerText().catch(() => "")) ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
      const href = (await el.getAttribute("href")) ?? "";
      const key = testid || (text || href ? `${text}|${href}` : `anon#${i}`);
      if (seen.has(key)) continue;
      seen.add(key);
      info = { testid, text, href };
      // Logout is verified curated in 14-crm-settings — clicking it mid-sweep
      // destroys the shared dev session (and the org pin with it), breaking
      // every later iteration. The client portal's own sign-out (curated in
      // 15-client-portal) gets the same treatment.
      if (testid === "button-logout" || testid === "button-client-logout") { target = -1; continue; }
      if (opts.skip?.(info)) { target = -1; continue; }
      target = i;
      break;
    }
    if (target === -1) {
      // Either everything was clicked or the rest were skipped. If the last
      // unseen item was skipped, keep scanning; otherwise we're done.
      const anyUnseenLeft = await (async () => {
        for (let i = 0; i < n; i++) {
          const el = els.nth(i);
          const testid = (await el.getAttribute("data-testid")) ?? "";
          const text = ((await el.innerText().catch(() => "")) ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
          const href = (await el.getAttribute("href")) ?? "";
          const key = testid || (text || href ? `${text}|${href}` : `anon#${i}`);
          if (!seen.has(key)) return true;
        }
        return false;
      })();
      if (!anyUnseenLeft) break;
      continue;
    }

    const el = els.nth(target);
    try {
      await el.click({ timeout: 5_000 });
    } catch {
      guards.consoleErrors.push(`sweep: control [${info.testid || info.text}] was not clickable`);
      continue;
    }
    labels.push(info.testid || info.text || info.href);
    await page.waitForTimeout(700);

    // Whatever opened — dialog, menu, select listbox — must also close.
    for (let attempt = 0; attempt < 3; attempt++) {
      const overlay = page.locator(
        '[role="dialog"]:visible, [role="menu"]:visible, [role="listbox"]:visible, [role="alertdialog"]:visible',
      );
      if (!(await overlay.first().isVisible().catch(() => false))) break;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
      if (await overlay.first().isVisible().catch(() => false)) {
        await page.mouse.click(4, 4);
        await page.waitForTimeout(250);
      }
    }

    // A navigation must land on a page that renders content.
    await expect(page.locator("body")).not.toBeEmpty();
  }

  guards.assertClean(`sweep ${url}`);
  return { clicked: labels.length, labels };
}

/** Create a throwaway customer + one-line estimate through the real API;
 *  returns ids and the public token (read from the DB). */
export async function makeEstimate(
  page: Page,
  opts: { name?: string; unitPriceCents?: number } = {},
): Promise<{ customerId: string; estimateId: string; token: string }> {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const cust = await page.request.post("/api/crm/customers", {
    data: { displayName: opts.name ?? `E2E Public ${stamp}`, email: `e2e-${stamp}@example.com` },
  });
  if (!cust.ok()) throw new Error(`create customer: ${cust.status()} ${await cust.text()}`);
  const customer = await cust.json();

  const est = await page.request.post("/api/crm/estimates", {
    data: {
      customerId: customer.id,
      title: "E2E throwaway estimate",
      introText: "Created by the click-through suite.",
      taxRateBps: 0,
      items: [{
        kind: "labor", name: "E2E line item", description: null, unit: null,
        quantityMilli: 1000, unitPriceCents: opts.unitPriceCents ?? 123_45,
        taxable: true, hiddenFromClient: false, sortOrder: 0,
      }],
    },
  });
  if (!est.ok()) throw new Error(`create estimate: ${est.status()} ${await est.text()}`);
  const estimate = await est.json();

  const rows = await import("./db").then((m) =>
    m.q<{ public_token: string }>(`select public_token from crm_estimates where id = $1`, [estimate.id]));
  return { customerId: customer.id, estimateId: estimate.id, token: rows[0].public_token };
}
