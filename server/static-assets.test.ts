/**
 * A tab that outlived a deploy (the "'text/html' is not a valid JavaScript
 * MIME type" reports):
 *
 *   the server  a missing /assets/… bundle — or any missing static file — is a
 *               plain 404 marked no-store on every host, never the app's HTML;
 *               hashed bundles are immutable; every HTML answer is no-cache
 *   the client  one reload to the new build, guarded against loops; no reload
 *               (and an honest outcome) when the build is the same, the server
 *               is unreachable, or the tab just reloaded
 *   the page    /property's search box hands its text to a typed handler
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { HTML_CACHE, IMMUTABLE_CACHE, isStaticFilePath, serveStatic } from "./static";
import { PORTAL_HOSTS } from "./site-context";
import {
  RELOAD_KEY, RELOAD_WINDOW_MS, assetRefs, decideStaleBuild, isChunkLoadError, isChunkLoadMessage, isNewerBuild, takeReloadSlot,
  type StaleBuildEnv,
} from "../client/src/lib/stale-build";
import { CHUNK_LOAD_RE } from "./ops/fingerprint";

const read = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");
const indexHtml = (hash: string) => `<!doctype html><html><head><title>ConstructHUB</title>
<script type="module" crossorigin src="/assets/index-${hash}.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-${hash}.css"></head><body><div id="root"></div></body></html>`;

describe("static files (server/static.ts)", () => {
  let server: Server;
  let base = "";
  let tmp = "";
  const get = (url: string, headers: Record<string, string> = {}) => fetch(`${base}${url}`, { headers, redirect: "manual" });

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chub-static-"));
    const pub = path.join(tmp, "public");
    fs.mkdirSync(path.join(pub, "assets"), { recursive: true });
    fs.mkdirSync(path.join(pub, "mascot"), { recursive: true });
    fs.writeFileSync(path.join(pub, "index.html"), indexHtml("NEWbuild"));
    fs.writeFileSync(path.join(pub, "assets", "index-NEWbuild.js"), "console.log('app')");
    fs.writeFileSync(path.join(pub, "assets", "index-NEWbuild.css"), "body{}");
    fs.writeFileSync(path.join(pub, "favicon.png"), "png");
    fs.writeFileSync(path.join(pub, "mascot", "gabe-160.v1.webp"), "webp");
    const app = express();
    serveStatic(app, pub);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("answers a bundle that is gone with a plain 404, no-store — on the marketing host and on the CRM host", async () => {
    for (const headers of [{}, { "x-forwarded-host": PORTAL_HOSTS[0] }] as Record<string, string>[]) {
      for (const url of ["/assets/schedule-OLDbuild.js", "/assets/index-OLDbuild.css", "/assets/does-not-exist-abc123.js?v=1", "/assets/", "/assets/nested/x"]) {
        const res = await get(url, headers);
        const body = await res.text();
        expect([url, res.status]).toEqual([url, 404]);
        expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(body).toBe("Not found\n");
        expect(body).not.toContain("<html");
      }
    }
  });

  it("answers any other missing static file the same way (the image Cloudflare once cached as HTML for 4 h)", async () => {
    for (const url of ["/mascot/gabe-161.webp", "/logo-new.png", "/fonts/x.woff2", "/app.js.map", "/data.json", "/x.pdf"]) {
      const res = await get(url);
      expect([url, res.status, res.headers.get("cache-control")]).toEqual([url, 404, "no-store"]);
      expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    }
    expect(isStaticFilePath("/assets/anything")).toBe(true);
    expect(isStaticFilePath("/crm/schedule")).toBe(false);
    expect(isStaticFilePath("/domains/example.com")).toBe(false);
    expect(isStaticFilePath("/site-scan/acme.io")).toBe(false);
  });

  it("serves hashed bundles as immutable and files that keep their name as revalidated", async () => {
    const js = await get("/assets/index-NEWbuild.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toMatch(/javascript/);
    expect(js.headers.get("cache-control")).toBe(IMMUTABLE_CACHE);
    expect(IMMUTABLE_CACHE).toBe("public, max-age=31536000, immutable");
    expect((await get("/assets/index-NEWbuild.css")).headers.get("cache-control")).toBe(IMMUTABLE_CACHE);
    const icon = await get("/favicon.png");
    expect(icon.status).toBe(200);
    expect(icon.headers.get("cache-control")).not.toMatch(/immutable/);
  });

  it("serves every HTML answer no-cache, so a reload after a deploy gets the new bundle names", async () => {
    expect(HTML_CACHE).toBe("no-cache");
    for (const [url, headers, status] of [
      ["/", {}, 200], ["/pricing", {}, 200], ["/crm/schedule", {}, 200], ["/no/such/page", {}, 404],
      ["/crm/schedule", { "x-forwarded-host": PORTAL_HOSTS[0] }, 200], ["/index.html", {}, 200],
    ] as [string, Record<string, string>, number][]) {
      const res = await get(url, headers);
      const body = await res.text();
      expect([url, res.status]).toEqual([url, status]);
      expect(res.headers.get("content-type")).toMatch(/^text\/html/);
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(assetRefs(body)).toContain("/assets/index-NEWbuild.js");
    }
  });
});

describe("the stale tab (client/src/lib/stale-build.ts)", () => {
  const memoryStorage = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  };
  const env = (o: Partial<StaleBuildEnv> = {}): StaleBuildEnv & { reloads: number; notices: number } => {
    const e: any = {
      storage: memoryStorage(), now: () => 1_000_000, currentAssets: () => ["/assets/index-OLDbuild.js"],
      fetchIndex: async () => indexHtml("NEWbuild"), reloads: 0, notices: 0,
      showUpdating: () => { e.notices++; }, reload: () => { e.reloads++; }, ...o,
    };
    return e;
  };

  it("knows every browser's wording for a bundle that would not load — the same list the server groups by", () => {
    for (const m of [
      "TypeError: 'text/html' is not a valid JavaScript MIME type.",
      "TypeError: Failed to fetch dynamically imported module: https://constructhub.us/assets/schedule-BxK3_9aZ.js",
      "TypeError: Importing a module script failed.",
      "TypeError: error loading dynamically imported module: https://x/assets/a.js",
      "Error: Unable to preload CSS for /assets/schedule-AAAA1111.css",
      "ChunkLoadError: Loading chunk 12 failed.",
    ]) {
      expect([m, isChunkLoadMessage(m)]).toEqual([m, true]);
      expect(CHUNK_LOAD_RE.test(m)).toBe(true);
    }
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'value')"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(read("client/src/lib/stale-build.ts")).toContain(CHUNK_LOAD_RE.source);
  });

  it("reloads once when the server has a newer build, saying so first", async () => {
    const e = env();
    expect(await decideStaleBuild(e)).toBe("reloading");
    expect([e.notices, e.reloads]).toEqual([1, 1]);
    expect(e.storage!.getItem(RELOAD_KEY)).toBe("1000000");
  });

  it("never loops: a tab that just reloaded and still fails does not reload again, until the window has passed", async () => {
    const e = env();
    expect(await decideStaleBuild(e)).toBe("reloading");
    expect(await decideStaleBuild(e)).toBe("already_reloaded");
    e.now = () => 1_000_000 + RELOAD_WINDOW_MS - 1;
    expect(await decideStaleBuild(e)).toBe("already_reloaded");
    expect(e.reloads).toBe(1);
    e.now = () => 1_000_000 + RELOAD_WINDOW_MS + 1; // a later deploy, the same tab
    expect(await decideStaleBuild(e)).toBe("reloading");
    expect(e.reloads).toBe(2);
  });

  it("does not reload when sessionStorage is unavailable or broken (nothing could stop a loop)", async () => {
    for (const storage of [null, { getItem: () => { throw new Error("denied"); }, setItem: () => {} }, { getItem: () => null, setItem: () => {} }]) {
      const e = env({ storage: storage as any });
      expect(await decideStaleBuild(e)).toBe("already_reloaded");
      expect(e.reloads).toBe(0);
    }
    expect(takeReloadSlot(null, 1)).toBe(false);
  });

  it("does not reload when the build is the same (a real fault) or the server cannot be reached", async () => {
    const same = env({ currentAssets: () => ["/assets/index-NEWbuild.js"] });
    expect(await decideStaleBuild(same)).toBe("same_build");
    const offline = env({ fetchIndex: async () => { throw new TypeError("Load failed"); } });
    expect(await decideStaleBuild(offline)).toBe("offline");
    const down = env({ fetchIndex: async () => null });
    expect(await decideStaleBuild(down)).toBe("offline");
    // The dev server has no hashed entry bundle: never a reload.
    expect(await decideStaleBuild(env({ currentAssets: () => [] }))).toBe("same_build");
    expect(same.reloads + offline.reloads + down.reloads).toBe(0);
    expect(isNewerBuild(["/assets/index-A.js"], "<p>maintenance</p>")).toBe(false);
  });

  it("is what every lazy page goes through, and a stale bundle is not reported as an issue", () => {
    const app = read("client/src/App.tsx");
    expect(app).not.toMatch(/\blazy\(/);
    expect(app.match(/= lazyPage\(\(\) => import\(/g)!.length).toBeGreaterThan(30);
    const reporter = read("client/src/lib/report-client-errors.ts");
    expect(reporter).toMatch(/isChunkLoadMessage\(message\)/);
    expect(reporter).toMatch(/outcome !== "reloading" && outcome !== "offline"/);
  });
});

describe("/property search (the \"reading 'value'\" browser error)", () => {
  it("hands the Toolbar a handler that takes the text, as the Toolbar's type says", () => {
    const page = read("client/src/pages/property.tsx");
    expect(page).toMatch(/const handleSearchChange = \(value: string\) =>/);
    expect(page).not.toMatch(/handleSearchChange = \(e: any\)/);
    expect(read("client/src/components/app-ui.tsx")).toMatch(/search\?: \{ value: string; onChange: \(v: string\) => void;/);
  });

  it("no page passes Toolbar's search an untyped (any) handler — the way that bug got past tsc", () => {
    const root = path.resolve(import.meta.dirname, "..", "client", "src");
    const files: string[] = [];
    const walk = (dir: string) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) f.isDirectory() ? walk(path.join(dir, f.name)) : f.name.endsWith(".tsx") && files.push(path.join(dir, f.name)); };
    walk(root);
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/search=\{\{[\s\S]{0,200}?onChange:\s*([A-Za-z_$][\w$.]*)\s*[,}]/g)) {
        const name = m[1].split(".").pop()!;
        if (new RegExp(`(?:const|let|function)\\s+${name}\\s*=?\\s*(?:async\\s*)?\\(\\s*\\w+\\s*:\\s*any\\b`).test(src)) offenders.push(`${path.relative(root, file)}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
