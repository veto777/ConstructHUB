import { describe, expect, it } from "vitest";
import { allowanceFor, queueEmail, resolveSettings } from "./worker";

describe("media@ settings — the admin's choices over the env defaults", () => {
  it("defaults to the ramp (50 + 25 a day, at most 400) when nothing is set", () => {
    const s = resolveSettings({}, {});
    expect(s.outreach).toBe("ramp");
    expect(allowanceFor(s, 0)).toBe(50);
    expect(allowanceFor(s, 2)).toBe(100);
    expect(allowanceFor(s, 100)).toBe(400);
  });
  it("reads MEDIA_OUTREACH_PER_DAY as fixed, and 0 as paused", () => {
    expect(allowanceFor(resolveSettings({}, { MEDIA_OUTREACH_PER_DAY: "120" }), 9)).toBe(120);
    expect(resolveSettings({}, { MEDIA_OUTREACH_PER_DAY: "0" }).outreach).toBe("paused");
  });
  it("the admin's saved settings win over env", () => {
    expect(allowanceFor(resolveSettings({ outreach: "paused" }, {}), 5)).toBe(0);
    expect(allowanceFor(resolveSettings({ outreach: "ramp", rampStep: 50 }, { MEDIA_OUTREACH_PER_DAY: "0" }), 2)).toBe(150);
    expect(allowanceFor(resolveSettings({ outreach: "fixed", fixedPerDay: 75 }, {}), 30)).toBe(75);
  });
  it("uses an edited template with the company filled in, and only when it keeps the stop line", () => {
    const body = 'Hi {company} team,\n\nShort note.\n\nIf not, reply "stop".\n\nBest regards,';
    const e = queueEmail("news", "Canyon News", { templates: { news: { subject: "Hello {company}", body } } });
    expect(e.subject).toBe("Hello Canyon News");
    expect(e.body).toContain("Hi Canyon News team");
    const fallback = queueEmail("news", "Canyon News", { templates: { news: { subject: "x", body: "no way out" } } });
    expect(fallback.body).toMatch(/reply "stop"/);
    expect(queueEmail("unknown", "X", { templates: {} }).subject).toMatch(/Listings partnership/);
  });
});
