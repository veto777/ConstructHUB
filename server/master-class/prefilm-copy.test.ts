import { expect, it } from "vitest";
import { WALKTHROUGHS } from "../../client/src/components/guides/library";
import gabe from "../../shared/feature-pages/gabe";
import { HUB_PRESETS } from "../../shared/hub-presets";
it("the Social guide explains how to resume each business draft", () => {
  const step = WALKTHROUGHS.find(w => w.id === "agency-social")!.steps[0];
  expect(step).toContain("Switching businesses keeps each business's unsaved composer draft — pick the business again to continue where you left off.");
  expect(step).not.toContain("resets the composer");
});
it("Gabe's quick-question card names exactly the advertised questions", () => {
  const card = gabe.cards![0];
  expect(card.title).toBe(`${Object.keys(HUB_PRESETS).length} quick questions`);
  expect(card.body.split(" · ")).toEqual(Object.values(HUB_PRESETS).map(p => p.label));
});
