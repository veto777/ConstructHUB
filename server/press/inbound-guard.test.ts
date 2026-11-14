/** Pure checks (no database): who counts as the wire, what a customer email may contain, which photos may be sent. */
import { describe, it, expect } from "vitest";
import { isWireSender } from "./mailbox";
import { pressInputSchema, PRESS_PHOTO_KEY } from "./draft";
import { lineHtml } from "./worker";

describe("isWireSender", () => {
  const env = { PRESS_WIRE_EMAIL: "Editorial@wire.test" } as NodeJS.ProcessEnv;
  it("accepts the wire's address and its domain, in any case", () => {
    expect(isWireSender("editorial@wire.test", env)).toBe(true);
    expect(isWireSender("EDITORIAL@WIRE.TEST", env)).toBe(true);
    expect(isWireSender("reports@wire.test", env)).toBe(true);
  });
  it("refuses everyone else, including look-alike domains and empty senders", () => {
    expect(isWireSender("customer@example.com", env)).toBe(false);
    expect(isWireSender("editorial@wire.test.evil.example", env)).toBe(false);
    expect(isWireSender("editorial@notwire.test", env)).toBe(false);
    expect(isWireSender("", env)).toBe(false);
    expect(isWireSender(null, env)).toBe(false);
    expect(isWireSender("anyone@wire.test", {} as NodeJS.ProcessEnv)).toBe(false);
  });
  it("does not trust a whole shared mail provider because the wire uses one", () => {
    const gmail = { PRESS_WIRE_EMAIL: "thewire@gmail.com" } as NodeJS.ProcessEnv;
    expect(isWireSender("thewire@gmail.com", gmail)).toBe(true);
    expect(isWireSender("someoneelse@gmail.com", gmail)).toBe(false);
  });
  it("PRESS_WIRE_FROM adds addresses and @domains", () => {
    const more = { PRESS_WIRE_EMAIL: "editorial@wire.test", PRESS_WIRE_FROM: "desk@helpdesk.test, @reports.test" } as NodeJS.ProcessEnv;
    expect(isWireSender("desk@helpdesk.test", more)).toBe(true);
    expect(isWireSender("other@helpdesk.test", more)).toBe(false);
    expect(isWireSender("noreply@reports.test", more)).toBe(true);
  });
});

describe("customer email lines", () => {
  it("escapes markup and links only plain http(s) URLs", () => {
    expect(lineHtml(`<img src=x onerror=alert(1)> "Smith & Sons"`)).toBe(`&lt;img src=x onerror=alert(1)&gt; &quot;Smith &amp; Sons&quot;`);
    expect(lineHtml(`Read it here: https://wire.test/a?b=1&c=2`)).toBe(`Read it here: <a href="https://wire.test/a?b=1&amp;c=2" style="color:#F97316">https://wire.test/a?b=1&amp;c=2</a>`);
    expect(lineHtml(`https://x.test/"onmouseover="alert(1)`)).not.toContain(`"onmouseover`);
  });
});

describe("press photos", () => {
  const base = { newsType: "expansion", companyName: "Vitest Roofing", website: "", city: "Columbus", state: "OH", contactName: "Pat Vitest", contactEmail: "pat@vitest.example", contactPhone: "", details: "x".repeat(90), spokesperson: "", spokespersonTitle: "", quoteNotes: "", about: "" };
  const key = "press/photos/3f0c9a52-7a1e-4a53-9c35-0d6c2f6f6a11.jpg";
  it("accepts a photo the upload route stored", () => {
    expect(pressInputSchema.safeParse({ ...base, photos: [{ key, url: `/api/files/${key}`, caption: "The crew" }] }).success).toBe(true);
    expect(pressInputSchema.safeParse({ ...base, photos: [] }).success).toBe(true);
  });
  it("refuses any other storage key or a url that is not that key's", () => {
    for (const bad of ["press/inbox/abc.pdf", "press/photos/../inbox/abc.jpg", "uploads/x.jpg", "press/photos/a/b.jpg", ""]) {
      expect(PRESS_PHOTO_KEY.test(bad)).toBe(false);
      expect(pressInputSchema.safeParse({ ...base, photos: [{ key: bad, url: `/api/files/${bad}`, caption: "" }] }).success).toBe(false);
    }
    expect(pressInputSchema.safeParse({ ...base, photos: [{ key, url: "/api/files/press/inbox/abc.pdf", caption: "" }] }).success).toBe(false);
  });
});
