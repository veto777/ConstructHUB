import { describe, expect, it } from "vitest";
// The à la carte tab on /pricing (client/src/components/alacarte-cards.tsx, client/src/pages/pricing.tsx): the
// price lines come from shared/alacarte.ts, the tab opens from /pricing#alacarte, the checkout's return
// flags are handled, and nothing types a price. Pure helpers + source guards (the pricing-copy tests' pattern).
import fs from "fs";
import path from "path";
import { alacartePriceNote } from "../client/src/components/alacarte-cards";
import { ALACARTE_KEYS, alacartePriceCents } from "@shared/alacarte";
import { formatUsd } from "@shared/plan-copy";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("the à la carte price line", () => {
  it("signed out or without a plan: the standalone price, then the add-on price for any plan", () => {
    expect(alacartePriceNote("gbp", "standalone", "month", false)).toBe("or $24/mo per location as an add-on to any plan");
    expect(alacartePriceNote("reviews", "standalone", "month", true)).toBe("or $39/mo as an add-on to any plan");
    expect(alacartePriceNote("reviews", "standalone", "year", false)).toBe(`${formatUsd(Math.round(alacartePriceCents("reviews", "standalone", "year") / 12))}/mo billed yearly · or ${formatUsd(alacartePriceCents("reviews", "addon", "year"))}/yr as an add-on to any plan`);
    // Overlapping add-ons quote the existing add-on's price.
    expect(alacartePriceNote("seo_basic", "standalone", "month", false)).toBe("or $29/mo as an add-on to any plan");
    expect(alacartePriceNote("click_guard", "standalone", "month", false)).toBe("or $15/mo per website as an add-on to any plan");
  });

  it("on a plan: the add-on price alone, and why", () => {
    expect(alacartePriceNote("gridrank", "addon", "month", true)).toBe("the add-on price, because you have a plan · save $29 on yearly billing");
    expect(alacartePriceNote("gridrank", "addon", "year", true)).toBe(`${formatUsd(Math.round(alacartePriceCents("gridrank", "addon", "year") / 12))}/mo billed yearly · the add-on price, because you have a plan`);
    for (const k of ALACARTE_KEYS) expect(alacartePriceNote(k, "addon", "month", true)).not.toMatch(/undefined|NaN/);
  });
});

describe("the tab on /pricing", () => {
  const pricing = read("client/src/pages/pricing.tsx");
  const cards = read("client/src/components/alacarte-cards.tsx");

  it("is the third tab, opens from #alacarte, handles the checkout's return flags, and keeps the two existing tabs", () => {
    expect(pricing).toContain('{ key: "business", label: "Business Tools", testId: "tab-business" }');
    expect(pricing).toContain('{ key: "crm", label: "CRM (Customer Relations Management)", testId: "tab-crm" }');
    expect(pricing).toContain('{ key: "alacarte", label: "À la carte", testId: "tab-alacarte" }');
    expect(pricing).toContain('TAB_BY_HASH: Partial<Record<string, PricingTab>> = { crm: "crm", alacarte: "alacarte" }');
    expect(pricing).toContain('<AlacarteCards interval={interval} signedIn={!!user} />');
    expect(pricing).toContain('role="tabpanel" id="alacarte"');
    expect(pricing).toContain('params.get("alacarte_success")');
    expect(pricing).toContain('params.get("alacarte_canceled")');
    // The Business Tools and CRM panels are untouched.
    expect(pricing).toContain('<div id="plans" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5 scroll-mt-16">');
    expect(pricing).toContain('<div className="mt-10"><CrmPlanCards interval={interval} signedIn={!!user} /></div>');
    expect(pricing).toContain('id="call-assistant"');
  });

  it("the cards read every price from shared/alacarte.ts, buy through POST /api/alacarte/checkout, and link each tool's Compare page", () => {
    expect(cards).toContain('apiRequest("POST", "/api/alacarte/checkout", body)');
    expect(cards).toContain('queryKey: ["/api/alacarte/me"]');
    expect(cards).toContain("href={`/features/${it.slug}`}");
    expect(cards).toContain("alacartePriceCents(key, tier, interval)");
    expect(cards).toContain("ALACARTE_LINKED.map");
    expect(cards).toContain("ALACARTE_ADDON_ONLY.map");
    // "Active" for a tool the account holds; "Included in your plan" for one the plan covers; the CRM gate for JobCam.
    for (const label of ["Active", "Included in your plan", "Choose a CRM plan first", "Update payment"]) expect(cards).toContain(label);
    expect(cards).not.toMatch(/\$\s?\d/);
    expect(cards).not.toMatch(/SignalWire/);
    // Signed out, the Buy button goes to sign-in and back to the tab.
    expect(cards).toContain("#alacarte`)}`)");
  });
});
