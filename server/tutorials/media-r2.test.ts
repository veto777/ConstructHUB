/**
 * Incident 2026-10-15: after ~500 quick HEAD / ranged requests every uncached tutorial-media request hung.
 * An R2 body nobody read or destroyed kept its socket; once the pool was full, send() queued forever.
 * These tests hold the route to: the body is always released, an abort reaches send(), and a slow R2 is
 * a 504 — never a hang.
 */
import http from "http";
import type { AddressInfo } from "net";
import { PassThrough } from "stream";
import express from "express";
import { S3Client } from "@aws-sdk/client-s3";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { registerTutorialMediaRoutes, setTutorialR2ForTests } from "./media";
import { r2RequestHandler } from "../r2-http";

const FILE = "database-directory.0a1b2c3d.mp4";
let base = "";
let server: http.Server;
const savedEnv = { ...process.env };

beforeAll(async () => {
  Object.assign(process.env, { R2_ENDPOINT: "http://127.0.0.1:9", R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test" });
  delete process.env.TUTORIALS_STORAGE;
  const app = express();
  registerTutorialMediaRoutes(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tutorials/media/`;
});
afterAll(() => {
  server?.close();
  setTutorialR2ForTests(null);
  process.env = savedEnv;
});
afterEach(() => setTutorialR2ForTests(null));

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string };
function request(path: string, opts: { method?: string; headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const r = http.request(base + path, { method: opts.method ?? "GET", headers: opts.headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    r.on("error", reject);
    r.setTimeout(opts.timeoutMs ?? 5000, () => { r.destroy(); reject(new Error("HUNG: no answer")); });
    r.end();
  });
}
/** Opens a request and drops it without waiting for the answer. */
function dropAfter(path: string, ms: number, headers: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve) => {
    const r = http.request(base + path, { headers }, (res) => { res.destroy(); resolve(); });
    r.on("error", () => resolve());
    r.end();
    setTimeout(() => { r.destroy(); resolve(); }, ms);
  });
}
const waitFor = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
};

/** A body that records being destroyed. */
function fakeBody(content = "x".repeat(64)) {
  const body = new PassThrough();
  const destroy = vi.spyOn(body, "destroy");
  body.end(content);
  return { body, destroy, length: content.length };
}

describe("tutorial media (R2, mocked client): the body is always released", () => {
  it("a viewer who leaves while R2 is answering: the abort reaches send() and the late body is destroyed", async () => {
    const { body, destroy, length } = fakeBody();
    let signal: AbortSignal | undefined;
    let answer!: (v: unknown) => void;
    const send = vi.fn((_cmd: unknown, opts: { abortSignal?: AbortSignal }) => {
      signal = opts?.abortSignal;
      return new Promise((r) => { answer = r; });
    });
    setTutorialR2ForTests({ send } as any);
    await dropAfter(FILE, 50, { Range: "bytes=0-1" });
    await waitFor(() => send.mock.calls.length === 1 && !!signal?.aborted);
    // A client that ignores the abort and answers anyway: the route must still let the body go.
    answer({ Body: body, ContentLength: length, ContentRange: `bytes 0-1/${length}` });
    await waitFor(() => destroy.mock.calls.length > 0);
  });

  it("HEAD destroys the body and answers the headers", async () => {
    const { body, destroy, length } = fakeBody();
    setTutorialR2ForTests({ send: vi.fn(async () => ({ Body: body, ContentLength: length })) } as any);
    const r = await request(FILE, { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(r.headers["content-length"]).toBe(String(length));
    expect(destroy).toHaveBeenCalled();
  });

  it("a body that fails mid-stream is destroyed and the response is cut, not left open", async () => {
    const body = new PassThrough();
    const destroy = vi.spyOn(body, "destroy");
    setTutorialR2ForTests({ send: vi.fn(async () => ({ Body: body, ContentLength: 1000 })) } as any);
    body.write("x".repeat(10));
    const cut = await new Promise<boolean>((resolve) => {
      const r = http.get(base + FILE, (res) => {
        expect(res.statusCode).toBe(200);
        res.on("data", () => body.emit("error", new Error("R2 reset")));
        res.on("end", () => resolve(false));
        res.on("error", () => resolve(true)); // aborted: the body was cut short
      });
      r.on("error", () => resolve(true));
      r.setTimeout(3000, () => { r.destroy(); resolve(false); });
    });
    expect(cut).toBe(true);
    expect(destroy).toHaveBeenCalled();
  });

  it("a viewer who closes mid-stream destroys the body", async () => {
    const body = new PassThrough();
    const destroy = vi.spyOn(body, "destroy");
    setTutorialR2ForTests({ send: vi.fn(async () => ({ Body: body, ContentLength: 1_000_000 })) } as any);
    body.write("x".repeat(1000));
    await dropAfter(FILE, 100);
    await waitFor(() => destroy.mock.calls.length > 0);
  });

  it("404 and 416 from R2 answer cleanly; other errors are 500, timeouts 504", async () => {
    const fail = (e: object) => setTutorialR2ForTests({ send: vi.fn(async () => { throw e; }) } as any);
    fail({ name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    expect((await request(FILE)).status).toBe(404);
    fail({ name: "InvalidRange", $metadata: { httpStatusCode: 416 } });
    expect((await request(FILE, { headers: { Range: "bytes=999999-" } })).status).toBe(416);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fail(new Error("boom"));
    expect((await request(FILE)).status).toBe(500);
    err.mockRestore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fail(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    expect((await request(FILE)).status).toBe(504);
    warn.mockRestore();
  });

  it("a send() that never settles hits the route deadline: 504, and the abort reaches send()", async () => {
    let signal: AbortSignal | undefined;
    setTutorialR2ForTests({ send: vi.fn((_c: unknown, o: { abortSignal?: AbortSignal }) => { signal = o?.abortSignal; return new Promise(() => {}); }) } as any, 200);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t0 = Date.now();
    const r = await request(FILE);
    warn.mockRestore();
    expect(r.status).toBe(504);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(signal?.aborted).toBe(true);
  });
});

describe("tutorial media against a fake R2 (the real SDK client and handler)", () => {
  const OBJ = Buffer.alloc(256 * 1024, 7);
  let fake: http.Server;
  let mode: "answer" | "silent" = "answer";
  let endpoint = "";
  beforeAll(async () => {
    fake = http.createServer((req, res) => {
      if (mode === "silent") return; // accepts the request, never answers
      setTimeout(() => {
        const m = /bytes=(\d+)-(\d*)/.exec(String(req.headers.range ?? ""));
        if (m) {
          const start = Number(m[1]); const end = m[2] ? Number(m[2]) : OBJ.length - 1;
          res.writeHead(206, { "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${OBJ.length}`, "Content-Type": "video/mp4" });
          return res.end(OBJ.subarray(start, end + 1));
        }
        res.writeHead(200, { "Content-Length": OBJ.length, "Content-Type": "video/mp4" });
        res.end(OBJ);
      }, 40);
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    endpoint = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  });
  afterAll(() => { fake.closeAllConnections(); fake.close(); });

  const realClient = (maxSockets: number) => new S3Client({
    region: "auto", endpoint, forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    requestHandler: r2RequestHandler({ maxSockets }),
  });

  it("hundreds of viewers who drop early or only ask HEAD do not exhaust the socket pool", async () => {
    mode = "answer";
    setTutorialR2ForTests(realClient(4), 3000);
    await Promise.all(Array.from({ length: 120 }, (_, i) =>
      i % 3 === 0 ? request(FILE, { method: "HEAD" }).catch(() => {}) : dropAfter(FILE, 10 + (i % 6) * 15, i % 2 ? { Range: "bytes=0-1" } : {})));
    const r = await request(FILE, { headers: { Range: "bytes=0-1" }, timeoutMs: 5000 });
    expect(r.status).toBe(206);
    expect(r.headers["content-range"]).toBe(`bytes 0-1/${OBJ.length}`);
  }, 20_000);

  it("an R2 that accepts but never answers is a 504, not a hang", async () => {
    mode = "silent";
    setTutorialR2ForTests(realClient(4), 300);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t0 = Date.now();
    const r = await request(FILE, { timeoutMs: 5000 });
    warn.mockRestore();
    expect(r.status).toBe(504);
    expect(Date.now() - t0).toBeLessThan(3000);
    mode = "answer";
  }, 10_000);
});
