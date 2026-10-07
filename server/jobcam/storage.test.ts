import { describe, expect, it } from "vitest";
import { assertKey, cleanRange, keyBelongsTo, keyPrefix } from "./storage";
import { sniffMedia, sniffMatchesKind } from "./exif";

const ORG = "c5b47b8d-caa8-47e6-ae7e-6248ad5df565", MEDIA = "eef41bc9-fdab-4cc7-8b2b-2724ceb028b4";

describe("jobcam storage keys", () => {
  it("accepts only <prefix>/<org>/<media>/<file>", () => {
    expect(assertKey(`jobcam/${ORG}/${MEDIA}/original.jpg`)).toBe(`jobcam/${ORG}/${MEDIA}/original.jpg`);
    expect(assertKey(`jobcam-dev/${ORG}/${MEDIA}/video-720.mp4`)).toContain("jobcam-dev/");
    for (const bad of [
      `jobcam/${ORG}/${MEDIA}/../x.jpg`, `jobcam/${ORG}/../${MEDIA}/x.jpg`, `jobcam/../crm-attachments/a/b.jpg`,
      `/jobcam/${ORG}/${MEDIA}/x.jpg`, `photos/${ORG}/${MEDIA}/x.jpg`, `jobcam/${ORG}/${MEDIA}/a/b.jpg`, `jobcam/${ORG}/${MEDIA}/`,
      `jobcam/${ORG}/${MEDIA}/.hidden`, `jobcam/${ORG}/${MEDIA}/x.jpg\n`, `jobcam/${ORG}/${MEDIA}/x y.jpg`, `jobcam/${ORG}/${MEDIA}/..`,
      `jobcam-DEV/${ORG}/${MEDIA}/x.jpg`, `jobcamx/${ORG}/${MEDIA}/x.jpg`, `jobcam/${ORG}/${MEDIA}/%2e%2e`, "",
    ]) expect(() => assertKey(bad), bad).toThrow();
  });

  it("a key belongs to exactly one org + media row", () => {
    expect(keyBelongsTo(`jobcam/${ORG}/${MEDIA}/thumb.jpg`, ORG, MEDIA)).toBe(true);
    expect(keyBelongsTo(`jobcam/other-org/${MEDIA}/thumb.jpg`, ORG, MEDIA)).toBe(false);
    expect(keyBelongsTo(`jobcam/${ORG}/other-media/thumb.jpg`, ORG, MEDIA)).toBe(false);
    expect(keyBelongsTo(`crm-attachments/${ORG}/${MEDIA}/thumb.jpg`, ORG, MEDIA)).toBe(false);
    expect(keyBelongsTo(null, ORG, MEDIA)).toBe(false);
  });

  it("the dev prefix can only be a jobcam-* sibling", () => {
    expect(keyPrefix("")).toBe("jobcam");
    expect(keyPrefix(undefined)).toBe("jobcam");
    expect(keyPrefix("jobcam-dev")).toBe("jobcam-dev");
    for (const bad of ["dev", "jobcam/dev", "jobcam-", "../jobcam", "jobcam-Dev", "crm-attachments"]) expect(() => keyPrefix(bad), bad).toThrow();
  });

  it("passes only a single well-formed byte range to storage", () => {
    expect(cleanRange("bytes=0-99")).toBe("bytes=0-99");
    expect(cleanRange("bytes=100-")).toBe("bytes=100-");
    expect(cleanRange("bytes=-500")).toBe("bytes=-500");
    for (const bad of ["bytes=-", "bytes=9-1", "bytes=0-1,5-9", "items=0-1", "bytes=a-b", "", undefined, ["bytes=0-1"]]) expect(cleanRange(bad)).toBeUndefined();
  });
});

describe("jobcam file sniffing", () => {
  const pad = (b: number[] | Buffer) => Buffer.concat([Buffer.from(b as any), Buffer.alloc(32)]);
  const ftyp = (brand: string) => pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`, "latin1")]));

  it("recognises what the first bytes are", () => {
    expect(sniffMedia(pad([0xff, 0xd8, 0xff, 0xe1]))).toBe("jpeg");
    expect(sniffMedia(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniffMedia(pad(Buffer.from("RIFF\0\0\0\0WEBP", "latin1")))).toBe("webp");
    expect(sniffMedia(pad([0x1a, 0x45, 0xdf, 0xa3]))).toBe("webm");
    expect(sniffMedia(ftyp("heic"))).toBe("heif");
    expect(sniffMedia(ftyp("isom"))).toBe("mp4");
    expect(sniffMedia(ftyp("qt  "))).toBe("mp4");
  });

  it("refuses text formats a decoder could be steered by", () => {
    for (const text of ["#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n", "ffconcat version 1.0\nfile /etc/passwd\n", "<svg xmlns='http://www.w3.org/2000/svg'><image href='file:///etc/passwd'/></svg>", "<?xml version='1.0'?><svg/>      ", "GIF89a" + "\0".repeat(20)]) {
      expect(sniffMedia(Buffer.from(text, "latin1")), text.slice(0, 12)).toBeNull();
    }
    expect(sniffMedia(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it("the sniffed type must fit the row's kind", () => {
    expect(sniffMatchesKind("jpeg", "photo")).toBe(true);
    expect(sniffMatchesKind("heif", "photo")).toBe(true);
    expect(sniffMatchesKind("mp4", "video")).toBe(true);
    expect(sniffMatchesKind("mp4", "photo")).toBe(false);
    expect(sniffMatchesKind("jpeg", "video")).toBe(false);
    expect(sniffMatchesKind(null, "photo")).toBe(false);
  });
});
