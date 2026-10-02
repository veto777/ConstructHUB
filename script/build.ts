import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, mkdir, cp, writeFile } from "fs/promises";
import { execFileSync } from "child_process";
import { routeSourceFile } from "../shared/seo";
import { PUBLIC_ROUTES, SEO_MANIFEST } from "../server/static";
import { prerenderMarketingPages } from "./prerender";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "archiver",
  "axios",
  "bcryptjs",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-google-oauth20",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    banner: {
      js: `const { createRequire: __bundled_createRequire } = require("module");
const __bundled_require = __bundled_createRequire(__filename);
const { URL: __bundled_URL } = require("url");
const __bundled_import_meta_url = require("url").pathToFileURL(__filename).href;
var import_meta_url = __bundled_import_meta_url;`,
    },
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.url": "import_meta_url",
      "import.meta.dirname": "__dirname",
      "import.meta.filename": "__filename",
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  console.log("copying server data files...");
  await mkdir("dist/data", { recursive: true });
  await cp("server/data", "dist/data", { recursive: true });

  console.log("writing sitemap dates...");
  await writeSeoManifest();

  console.log("prerendering marketing pages...");
  await prerenderStep();
}

/**
 * dist/seo-manifest.json: each public page's <lastmod> for the sitemap — the
 * last commit of the file that holds its content (shared/seo.ts
 * routeSourceFile), or the build date when git can't say.
 */
async function writeSeoManifest() {
  const today = new Date().toISOString().slice(0, 10);
  const lastmod: Record<string, string> = {};
  for (const route of PUBLIC_ROUTES) {
    const file = routeSourceFile(route);
    let date = "";
    if (file) {
      try {
        date = execFileSync("git", ["log", "-1", "--format=%cs", "--", file], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch { /* not a git checkout: the build date stands in */ }
    }
    lastmod[route] = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  }
  await writeFile(`dist/${SEO_MANIFEST}`, JSON.stringify({ builtAt: new Date().toISOString(), lastmod }, null, 2));
}

/**
 * The prerendered marketing pages (script/prerender.ts). Never blocks a
 * deploy: if Chromium is missing or a page fails, the build still succeeds,
 * says so loudly, and those pages ship as the plain SPA shell (as before).
 * SKIP_PRERENDER=1 skips it on purpose.
 */
async function prerenderStep() {
  const banner = (lines: string[]) => console.warn(["", "!".repeat(78), ...lines.map((l) => `!! ${l}`), "!".repeat(78), ""].join("\n"));
  if (process.env.SKIP_PRERENDER === "1") {
    banner(["PRERENDER SKIPPED (SKIP_PRERENDER=1): marketing pages ship as the SPA shell only."]);
    return;
  }
  try {
    const result = await prerenderMarketingPages({ publicDir: "dist/public" });
    if (result.apiCalls.length) console.log(`  API calls refused while prerendering (filled in on boot): ${result.apiCalls.join(", ")}`);
    if (result.failed.length) {
      banner([
        `PRERENDER INCOMPLETE: ${result.failed.length} page(s) ship as the SPA shell only:`,
        ...result.failed.map((f) => `  ${f.route} — ${f.reason}`),
        "The build continues; fix and rebuild to prerender them.",
      ]);
    }
  } catch (err: any) {
    banner([
      "PRERENDER FAILED: every marketing page ships as the SPA shell only.",
      String(err?.message ?? err).split("\n")[0],
      "The build continues. Is playwright-core's chromium-headless-shell installed?",
      "  npx playwright-core install chromium-headless-shell",
    ]);
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
