import { describe, expect, it } from "vitest";
import { perItem } from "@shared/media-inbox";
import { keepQuotedPrices, parseDecision, parsePrices } from "./ai";
import { supportSkip } from "./guard";
import { htmlToPlain, inboundBody } from "./mailbox";

// EIN Presswire's answer on support@ (2026-10-14), the email that sat unseen.
const EIN = `On pricing, EIN Presswire is a pay-as-you-go platform...
* $999: 15 releases - approximately $67 per release (Corporate Package)
* $1,999: 35 releases - approximately $57 per release
* $19,999: 800 releases - approximately $25 per release`;

describe("parsePrices — the model's price list, clamped", () => {
  it("keeps good items and fixes unknown categories and units", () => {
    expect(parsePrices([
      { category: "press_release", product: "Corporate Package bundle", price: 999, quantity: 15, unit: "one-time", notes: "credits valid 12 months" },
      { category: "nonsense", product: "Featured listing", price: 39, quantity: 1, unit: "monthly" },
      { category: "article", product: "", price: 100 },
      { category: "article", product: "Paid post", price: -5 },
    ])).toEqual([
      { category: "press_release", product: "Corporate Package bundle", price: 999, quantity: 15, unit: "one-time", notes: "credits valid 12 months" },
      { category: "other", product: "Featured listing", price: 39, quantity: null, unit: "each", notes: null },
      { category: "article", product: "Paid post", price: null, quantity: null, unit: "each", notes: null },
    ]);
  });
  it("is empty for anything that is not a list", () => expect(parsePrices("$999")).toEqual([]));
  it("comes back on every decision", () => {
    const d = parseDecision(JSON.stringify({ reply: "Thanks", prices: [{ category: "listing", product: "API plan", price: 0.12, unit: "per listing / month" }], api: "Full API", minimum: "$20 a month" }));
    expect(d.prices).toHaveLength(1);
    expect(d.apiTerms).toBe("Full API");
    expect(d.minCommitment).toBe("$20 a month");
  });
});

describe("keepQuotedPrices — only amounts they wrote", () => {
  const p = (price: number | null, quantity: number | null = null) => ({ category: "press_release" as const, product: `x${price}`, price, quantity, unit: "one-time" as const, notes: null });
  it("keeps amounts in the email, written with or without commas and cents", () => {
    expect(keepQuotedPrices([p(999, 15), p(1999, 35), p(19999, 800)], EIN)).toHaveLength(3);
    expect(keepQuotedPrices([p(0.12)], "US$0.12 per listing under management")).toHaveLength(1);
    expect(keepQuotedPrices([p(356.25)], "her rate is $356.25 per release")).toHaveLength(1);
  });
  it("drops an amount the model worked out itself", () => {
    expect(keepQuotedPrices([p(66.6), p(99)], EIN)).toEqual([]);
  });
  it("does not match an amount inside a bigger one", () => {
    expect(keepQuotedPrices([p(1999)], "$11,999 for the year")).toEqual([]);
  });
  it("keeps an offer without a number", () => expect(keepQuotedPrices([p(null)], "paid releases available")).toHaveLength(1));
});

describe("perItem", () => {
  it("divides a bundle by its size", () => expect(perItem({ price: 999, quantity: 15 })).toBe(66.6));
  it("is the price for one item", () => expect(perItem({ price: 1205, quantity: null })).toBe(1205));
  it("is empty without a price", () => expect(perItem({ price: null, quantity: 4 })).toBeNull());
});

describe("inboundBody — what a person wrote", () => {
  it("reads the HTML when the text part is empty (Reputation, 2026-10-22)", () => {
    const html = "<div>Hi Leah,</div><p>Thanks for reaching out&nbsp;to Reputation. We are open to direct API connectivity.</p>";
    expect(inboundBody({ text: "\n", html })).toBe("Hi Leah,\nThanks for reaching out to Reputation. We are open to direct API connectivity.");
  });
  it("names the attachment when the reply is only a file (Industry Today, 2026-10-21)", () => {
    const text = "\n\nFrom: Leah Peterson | Construct HUB <media@constructhub.us>\nSent: Saturday, October 17, 2026 9:39 PM\nTo: Editor\nSubject: Local contractor news\n\nHi Industry Today team,";
    expect(inboundBody({ text, attachments: [{ filename: "Press-release-submission-details.pdf", contentDisposition: "attachment" }, { filename: "logo.png", contentDisposition: "inline" }] }))
      .toBe("[Attached: Press-release-submission-details.pdf]");
  });
  it("leaves a plain email as it was", () => expect(inboundBody({ text: "Sounds good.\n\nOn Tue, Oct 13, 2026 at 10:26 PM Leah wrote:\n> hi" })).toBe("Sounds good."));
  it("turns list items and line breaks into text", () => expect(htmlToPlain("<ul><li>$999: 15 releases</li><li>$1,999: 35</li></ul>a<br>b")).toBe("- $999: 15 releases\n- $1,999: 35\na\nb"));
});

describe("supportSkip — support@ mail that is never a partner's answer", () => {
  it("reads a help-desk agent's answer", () => expect(supportSkip({ fromEmail: "support@einpresswire.com", subject: "Re: Agency / reseller pricing", autoSubmitted: null })).toBe(false));
  it.each([
    ["us", { fromEmail: "support@constructhub.us", subject: "x", autoSubmitted: null }],
    ["no-reply", { fromEmail: "donotreply@godaddy.com", subject: "Your order", autoSubmitted: null }],
    ["auto-reply", { fromEmail: "jmoreno@vendasta.com", subject: "Out of Office – Returning October 20th", autoSubmitted: null }],
    ["auto-submitted", { fromEmail: "desk@wire.com", subject: "Ticket opened", autoSubmitted: "auto-replied" }],
  ])("skips %s", (_, h) => expect(supportSkip(h)).toBe(true));
});
