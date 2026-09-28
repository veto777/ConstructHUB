import { describe, expect, it } from "vitest";
import { analyticsPath } from "@shared/analytics-path";
describe("analytics credential redaction", () => {
  it.each(["e", "i", "co", "portal", "lead-form", "review", "contract/sign"])("redacts %s for paths and referrers", route => {
    expect(analyticsPath(`/${route}/private-token?secret=1#fragment`)).toBe(`/${route}/:token`);
    expect(analyticsPath(`https://example.invalid/${route}/private-token/unsubscribe`)).toBe(`https://example.invalid/${route}/:token/unsubscribe`);
  });
  it("preserves ordinary routes and never retains query credentials", () => {
    expect(analyticsPath("/google-reviews?token=secret")).toBe("/google-reviews");
    expect(analyticsPath("/crm/clients/123")).toBe("/crm/clients/123");
  });
});
