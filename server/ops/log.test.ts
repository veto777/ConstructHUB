import { afterEach, describe, expect, it, vi } from "vitest";
// The journal-safe error logger (server/ops/log.ts) that server/index.ts's error
// handler and the process-level handlers print through: never a request body,
// never a Postgres row, never a recipient address.
import { errorLogFacts, isBodyParserError, logError } from "./log";

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
