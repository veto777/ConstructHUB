import { describe, expect, it } from "vitest";
import { publicNote } from "./public-errors";
import { WEEKLY_SKIPPED_MESSAGE } from "./jobs";

describe("notes the rank jobs save are shown to the customer as written", () => {
  it("the skipped-automatic-check note is a known note (not replaced by the generic one)", () => {
    expect(publicNote(WEEKLY_SKIPPED_MESSAGE)).toBe(WEEKLY_SKIPPED_MESSAGE);
  });
});
