import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { xSplitText, xWeightedLength } from "../../shared/social-x";
import { destinationSchema, postPayload } from "../../shared/social";
import { XPreview } from "../../client/src/components/social-x";
import { characterCount } from "../../client/src/components/social-drafts";
import Privacy from "../../client/src/pages/privacy-policy";
import Terms from "../../client/src/pages/terms-of-use";
import Deletion from "../../client/src/pages/data-deletion";

vi.mock("../../client/src/components/legal-page", () => ({ LegalPage: ({ children }: any) => children }));

describe("X composer", () => {
  it("shows links in the reply preview and counts only the main text", () => {
    const text = "New roof https://example.com/very-long-link";
    const html = renderToStaticMarkup(createElement(XPreview, { text }));
    expect(html).toContain("Link moves to a reply");
    expect(html).toContain("New roof</span>");
    expect(html).toContain("https://example.com/very-long-link");
    expect(characterCount("x", text)).toBe("8/280 characters");
    expect(renderToStaticMarkup(createElement(XPreview, { text: "New roof" }))).not.toContain("Link moves");
  });
  it("splits bare, Unicode, www and explicit URLs and keeps one deduplicated reply", () => {
    expect(xSplitText("Hi https://example.com https://example.com www.example.org 例子.中国")).toEqual({ main: "Hi", reply: "https://example.com\nwww.example.org\n例子.中国" });
    expect(xSplitText("Hi (https://example.com). example.org/path?q=yes").main).not.toMatch(/example/);
  });
  it("weights CJK, emoji clusters, NFC and URLs and validates the stripped main text", () => {
    expect(xWeightedLength("中👨‍👩‍👧‍👦🇺🇸e\u0301")).toBe(7);
    expect(xWeightedLength("https://example.com/long")).toBe(23);
    expect(xWeightedLength("a https://example.com https://example.com")).toBe(49);
    const d = destinationSchema.parse({ accountId: "x1", platform: "x" });
    expect(() => postPayload(d, "a".repeat(280) + " https://example.com", [])).not.toThrow();
    expect(() => postPayload(d, "中".repeat(141), [])).toThrow(/exceeds/);
  });
});

describe("X legal disclosures", () => {
  it.each([Privacy, Terms, Deletion])("mentions X and links to revocation", (Page) => {
    const html = renderToStaticMarkup(createElement(Page));
    expect(html).toContain("X");
    expect(html).toContain('href="https://x.com/settings/connected_apps"');
  });
  it("explains access, retention, deletion and the separate reply", () => {
    const html = renderToStaticMarkup(createElement(Privacy));
    expect(html).toContain("rotating refresh tokens");
    expect(html).toContain("Retention:");
    expect(html).toContain("30 days");
    expect(renderToStaticMarkup(createElement(Terms))).toContain("main post remains published");
  });
});
