import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execFileSync } from "child_process";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

/**
 * `virtual:research-coverage`: what the research bot searches in each state (/compliance/research/coverage), generated
 * from the bot's own source registry by script/research-coverage.ts when the module is first loaded, so every build
 * (and dev server) carries the sources it actually ships. Offline and database-free; a failure fails the build.
 */
function researchCoverage(): Plugin {
  const id = "virtual:research-coverage";
  let json: string | null = null;
  return {
    name: "research-coverage",
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(loaded) {
      if (loaded !== `\0${id}`) return undefined;
      json ??= execFileSync(process.execPath, ["--import", "tsx", "script/research-coverage.ts"], {
        cwd: import.meta.dirname, encoding: "utf8", maxBuffer: 64 << 20, timeout: 5 * 60_000,
        env: { ...process.env, DATABASE_URL: "" }, stdio: ["ignore", "pipe", "ignore"],
      });
      JSON.parse(json); // a cut-off or noisy output fails here, not in the browser
      return `export default ${json};`;
    },
  };
}

export default defineConfig({
  // Worktrees share node_modules; dependency caches must stay lane-local.
  // VITE_CACHE_DIR: several dev servers of ONE working copy (the tutorial recording slots) each need their own.
  cacheDir: process.env.VITE_CACHE_DIR ? path.resolve(process.env.VITE_CACHE_DIR) : path.resolve(import.meta.dirname, ".cache/vite"),
  plugins: [
    react(),
    researchCoverage(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
