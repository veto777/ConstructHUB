/**
 * Keyboard and screen-reader contract of the 2026-10-15 "every page explains itself" components: static markup
 * checks (renderToStaticMarkup, the project's pattern for component tests) of what a screen reader and the Tab key
 * get. The live behaviour (Enter/Space/Esc, focus return, reduced motion) was checked with Playwright on the dev
 * server; this file pins the markup those checks depend on.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { SamplePreview } from "@/components/sample-preview";
import { PresetFilter } from "@/components/domains/preset-filter";
import { RangePicker, WindowPicker, rangeError, windowError } from "@/components/traffic-tool/shared";
import { HelpButton, HelpVideoPlayer, filmKind, filmNoun } from "@/components/help-button";
import { loadHelpRegistry } from "@/lib/use-help-entry";
import { GooglePill } from "@/components/google";
import type { HelpEntry } from "@shared/help/types";

const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("SamplePreview", () => {
  const out = html(h(SamplePreview, { what: "what a scan looks like", cta: h("button", { type: "button", "data-testid": "cta" }, "Run a scan") },
    h("a", { href: "/x", "data-testid": "inner-link" }, "inside"), h("button", { type: "button" }, "inside")));
  it("is a named region announced once: aria-label on the section, the visual badge aria-hidden", () => {
    expect(out).toMatch(/<section[^>]*aria-label="Sample data: what a scan looks like"/);
    expect(out).toMatch(/<p[^>]*aria-hidden="true"[^>]*data-testid="sample-preview-badge"/);
  });
  it("keeps the sample itself out of the tab order and the accessibility tree (inert + aria-hidden), the CTA outside it", () => {
    expect(out).toMatch(/<div[^>]*aria-hidden="true"[^>]*inert=""[^>]*>.*inner-link/);
    const inertStart = out.indexOf('inert=""'), ctaAt = out.indexOf('data-testid="cta"');
    expect(ctaAt).toBeGreaterThan(-1);
    expect(ctaAt).toBeLessThan(inertStart);
  });
});

describe("PresetFilter", () => {
  const props = { label: "Filter registrar", onChange: () => {}, presets: ["GoDaddy", ["namecheap", "Namecheap"]] as const, allLabel: "All registrars", selectClass: "g-input", testId: "filter-registrar" };
  it("is a labelled select with the presets only, and 'Type your own…' is a real, named button beside it", () => {
    const out = html(h(PresetFilter, { ...props, value: "" }));
    expect(out).toMatch(/<select[^>]*aria-label="Filter registrar"/);
    expect(out).not.toContain("__custom__");
    expect(out).toMatch(/<button type="button"[^>]*aria-label="Filter registrar: type your own value"[^>]*>Type your own…<\/button>/);
  });
  it("a value off the list shows as the typed value, in an input tied to the same label, with a named clear button", () => {
    const out = html(h(PresetFilter, { ...props, value: "porkbun" }));
    expect(out).toMatch(/<input[^>]*aria-label="Filter registrar — your own value"[^>]*value="porkbun"/);
    expect(out).toMatch(/<button[^>]*aria-label="Clear filter registrar and go back to the list"/);
    expect(out).not.toContain("<select");
  });
});

describe("RangePicker / WindowPicker", () => {
  it("are labelled groups of toggle buttons (aria-pressed) with labelled date inputs", () => {
    const out = html(h(RangePicker, { value: { preset: "7d", from: "", to: "" }, onChange: () => {}, testId: "r" }));
    expect(out).toMatch(/role="group" aria-label="Date range"/);
    expect(out).toMatch(/<button[^>]*aria-pressed="true"/);
    expect(out).toMatch(/<input type="date"[^>]*aria-label="Range start date"/);
    expect(out).toMatch(/<input type="date"[^>]*aria-label="Range end date"/);
    expect(out).not.toContain('role="alert"');
  });
  it("say a bad typed range in words, announced (role=alert) and tied to the inputs (aria-invalid + aria-describedby)", () => {
    expect(rangeError({ preset: "custom", from: "2026-10-10", to: "2026-10-01" }, "2026-10-15")).toBe("The start date is after the end date.");
    expect(rangeError({ preset: "custom", from: "2026-10-01", to: "2026-10-20" }, "2026-10-15")).toBe("The range cannot go past today.");
    expect(rangeError({ preset: "custom", from: "2026-10-01", to: "2026-10-10" }, "2026-10-15")).toBeNull();
    const out = html(h(RangePicker, { value: { preset: "custom", from: "2026-10-10", to: "2026-10-01" }, onChange: () => {}, testId: "r" }));
    expect(out).toMatch(/<p id="r-error" role="alert"[^>]*>The start date is after the end date.<\/p>/);
    expect(out).toMatch(/aria-label="Range start date" aria-invalid="true" aria-describedby="r-error"/);
  });
  it("WindowPicker: a labelled group, a labelled number box, and a typed non-number announced", () => {
    expect(windowError("")).toBeNull(); expect(windowError("45")).toBeNull();
    expect(windowError("0")).toBe("Enter a number of minutes above 0."); expect(windowError("-3")).toBe("Enter a number of minutes above 0.");
    const out = html(h(WindowPicker, { minutes: 60, onChange: () => {}, testId: "w" }));
    expect(out).toMatch(/role="group" aria-label="Seen within"/);
    expect(out).toMatch(/<input type="number"[^>]*aria-label="Seen within this many minutes"/);
    expect(out).not.toContain('role="alert"');
  });
});

describe("HelpVideoPlayer", () => {
  const video = { url: "/tutorials/x.mp4", durationSec: 86, poster: undefined, captions: "/tutorials/x.vtt" } as any;
  it("has an accessible name that says what the film is", () => {
    expect(html(h(HelpVideoPlayer, { video, title: "Domains" }))).toMatch(/<video[^>]*aria-label="Walkthrough video: Domains"/);
    expect(html(h(HelpVideoPlayer, { video, title: "Domains", kind: "Overview film" }))).toMatch(/<video[^>]*aria-label="Overview film: Domains"/);
    expect(html(h(HelpVideoPlayer, { video, title: "Domains" }))).not.toContain("autoplay");
    expect(html(h(HelpVideoPlayer, { video, title: "Domains", autoPlay: true }))).toContain("autoplay");
  });
  it("names the film by its source (an intro film is never passed off as a walkthrough)", () => {
    const own = { videoSource: "own" } as HelpEntry, intro = { videoSource: "intro" } as HelpEntry;
    expect([filmNoun(own), filmKind(own)]).toEqual(["walkthrough", "Walkthrough video"]);
    expect([filmNoun(intro), filmKind(intro)]).toEqual(["overview film", "Overview film"]);
  });
});

describe("GooglePill", () => {
  it("is a link when it goes somewhere and a button when it acts", () => {
    expect(html(h(GooglePill, { label: "Website", href: "/x" }))).toMatch(/^<a href="\/x"/);
    expect(html(h(GooglePill, { label: "Website", href: "/x", external: true }))).toContain('rel="noopener noreferrer"');
    expect(html(h(GooglePill, { label: "Rescan", onClick: () => {} }))).toMatch(/^<button type="button"/);
    expect(html(h(GooglePill, { label: "7 days", selected: true, ariaPressed: true }))).toContain('aria-pressed="true"');
    expect(html(h(GooglePill, { label: "", icon: (p: any) => h("svg", p), ariaLabel: "Clear" }))).toMatch(/<button[^>]*aria-label="Clear"/);
  });
});

describe("HelpButton trigger", () => {
  // The registry loads on demand; once it has, useHelpEntry resolves synchronously and the static render carries the trigger.
  beforeAll(async () => { await loadHelpRegistry(); });
  it("is a named button that says it opens a dialog; the shell's crumb-row fallback names itself apart from a header's", () => {
    const out = html(h(HelpButton, { k: "domains" }));
    expect(out).toMatch(/<button type="button"[^>]*aria-label="About Domains"[^>]*aria-haspopup="dialog"[^>]*data-testid="help-button-domains"/);
    expect(html(h(HelpButton, { k: "domains", fallback: true }))).toMatch(/aria-label="About this page: Domains"/);
    // the film beside it is a second, differently named button (an overview film is called one)
    expect(out).toMatch(/<button[^>]*aria-label="Watch the overview film: Domains"[^>]*data-testid="help-play-domains"/);
  });
  it("renders nothing for a key the registry does not have (never a dead icon)", () => {
    expect(html(h(HelpButton, { k: "no-such-key" }))).toBe("");
  });
});
