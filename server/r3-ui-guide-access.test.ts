import { expect, it } from "vitest";
import { accessLabel } from "@/components/guides/access-label";
import { LIBRARY } from "@/components/guides/library";
import type { CourseAccess } from "@/components/master-class/access";

const access: CourseAccess = {
  included: false, purchases: [], unlocked: { licensing: false, gmb: true, website: false, seo: false },
  any: true, all: false, devPreview: false, signedIn: true,
};
const label = (id: string, a: CourseAccess | undefined = access, failed = false) =>
  accessLabel(LIBRARY.find(e => e.id === id)!.access, a, failed);

it("a Google Business module purchase opens the bonus guide, not the licensing module or whole course", () => {
  expect(label("google-ads-guide")).toBe("Unlocked on your account");
  expect(label("state-guides")).toBe("Master Class · Licensing module");
  expect(label("master-class")).toBe("Some modules unlocked");
});
it("licensing access and full bundle access receive accurate labels", () => {
  expect(label("state-guides", { ...access, unlocked: { ...access.unlocked, licensing: true } })).toBe("Unlocked on your account");
  expect(label("master-class", { ...access, all: true })).toBe("Unlocked on your account");
});
it("pending and failed access checks do not claim a purchase is locked or unlocked", () => {
  const entry = LIBRARY.find(e => e.id === "state-guides")!;
  expect(accessLabel(entry.access, undefined)).toBe("Checking access…");
  expect(accessLabel(entry.access, access, true)).toBe("Access unavailable");
  expect(label("lsa-guide", access, true)).toBe("Free");
});
