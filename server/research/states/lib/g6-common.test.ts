import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session, pickZipMember, unzipFirst } from "./g6-common";
import { PortalBlockedError, resetHostState } from "../../http";

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

describe("g6 Session (round 2, decision 6)", () => {
  afterEach(() => { vi.unstubAllGlobals(); resetHostState(); });
  it("a 403 ends the search and blocks the host: the next request is never sent", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      const url = String(u);
      calls.push(url);
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      return new Response("denied", { status: 403 });
    }));
    const s = new Session(0);
    await expect(s.fetch("https://g6.example.test/search")).rejects.toBeInstanceOf(PortalBlockedError);
    await expect(s.fetch("https://g6.example.test/detail?id=2")).rejects.toBeInstanceOf(PortalBlockedError);
    expect(calls.filter((c) => !c.endsWith("/robots.txt"))).toEqual(["https://g6.example.test/search"]);
  });
  it("redirects are followed with the session cookie, each hop checked against robots.txt", async () => {
    const calls: { url: string; cookie: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL, init?: RequestInit) => {
      const url = String(u);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /private/\n", { status: 200 });
      calls.push({ url, cookie: new Headers(init?.headers).get("cookie") });
      if (url.endsWith("/start")) return new Response("", { status: 302, headers: { location: "/private/x", "set-cookie": "sid=1; path=/" } });
      return new Response("ok", { status: 200 });
    }));
    const s = new Session(0);
    await expect(s.fetch("https://g6b.example.test/start")).rejects.toThrow(/robots\.txt disallows/);
    expect(calls.map((c) => c.url)).toEqual(["https://g6b.example.test/start"]);
  });
});
