import { describe, it, expect } from "vitest";
import {
  buildVisitDetail, groupSessionsIntoVisits, parseOfferDetail, deviceFromUserAgent, mergeSummaries, eventLine,
} from "@shared/engagement-events";

const t0 = new Date("2026-10-21T19:04:38Z");
const at = (secs: number) => new Date(t0.getTime() + secs * 1000);

describe("engagement events → visit detail", () => {
  it("groups the estimate and its Terms page into one visit, and a next-day open into another", () => {
    const sessions = [
      { id: "a", startedAt: t0, lastPingAt: at(130), durationSecs: 130 },
      { id: "b", startedAt: at(140), lastPingAt: at(210), durationSecs: 70 },
      { id: "c", startedAt: at(86_400), lastPingAt: at(86_460), durationSecs: 60 },
    ];
    const visits = groupSessionsIntoVisits(sessions);
    expect(visits.map((v) => v.map((s) => s.id))).toEqual([["c"], ["a", "b"]]);
  });

  it("reads the visit in plain English with the summary chips", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
    const d = buildVisitDetail(
      [{ id: "a", startedAt: t0, durationSecs: 130, userAgent: ua }, { id: "b", startedAt: at(140), durationSecs: 70 }],
      [
        { sessionId: "a", name: "page_view", detail: { page: "estimate", device: "phone" }, tMs: 0 },
        { sessionId: "a", name: "section_time", detail: { section: "warranty", secs: 42 }, tMs: 5_000 },
        { sessionId: "a", name: "section_time", detail: { section: "scope:Hardie siding", secs: 30 }, tMs: 2_000 },
        { sessionId: "a", name: "discounts_open", detail: null, tMs: 60_000 },
        { sessionId: "a", name: "discount_toggle", detail: { d: "pay_in_full:on" }, tMs: 61_000 },
        { sessionId: "a", name: "discount_info", detail: { d: "price_match" }, tMs: 62_000 },
        { sessionId: "a", name: "model3d_open", detail: null, tMs: 70_000 },
        { sessionId: "a", name: "approve_open", detail: null, tMs: 100_000 },
        { sessionId: "a", name: "scroll_depth", detail: { pct: 80 }, tMs: 120_000 },
        { sessionId: "b", name: "page_view", detail: { page: "terms" }, tMs: 0 },
        { sessionId: "b", name: "scroll_depth", detail: { pct: 55 }, tMs: 60_000 },
      ],
    );
    const text = d.lines.map((l) => l.text);
    expect(text).toContain("Read Warranty — 42s");
    expect(text).toContain("Read the “Hardie siding” scope — 30s");
    expect(text).toContain("Ticked the Pay-in-full discount");
    expect(text).toContain("Clicked ⓘ on Price match");
    expect(text).toContain("Opened the 3D model of their home");
    expect(text).toContain("Opened Terms & Conditions — 1m 10s, scrolled 55%");
    expect(text).toContain("Started approving, then backed out");
    expect(text).toContain("Scrolled 80% of the estimate");
    expect(d.summary).toMatchObject({
      readTerms: true, termsSecs: 70, pamphlets: false, model3d: true, discountsViewed: true, scrollPct: 80,
      device: "iPhone · Safari",
    });
    // Offsets are from the visit start: the Terms page opened 140s in.
    expect(d.lines.find((l) => l.text.startsWith("Opened Terms"))?.offsetSecs).toBe(140);
    // Sorted by time.
    const offs = d.lines.map((l) => l.offsetSecs);
    expect([...offs].sort((a, b) => a - b)).toEqual(offs);
  });

  it("does not say 'backed out' when they signed", () => {
    const d = buildVisitDetail([{ id: "a", startedAt: t0, durationSecs: 60 }], [
      { sessionId: "a", name: "approve_open", detail: null, tMs: 1000 },
      { sessionId: "a", name: "approve_submit", detail: null, tMs: 9000 },
    ]);
    expect(d.lines.map((l) => l.text)).not.toContain("Started approving, then backed out");
    expect(buildVisitDetail([{ id: "a", startedAt: t0, durationSecs: 60 }],
      [{ sessionId: "a", name: "approve_open", detail: null, tMs: 1000 }], { approved: true })
      .lines.map((l) => l.text)).not.toContain("Started approving, then backed out");
  });

  it("names offers, devices and unknown events", () => {
    expect(parseOfferDetail("pay_in_full:off")).toEqual({ label: "Pay-in-full", on: false });
    expect(parseOfferDetail("bundle")).toEqual({ label: "Bundle", on: null });
    expect(deviceFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"))
      .toBe("Windows computer · Chrome");
    expect(eventLine("something_new", { d: "x" })).toBe("Something new (x)");
    expect(eventLine("upsell_click", { d: "roofing" })).toBe("Asked for a roofing bid");
    expect(mergeSummaries([]).readTerms).toBe(false);
  });
});
