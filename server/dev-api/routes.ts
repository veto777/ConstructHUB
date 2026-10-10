/**
 * The Code API — ConstructHUB's source code (backend + frontend) for an AI
 * agent or a developer, through a short-lived token.
 *
 * Admin portal (/admin/code-api, platform admins only):
 *   GET    /api/admin/dev-tokens              tokens of the last 14 days, the API URL, the admin's Google status
 *   POST   /api/admin/dev-tokens              issue: {name, holderType, hours 24–48, scopes} → token shown once
 *   DELETE /api/admin/dev-tokens/:id          revoke at once
 *   GET    /api/admin/dev-tokens/:id/activity the token's commits and its last requests
 *   Issuing needs an account signed in with Google, a Google re-verification
 *   in the last 15 minutes (owner, 2026-10-10: "Account admin with Google
 *   access and verification") AND the 6-digit code from the admin's
 *   authenticator app, every time (owner, same day: "adding another layer of
 *   protection … 2step"). Revoking needs only the admin.
 *
 * Code API (Authorization: Bearer chdev_…), DEV_API_BASE = /api/dev/v1:
 *   GET  /            this reference (no token)
 *   GET  /me          the token, its branch and head
 *   GET  /tree        ?path=&ref=branch|base       a directory
 *   GET  /files       ?path=&ref=branch|base       a file (utf8, or base64 for binary)
 *   GET  /search      ?q=&path=&ref=               fixed-string search
 *   GET  /log         commits on the token's branch
 *   GET  /diff        what the branch changes, with files that need careful review
 *   POST /commits     {message, changes:[{path, content|delete, encoding?, executable?}], expectedHead?}   (write)
 *   POST /submit      {note?} tell the admin the branch is ready for review                                  (write)
 *
 * Every token writes only to its own branch devapi/<id>, pushed to GitHub.
 * Nothing here runs code, restarts the app or deploys: the owner reviews the
 * branch, merges it and deploys from ConstructHUB-release as always.
 * Secrets and CI/git config are out of reach (./paths.ts).
 */
import { Router, type ErrorRequestHandler, type Express, type Request, type RequestHandler, type Response } from "express";
import { pool } from "../db";
import { requirePlatformAdmin } from "../crm/admin";
import { originOk } from "../hub/access";
import { logActivity, notifyUser } from "../account-events";
import { googleVerifiedAt, GOOGLE_STEP_UP_MS, validTotp } from "../account-security";
import { DEV_API_BASE } from "./guard";
import { normalizeRepoPath, pathReadable, pathSensitive, writeRefusal } from "./paths";
import { getRepo, MAX_CHANGES_PER_COMMIT, MAX_FILE_BYTES, RepoError, type Repo } from "./repo";
import {
  assertUnderLimit, audit, DevTokenLimitError, insertToken, listTokens, markSubmitted, MAX_LIVE_TOKENS, MAX_TOKEN_HOURS,
  MIN_TOKEN_HOURS, newTokenIdentity, recentAudit, revokeToken, tokenStatus, validateIssue, verifyDevToken, type DevTokenRow,
} from "./tokens";

type GetUser = (req: any, res: any) => any;
export const ADMIN_PAGE = "/admin/code-api";
const MAX_READ_BYTES = 5_000_000;
const MAX_COMMIT_BYTES = 10_000_000;
const RATE_PER_MINUTE = 120;

declare global {
  namespace Express {
    interface Request {
      /** Set by the Code API's token check; absent everywhere else. */
      devToken?: DevTokenRow;
    }
  }
}

const appUrl = () => (process.env.APP_URL || "https://constructhub.us").replace(/\/+$/, "");
export const devApiUrl = () => `${appUrl()}${DEV_API_BASE}`;
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const requestIp = (req: Request) => String(req.headers["cf-connecting-ip"] || req.ip || "").slice(0, 64) || null;

function devError(res: Response, status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error: { code, message, ...extra } });
}

