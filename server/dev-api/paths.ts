/**
 * What the Code API may read and write in the repository. Pure: no git, no IO.
 *
 * A path is repo-relative ("server/routes.ts"): no leading slash, no "..", no
 * backslash. Secrets never leave the server even though they are gitignored
 * (a token holder could have committed one): .env*, secrets/, private/, keys/,
 * analysis/ (live account data) and key files are neither readable nor writable.
 * Writing is narrower still: .github/ (a pushed workflow would run with the
 * repo's Actions secrets), .gitmodules, .gitignore and .husky/ are refused.
 *
 * "Sensitive" files may be written but are flagged for the owner's review:
 * they run on the owner's machines at install/build/deploy time.
 */

export const MAX_PATH_LENGTH = 400;

const DENIED_SEGMENTS = new Set(["secrets", "private", "keys", "analysis", "node_modules", ".git", "pgdata", "backups"]);
const DENIED_FILE = [/^\.env(\..*)?$/i, /\.(pem|key|p12|pfx|keystore|jks)$/i, /^id_(rsa|ed25519|ecdsa|dsa)/i, /^\.npmrc$/i, /^\.netrc$/i];
const WRITE_DENIED_PREFIX = [".github/", ".husky/"];
const WRITE_DENIED_FILE = new Set([".gitmodules", ".gitignore", ".gitattributes"]);
const SENSITIVE = [
  /^package(-lock)?\.json$/, /^script\//, /^scripts\//, /^ops\//, /^tunnel\//, /\.sh$/, /(^|\/)Dockerfile$/,
  /^drizzle\.config\.ts$/, /^vite\.config\.ts$/, /^server\/index\.ts$/, /^server\/auth\.ts$/, /^server\/admin\.ts$/,
  /^server\/dev-api\//, /^server\/account-security\.ts$/,
];

/** The normalized path, or null when it is not an acceptable repo path. "" is the repo root. */
export function normalizeRepoPath(raw: unknown, { allowRoot = false } = {}): string | null {
  if (typeof raw !== "string") return allowRoot && raw == null ? "" : null;
  const s = raw.trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (s === "" || s === ".") return allowRoot ? "" : null;
  if (s.length > MAX_PATH_LENGTH || s.startsWith("/") || s.includes("\\") || /[\u0000-\u001f\u007f]/.test(s)) return null;
  const parts = s.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  return parts.join("/");
}

/** Readable (and listable) by a token: false for secrets and key material. */
export function pathReadable(path: string): boolean {
  if (path === "") return true;
  const parts = path.split("/");
  if (parts.some((p) => DENIED_SEGMENTS.has(p.toLowerCase()))) return false;
  const file = parts[parts.length - 1];
  return !DENIED_FILE.some((re) => re.test(file));
}

/** Writable by a token with the write scope. */
export function pathWritable(path: string): boolean {
  if (!path || !pathReadable(path)) return false;
  if (WRITE_DENIED_PREFIX.some((p) => path.startsWith(p))) return false;
  return !WRITE_DENIED_FILE.has(path);
}

/** Runs on the owner's machines at install, build or deploy time: the diff calls these out. */
export function pathSensitive(path: string): boolean {
  return SENSITIVE.some((re) => re.test(path));
}

/** Why a write is refused, in one sentence (null when it is allowed). */
export function writeRefusal(path: string): string | null {
  if (!pathReadable(path)) return `${path} is a secret or key location; the Code API cannot touch it.`;
  if (!pathWritable(path)) return `${path} cannot be changed through the Code API (CI, git and hook config are owner-only).`;
  return null;
}
