import { describe, expect, it } from "vitest";
import { dmsToDecimal, parseExifDate, parseIso6709, videoMetaFromProbe } from "./exif";

const probe = (o: { v?: any; a?: any; brand?: string; bitRate?: number; format?: string; tags?: any }) => ({
  streams: [
    ...(o.v === null ? [] : [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, pix_fmt: "yuv420p", ...(o.v ?? {}) }]),
    ...(o.a === null ? [] : [{ codec_type: "audio", codec_name: "aac", ...(o.a ?? {}) }]),
  ],
  format: {
    format_name: o.format ?? "mov,mp4,m4a,3gp,3g2,mj2", format_long_name: "QuickTime / MOV", duration: "5.000000",
    bit_rate: String(o.bitRate ?? 8_000_000), tags: { major_brand: o.brand ?? "isom", ...(o.tags ?? {}) },
  },
});

describe("jobcam video metadata → playback decision", () => {
  it("an ordinary H.264/AAC .mp4 plays as-is (ffprobe calls every mp4 'QuickTime / MOV')", () => {
    const m = videoMetaFromProbe(probe({}));
    expect(m.container).toBe("mp4");
    expect(m.playable).toBe(true);
    expect(m.remuxable).toBe(false);
    expect(m.durationS).toBe(5);
  });

  it("H.264/AAC in a QuickTime .mov is rewrapped, not re-encoded", () => {
    const m = videoMetaFromProbe(probe({ brand: "qt  " }));
    expect(m.container).toBe("mov");
    expect(m.playable).toBe(false);
    expect(m.remuxable).toBe(true);
  });

  it("HEVC, 10-bit, 4K and heavy bitrates are transcoded", () => {
    for (const p of [
      probe({ v: { codec_name: "hevc" }, brand: "qt  " }),
      probe({ v: { codec_name: "hevc" } }),
      probe({ v: { pix_fmt: "yuv420p10le" } }),
      probe({ v: { width: 3840, height: 2160 } }),
      probe({ bitRate: 45_000_000 }),
      probe({ a: { codec_name: "pcm_s16le" }, brand: "qt  " }),
    ]) {
      const m = videoMetaFromProbe(p);
      expect(m.playable).toBe(false);
      expect(m.remuxable).toBe(false);
    }
  });

  it("VP9/Opus WebM and silent clips play as-is; no video track never does", () => {
    expect(videoMetaFromProbe(probe({ format: "matroska,webm", v: { codec_name: "vp9" }, a: { codec_name: "opus" }, brand: "" })).playable).toBe(true);
    expect(videoMetaFromProbe(probe({ a: null })).playable).toBe(true);
    const none = videoMetaFromProbe(probe({ v: null }));
    expect(none.playable).toBe(false);
    expect(none.videoCodec).toBeNull();
  });

  it("portrait phone video reports the displayed size and the capture place/time", () => {
    const m = videoMetaFromProbe(probe({
      v: { side_data_list: [{ rotation: -90 }] },
      tags: { creation_time: "2026-10-07T18:10:00.000000Z", "com.apple.quicktime.location.ISO6709": "+39.7392-104.9903+1609.000/" },
    }));
    expect([m.width, m.height, m.rotation]).toEqual([1080, 1920, 90]);
    expect(m.lat).toBeCloseTo(39.7392, 4);
    expect(m.lng).toBeCloseTo(-104.9903, 4);
    expect(m.capturedAt?.toISOString()).toBe("2026-10-07T18:10:00.000Z");
  });
});

describe("jobcam EXIF parsing never invents a value", () => {
  it("converts DMS rationals and honours the hemisphere", () => {
    expect(dmsToDecimal([[39, 1], [44, 1], [2112, 100]], "N")).toBeCloseTo(39.7392, 4);
    expect(dmsToDecimal([[104, 1], [59, 1], [2508, 100]], "W")).toBeCloseTo(-104.9903, 4);
    expect(dmsToDecimal([[1, 0], [0, 1], [0, 1]], "N")).toBeNull();
    expect(dmsToDecimal(undefined, "N")).toBeNull();
    expect(dmsToDecimal([[39, 1]], "N")).toBeNull();
  });
  it("parses EXIF dates with and without an offset; garbage is null", () => {
    expect(parseExifDate("2026:10:07 12:30:00", "-06:00")?.toISOString()).toBe("2026-10-07T18:30:00.000Z");
    expect(parseExifDate("2026:10:07 12:30:00")?.toISOString()).toBe("2026-10-07T12:30:00.000Z");
    expect(parseExifDate("0000:00:00 00:00:00")).toBeNull();
    expect(parseExifDate("yesterday")).toBeNull();
    expect(parseExifDate(undefined)).toBeNull();
  });
  it("ISO 6709 locations: in range or nothing", () => {
    expect(parseIso6709("+39.7392-104.9903/")).toEqual({ lat: 39.7392, lng: -104.9903 });
    expect(parseIso6709("+99.0-104.9/")).toBeNull();
    expect(parseIso6709("")).toBeNull();
  });
});
