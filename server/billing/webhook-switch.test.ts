import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
// The Stripe webhook's `switch (event.type)` (server/stripe.ts), read as source: a case label listed twice makes
// the second block unreachable. That is how the referral program's refund / chargeback handler never ran (audit H3).

const src = readFileSync("server/stripe.ts", "utf8");
const start = src.indexOf("switch (event.type) {");
const body = src.slice(start, src.indexOf("} catch (handlerErr)", start));
const labels = Array.from(body.matchAll(/^\s*case "([a-z_.]+)":/gm), (m) => m[1]);

it("names every event type once, so no handler sits behind an earlier case label", () => {
  expect(start).toBeGreaterThan(0);
  expect(labels.length).toBeGreaterThan(10);
  expect(labels.filter((l, i) => labels.indexOf(l) !== i)).toEqual([]);
});

it("a refund or chargeback reaches the referral program", () => {
  const refund = body.slice(body.indexOf('case "charge.refunded":'));
  expect(refund.slice(0, refund.indexOf("break;"))).toContain("onChargeReversed(event)");
});
