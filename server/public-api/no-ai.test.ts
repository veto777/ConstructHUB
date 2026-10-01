/**
 * NO AI RULE for the public API: nothing under server/public-api/*, and no
 * file that registers a public-API resource, may reach OpenAI or a
 * TruthCoder generator through its imports — directly or transitively.
 *
 * Walks the static import graph (import/export-from/dynamic import/require)
 * from every public-API module and every caller of registerResource, and
 * names the exact chain when an AI module is reachable. No DB needed.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const API_DIR = path.join(ROOT, "server/public-api");
const SERVER_DIR = path.join(ROOT, "server");

/** AI SDKs: any module importing one is an AI module. */
export const FORBIDDEN_PACKAGES = ["openai", "@anthropic-ai/sdk", "@google/generative-ai"];
/** Known TruthCoder modules (the contract's list) — reachable = fail, whatever they import. */
export const FORBIDDEN_FILES = [
  "server/ai-config.ts",
  "server/ai-output.ts",
  "server/gbp/content.ts",
  "server/gbp/review-automation.ts",
  "server/social/service.ts",
  "server/sitescan/providers.ts",
  "server/site-assistant.ts",
  "server/ads-consultant.ts",
];

const isTest = (f: string) => /\.test\.tsx?$/.test(f);
const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join("/");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Module specifiers a file imports (static, re-export, dynamic, require). */
export function importSpecifiers(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  const patterns = [
    /\bimport\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) for (let m = re.exec(code); m; m = re.exec(code)) out.push(m[1]);
  return [...new Set(out)];
}

type Node = { kind: "file"; abs: string } | { kind: "package"; name: string };

function resolveSpecifier(fromFile: string, spec: string): Node | null {
  if (spec.startsWith("node:")) return null;
  let base: string | null = null;
  if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else if (spec.startsWith("@shared/")) base = path.join(ROOT, "shared", spec.slice("@shared/".length));
  else if (spec.startsWith("@/")) base = path.join(ROOT, "client/src", spec.slice(2));
  if (!base) {
    const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    return { kind: "package", name };
  }
  const candidates = [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isFile()) return { kind: "file", abs: c };
  return null;
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") out.push(...listTsFiles(abs)); }
    else if (/\.tsx?$/.test(entry.name) && !isTest(entry.name)) out.push(abs);
  }
  return out;
}

/**
 * Every non-test file in server/public-api plus every server file that
 * registers a resource (imports from server/public-api and calls
 * registerResource). server/routes.ts only mounts the API (registerPublicApi)
 * and is the app root, so it is not an entry.
 */
function entryFiles(): string[] {
  const api = listTsFiles(API_DIR);
  const registrars = listTsFiles(SERVER_DIR).filter((f) => {
    if (f.startsWith(API_DIR + path.sep)) return false;
    const src = stripComments(fs.readFileSync(f, "utf8"));
    if (!/\bregisterResource\s*\(/.test(src)) return false;
    return importSpecifiers(src).some((s) => {
      const r = resolveSpecifier(f, s);
      return r?.kind === "file" && r.abs.startsWith(API_DIR + path.sep);
    });
  });
  return [...api, ...registrars];
}

type Violation = { chain: string[]; reason: string };

/** BFS the import graph from `entry`; returns the first forbidden reach (with its chain) or null. */
export function findAiReach(entry: string, forbiddenFiles = FORBIDDEN_FILES, forbiddenPackages = FORBIDDEN_PACKAGES): Violation | null {
  const forbidden = new Set(forbiddenFiles.map((f) => path.join(ROOT, f)));
  const parent = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  const chainTo = (abs: string) => { const c: string[] = []; for (let cur: string | null | undefined = abs; cur; cur = parent.get(cur)) c.unshift(rel(cur)); return c; };
  while (queue.length) {
    const file = queue.shift()!;
    if (forbidden.has(file)) return { chain: chainTo(file), reason: `${rel(file)} is a TruthCoder AI module` };
    const src = fs.readFileSync(file, "utf8");
    for (const spec of importSpecifiers(src)) {
      const node = resolveSpecifier(file, spec);
      if (!node) continue;
      if (node.kind === "package") {
        if (forbiddenPackages.includes(node.name)) return { chain: [...chainTo(file), node.name], reason: `${rel(file)} imports the AI SDK "${node.name}"` };
        continue;
      }
      if (!parent.has(node.abs)) { parent.set(node.abs, file); queue.push(node.abs); }
    }
  }
  return null;
}

describe("public API never reaches TruthCoder AI", () => {
  it("knows the AI modules it guards against", () => {
    const present = FORBIDDEN_FILES.filter((f) => fs.existsSync(path.join(ROOT, f)));
    // A rename would silently weaken the guard: most of the list must still exist.
    expect(present.length).toBeGreaterThanOrEqual(5);
    // Each generator imports the SDK or the AI configuration (ai-config / ai-output ARE the configuration).
    for (const f of present.filter((f) => !/\/ai-(config|output)\.ts$/.test(f))) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      const importsAi = importSpecifiers(src).some((s) => FORBIDDEN_PACKAGES.includes(s) || /ai-(config|output)$/.test(s));
      expect(importsAi, `${f} no longer looks like an AI module — update FORBIDDEN_FILES`).toBe(true);
    }
  });

  it("parses every import form", () => {
    const src = `import a from "./a"; import { b } from './b'; import type { C } from "../c";
      import "./side"; export * from "./d"; export { e } from "@shared/e"; const f = await import("./f"); const g = require("openai");
      // import x from "./commented"
      /* import y from "./blocked" */`;
    expect(importSpecifiers(src)).toEqual(["./a", "./b", "../c", "./side", "./d", "@shared/e", "./f", "openai"]);
  });

  it("walks from every public-API module and every resource registrar", () => {
    const entries = entryFiles();
    expect(entries.map(rel)).toContain("server/public-api/index.ts");
    const violations = entries.map((e) => ({ entry: rel(e), v: findAiReach(e) })).filter((x) => x.v);
    const report = violations.map(({ entry, v }) => `  ${entry}: ${v!.reason}\n    ${v!.chain.join(" → ")}`).join("\n");
    expect(violations, `AI modules are reachable from the public API:\n${report}`).toEqual([]);
  });

  it("would catch a resource that imports a generator", () => {
    // The walker is only worth something if it actually flags the known modules.
    const offender = FORBIDDEN_FILES.map((f) => path.join(ROOT, f)).find((f) => fs.existsSync(f))!;
    const v = findAiReach(offender);
    expect(v?.chain[0]).toBe(rel(offender));
    const sdkUser = listTsFiles(SERVER_DIR).find((f) => importSpecifiers(fs.readFileSync(f, "utf8")).includes("openai"));
    expect(sdkUser, "no server module imports openai any more — revisit FORBIDDEN_PACKAGES").toBeTruthy();
    expect(findAiReach(sdkUser!, [])?.reason).toMatch(/imports the AI SDK "openai"/);
  });
});
