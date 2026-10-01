import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createWriteStream, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// The NO AI RULE for the public API write lane, checked two ways:
//   1. statically — the write resources never import an AI module or an AI
//      generator (direct import specifiers and named imports);
//   2. over HTTP against a real server with the dev bypass OFF — an account API
//      key (`chub_…`) never authenticates the AI routes (401), and the CRM's
//      own key middleware does not accept it either.
// The behavioural half (AI clients mocked to throw while every write runs) is
// in write.test.ts.

const here = path.dirname(new URL(import.meta.url).pathname);
const sources = readdirSync(here).filter((f) => /-write\.ts$/.test(f) && !f.endsWith(".test.ts")).sort();
const FORBIDDEN_MODULES = [/^openai$/, /ai-config/, /ai-output/, /review-automation/, /sitescan\/providers/, /site-assistant/, /ads-consultant/, /sitescan\/worker/, /social\/agency/, /gbp\/content$/];
const FORBIDDEN_NAMES = ["createDraftGenerator", "generateDraft", "generateReply", "processReplies", "generateText", "generateDue", "openAIProvider", "planBatches", "OpenAI", "aiModel", "aiVisionModel"];
const specifiers = (code: string) => [...code.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/g)].map((m) => m[1]);
const namedImports = (code: string) => [...code.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from/g)].flatMap((m) => m[1].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean));

describe("no AI reachable from the public API (static)", () => {
  it("the write resources exist and import no AI module", () => {
    expect(sources).toEqual(["gbp-write.ts", "index-write.ts", "shared-write.ts", "sitescan-write.ts", "social-write.ts"]);
    for (const file of sources) {
      const code = readFileSync(path.join(here, file), "utf8");
      for (const spec of specifiers(code)) for (const rule of FORBIDDEN_MODULES) expect(spec, `${file} imports ${spec}`).not.toMatch(rule);
      for (const name of namedImports(code)) expect(FORBIDDEN_NAMES, `${file} imports ${name}`).not.toContain(name);
      expect(code, `${file} must not construct an AI client`).not.toMatch(/new\s+OpenAI|chat\.completions|AI_INTEGRATIONS_OPENAI/);
    }
  });

  it("every stored write is marked as API-authored so no AI worker rewrites it", () => {
    const gbp = readFileSync(path.join(here, "gbp-write.ts"), "utf8"), social = readFileSync(path.join(here, "social-write.ts"), "utf8");
    expect(gbp).toMatch(/INSERT INTO gbp_content_jobs[\s\S]*'api'\)/);
    expect(social).toMatch(/UPDATE social_posts SET source='api'/);
    // The social path never passes ai=true / automatic=true into insertPosts, and never reaches the AI settings.
    expect(social).not.toMatch(/saveSettings|social_settings/);
  });
});

const AI_ROUTES = (job: string) => [
  ["POST", "/api/gbp/content/1/draft", { kind: "post" }, "session"],
  ["POST", "/api/gmb/review-response", {}, "anonymous"],
  ["POST", `/api/sitescan/jobs/${job}/plan`, {}, "session"],
  ["POST", "/api/social/generate", { requestId: job }, "session"],
  ["POST", "/api/site-assistant/chat", {}, "anonymous"],
] as const;

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const port = (s.address() as any).port; s.close(() => resolve(port)); });
  });
}

describe.skipIf(process.env.CRM_TEST_SINGLE_PORT === "true")("API keys never authenticate the AI routes (child server, no dev bypass)", () => {
  let child: ChildProcess, base = "";
  const key = "chub_fixture_" + randomUUID().replace(/-/g, "");
  const ip = `198.18.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  const api = async (method: string, path: string, body: unknown, bearer = key) => {
    const r = await fetch(base + path, { method, redirect: "manual", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
    const text = await r.text();
    let data: any = text; try { data = JSON.parse(text); } catch { /* html/text */ }
    return { status: r.status, data };
  };

  beforeAll(async () => {
    if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      cwd: path.resolve(here, "../../.."),
      env: { ...process.env, PORT: String(port), NODE_ENV: "development", DEV_AUTH_BYPASS_USER1: "false", CRM_DEMO_AUTOLOGIN: "false", SESSION_SECRET: "l7-no-ai-session-secret", EMAIL_FORCE_SINK: "1", STRIPE_SECRET_KEY: "", GOOGLE_PLACES_API_KEY: "", AI_INTEGRATIONS_OPENAI_API_KEY: "", SCRAPE_SCHEDULER_DISABLED: "true", GBP_SYNC_DISABLED: "true" },
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    const log = createWriteStream(path.join(mkdtempSync(path.join(tmpdir(), "acct-l7-no-ai-")), `server-${port}.log`));
    child.stdout!.pipe(log); child.stderr!.pipe(log);
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error("no-AI test server exited");
      try { if ((await fetch(base + "/api/auth/me")).status < 500) { ready = true; break; } } catch { /* booting */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error("no-AI test server did not start");
  }, 90_000);

  afterAll(() => { if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ } } });

  it("the session-protected AI routes answer 401 to an account API key, and the anonymous ones grant it nothing", async () => {
    for (const [method, route, body, kind] of AI_ROUTES(randomUUID())) {
      const r = await api(method, route, body);
      if (kind === "session") {
        expect(r.status, route).toBe(401);
      } else {
        // Public endpoints (rate-limited, CAPTCHA-gated): a key is not an identity there either —
        // the request is treated like any anonymous caller (input refused before any AI call).
        expect(r.status, route).toBe(400);
      }
      expect(r.data?.reached, route).toBeUndefined();
    }
  });

  it("the CRM's own /api/v1 key middleware refuses an account key (the two key types never cross)", async () => {
    expect((await api("GET", "/api/v1/ping", undefined as any)).status).toBe(401);
    expect((await api("GET", "/api/v1/customers", undefined as any)).status).toBe(401);
    // And a CRM-shaped key does not become a session on the AI routes.
    expect((await api("POST", "/api/social/generate", { requestId: randomUUID() }, "chk_fixture")).status).toBe(401);
  });
});
