/**
 * The per-org bid headline (shared/bid-headline.ts): the banner every estimate
 * opens with, above the scopes and the line items. Pure normalisation, the
 * email block, the client-page banner rendered to markup, the signed-contract
 * PDF, and source guards that each client-facing surface puts it FIRST — and
 * that an org without one gets nothing new.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BID_HEADLINE_SUBLINE_MAX,
  BID_HEADLINE_TITLE_MAX,
  WARRANTY_ANCHOR,
  bidHeadlineEmailHtml,
  bidHeadlineFromCustomFields,
  normalizeBidHeadline,
} from "@shared/bid-headline";
import { BidHeadlineBanner } from "@/components/bid-headline-banner";
import { buildContractPdf, type ContractPdfInput } from "./contract-pdf";

const root = path.resolve(import.meta.dirname, "../..");
const src = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const HEADLINE = {
  title: "The only company with a test workmanship warranty",
  subline: "Limited: covers our installation for the life of the product. See warranty terms.",
};

describe("normalizeBidHeadline / bidHeadlineFromCustomFields", () => {
  it("is null for an org without one — missing, blank, or malformed", () => {
    expect(bidHeadlineFromCustomFields(null)).toBeNull();
    expect(bidHeadlineFromCustomFields({})).toBeNull();
    expect(bidHeadlineFromCustomFields({ themeColor: "blue" })).toBeNull();
    expect(bidHeadlineFromCustomFields({ bidHeadline: null })).toBeNull();
    expect(bidHeadlineFromCustomFields({ bidHeadline: "just a string" })).toBeNull();
    expect(bidHeadlineFromCustomFields({ bidHeadline: { title: "   ", subline: "orphan subline" } })).toBeNull();
    expect(bidHeadlineFromCustomFields({ bidHeadline: { title: 42 } })).toBeNull();
  });

  it("keeps the title and subline, trimmed and on one line", () => {
    expect(bidHeadlineFromCustomFields({ bidHeadline: HEADLINE })).toEqual(HEADLINE);
    expect(normalizeBidHeadline({ title: "  Big\n claim ", subline: "  limits\n\nhere " }))
      .toEqual({ title: "Big claim", subline: "limits here" });
    expect(normalizeBidHeadline({ title: "Claim", subline: "  " })).toEqual({ title: "Claim", subline: null });
    expect(normalizeBidHeadline({ title: "Claim" })).toEqual({ title: "Claim", subline: null });
  });

  it("caps the lengths at the limits the route validates", () => {
    const h = normalizeBidHeadline({ title: "x".repeat(500), subline: "y".repeat(900) })!;
    expect(h.title).toHaveLength(BID_HEADLINE_TITLE_MAX);
    expect(h.subline).toHaveLength(BID_HEADLINE_SUBLINE_MAX);
  });
});

describe("bidHeadlineEmailHtml", () => {
  it("prints the title, the subline and a link to the warranty section", () => {
    const html = bidHeadlineEmailHtml(HEADLINE, { accentHex: "#2563eb", warrantyHref: "https://x.test/e/tok?k=p#warranty" });
    expect(html).toContain(HEADLINE.title);
    expect(html).toContain(HEADLINE.subline);
    expect(html).toContain('href="https://x.test/e/tok?k=p#warranty"');
    expect(html).toContain("Read the full warranty");
    expect(html).toContain("border:2px solid #2563eb");
  });

  it("has no warranty link when the estimate has no warranty text, and escapes HTML", () => {
    const html = bidHeadlineEmailHtml({ title: "<b>A & B</b>", subline: null }, { accentHex: "not-a-hex" });
    expect(html).not.toContain("Read the full warranty");
    expect(html).toContain("&lt;b&gt;A &amp; B&lt;/b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).toContain("border:2px solid #F97316"); // bad accent → brand orange
  });
});

describe("BidHeadlineBanner (client estimate page)", () => {
  const render = (headline: unknown, hasWarranty: boolean) =>
    renderToStaticMarkup(createElement(BidHeadlineBanner, { headline, hasWarranty }));

  it("renders nothing for an org without a headline", () => {
    expect(render(null, true)).toBe("");
    expect(render(undefined, true)).toBe("");
    expect(render({ title: "" }, true)).toBe("");
  });

  it("renders the claim, the disclosure line under it, and the jump to #warranty", () => {
    const html = render(HEADLINE, true);
    expect(html).toContain('data-testid="bid-headline"');
    expect(html).toContain(HEADLINE.title);
    expect(html).toContain(HEADLINE.subline);
    expect(html.indexOf(HEADLINE.title)).toBeLessThan(html.indexOf(HEADLINE.subline));
    expect(html).toContain(`href="#${WARRANTY_ANCHOR}"`);
  });

  it("drops the warranty link when there is no warranty to jump to", () => {
    expect(render(HEADLINE, false)).not.toContain(`href="#${WARRANTY_ANCHOR}"`);
  });
});

/** pdfkit's subset-font text, decoded in order (see contract-pdf.test.ts). */
function pdfText(pdf: Buffer): string {
  const s = pdf.toString("latin1");
  let out = "";
  for (const m of s.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    for (const h of m[1].matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(h[1], "hex").toString("latin1");
    out += "\n";
  }
  return out.replace(/\s+/g, " ");
}

const PDF_INPUT: ContractPdfInput = {
  branding: { name: "Headline Test Co" },
  orgName: "Headline Test Co",
  customer: { displayName: "Pat Client" },
  estimate: {
    number: "E-77", title: "Exterior repaint",
    subtotalCents: 1000_00, discountCents: 0, taxCents: 0, totalCents: 1000_00,
    approvedTotalCents: 1000_00, signatureName: "Pat Client",
  },
  items: [{ name: "Paint the house", quantityMilli: 1000, unitPriceCents: 1000_00, lineTotalCents: 1000_00 }],
  options: [{ name: "Premium scope", description: "Two coats", totalCents: 1000_00 }],
  terms: "Standing terms here.",
  warrantyText: "Workmanship warranty body text.",
};

describe("signed-contract PDF", () => {
  it("opens with the headline banner — before the options and the line items — and links to a Warranty section", async () => {
    const pdf = await buildContractPdf({ ...PDF_INPUT, bidHeadline: HEADLINE }, { compress: false });
    const t = pdfText(pdf);
    const at = (needle: string) => { const i = t.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
    expect(at("only company with a test")).toBeLessThan(at("PREPARED FOR"));
    expect(at("PREPARED FOR")).toBeLessThan(at("Premium scope"));
    expect(at("Premium scope")).toBeLessThan(at("Paint the house"));
    expect(at("for the life of the product")).toBeLessThan(at("PREPARED FOR"));
    expect(at("See the Warranty section")).toBeLessThan(at("PREPARED FOR"));
    expect(at("Workmanship warranty body text.")).toBeLessThan(at("Standing terms here."));
    // The in-document link and its target.
    const raw = pdf.toString("latin1");
    expect(raw).toMatch(/\/Dests/);
    expect(raw).toContain("(warranty)");
  });

  it("is unchanged for an org without a headline — no banner, no extra warranty section", async () => {
    const pdf = await buildContractPdf({ ...PDF_INPUT, bidHeadline: null }, { compress: false });
    const t = pdfText(pdf);
    expect(t).not.toContain("See the Warranty section");
    expect(t).not.toContain("Workmanship warranty body text.");
    expect(t).toContain("Standing terms here.");
  });
});

describe("every client-facing bid opens with it (source guards)", () => {
  it("the estimate page renders the banner after the title, before the scopes and the document", () => {
    const page = src("client/src/pages/public-estimate.tsx");
    const banner = page.indexOf("<BidHeadlineBanner headline={company.bidHeadline}");
    expect(banner).toBeGreaterThan(page.indexOf('data-testid="text-estimate-for"'));
    expect(banner).toBeLessThan(page.indexOf('data-testid="options-checklist"'));
    expect(banner).toBeLessThan(page.indexOf('data-testid="estimate-document"'));
    expect(page).toContain("id={WARRANTY_ANCHOR}");
  });

  it("the public payload, the estimate email and the contract PDF carry the org's headline", () => {
    const portal = src("server/crm/portal.ts");
    expect(portal).toContain("bidHeadline: bidHeadlineFromCustomFields(org.customFields),");
    // Email: the block sits right under the title, before the greeting.
    const title = portal.indexOf("Approve Estimate${est.number");
    const block = portal.indexOf("${headlineHtml}");
    expect(block).toBeGreaterThan(title);
    expect(block).toBeLessThan(portal.indexOf("<p style=\"font-size:16px\">Hi ${esc(cust.displayName)},</p>"));
    expect(portal).toMatch(/warrantyText: estimateDocText\(est, org\)\.warrantyText,\s*bidHeadline: bidHeadlineFromCustomFields/);
  });

  it("Settings saves it through PATCH /api/crm/org, merged into custom_fields and removed when blank", () => {
    const routes = src("server/crm/routes.ts");
    expect(routes).toMatch(/bidHeadline: z\.object\(\{\s*title: z\.string\(\)\.max\(BID_HEADLINE_TITLE_MAX\)/);
    expect(routes).toContain("if (h) base.bidHeadline = h; else delete base.bidHeadline;");
    const settings = src("client/src/pages/crm-settings.tsx");
    expect(settings).toContain('data-testid="input-bid-headline"');
    expect(settings).toContain('data-testid="textarea-bid-headline-subline"');
    expect(settings).toMatch(/bidHeadline: defaults\.headlineTitle\.trim\(\)/);
  });
});
