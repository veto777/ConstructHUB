/**
 * The Code API's git layer: a bare clone of the ConstructHUB repository on
 * this server, read and written with git plumbing (no checkout, no working
 * tree, nothing in it ever runs). Every token works on its own branch
 * `devapi/<token id>`, cut from the base branch when the token is issued; a
 * commit is pushed to origin at once so the owner can review it on GitHub.
 * Only `devapi/*` refs are ever pushed: the owner merges and deploys.
 *
 *   DEV_API_REPO_URL      origin to clone and push (git@github.com:owner/repo.git); unset = Code API off
 *   DEV_API_SSH_KEY       private key file for that origin (a GitHub deploy key with write access)
 *   DEV_API_REPO_DIR      where the bare clone lives (default ~/.constructhub-dev-api/repo.git)
 *   DEV_API_BASE_BRANCH   branch new token branches start from (default main)
 *   DEV_API_GITHUB_REPO   "owner/repo", for compare links in the admin page (optional)
 *
 * git runs through execFile (no shell); every path reaching git has passed
 * ./paths.ts and is placed after "--" or inside a "<ref>:<path>" object name.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathReadable } from "./paths";

export const BRANCH_PREFIX = "devapi/";
export const MAX_FILE_BYTES = 1_000_000;
export const MAX_CHANGES_PER_COMMIT = 100;
export const MAX_PATCH_BYTES = 1_000_000;

export type RepoConfig = { url: string; sshKey: string | null; dir: string; base: string; githubRepo: string | null };

export function repoConfig(env: NodeJS.ProcessEnv = process.env): RepoConfig | null {
  const url = env.DEV_API_REPO_URL?.trim();
  if (!url) return null;
  return {
    url,
    sshKey: env.DEV_API_SSH_KEY?.trim() || null,
    dir: env.DEV_API_REPO_DIR?.trim() || join(homedir(), ".constructhub-dev-api", "repo.git"),
    base: env.DEV_API_BASE_BRANCH?.trim() || "main",
    githubRepo: env.DEV_API_GITHUB_REPO?.trim() || null,
  };
}

export class RepoError extends Error {
  constructor(message: string, public status = 500, public code = "repo_error") { super(message); }
}

type GitOpts = { input?: string | Buffer; env?: Record<string, string>; binary?: boolean; allowFail?: boolean };

export function createRepo(cfg: RepoConfig) {
  const sshEnv: Record<string, string> = cfg.sshKey
    ? { GIT_SSH_COMMAND: `ssh -i ${JSON.stringify(cfg.sshKey)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes` }
    : {};

  function git(args: string[], opts: GitOpts = {}): Promise<{ stdout: Buffer; code: number; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = execFile("git", ["-C", cfg.dir, ...args], {
        encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: 120_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...sshEnv, ...opts.env },
      }, (err: any, stdout, stderr) => {
        const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
        if (err && !opts.allowFail) {
          return reject(new RepoError(`git ${args[0]} failed: ${String(stderr || err.message).trim().slice(0, 500)}`));
        }
        resolve({ stdout: stdout as Buffer, code, stderr: String(stderr) });
      });
      if (opts.input !== undefined) child.stdin!.end(opts.input);
    });
  }
  const text = async (args: string[], opts: GitOpts = {}) => (await git(args, opts)).stdout.toString("utf8").trim();

  // One write at a time per branch inside this process; the CAS in update-ref covers the rest.
  const locks = new Map<string, Promise<unknown>>();
  function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    locks.set(key, run);
    run.finally(() => { if (locks.get(key) === run) locks.delete(key); }).catch(() => {});
    return run;
  }

  let ready: Promise<void> | null = null;
  function ensure(): Promise<void> {
    if (!ready) {
      ready = (async () => {
        if (!existsSync(join(cfg.dir, "HEAD"))) {
          mkdirSync(dirname(cfg.dir), { recursive: true, mode: 0o700 });
          await new Promise<void>((resolve, reject) => execFile("git", ["clone", "--bare", "--quiet", cfg.url, cfg.dir],
            { timeout: 600_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...sshEnv } },
            (err, _o, stderr) => (err ? reject(new RepoError(`Cloning the repository failed: ${String(stderr).trim().slice(0, 500)}`)) : resolve())));
        }
      })().catch((e) => { ready = null; throw e; });
    }
    return ready;
  }

  const branchRef = (branch: string) => {
    if (!branch.startsWith(BRANCH_PREFIX) || !/^devapi\/[a-z0-9_-]{1,64}$/.test(branch)) throw new RepoError("Not a Code API branch.", 400, "bad_branch");
    return `refs/heads/${branch}`;
  };
  const baseRef = `refs/remotes/origin/${cfg.base}`;

  async function fetchBase(): Promise<string> {
    await ensure();
    await git(["fetch", "--quiet", "origin", `+refs/heads/${cfg.base}:${baseRef}`]);
    return text(["rev-parse", "--verify", `${baseRef}^{commit}`]);
  }

  /** Resolve "branch" | "base" to a commit for a token's branch. */
  async function resolve(branch: string, which: "branch" | "base" = "branch"): Promise<string> {
    await ensure();
    const ref = which === "base" ? baseRef : branchRef(branch);
    const out = await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { allowFail: true });
    if (out.code !== 0) throw new RepoError(which === "base" ? "The base branch is not fetched yet." : "This token's branch does not exist.", 404, "not_found");
    return out.stdout.toString().trim();
  }

  async function push(branch: string) {
    await git(["push", "--quiet", "origin", `${branchRef(branch)}:${branchRef(branch)}`]);
  }

  return {
    config: cfg,
    ensure,
    fetchBase,
    resolve,

    /** Cut `branch` from the freshly fetched base and push it. Returns the base commit. */
    async createBranch(branch: string): Promise<string> {
      return locked(branch, async () => {
        const base = await fetchBase();
        await git(["update-ref", branchRef(branch), base, ""]); // "" old value: must not exist yet
        try { await push(branch); } catch (e) { await git(["update-ref", "-d", branchRef(branch)], { allowFail: true }); throw e; }
        return base;
      });
    },

    /** Entries of a directory ("" = root) at a commit; secret locations are left out. */
    async listTree(commit: string, path: string): Promise<{ path: string; type: "file" | "dir"; size: number | null }[]> {
      const spec = path ? `${commit}:${path}` : `${commit}^{tree}`;
      const out = await git(["ls-tree", "-l", "-z", spec], { allowFail: true });
      if (out.code !== 0) throw new RepoError(`No directory at ${path || "/"}.`, 404, "not_found");
      return out.stdout.toString("utf8").split("\0").filter(Boolean).flatMap((line) => {
        const [meta, name] = [line.slice(0, line.indexOf("\t")), line.slice(line.indexOf("\t") + 1)];
        const [, type, , size] = meta.split(/\s+/);
        const full = path ? `${path}/${name}` : name;
        if (!pathReadable(full) || (type !== "blob" && type !== "tree")) return [];
        return [{ path: full, type: type === "tree" ? "dir" as const : "file" as const, size: type === "blob" ? Number(size) : null }];
      });
    },

    /** A file's bytes at a commit, or null when it does not exist. */
    async readFile(commit: string, path: string): Promise<{ content: Buffer; executable: boolean } | null> {
      const ls = await text(["ls-tree", "-z", commit, "--", path]);
      const entry = ls.split("\0").find(Boolean);
      if (!entry || !/^\d+ blob /.test(entry)) return null;
      const out = await git(["cat-file", "blob", `${commit}:${path}`], { allowFail: true });
      if (out.code !== 0) return null;
      return { content: out.stdout, executable: entry.startsWith("100755") };
    },

    /**
     * Apply changes on top of the branch head in one commit and push it.
     * `expectedHead` (optional) refuses the commit when the branch moved (409).
     */
    async commit(branch: string, input: {
      message: string; author: { name: string; email: string }; expectedHead?: string | null;
      changes: { path: string; content: Buffer | null; executable?: boolean }[];
    }): Promise<{ commit: string; parent: string }> {
      return locked(branch, async () => {
        const parent = await resolve(branch);
        if (input.expectedHead && input.expectedHead !== parent) {
          throw new RepoError(`The branch moved: its head is ${parent}, not ${input.expectedHead}. Read again and retry.`, 409, "conflict");
        }
        const tmp = mkdtempSync(join(tmpdir(), "devapi-idx-"));
        const env = { GIT_INDEX_FILE: join(tmp, "index") };
        try {
          await git(["read-tree", parent], { env });
          // One --index-info batch (works in a bare repo): "<mode> <sha>\t<path>", mode 0 removes the path.
          const entries: string[] = [];
          for (const c of input.changes) {
            if (c.content === null) { entries.push(`0 ${"0".repeat(40)}\t${c.path}`); continue; }
            const sha = await text(["hash-object", "-w", "--stdin"], { input: c.content });
            entries.push(`${c.executable ? "100755" : "100644"} ${sha}\t${c.path}`);
          }
          await git(["update-index", "-z", "--index-info"], { env, input: entries.join("\0") + "\0" });
          const tree = await text(["write-tree"], { env });
          const parentTree = await text(["rev-parse", `${parent}^{tree}`]);
          if (tree === parentTree) throw new RepoError("Nothing changed: the files already have this content.", 400, "no_changes");
          const who = { GIT_AUTHOR_NAME: input.author.name, GIT_AUTHOR_EMAIL: input.author.email, GIT_COMMITTER_NAME: "ConstructHUB Code API", GIT_COMMITTER_EMAIL: "support@constructhub.us" };
          const commit = await text(["commit-tree", tree, "-p", parent, "-F", "-"], { input: input.message, env: who });
          await git(["update-ref", branchRef(branch), commit, parent]);
          try { await push(branch); } catch (e) {
            await git(["update-ref", branchRef(branch), parent, commit], { allowFail: true });
            throw e;
          }
          return { commit, parent };
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      });
    },

    /** What the branch changes against the commit it was cut from. */
    async diff(branch: string, baseCommit: string): Promise<{ files: { path: string; status: string; additions: number | null; deletions: number | null }[]; patch: string; truncated: boolean }> {
      const head = await resolve(branch);
      const status = await text(["diff", "--name-status", "-z", "--no-renames", baseCommit, head]);
      const parts = status.split("\0").filter(Boolean);
      const statusOf = new Map<string, string>();
      for (let i = 0; i + 1 < parts.length; i += 2) statusOf.set(parts[i + 1], { A: "added", M: "modified", D: "deleted", T: "modified" }[parts[i][0]] ?? parts[i]);
      const numstat = await text(["diff", "--numstat", "-z", "--no-renames", baseCommit, head]);
      const files = numstat.split("\0").filter(Boolean).map((line) => {
        const [a, d, path] = line.split("\t");
        return { path, status: statusOf.get(path) ?? "modified", additions: a === "-" ? null : Number(a), deletions: d === "-" ? null : Number(d) };
      });
      const raw = (await git(["diff", "--no-renames", baseCommit, head])).stdout;
      const truncated = raw.length > MAX_PATCH_BYTES;
      return { files, patch: raw.subarray(0, MAX_PATCH_BYTES).toString("utf8"), truncated };
    },

    /** Commits on the branch since it was cut, newest first. */
    async log(branch: string, baseCommit: string, limit = 100) {
      const head = await resolve(branch);
      const out = await text(["log", `--max-count=${Math.min(500, Math.max(1, limit))}`, "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e", `${baseCommit}..${head}`]);
      return out.split("\x1e").map((s) => s.trim()).filter(Boolean).map((s) => {
        const [sha, name, email, at, subject] = s.split("\x1f");
        return { sha, author: { name, email }, at, subject };
      });
    },

    /** Fixed-string search (git grep) at a commit; secret locations are dropped. */
    async search(commit: string, query: string, path: string, max = 200) {
      const args = ["grep", "-n", "-I", "-F", "--full-name", "-e", query, commit];
      if (path) args.push("--", path);
      const out = await git(args, { allowFail: true });
      if (out.code === 1) return { matches: [], truncated: false };
      if (out.code !== 0) throw new RepoError("Search failed.", 400, "bad_request");
      const matches: { path: string; line: number; text: string }[] = [];
      for (const raw of out.stdout.toString("utf8").split("\n")) {
        if (!raw) continue;
        const rest = raw.slice(commit.length + 1);
        const m = /^(.*?):(\d+):(.*)$/.exec(rest);
        if (!m || !pathReadable(m[1])) continue;
        matches.push({ path: m[1], line: Number(m[2]), text: m[3].slice(0, 400) });
        if (matches.length >= max) return { matches, truncated: true };
      }
      return { matches, truncated: false };
    },

    compareUrl(branch: string): string | null {
      return cfg.githubRepo ? `https://github.com/${cfg.githubRepo}/compare/${encodeURIComponent(cfg.base)}...${branch.split("/").map(encodeURIComponent).join("/")}` : null;
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;

let shared: Repo | null | undefined;
/** The process's repo, or null when DEV_API_REPO_URL is not set (the Code API is off). */
export function getRepo(): Repo | null {
  if (shared === undefined) {
    const cfg = repoConfig();
    shared = cfg ? createRepo(cfg) : null;
  }
  return shared;
}
