import { describe, expect, it } from "vitest";
import { parseRange, tutorialObject } from "./media";

/** The tutorial media route serves a narrow set of names and must answer byte ranges (iPhones need 206). */
describe("tutorial media: which files it will serve", () => {
  it("accepts only <helpKey>.<hash8>.(mp4|vtt|jpg) and maps it under tutorials/", () => {
    expect(tutorialObject("database-directory.0a1b2c3d.mp4")).toEqual({ key: "tutorials/database-directory.0a1b2c3d.mp4", contentType: "video/mp4" });
    expect(tutorialObject("cloudflare.connections.deadbeef.vtt")).toEqual({ key: "tutorials/cloudflare.connections.deadbeef.vtt", contentType: "text/vtt; charset=utf-8" });
    expect(tutorialObject("jobcam.00000000.jpg")?.contentType).toBe("image/jpeg");
  });

  it("refuses anything else — traversal, other prefixes, other types, missing hash", () => {
    for (const bad of [
      "", ".", "..", "../secrets.0a1b2c3d.mp4", "..%2Fvoice%2Fx.0a1b2c3d.mp4", "a/b.0a1b2c3d.mp4", "a\\b.0a1b2c3d.mp4",
      "database-directory.mp4", "database-directory.0a1b2c3.mp4", "database-directory.0A1B2C3D.mp4", "database-directory.0a1b2c3g.mp4",
      "database-directory.0a1b2c3d.mp4.exe", "database-directory.0a1b2c3d.html", "database-directory.0a1b2c3d.webm", "database-directory.0a1b2c3d.MP4",
      "a.b.c.0a1b2c3d.mp4", "Database.0a1b2c3d.mp4", "x.0a1b2c3d.mp4\n", " x.0a1b2c3d.mp4", "x.0a1b2c3d.mp4?y", `${"a".repeat(200)}.0a1b2c3d.mp4`,
    ]) expect(tutorialObject(bad), JSON.stringify(bad)).toBeNull();
    for (const bad of [undefined, null, 7, ["x.0a1b2c3d.mp4"], { file: "x" }]) expect(tutorialObject(bad)).toBeNull();
  });
});

describe("tutorial media: Range", () => {
  const SIZE = 5000;
  it("reads first-byte, open-ended and suffix ranges", () => {
    expect(parseRange("bytes=0-1023", SIZE)).toEqual({ start: 0, end: 1023 });
    expect(parseRange("bytes=0-0", SIZE)).toEqual({ start: 0, end: 0 });
    expect(parseRange("bytes=0-1", SIZE)).toEqual({ start: 0, end: 1 }); // Safari's opening probe
    expect(parseRange("bytes=1000-", SIZE)).toEqual({ start: 1000, end: 4999 });
    expect(parseRange("bytes=-500", SIZE)).toEqual({ start: 4500, end: 4999 });
    expect(parseRange(" bytes=4999-4999 ", SIZE)).toEqual({ start: 4999, end: 4999 });
  });

  it("clamps an end past the file and a suffix longer than the file", () => {
    expect(parseRange("bytes=4000-99999", SIZE)).toEqual({ start: 4000, end: 4999 });
    expect(parseRange("bytes=-99999", SIZE)).toEqual({ start: 0, end: 4999 });
  });

  it("says unsatisfiable when the range starts past the end (416)", () => {
    expect(parseRange("bytes=5000-", SIZE)).toBe("unsatisfiable");
    expect(parseRange("bytes=9000-9100", SIZE)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", SIZE)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-10", 0)).toBe("unsatisfiable");
  });

  it("ignores what it does not understand and serves the whole file", () => {
    for (const raw of [undefined, "", "bytes=", "bytes=-", "bytes=a-b", "bytes=10-5", "items=0-10", "bytes=0-10,20-30", "bytes=0-10\r\nX: y", "bytes=1e3-2e3", ["bytes=0-1"]])
      expect(parseRange(raw, SIZE), JSON.stringify(raw)).toBeNull();
  });
});
