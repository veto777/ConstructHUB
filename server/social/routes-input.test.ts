/**
 * The per-post action body (POST /api/social/posts/:id/action): approve a draft (with or without an
 * edit), save an edit without queueing, cancel. Pure — no database.
 */
import { describe, expect, it } from "vitest";
import { postActionBody, socialInputMessage } from "./routes";

describe("postActionBody", () => {
  it("accepts approve with or without text, cancel, and save with text", () => {
    expect(postActionBody.parse({ action: "approve" })).toEqual({ action: "approve" });
    expect(postActionBody.parse({ action: "approve", text: " Edited " })).toEqual({ action: "approve", text: "Edited" });
    expect(postActionBody.parse({ action: "cancel" })).toEqual({ action: "cancel" });
    expect(postActionBody.parse({ action: "save", text: "Kept as a draft" })).toEqual({ action: "save", text: "Kept as a draft" });
  });

  it("refuses a save without text, with a message for people, and unknown actions or fields", () => {
    const r = postActionBody.safeParse({ action: "save" });
    expect(r.success).toBe(false);
    if (!r.success) expect(socialInputMessage(r.error)).toBe("Enter the draft text to save it.");
    expect(postActionBody.safeParse({ action: "publish" }).success).toBe(false);
    expect(postActionBody.safeParse({ action: "save", text: "" }).success).toBe(false);
    expect(postActionBody.safeParse({ action: "cancel", extra: 1 }).success).toBe(false);
  });
});