/** RepoError → its status; anything else → 500 (logged). */
function repoFailure(res: Response, e: any) {
  if (e instanceof RepoError && e.status < 500) return devError(res, e.status, e.code, e.message);
  console.error("[dev-api]", e?.message || e);
  devError(res, 502, "repo_unavailable", "The repository could not be reached. Try again shortly.");
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

function tokenItem(row: DevTokenRow, repo: Repo | null) {
  return {
    id: row.id, name: row.name, holderType: row.holderType, scopes: row.scopes, prefix: row.prefix, suffix: row.suffix,
    branch: row.branch, baseSha: row.baseSha, compareUrl: repo?.compareUrl(row.branch) ?? null,
    status: tokenStatus(row), createdByEmail: row.createdByEmail,
    createdAt: iso(row.createdAt), expiresAt: iso(row.expiresAt), revokedAt: iso(row.revokedAt),
    lastUsedAt: iso(row.lastUsedAt), submittedAt: iso(row.submittedAt),
  };
}

/** The issuing admin hears about a new token, a revoke and a submitted branch: activity log + notification (+ email). */
async function tell(req: Request | null, userId: number, kind: "security.code_token_issued" | "security.code_token_revoked" | "code_api.submitted",
  title: string, body: string, detail: Record<string, unknown>) {
  try { await logActivity(req, userId, kind, detail); } catch (e: any) { console.error(`[dev-api] ${kind} activity:`, e?.message); }
  try {
    await notifyUser(userId, kind, { title, body, link: ADMIN_PAGE, severity: kind === "code_api.submitted" ? "info" : "warning", actionUrl: ADMIN_PAGE, actionLabel: "Open Code API" });
  } catch (e: any) { console.error(`[dev-api] ${kind} notification:`, e?.message); }
}

// ── reference (GET /api/dev/v1) ─────────────────────────────────────────────
export function reference() {
  return {
    name: "ConstructHUB Code API",
    baseUrl: devApiUrl(),
    auth: "Authorization: Bearer chdev_… — issued by a ConstructHUB admin at /admin/code-api; lives 24–48 hours.",
    model: "Your token has its own git branch (devapi/…), cut from main when the token was issued. Reads default to that branch; ?ref=base reads main as it was then. Every commit is pushed to GitHub for the owner to review. Nothing you write runs or deploys until the owner merges and deploys it.",
    limits: { requestsPerMinute: RATE_PER_MINUTE, maxFileBytes: MAX_FILE_BYTES, maxChangesPerCommit: MAX_CHANGES_PER_COMMIT },
    offLimits: "Secrets and key files (.env*, secrets/, private/, keys/, analysis/, *.pem, *.key) cannot be read or written. .github/, .husky/, .gitignore, .gitattributes and .gitmodules cannot be written.",
    endpoints: [
      { method: "GET", path: "/me", scope: "read", about: "The token, its branch and current head commit." },
      { method: "GET", path: "/tree?path=client/src&ref=branch", scope: "read", about: "Entries of a directory (path empty = repo root)." },
      { method: "GET", path: "/files?path=server/routes.ts&ref=branch", scope: "read", about: "A file: {content, encoding: utf8|base64, executable, commit}." },
      { method: "GET", path: "/search?q=registerRoutes&path=server", scope: "read", about: "Fixed-string search; up to 200 matches." },
      { method: "GET", path: "/log", scope: "read", about: "Commits on your branch." },
      { method: "GET", path: "/diff", scope: "read", about: "Your branch against where it started: files, patch, files needing careful review." },
      { method: "POST", path: "/commits", scope: "write", about: "One commit: {message, changes:[{path, content, encoding?:'utf8'|'base64', executable?:bool} | {path, delete:true}], expectedHead?}." },
      { method: "POST", path: "/submit", scope: "write", about: "Tell the admin your branch is ready for review: {note?}." },
    ],
    example: `curl -H "Authorization: Bearer $CHDEV_TOKEN" "${devApiUrl()}/files?path=package.json"`,
  };
}

export function registerDevApi(app: Express, getUser: GetUser, deps: { repo?: () => Repo | null } = {}): void {
  const repoOf = deps.repo ?? getRepo;

  // ── admin portal ──────────────────────────────────────────────────────────
  async function adminWithGoogle(req: Request, res: Response) {
    const admin = await requirePlatformAdmin(req, res, getUser, { skipGate: true });
    if (!admin) return null;
    // The admins own sign-in only: an agency member acting for an admins account never issues code access.
    if (req.user?.id !== admin.id) { res.status(403).json({ message: "Only the admin themselves can manage Code API tokens." }); return null; }
    const { rows: [u] } = await pool.query("SELECT google_id, totp_enabled, totp_secret FROM users WHERE id=$1", [admin.id]);
    return { admin: admin as { id: number; email: string }, googleLinked: !!u?.google_id, totpEnabled: !!u?.totp_enabled && !!u?.totp_secret, totpSecret: (u?.totp_secret ?? null) as string | null };
  }

  app.get("/api/admin/dev-tokens", wrap(async (req, res) => {
    const who = await adminWithGoogle(req, res); if (!who) return;
    const repo = repoOf();
    const verifiedAt = googleVerifiedAt(req, who.admin.id);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      configured: !!repo, apiUrl: devApiUrl(), baseBranch: repo?.config.base ?? null,
      hours: { min: MIN_TOKEN_HOURS, max: MAX_TOKEN_HOURS }, maxLive: MAX_LIVE_TOKENS,
      verification: {
        googleLinked: who.googleLinked,
        totpEnabled: who.totpEnabled,
        googleVerifiedUntil: verifiedAt ? new Date(verifiedAt + GOOGLE_STEP_UP_MS).toISOString() : null,
      },
      tokens: (await listTokens()).map((t) => tokenItem(t, repo)),
    });
  }));

  // An authenticator code is good for one issue only (no replay inside its 30-90 s window), and
  // 5 wrong codes lock issuing for 15 minutes (guessing 6 digits is then hopeless).
  const usedCodes = new Map<number, { code: string; at: number }>();
  const wrongCodes = new Map<number, { n: number; since: number }>();
  const LOCK_MS = 15 * 60_000, MAX_WRONG = 5;
  app.post("/api/admin/dev-tokens", wrap(async (req, res) => {
    const who = await adminWithGoogle(req, res); if (!who) return;
    if (!originOk(req)) return void res.status(403).json({ message: "Forbidden" });
    if (!who.googleLinked) return void res.status(403).json({ google: "link", message: "Issuing a Code API token needs an admin account that signs in with Google." });
    if (!googleVerifiedAt(req, who.admin.id)) {
      return void res.status(403).json({ google: "verify", message: "Confirm it's you with Google first (good for 15 minutes)." });
    }
    const input = validateIssue(req.body ?? {});
    if (typeof input === "string") return void res.status(400).json({ message: input });
    if (!who.totpEnabled || !who.totpSecret) {
      return void res.status(403).json({ totp: "setup", message: "Set up your authenticator app first: step 2 on this page." });
    }
    const strikes = wrongCodes.get(who.admin.id);
    if (strikes && Date.now() - strikes.since >= LOCK_MS) wrongCodes.delete(who.admin.id);
    else if (strikes && strikes.n >= MAX_WRONG) {
      return void res.status(429).json({ totp: "locked", message: "Too many wrong authenticator codes. Wait 15 minutes and try again." });
    }
    const code = typeof req.body?.totpCode === "string" ? req.body.totpCode.replace(/\s/g, "") : "";
    const last = usedCodes.get(who.admin.id);
    if (!/^\d{6}$/.test(code) || (last && last.code === code && Date.now() - last.at < 120_000) || !validTotp(who.totpSecret, code)) {
      const s = wrongCodes.get(who.admin.id) ?? { n: 0, since: Date.now() };
      wrongCodes.set(who.admin.id, { n: s.n + 1, since: s.since });
      await logActivity(req, who.admin.id, "security.code_token_bad_code", { attempt: s.n + 1 }).catch(() => {});
      return void res.status(403).json({ totp: "invalid", message: "That authenticator code is wrong or expired. Enter the current 6-digit code." });
    }
    wrongCodes.delete(who.admin.id);
    usedCodes.set(who.admin.id, { code, at: Date.now() });
    const repo = repoOf();
    if (!repo) return void res.status(503).json({ message: "The Code API is not set up on this server yet (DEV_API_REPO_URL)." });
    try { await assertUnderLimit(); } catch (e) {
      if (e instanceof DevTokenLimitError) return void res.status(403).json({ message: e.message });
      throw e;
    }
    const identity = newTokenIdentity();
    let base: string;
    try { base = await repo.createBranch(identity.branch); } catch (e: any) {
      console.error("[dev-api] branch:", e?.message);
      return void res.status(502).json({ message: "Could not create the token's branch on GitHub. Check the deploy key and try again." });
    }
    let row: DevTokenRow;
    try { row = await insertToken(identity, input, base, who.admin); } catch (e) {
      if (e instanceof DevTokenLimitError) return void res.status(403).json({ message: e.message });
      throw e;
    }
    await tell(req, who.admin.id, "security.code_token_issued", `Code API token "${row.name}" was issued`,
      `A ${row.scopes.join(" + ")} Code API token for ${row.holderType === "agent" ? "an AI agent" : "a person"} (${row.prefix}…${row.suffix}) was issued from ${requestIp(req) ?? "an unknown address"}. It works on branch ${row.branch} and expires ${new Date(row.expiresAt).toUTCString()}. If this was not you, revoke it now.`,
      { tokenId: row.id, name: row.name, scopes: row.scopes, branch: row.branch, expiresAt: iso(row.expiresAt) });
    // The one response that carries the secret: written past res.json so the request logger never captures it.
    res.status(201).setHeader("Cache-Control", "no-store");
    res.type("application/json").send(JSON.stringify({ token: identity.token, apiUrl: devApiUrl(), item: tokenItem(row, repo) }));
  }));

  app.delete("/api/admin/dev-tokens/:id", wrap(async (req, res) => {
    const who = await adminWithGoogle(req, res); if (!who) return;
    if (!originOk(req)) return void res.status(403).json({ message: "Forbidden" });
    const id = String(req.params.id ?? "");
    if (!/^dtk_[a-f0-9]{18}$/.test(id)) return void res.status(404).json({ message: "Token not found" });
    const row = await revokeToken(id);
    if (!row) return void res.status(404).json({ message: "Token not found or already revoked" });
    await tell(req, who.admin.id, "security.code_token_revoked", `Code API token "${row.name}" was revoked`,
      `The Code API token ${row.prefix}…${row.suffix} was revoked and stops working at once. Its branch ${row.branch} stays on GitHub for review.`,
      { tokenId: row.id, name: row.name, branch: row.branch });
    res.json({ ok: true, item: tokenItem(row, repoOf()) });
  }));

  app.get("/api/admin/dev-tokens/:id/activity", wrap(async (req, res) => {
    const who = await adminWithGoogle(req, res); if (!who) return;
    const id = String(req.params.id ?? "");
    const { rows: [r] } = await pool.query("SELECT branch, base_sha FROM dev_api_tokens WHERE id=$1", [id]);
    if (!r) return void res.status(404).json({ message: "Token not found" });
    const repo = repoOf();
    let commits: unknown[] = [], files: unknown[] = [], sensitive: string[] = [];
    if (repo) {
      try {
        await repo.ensure();
        commits = await repo.log(r.branch, r.base_sha, 50);
        const d = await repo.diff(r.branch, r.base_sha);
        files = d.files;
        sensitive = d.files.map((f) => f.path).filter(pathSensitive);
      } catch (e: any) { console.error("[dev-api] activity:", e?.message); }
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ commits, files, sensitive, requests: await recentAudit(id, 50) });
  }));

  // ── the Code API ──────────────────────────────────────────────────────────
  const api = Router();
  api.get("/", (_req, res) => { res.setHeader("Cache-Control", "no-store"); res.json(reference()); });

  const hits = new Map<string, { at: number; n: number }>();
  api.use(((req, res, next) => {
    (async () => {
      const token = await verifyDevToken(req.headers.authorization);
      if (!token) return devError(res, 401, "unauthorized", "Provide a live Code API token: Authorization: Bearer chdev_… (tokens last 24–48 hours; ask an admin for a new one).");
      const now = Date.now(), slot = hits.get(token.id);
      if (!slot || now - slot.at >= 60_000) hits.set(token.id, { at: now, n: 1 });
      else if (++slot.n > RATE_PER_MINUTE) {
        res.setHeader("Retry-After", String(Math.ceil((slot.at + 60_000 - now) / 1000)));
        return devError(res, 429, "rate_limited", `Up to ${RATE_PER_MINUTE} requests a minute.`);
      }
      if (!repoOf()) return devError(res, 503, "not_configured", "The Code API is not set up on this server.");
      req.devToken = token;
      res.setHeader("Cache-Control", "no-store");
      res.on("finish", () => {
        audit(token.id, { method: req.method, path: req.originalUrl, status: res.statusCode, ip: requestIp(req), detail: res.locals.devAudit ?? null })
          .catch((e) => console.error("[dev-api] audit:", e?.message));
      });
      next();
    })().catch(next);
  }) as RequestHandler);

  const repo = () => repoOf()!;
  const needWrite: RequestHandler = (req, res, next) =>
    req.devToken!.scopes.includes("write") ? next() : devError(res, 403, "insufficient_scope", 'This token does not have the "write" scope.');
  const refOf = (req: Request): "branch" | "base" | null => {
    const r = req.query.ref;
    if (r === undefined || r === "" || r === "branch") return "branch";
    return r === "base" ? "base" : null;
  };

  api.get("/me", wrap(async (req, res) => {
    const t = req.devToken!;
    let head: string | null = null;
    try { head = await repo().resolve(t.branch); } catch (e) { return repoFailure(res, e); }
    res.json({
      token: { id: t.id, name: t.name, holderType: t.holderType, scopes: t.scopes, expiresAt: iso(t.expiresAt) },
      branch: t.branch, head, baseSha: t.baseSha, baseBranch: repo().config.base, compareUrl: repo().compareUrl(t.branch),
    });
  }));

  api.get("/tree", wrap(async (req, res) => {
    const path = normalizeRepoPath(req.query.path ?? "", { allowRoot: true });
    const ref = refOf(req);
    if (path === null || ref === null) return devError(res, 400, "bad_request", "Give a repo-relative path and ref=branch or ref=base.");
    if (!pathReadable(path)) return devError(res, 403, "forbidden_path", `${path} is off-limits to the Code API.`);
    try {
      const commit = ref === "base" ? req.devToken!.baseSha : await repo().resolve(req.devToken!.branch);
      res.json({ path, ref, commit, entries: await repo().listTree(commit, path) });
    } catch (e) { repoFailure(res, e); }
  }));

  api.get("/files", wrap(async (req, res) => {
    const path = normalizeRepoPath(req.query.path);
    const ref = refOf(req);
    if (!path || ref === null) return devError(res, 400, "bad_request", "Give ?path= (repo-relative) and ref=branch or ref=base.");
    if (!pathReadable(path)) return devError(res, 403, "forbidden_path", `${path} is off-limits to the Code API.`);
    try {
      const commit = ref === "base" ? req.devToken!.baseSha : await repo().resolve(req.devToken!.branch);
      const file = await repo().readFile(commit, path);
      if (!file) return devError(res, 404, "not_found", `No file at ${path} on ${ref}.`);
      if (file.content.length > MAX_READ_BYTES) return devError(res, 413, "too_large", `${path} is over ${MAX_READ_BYTES} bytes.`);
      const binary = file.content.subarray(0, 8000).includes(0);
      res.json({
        path, ref, commit, size: file.content.length, executable: file.executable,
        encoding: binary ? "base64" : "utf8", content: file.content.toString(binary ? "base64" : "utf8"),
      });
    } catch (e) { repoFailure(res, e); }
  }));

  api.get("/search", wrap(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const path = normalizeRepoPath(req.query.path ?? "", { allowRoot: true });
    const ref = refOf(req);
    if (!q || q.length > 200 || /[\u0000-\u001f]/.test(q) || path === null || ref === null) return devError(res, 400, "bad_request", "Give ?q= (1–200 characters), optional ?path= and ref.");
    if (!pathReadable(path)) return devError(res, 403, "forbidden_path", `${path} is off-limits to the Code API.`);
    try {
      const commit = ref === "base" ? req.devToken!.baseSha : await repo().resolve(req.devToken!.branch);
      res.json({ q, path, ref, commit, ...(await repo().search(commit, q, path)) });
    } catch (e) { repoFailure(res, e); }
  }));

  api.get("/log", wrap(async (req, res) => {
    try { res.json({ branch: req.devToken!.branch, commits: await repo().log(req.devToken!.branch, req.devToken!.baseSha) }); } catch (e) { repoFailure(res, e); }
  }));

  api.get("/diff", wrap(async (req, res) => {
    try {
      const d = await repo().diff(req.devToken!.branch, req.devToken!.baseSha);
      res.json({ branch: req.devToken!.branch, base: req.devToken!.baseSha, ...d, sensitive: d.files.map((f) => f.path).filter(pathSensitive) });
    } catch (e) { repoFailure(res, e); }
  }));

  api.post("/commits", needWrite, wrap(async (req, res) => {
    const t = req.devToken!;
    const body = req.body ?? {};
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 2000) return devError(res, 400, "bad_request", "Give a commit message (1–2000 characters).");
    if (!Array.isArray(body.changes) || !body.changes.length || body.changes.length > MAX_CHANGES_PER_COMMIT) {
      return devError(res, 400, "bad_request", `Send 1 to ${MAX_CHANGES_PER_COMMIT} changes.`);
    }
    if (body.expectedHead != null && (typeof body.expectedHead !== "string" || !/^[0-9a-f]{40}$/.test(body.expectedHead))) {
      return devError(res, 400, "bad_request", "expectedHead is a full 40-character commit id.");
    }
    const changes: { path: string; content: Buffer | null; executable?: boolean }[] = [];
    const seen = new Set<string>();
    let total = 0;
    for (const c of body.changes) {
      const path = normalizeRepoPath(c?.path);
      if (!path) return devError(res, 400, "bad_request", "Every change needs a repo-relative path.");
      const refusal = writeRefusal(path);
      if (refusal) return devError(res, 403, "forbidden_path", refusal);
      if (seen.has(path)) return devError(res, 400, "bad_request", `${path} appears twice in one commit.`);
      seen.add(path);
      if (c.delete === true) { changes.push({ path, content: null }); continue; }
      if (typeof c.content !== "string") return devError(res, 400, "bad_request", `${path}: give content (a string) or delete: true.`);
      const encoding = c.encoding ?? "utf8";
      if (encoding !== "utf8" && encoding !== "base64") return devError(res, 400, "bad_request", `${path}: encoding is utf8 or base64.`);
      const content = Buffer.from(c.content, encoding);
      if (content.length > MAX_FILE_BYTES) return devError(res, 413, "too_large", `${path} is over ${MAX_FILE_BYTES} bytes.`);
      total += content.length;
      changes.push({ path, content, executable: c.executable === true });
    }
    if (total > MAX_COMMIT_BYTES) return devError(res, 413, "too_large", `One commit carries at most ${MAX_COMMIT_BYTES} bytes.`);
    const trailer = `\n\nCode-API-Token: ${t.id} (${t.name})\nIssued-By: ${t.createdByEmail}`;
    try {
      const out = await repo().commit(t.branch, {
        message: message + trailer,
        author: { name: `${t.name} (Code API)`.slice(0, 120), email: `${t.id}@code-api.constructhub.us` },
        expectedHead: body.expectedHead ?? null, changes,
      });
      res.locals.devAudit = { commit: out.commit, paths: changes.map((c) => c.path) };
      res.status(201).json({
        commit: out.commit, parent: out.parent, branch: t.branch, compareUrl: repo().compareUrl(t.branch),
        changed: changes.map((c) => ({ path: c.path, action: c.content === null ? "deleted" : "written", sensitive: pathSensitive(c.path) })),
      });
    } catch (e) { repoFailure(res, e); }
  }));

  api.post("/submit", needWrite, wrap(async (req, res) => {
    const t = req.devToken!;
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : "";
    let files: { path: string }[] = [];
    try { files = (await repo().diff(t.branch, t.baseSha)).files; } catch (e) { return repoFailure(res, e); }
    if (!files.length) return devError(res, 400, "no_changes", "Your branch has no changes to review yet.");
    await markSubmitted(t.id);
    const sensitive = files.map((f) => f.path).filter(pathSensitive);
    await tell(null, t.createdBy, "code_api.submitted", `"${t.name}" submitted ${t.branch} for review`,
      `${files.length} file${files.length === 1 ? "" : "s"} changed${sensitive.length ? `; review closely: ${sensitive.join(", ")}` : ""}.${note ? ` Note: ${note}` : ""}`,
      { tokenId: t.id, branch: t.branch, files: files.length, sensitive, note: note || null });
    res.json({ ok: true, branch: t.branch, files: files.length, sensitive, compareUrl: repo().compareUrl(t.branch) });
  }));

  api.use((req, res) => devError(res, 404, "not_found", `No endpoint at ${req.method} ${DEV_API_BASE}${req.path}. GET ${DEV_API_BASE}/ lists them.`));
  api.use(((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode) || 500;
    if (status >= 500) { console.error("[dev-api]", err?.stack || err); return devError(res, 500, "internal_error", "Something went wrong on our side."); }
    devError(res, status, "bad_request", typeof err?.type === "string" && err.type.startsWith("entity.") ? "The request body could not be read as JSON." : String(err?.message || "Bad request"));
  }) as ErrorRequestHandler);

  app.use(DEV_API_BASE, api);
}
