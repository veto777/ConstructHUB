import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickZipMember, unzipFirst } from "./g6-common";

describe("g6 zip members", () => {
  it("picks the one member that matches, folders aside", () => {
    expect(pickZipMember(["FILEDESC.TXT", "ELC.TXT", ""], /^(?!FILEDESC).*\.TXT$/i)).toBe("ELC.TXT");
    expect(pickZipMember(["export/", "export/rows.csv"], /\.csv$/i)).toBe("export/rows.csv");
  });
  it("refuses to guess between several matching members (readdir order is arbitrary)", () => {
    expect(() => pickZipMember(["A.TXT", "B.TXT"], /\.TXT$/i)).toThrow(/2 matching files/);
    expect(() => pickZipMember(["a.csv", "b.csv"])).toThrow(/expected one/);
    expect(() => pickZipMember(["readme.pdf"], /\.csv$/i)).toThrow(/no matching file/);
  });
  it("extracts the chosen member from a real zip", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "g6-test-"));
    await fs.mkdir(join(dir, "sub"));
    await fs.writeFile(join(dir, "FILEDESC.TXT"), "layout");
    await fs.writeFile(join(dir, "sub", "DATA.TXT"), "rows");
    execFileSync("zip", ["-q", "-r", "t.zip", "FILEDESC.TXT", "sub"], { cwd: dir });
    const out = await unzipFirst(join(dir, "t.zip"), /^(?!FILEDESC).*\.TXT$/i);
    expect(await fs.readFile(out, "utf8")).toBe("rows");
    await fs.rm(out); await fs.rm(dir, { recursive: true, force: true });
  });
});
