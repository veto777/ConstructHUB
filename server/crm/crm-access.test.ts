/**
 * The pure halves of the CRM role gates — no server, no database:
 *   - the menu rules (shared/crm-access.ts, shared/tab-bar.ts): which pages a
 *     seat is offered and which deep links show "ask your admin";
 *   - the central helpers in tenancy.ts (stripMoney, grantExceedsOwn,
 *     requireAnyPermission);
 *   - the audit sentences (activity.ts): labels, never column names.
 * The API itself is walked route by route in role-gates.test.ts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { CRM_PERMISSIONS, CRM_ROLES, crmEffectivePermissions, type CrmPermission } from "@shared/schema";
import {
  CRM_ESTIMATES_MENU, CRM_PAGE_RULES, CRM_PERMISSION_LABELS, crmHasAny, crmPageRefusal, crmPermissionPhrase,
} from "@shared/crm-access";
import { CRM_TAB_DEFAULT, CRM_TAB_OPTIONS, resolveTabs, tabAllowed } from "@shared/tab-bar";

// tenancy.ts / activity.ts import the db module; no query runs here.
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";

let stripMoney: any, grantExceedsOwn: any, requireAnyPermission: any, activityText: any;
beforeAll(async () => {
  ({ stripMoney, grantExceedsOwn, requireAnyPermission } = await import("./tenancy"));
  ({ activityText } = await import("./activity"));
});

const ctx = (role: string, overrides: Partial<Record<CrmPermission, boolean>> | null = null) => ({
  org: { id: "org-1" }, member: { id: "mem-1", role },
  permissions: crmEffectivePermissions(role, overrides),
});
const res = () => {
  const r: any = { code: 0, body: null };
  r.status = (c: number) => { r.code = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
};

describe("menus and deep links follow the seat's permissions", () => {
  const field = crmEffectivePermissions("field", null);
  const owner = crmEffectivePermissions("owner", null);

  it("every permission has a label, and every page rule names real permissions", () => {
    for (const p of CRM_PERMISSIONS) expect(CRM_PERMISSION_LABELS[p]).toBeTruthy();
    for (const r of CRM_PAGE_RULES) for (const p of r.anyOf) expect(CRM_PERMISSIONS).toContain(p);
  });

  it("a field tech is refused the pages the report named — and nothing a crew needs", () => {
    for (const p of ["/crm/pricebook", "/crm/payments", "/crm/estimates/new", "/crm/invoices", "/crm/inbox", "/crm/settings", "/crm/integrations", "/crm/migrate"]) {
      expect(crmPageRefusal(p, field), p).not.toBeNull();
    }
    for (const p of ["/", "/crm", "/crm/clients", "/crm/clients/abc", "/crm/pipeline", "/crm/projects/abc", "/crm/projects/abc/jobcam", "/crm/schedule", "/crm/jobcam", "/crm/team", "/crm/estimates/abc"]) {
      expect(crmPageRefusal(p, field), p).toBeNull();
    }
    // A query string or hash does not get around the rule.
    expect(crmPageRefusal("/crm/pricebook?tab=materials", field)).not.toBeNull();
    expect(crmPageRefusal("/crm/estimates/new#x", field)).not.toBeNull();
  });

  it("owners and admins are refused nothing", () => {
    for (const r of CRM_PAGE_RULES) {
      const path = r.match.source.replace(/\\\//g, "/").replace(/^\^/, "").replace(/\(\/\|\$\)$/, "");
      expect(crmPageRefusal(path, owner), path).toBeNull();
      expect(crmPageRefusal(path, crmEffectivePermissions("admin", null)), path).toBeNull();
    }
  });

  it("one switch opens exactly its pages: field + See prices gets the price book, not New estimate", () => {
    const seat = crmEffectivePermissions("field", { seePrices: true });
    expect(crmPageRefusal("/crm/pricebook", seat)).toBeNull();
    expect(crmPageRefusal("/crm/payments", seat)).toBeNull();
    expect(crmPageRefusal("/crm/estimates/new", seat)?.title).toBe("New estimate");
    expect(crmHasAny(seat, CRM_ESTIMATES_MENU)).toBe(true);
    expect(crmHasAny(field, CRM_ESTIMATES_MENU)).toBe(false);
  });

  it("the ask-your-admin card names the switch as the Team page labels it", () => {
    expect(crmPermissionPhrase(["seePrices"])).toBe("“See prices”");
    expect(crmPermissionPhrase(["manageCustomers", "manageEstimates", "manageInvoices"]))
      .toBe("“Manage clients”, “Create and send estimates” or “Create and send invoices”");
  });

  it("the phone tab bar never offers a field tech Estimates, New estimate, Price book or Payments", () => {
    const can = (o: (typeof CRM_TAB_OPTIONS)[number]) => tabAllowed(o, field);
    const offered = CRM_TAB_OPTIONS.filter(can).map((o) => o.key);
    expect(offered).toEqual(["home", "schedule", "clients", "pipeline", "jobcam", "team", "reports"]);
    // Even a saved choice made under another role is filtered, and the bar stays full.
    const tabs = resolveTabs(["new-estimate", "pricebook", "payments", "estimates"], CRM_TAB_OPTIONS, CRM_TAB_DEFAULT, can);
    expect(tabs).toHaveLength(4);
    for (const t of tabs) expect(offered).toContain(t.key);
    // While /api/crm/me is still loading nothing is hidden (strict=false) — and nothing is shown strictly.
    expect(tabAllowed(CRM_TAB_OPTIONS.find((o) => o.key === "pricebook")!, undefined, false)).toBe(true);
    expect(tabAllowed(CRM_TAB_OPTIONS.find((o) => o.key === "pricebook")!, undefined)).toBe(false);
  });
});

describe("central helpers (tenancy.ts)", () => {
  const row = { id: "x", name: "Roof", totalCents: 100, unitCostCents: 60 };
  const keys = { price: ["totalCents"], cost: ["unitCostCents"] };

  it("stripMoney removes the keys — absent, not zero — per the two money switches", () => {
    expect(stripMoney(ctx("owner"), row, keys)).toEqual(row);
    expect(stripMoney(ctx("pm"), row, keys)).toEqual({ id: "x", name: "Roof", totalCents: 100 });
    const blind = stripMoney(ctx("field"), row, keys);
    expect(blind).toEqual({ id: "x", name: "Roof" });
    expect("totalCents" in blind).toBe(false);
    expect(stripMoney(ctx("field", { seePrices: true }), row, keys)).toEqual({ id: "x", name: "Roof", totalCents: 100 });
    // The original row is never mutated.
    expect(row.unitCostCents).toBe(60);
  });

  it("requireAnyPermission answers 403 only when none of the permissions is held", () => {
    const ok = res();
    expect(requireAnyPermission(ok, ctx("pm"), ["manageSettings", "manageJobs"])).toBe(true);
    expect(ok.code).toBe(0);
    const no = res();
    expect(requireAnyPermission(no, ctx("field"), ["manageSettings", "manageJobs"])).toBe(false);
    expect(no.code).toBe(403);
  });

  it("grantExceedsOwn: owners and admins hand out any role; a delegate only what they hold", () => {
    for (const role of CRM_ROLES) {
      expect(grantExceedsOwn(ctx("owner"), role, null)).toBeNull();
      expect(grantExceedsOwn(ctx("admin"), role, { exportData: true })).toBeNull();
    }
    const delegate = ctx("field", { manageTeam: true });
    expect(grantExceedsOwn(delegate, "field", null)).toBeNull();
    expect(grantExceedsOwn(delegate, "subcontractor", { manageTeam: true })).toBeNull();
    expect(grantExceedsOwn(delegate, "field", { seePrices: true })).toBe("seePrices");
    expect(grantExceedsOwn(delegate, "admin", null)).toBeTruthy();
    expect(grantExceedsOwn(delegate, "office", null)).toBeTruthy();
    // An office delegate may add another office seat, not a sales seat (costs, price book).
    const office = ctx("office", { manageTeam: true });
    expect(grantExceedsOwn(office, "office", null)).toBeNull();
    expect(grantExceedsOwn(office, "sales", null)).toBeTruthy();
  });
});

describe("audit sentences read as words", () => {
  const say = (action: string, meta: Record<string, unknown> = {}) => activityText({ actorLabel: "Dana", action, meta });

  it("member changes use labels, never column names, and spell out access changes", () => {
    expect(say("member.updated", { name: "Marco", fields: ["hourlyCostCents"] }))
      .toBe("Dana updated Marco's account (cost rate)");
    expect(say("member.updated", {
      name: "Marco", fields: ["role", "permissions", "divisionId"],
      role: { from: "field", to: "office" },
      permissionChanges: [{ key: "seePrices", on: true }, { key: "exportData", on: false }],
    })).toBe("Dana updated Marco's account (role field → office; turned on “See prices”; turned off “Export client data (CSV)”; division)");
    expect(say("member.updated", { name: "Marco", fields: ["status"], status: { from: "active", to: "disabled" } }))
      .toBe("Dana updated Marco's account (seat turned off)");
    expect(say("member.removed", { name: "Marco" })).toBe("Dana removed Marco from the team");
    // Rows written before this change (fields only) still read cleanly.
    expect(say("member.updated", { name: "Marco", fields: ["permissions", "smsConsent"] }))
      .toBe("Dana updated Marco's account (permissions, text-message consent)");
    expect(say("customer.updated", { fields: ["addressLine1", "postalCode", "someNewFieldCents"] }))
      .toBe("Dana updated client details (address, ZIP, some new field)");
  });

  it("sending, reminding, receipts, reversals, payment links, price book and settings each have a sentence", () => {
    expect(say("estimate.sent", { number: "E-1001", to: "kane@example.com", emailed: true, texted: true }))
      .toBe("Dana sent estimate E-1001 to kane@example.com by email and text");
    expect(say("estimate.sent", { number: "E-1001", to: "kane@example.com", emailed: true, resend: true }))
      .toBe("Dana sent estimate E-1001 to kane@example.com by email (resent)");
    expect(say("estimate.reminded", { number: "E-1001", to: "kane@example.com" })).toBe("Dana sent a reminder about estimate E-1001 to kane@example.com");
    expect(say("estimate.extended", { number: "E-1001", days: 7 })).toBe("Dana extended estimate E-1001 by 7 days");
    expect(say("invoice.sent", { number: "INV-1001", to: "kane@example.com", emailed: true })).toBe("Dana sent invoice INV-1001 to kane@example.com by email");
    expect(say("receipt.sent", { number: "INV-1001", to: "kane@example.com" })).toBe("Dana sent a payment receipt for invoice INV-1001 to kane@example.com");
    expect(say("payment.reversed", { number: "INV-1001", amountCents: 100000, reason: "typed $1,000 instead of $100" }))
      .toBe("Dana reversed a $1,000.00 payment on invoice INV-1001 — typed $1,000 instead of $100");
    expect(say("payment.link.created", { number: "INV-1001", amountCents: 250000 })).toBe("Dana created a $2,500.00 payment link for invoice INV-1001");
    expect(say("payment.link.created", { number: "E-1001", amountCents: 50000, kind: "estimate" })).toBe("Dana created a $500.00 payment link for estimate E-1001");
    expect(say("changeorder.created", { number: "CO-101", title: "Rotted decking" })).toBe("Dana created change order CO-101 (Rotted decking)");
    expect(say("changeorder.sent", { number: "CO-101" })).toBe("Dana sent change order CO-101 to the client");
    expect(say("pricebook.updated", { change: "updated", what: "material", name: "Shingles" })).toBe("Dana updated price book material Shingles");
    expect(say("pricebook.updated", { change: "created", name: "Roof tear-off" })).toBe("Dana created price book item Roof tear-off");
    expect(say("pricebook.adjusted", { field: "price", count: 42, percent: 7 })).toBe("Dana adjusted price book prices on 42 materials by +7%");
    expect(say("pricebook.floor_lock", { enabled: true })).toBe("Dana turned the price-floor lock on");
    expect(say("settings.updated", { fields: ["defaultTaxRateBps", "termsAndConditions"], labels: { defaultTaxRateBps: "default sales tax", termsAndConditions: "terms and conditions" } }))
      .toBe("Dana updated company settings (default sales tax, terms and conditions)");
    expect(say("jobcam.media.added", { kind: "video" })).toBe("Dana added a video to JobCam");
    expect(say("jobcam.share.sent", { to: "kane@example.com", channel: "email" })).toBe("Dana sent a JobCam share link to kane@example.com by email");
  });

  it("an action without its own sentence still reads as words, never as a key", () => {
    expect(say("some.new_action")).toBe("Dana some new action");
  });
});
