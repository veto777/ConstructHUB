import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, mkdir, cp } from "fs/promises";

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
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
