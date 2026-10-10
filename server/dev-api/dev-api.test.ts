/**
 * The Code API (server/dev-api) without a database:
 *   1. paths.ts — what may be read, written and what is flagged for review.
 *   2. tokens.ts — the issue request's rules and the token format.
 *   3. repo.ts — the git layer against a throwaway "GitHub" (a local bare repo):
 *      a branch per token, reads, a commit that is pushed, the CAS on expectedHead,
 *      deletes, diff/log/search, and that only devapi/* is ever pushed.
 *   4. guard.ts — a chdev_ token is refused outside /api/dev/v1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeRepoPath, pathReadable, pathSensitive, pathWritable, writeRefusal } from "./paths";
import { DEV_TOKEN_RE, newTokenIdentity, parseDevToken, tokenStatus, validateIssue } from "./tokens";
import { createRepo, RepoError, type Repo } from "./repo";
import { isDevApiPath, rejectDevTokensOutsideDevApi } from "./guard";

describe("paths", () => {
  it("normalizes repo-relative paths and refuses escapes", () => {
    expect(normalizeRepoPath("server/routes.ts")).toBe("server/routes.ts");
    expect(normalizeRepoPath("./client/src/")).toBe("client/src");
    for (const bad of ["/etc/passwd", "../x", "a/../b", "a//b", "a\\b", "a/./b", "x\u0000", 5, null]) expect(normalizeRepoPath(bad)).toBeNull();
    expect(normalizeRepoPath("", { allowRoot: true })).toBe("");
    expect(normalizeRepoPath("")).toBeNull();
  });
  it("keeps secrets unreadable", () => {
    for (const p of [".env", ".env.local", "server/.env.production", "secrets/cf.txt", "private/ein.pdf", "keys/a", "analysis/x.json", "ops/id_ed25519", "certs/site.pem", "a/b.key", ".npmrc", "node_modules/x/y.js", ".git/config"]) {
      expect(pathReadable(p), p).toBe(false);
      expect(pathWritable(p), p).toBe(false);
    }
    for (const p of ["server/routes.ts", "client/src/App.tsx", "package.json", "docs/env.md", "server/environment.ts"]) expect(pathReadable(p), p).toBe(true);
  });
  it("refuses CI, hooks and git config writes but allows reading them", () => {
    for (const p of [".github/workflows/ci.yml", ".husky/pre-commit", ".gitignore", ".gitmodules", ".gitattributes"]) {
      expect(pathReadable(p), p).toBe(true);
      expect(pathWritable(p), p).toBe(false);
      expect(writeRefusal(p)).toMatch(/cannot be changed/);
    }
    expect(writeRefusal(".env")).toMatch(/secret/);
    expect(writeRefusal("server/x.ts")).toBeNull();
  });
  it("flags files that run on the owner's machines", () => {
    for (const p of ["package.json", "package-lock.json", "scripts/deploy.ts", "script/build.ts", "ops/run.sh", "server/index.ts", "server/dev-api/paths.ts"]) expect(pathSensitive(p), p).toBe(true);
    for (const p of ["client/src/pages/home.tsx", "server/routes.ts"]) expect(pathSensitive(p), p).toBe(false);
  });
});

describe("tokens", () => {
  it("issues chdev_ tokens tied to their own branch", () => {
    const id = newTokenIdentity();
    expect(id.token).toMatch(DEV_TOKEN_RE);
    expect(id.branch).toBe(`devapi/${id.id.slice(4)}`);
    expect(parseDevToken(`Bearer ${id.token}`)).toEqual({ token: id.token, prefix: id.prefix });
    expect(parseDevToken("Bearer chub_abcdefgh_" + "a".repeat(64))).toBeNull();
  });
  it("accepts 24–48 hours only, and write always with read", () => {
    const ok = { name: "Codex agent", holderType: "agent", hours: 24, scopes: ["read", "write"] };
    expect(validateIssue(ok)).toEqual({ name: "Codex agent", holderType: "agent", hours: 24, scopes: ["read", "write"] });
    expect(validateIssue({ ...ok, hours: 48 })).not.toBeTypeOf("string");
    for (const hours of [23, 49, 24.5, "24", 0, 720]) expect(validateIssue({ ...ok, hours })).toMatch(/24 to 48 hours/);
    expect(validateIssue({ ...ok, scopes: ["write"] })).toMatch(/also needs "read"/);
    expect(validateIssue({ ...ok, scopes: ["admin"] })).toMatch(/scopes/);
    expect(validateIssue({ ...ok, holderType: "robot" })).toMatch(/agent/);
    expect(validateIssue({ ...ok, name: "  " })).toMatch(/Name/);
  });
  it("reports live, expired and revoked", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(tokenStatus({ revokedAt: null, expiresAt: new Date("2026-10-11T12:00:00Z") }, now)).toBe("live");
    expect(tokenStatus({ revokedAt: null, expiresAt: new Date("2026-10-10T11:59:59Z") }, now)).toBe("expired");
    expect(tokenStatus({ revokedAt: new Date("2026-10-10T10:00:00Z"), expiresAt: new Date("2026-10-11T12:00:00Z") }, now)).toBe("revoked");
  });
});

describe("repo (git layer)", () => {
  let root: string, origin: string, repo: Repo;
  const g = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const branch = "devapi/test1";
  let base: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "devapi-test-"));
    origin = join(root, "origin.git");
    g(root, "init", "--bare", "--quiet", "-b", "main", origin);
    const seed = join(root, "seed");
    g(root, "init", "--quiet", "-b", "main", seed);
    mkdirSync(join(seed, "server"), { recursive: true });
    mkdirSync(join(seed, "secrets"), { recursive: true });
    writeFileSync(join(seed, "server", "routes.ts"), "export const a = 1;\n");
    writeFileSync(join(seed, "package.json"), "{}\n");
    writeFileSync(join(seed, "secrets", "x.txt"), "do-not-leak\n");
    writeFileSync(join(seed, "logo.bin"), Buffer.from([0, 1, 2, 3]));
    g(seed, "add", "-A");
    g(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "seed");
    g(seed, "push", "--quiet", origin, "main");
    repo = createRepo({ url: origin, sshKey: null, dir: join(root, "clone.git"), base: "main", githubRepo: "veto777/ConstructHUB" });
    base = await repo.createBranch(branch);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("cuts the token's branch from main and pushes it", () => {
    expect(base).toBe(g(origin, "rev-parse", "main"));
    expect(g(origin, "rev-parse", branch)).toBe(base);
  });
  it("refuses an existing branch and anything outside devapi/", async () => {
    await expect(repo.createBranch(branch)).rejects.toBeInstanceOf(RepoError);
    await expect(repo.createBranch("main" as any)).rejects.toThrow(/Not a Code API branch/);
  });
  it("lists and reads without exposing secrets", async () => {
    const entries = await repo.listTree(base, "");
    expect(entries.map((e) => e.path).sort()).toEqual(["logo.bin", "package.json", "server"]);
    const f = await repo.readFile(base, "server/routes.ts");
    expect(f?.content.toString()).toBe("export const a = 1;\n");
    expect(await repo.readFile(base, "nope.ts")).toBeNull();
    const hits = await repo.search(base, "leak", "");
    expect(hits.matches).toEqual([]);
    expect((await repo.search(base, "const a", "")).matches).toEqual([{ path: "server/routes.ts", line: 1, text: "export const a = 1;" }]);
  });
  it("commits, pushes, diffs and logs; CAS refuses a stale head", async () => {
    const one = await repo.commit(branch, {
      message: "add a script", author: { name: "Agent (Code API)", email: "dtk@code-api.constructhub.us" },
      changes: [
        { path: "server/routes.ts", content: Buffer.from("export const a = 2;\n") },
        { path: "scripts/hello.sh", content: Buffer.from("#!/bin/sh\necho hi\n"), executable: true },
      ],
    });
    expect(one.parent).toBe(base);
    expect(g(origin, "rev-parse", branch)).toBe(one.commit);
    expect(g(origin, "rev-parse", "main")).toBe(base); // main untouched
    expect(g(origin, "show", `${branch}:server/routes.ts`)).toBe("export const a = 2;");
    expect(g(origin, "ls-tree", branch, "scripts/hello.sh")).toMatch(/^100755 /);

    await expect(repo.commit(branch, { message: "stale", author: { name: "a", email: "a@a" }, expectedHead: base,
      changes: [{ path: "x.ts", content: Buffer.from("x") }] })).rejects.toMatchObject({ status: 409 });
    await expect(repo.commit(branch, { message: "same", author: { name: "a", email: "a@a" },
      changes: [{ path: "server/routes.ts", content: Buffer.from("export const a = 2;\n") }] })).rejects.toMatchObject({ code: "no_changes" });

    const two = await repo.commit(branch, { message: "drop logo", author: { name: "a", email: "a@a" }, expectedHead: one.commit,
      changes: [{ path: "logo.bin", content: null }] });
    const d = await repo.diff(branch, base);
    expect(d.files.map((f) => [f.path, f.status]).sort()).toEqual([["logo.bin", "deleted"], ["scripts/hello.sh", "added"], ["server/routes.ts", "modified"]]);
    expect(d.patch).toContain("+export const a = 2;");
    const log = await repo.log(branch, base);
    expect(log.map((c) => c.sha)).toEqual([two.commit, one.commit]);
    expect(log[1].author.email).toBe("dtk@code-api.constructhub.us");
    expect(g(origin, "for-each-ref", "--format=%(refname)").split("\n").sort()).toEqual(["refs/heads/devapi/test1", "refs/heads/main"]);
  });
  it("links the GitHub compare view", () => {
    expect(repo.compareUrl(branch)).toBe("https://github.com/veto777/ConstructHUB/compare/main...devapi/test1");
  });
});

describe("guard", () => {
  const run = (path: string, auth?: string) => {
    let status = 0, nexted = false;
    const res: any = { setHeader() {}, status(s: number) { status = s; return this; }, json() { return this; } };
    rejectDevTokensOutsideDevApi({ path, headers: auth ? { authorization: auth } : {} } as any, res, () => { nexted = true; });
    return { status, nexted };
  };
  it("lets chdev_ through only on /api/dev/v1", () => {
    expect(isDevApiPath("/api/dev/v1/files")).toBe(true);
    expect(isDevApiPath("/api/dev/v10")).toBe(false);
    expect(run("/api/dev/v1/files", "Bearer chdev_x").nexted).toBe(true);
    expect(run("/api/account/me", "Bearer chdev_x").status).toBe(401);
    expect(run("/api/v1/me", "Bearer chdev_x").status).toBe(401);
    expect(run("/api/account/me").nexted).toBe(true);
  });
});
