import { describe, expect, it } from "vitest";
import {
  LIMITS, PART_SIZE, canComplete, completedParts, kindFromMime, markPart, missingParts, nextMediaStatus, partPlan, partRange,
  uploadExpired, validateUploadRequest,
} from "./upload-state";

describe("jobcam upload rules (pure)", () => {
  it("classifies by MIME and names the stored extension", () => {
    expect(kindFromMime("image/jpeg")).toBe("photo");
    expect(kindFromMime("image/heic")).toBe("photo");
    expect(kindFromMime("video/quicktime")).toBe("video");
    expect(kindFromMime("VIDEO/MP4; codecs=avc1")).toBe("video");
    expect(kindFromMime("application/pdf")).toBeNull();
    expect(validateUploadRequest({ mime: "video/quicktime", bytes: 10 })).toMatchObject({ ok: true, kind: "video", ext: "mov" });
  });

  it("refuses what the caps refuse, with the status a client can act on", () => {
    expect(validateUploadRequest({ mime: "application/pdf", bytes: 10 })).toMatchObject({ ok: false, status: 415 });
    expect(validateUploadRequest({ mime: "image/jpeg", bytes: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(validateUploadRequest({ mime: "image/jpeg", bytes: LIMITS.photoBytes })).toMatchObject({ ok: true });
    expect(validateUploadRequest({ mime: "image/jpeg", bytes: LIMITS.photoBytes + 1 })).toMatchObject({ ok: false, status: 413 });
    expect(validateUploadRequest({ mime: "video/mp4", bytes: LIMITS.videoBytes + 1 })).toMatchObject({ ok: false, status: 413 });
    expect(validateUploadRequest({ mime: "video/mp4", bytes: 100, durationS: LIMITS.videoSeconds + 5 })).toMatchObject({ ok: false, status: 413 });
    expect(validateUploadRequest({ mime: "video/mp4", bytes: 100, durationS: LIMITS.videoSeconds })).toMatchObject({ ok: true });
  });

  it("plans 5 MiB parts, equal except the last", () => {
    expect(partPlan(1)).toEqual({ partSize: PART_SIZE, partsTotal: 1 });
    expect(partPlan(PART_SIZE)).toEqual({ partSize: PART_SIZE, partsTotal: 1 });
    expect(partPlan(PART_SIZE + 1).partsTotal).toBe(2);
    expect(partPlan(15_957_928).partsTotal).toBe(4);
    expect(partRange(1, 15_957_928)).toEqual({ start: 0, end: PART_SIZE });
    expect(partRange(4, 15_957_928)).toEqual({ start: 3 * PART_SIZE, end: 15_957_928 });
  });

  it("tracks parts and completes only when every part has an ETag", () => {
    let done = markPart(null, 2, '"b"');
    expect(missingParts(done, 3)).toEqual([1, 3]);
    expect(canComplete(done, 3)).toBe(false);
    done = markPart(markPart(done, 1, '"a"'), 3, '"c"');
    expect(missingParts(done, 3)).toEqual([]);
    expect(canComplete(done, 3)).toBe(true);
    expect(completedParts(done, 3)).toEqual([{ PartNumber: 1, ETag: '"a"' }, { PartNumber: 2, ETag: '"b"' }, { PartNumber: 3, ETag: '"c"' }]);
    // A re-sent part replaces its ETag; the record never grows.
    expect(Object.keys(markPart(done, 2, '"b2"'))).toHaveLength(3);
    expect(canComplete({}, 0)).toBe(false);
  });

  it("media moves only along uploading → processing → ready | failed → processing", () => {
    expect(nextMediaStatus("uploading", "complete")).toBe("processing");
    expect(nextMediaStatus("uploading", "done")).toBeNull();
    expect(nextMediaStatus("processing", "done")).toBe("ready");
    expect(nextMediaStatus("processing", "fail")).toBe("failed");
    expect(nextMediaStatus("failed", "retry")).toBe("processing");
    expect(nextMediaStatus("ready", "fail")).toBeNull();
    expect(nextMediaStatus("ready", "retry")).toBeNull();
  });

  it("expires an open upload after the TTL", () => {
    const now = Date.parse("2026-10-07T12:00:00Z");
    expect(uploadExpired("2026-10-07T11:00:00Z", now)).toBe(false);
    expect(uploadExpired("2026-10-06T11:59:00Z", now)).toBe(true);
    expect(uploadExpired(null, now)).toBe(false);
  });
});
