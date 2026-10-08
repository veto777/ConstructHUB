/**
 * The rank tracker's place box (client/src/pages/seo/location-picker.tsx, used by the "Add keywords" form in
 * client/src/pages/seo/index.tsx): a town typed there but never chosen from the list must not go out as "no place" —
 * that would quietly make the check a country-wide one (audit #55). Enter is guarded inside the box; this covers the
 * form itself (a click on "Track these", or Enter from another control). Pure module + source guard, no browser.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { unresolvedPlaceMessage } from "@shared/seo-place";

const read = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, "../../client/src/pages/seo", rel), "utf8");
/** Comments aside; only code counts. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("a typed town that was never chosen", () => {
  it("is a problem the form names; nothing typed is no problem", () => {
    expect(unresolvedPlaceMessage("", "the site's default (United States)")).toBeNull();
    expect(unresolvedPlaceMessage("   ", "the site's default (United States)")).toBeNull();
    expect(unresolvedPlaceMessage(" Tampa ", "the site's default (United States)")).toBe("\"Tampa\" isn't a chosen place yet: pick it from the list, or clear the box to check from the site's default (United States).");
    expect(unresolvedPlaceMessage("Kelowna", "the site's default (Canada)")).toMatch(/check from the site's default \(Canada\)\.$/);
  });

  it("the form stops before sending and the picker links an announced message to its box", () => {
    const form = code(read("index.tsx")), picker = code(read("location-picker.tsx"));
    // The form: a submit goes through one gate that asks the shared rule before the request, with the typed text the picker reported.
    const submit = form.slice(form.indexOf("const submit = () =>"), form.indexOf("m.mutate();", form.indexOf("const submit = () =>")));
    expect(submit).toMatch(/unresolvedPlaceMessage\(typed, defaultLabel\)/);
    expect(submit).toMatch(/setPlaceError\(problem\); return;/);
    expect(form).toMatch(/onSubmit=\{\(e\) => \{ e\.preventDefault\(\); submit\(\); \}\} data-testid="form-add-keywords"/);
    const picked = form.slice(form.indexOf("<LocationPicker "), form.indexOf("/>", form.indexOf("<LocationPicker ")));
    expect(picked).toMatch(/onTyped=\{\(t\) => \{ setTyped\(t\);/);
    expect(picked).toMatch(/error=\{placeError\}/);
    // The picker: the typed text is reported on every change and cleared on a pick; the message is under the box, linked
    // (aria-describedby + aria-invalid) and announced (role="alert").
    expect(picker).toMatch(/const type = \(v: string\) => \{ setText\(v\); onTyped\?\.\(v\.trim\(\)\); \}/);
    expect(picker).toMatch(/const clear = \(\) => \{[^}]*onTyped\?\.\(""\); \}/);
    expect(picker).toMatch(/const pick = \(p: Place\) => \{ onChange\(p\); clear\(\); \}/);
    expect(picker).toMatch(/aria-invalid=\{error \? true : undefined\} aria-describedby=\{error \? `\$\{id\}-error` : undefined\}/);
    expect(picker).toMatch(/<p id=\{`\$\{id\}-error`\} role="alert"/);
    // Enter inside the box stays guarded: it picks the highlighted place or does nothing, never submits the text.
    expect(picker).toMatch(/if \(e\.key === "Enter" && text\.trim\(\)\) \{ e\.preventDefault\(\);/);
  });
});
