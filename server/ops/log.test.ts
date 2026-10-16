import { afterEach, describe, expect, it, vi } from "vitest";
// The journal-safe error logger (server/ops/log.ts) that server/index.ts's error
// handler and the process-level handlers print through: never a request body,
// never a Postgres row, never a recipient address.
import { errorLogFacts, fail500, GENERIC_500_MESSAGE, hasClientStatus, isBodyParserError, logError, safeErrorClasses } from "./log";

/** What body-parser throws for a malformed JSON body (node_modules/body-parser/lib/read.js: `body` is the raw request). */
function bodyParserError(body: string) {
  return Object.assign(new SyntaxError(`Unexpected token 'h', "${body}" is not valid JSON`), {
    type: "entity.parse.failed", status: 400, statusCode: 400, expose: true, length: body.length, body,
  });
}

describe("errorLogFacts", () => {
  it("reduces a body-parser error to its type, status and length — never the body or its message", () => {
    const body = '{"email":"jane@x.com","password":"hunter2"';
    const err = bodyParserError(body);
    expect(isBodyParserError(err)).toBe(true);
    const facts = errorLogFacts(err);
    expect(facts).toEqual({ type: "entity.parse.failed", status: 400, length: body.length });
    expect(JSON.stringify(facts)).not.toMatch(/hunter2|jane|is not valid JSON/);
    expect(isBodyParserError(Object.assign(new Error("x"), { type: "entity.too.large", status: 413 }))).toBe(true);
    expect(errorLogFacts(Object.assign(new Error("x"), { type: "entity.too.large", status: 413 }))).toEqual({ type: "entity.too.large", status: 413, length: undefined });
  });

  it("gives every other error its scrubbed facts (no pg detail, no nodemailer rejected list)", () => {
    const pg = Object.assign(new Error('duplicate key value violates unique constraint "users_email_unique"'), {
      code: "23505", detail: "Key (email)=(jane@x.com) already exists.", where: "SQL statement", table: "users",
    });
    const facts = errorLogFacts(pg);
    expect(facts.name).toBe("Error");
    expect(facts.code).toBe("23505");
    expect(facts).not.toHaveProperty("detail");
    expect(JSON.stringify(facts)).not.toContain("jane@x.com");

    const smtp = Object.assign(new Error("Can't send mail - all recipients were rejected: 550 <jane@x.com>: User unknown"), {
      code: "EENVELOPE", rejected: ["jane@x.com"], response: "550 <jane@x.com>: User unknown", command: "RCPT TO",
    });
    const s = JSON.stringify(errorLogFacts(smtp));
    expect(s).not.toContain("jane@x.com");
    expect(s).toContain("j***@x.com");
    expect(s).not.toContain("RCPT TO");

    expect(errorLogFacts("plain string")).toEqual({ thrown: "plain string" });
    expect(isBodyParserError(null)).toBe(false);
    expect(isBodyParserError(undefined)).toBe(false);
  });
});

describe("logError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prints the label and one JSON line of facts", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("Internal Server Error:", bodyParserError("hunter2@gmail.com"));
    expect(spy).toHaveBeenCalledTimes(1);
    const [label, line] = spy.mock.calls[0];
    expect(label).toBe("Internal Server Error:");
    expect(typeof line).toBe("string");
    expect(line).not.toContain("hunter2");
    expect(JSON.parse(line as string)).toEqual({ type: "entity.parse.failed", status: 400, length: 17 });
    logError("Reminder scheduler error:", new Error("boom"));
    expect(JSON.parse(spy.mock.calls[1][1] as string)).toMatchObject({ name: "Error", message: "boom" });
  });

  it("never throws, whatever it is handed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => logError("x", cyclic)).not.toThrow();
    expect(() => logError("x", 1n as unknown)).not.toThrow();
    expect(() => logError("x", undefined)).not.toThrow();
  });
});

/** The slice of an Express response fail500 uses. */
function fakeRes(headersSent = false) {
  const out: { status?: number; body?: unknown } = {};
  const res: any = { headersSent };
  res.status = (s: number) => { out.status = s; return res; };
  res.json = (b: unknown) => { out.body = b; return res; };
  return { res, out };
}

class OurError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

describe("fail500", () => {
  afterEach(() => vi.restoreAllMocks());

  it("answers a generic error with the fixed message and logs only its scrubbed facts", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const pg = Object.assign(new Error('duplicate key value violates unique constraint "users_email_unique"'), {
      code: "23505", detail: "Key (email)=(jane@x.com) already exists.",
    });
    const { res, out } = fakeRes();
    fail500(res, "POST /api/auth/signup failed:", pg);
    expect(out).toEqual({ status: 500, body: { message: GENERIC_500_MESSAGE } });
    expect(GENERIC_500_MESSAGE).toBe("Something went wrong. Try again.");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe("POST /api/auth/signup failed:");
    expect(typeof spy.mock.calls[0][1]).toBe("string");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("jane@x.com");
  });

  it("passes one of our own typed errors through with its message and status, unlogged", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, out } = fakeRes();
    fail500(res, "x", new OurError("Reconnect Google Business Profile", 401), safeErrorClasses(OurError));
    expect(out).toEqual({ status: 401, body: { message: "Reconnect Google Business Profile" } });
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not trust an error the test does not vouch for, even with a status", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, out } = fakeRes();
    fail500(res, "x", Object.assign(new Error("Google Ads API error 400: {customer 123}"), { status: 400 }), safeErrorClasses(OurError));
    expect(out).toEqual({ status: 500, body: { message: GENERIC_500_MESSAGE } });
  });

  it("hasClientStatus trusts our status-tagged errors, not 5xx, plain or body-parser errors", () => {
    expect(hasClientStatus(Object.assign(new Error("Campaign not found"), { status: 404 }))).toBe(true);
    expect(hasClientStatus(Object.assign(new Error("upstream"), { status: 502 }))).toBe(false);
    expect(hasClientStatus(new Error("plain"))).toBe(false);
    expect(hasClientStatus({ status: 404, message: "not an Error" })).toBe(false);
    expect(hasClientStatus(bodyParserError('{"password":"hunter2"'))).toBe(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, out } = fakeRes();
    fail500(res, "x", Object.assign(new Error("Campaign not found"), { status: 404 }), hasClientStatus);
    expect(out).toEqual({ status: 404, body: { message: "Campaign not found" } });
  });

  it("falls back to 500 for a safe error without a usable status, and never answers twice", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, out } = fakeRes();
    fail500(res, "x", Object.assign(new OurError("Pick a reason."), { status: "bad" as any }), safeErrorClasses(OurError));
    expect(out).toEqual({ status: 500, body: { message: "Pick a reason." } });
    const sent = fakeRes(true);
    fail500(sent.res, "x", new Error("late"));
    expect(sent.out).toEqual({});
  });

  it("treats a throwing safe test, a non-Error and an empty message as generic", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [err, test] of [
      [new OurError("x"), () => { throw new Error("boom"); }],
      ["a string", () => true],
      [new OurError(""), safeErrorClasses(OurError)],
    ] as const) {
      const { res, out } = fakeRes();
      fail500(res, "x", err, test);
      expect(out).toEqual({ status: 500, body: { message: GENERIC_500_MESSAGE } });
    }
  });
});
