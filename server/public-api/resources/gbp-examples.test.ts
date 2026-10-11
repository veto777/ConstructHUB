import { describe, expect, it } from "vitest";
import { exampleFor, gbpPostExamples, curlFor } from "../../../client/src/pages/developers";
import { gbpPostInput, gbpPostPayload, gbpPostsWriteOpenapi } from "./gbp-write";

describe("copyable scheduling examples", () => {
  const now = new Date("2031-12-31T23:45:00Z");
  it("keeps nested scheduling fields three days ahead across year boundaries", () => {
    expect(exampleFor({ type: "object", properties: { scheduledTime: { type: "string", format: "date-time" }, day: { type: "string", format: "date" } } }, undefined, new Set(), 0, now)).toEqual({ scheduledTime: "2032-01-03T23:45:00.000Z", day: "2032-01-03" });
  });
  it.each(["STANDARD", "EVENT", "OFFER"] as const)("validates the %s example against the actual API input", topic => {
    const example = gbpPostExamples(now)[topic];
    const parsed = gbpPostInput.parse(example);
    expect(Date.parse(parsed.scheduledAt!)).toBe(now.getTime() + 3 * 86_400_000);
    expect(parsed.topicType).toBe(topic);
    const payload = gbpPostPayload(parsed);
    if (topic === "STANDARD") expect(payload.event).toBeUndefined();
    else expect(parsed.event!.end > parsed.event!.start).toBe(true);
    if (topic === "OFFER") { expect(payload.callToAction).toBeUndefined(); expect(payload.offer).toBeDefined(); }
    const op = gbpPostsWriteOpenapi.paths["/{id}/posts"].post;
    const curl = curlFor({ method: "post", path: "/api/v1/locations/{id}/posts", op }, gbpPostsWriteOpenapi, "https://example.com/api/v1", example);
    expect(curl).toContain(JSON.stringify(example, null, 2));
  });
  it("documents the same conditional failures the validator enforces", () => {
    const { EVENT, STANDARD } = gbpPostExamples(now);
    expect(gbpPostInput.safeParse({ ...EVENT, event: undefined }).success).toBe(false);
    expect(gbpPostInput.safeParse({ ...EVENT, event: { ...EVENT.event, end: EVENT.event.start } }).success).toBe(false);
    expect(gbpPostInput.safeParse({ ...STANDARD, callToAction: { actionType: "BOOK" } }).success).toBe(false);
    expect(gbpPostInput.safeParse({ ...STANDARD, callToAction: { actionType: "CALL" } }).success).toBe(true);
    const schema = gbpPostsWriteOpenapi.components.schemas.GbpPostInput;
    expect(schema.description).toContain("end strictly after start");
    expect(schema.properties.callToAction.description).toContain("except for CALL");
    expect(schema.properties.event.required).toEqual(["title", "start", "end"]);
  });
});
