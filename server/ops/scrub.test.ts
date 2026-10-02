import { describe, expect, it } from "vitest";
// The issue desk's scrubber (server/ops/scrub.ts): nothing secret or personal
// reaches ops_issues, and nothing it is handed can make it throw.
import { errorFacts, MAX_DETAIL_BYTES, scrubDetail, scrubText, stackFrames } from "./scrub";

describe("scrubText", () => {
  it("removes tokens, keys and credentials", () => {
    const s = scrubText([
      "Authorization: Bearer abcdefghijklmnop.qrstuvwx-yz",
      "postgres://constructhub:hunter2pass@127.0.0.1:5432/db",
      "https://x.test/cb?code=4/0AbCdEf&state=xyz&ok=1",
      "sk_live_51HabcdefGHIJKLmnop rk_test_abcdefghijk whsec_abcdefghijklmnop",
      "sk-proj-abcdefghijklmnopqrstuv AIzaSyA1234567890abcdefghijklmnopqrstu",
      "ghp_abcdefghijklmnopqrstuvwxyz0123 xoxb-1234567890-abcdefghij AKIAABCDEFGHIJKLMNOP",
      "chub_live_abcdef123456 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "session 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    ].join("\n"));
    for (const leaked of ["abcdefghijklmnop.qrstuvwx", "hunter2pass", "4/0AbCdEf", "sk_live_51H", "rk_test_", "whsec_", "sk-proj-", "AIzaSy",
      "ghp_", "xoxb-", "AKIAABCD", "chub_live", "eyJhbGci", "9f86d081884c"]) {
      expect(s, leaked).not.toContain(leaked);
    }
    expect(s).toContain("Bearer [redacted]");
    expect(s).toContain("postgres://[redacted]@127.0.0.x:5432/db");
    expect(s).toContain("code=[redacted]");
    expect(s).toContain("ok=1");
  });

  it("masks emails and phone numbers, and drops the host part of an IP", () => {
    const s = scrubText("Lead from jane.doe@example.com at +1 (555) 201-4499 / 555-201-7788 / +15552014455, ip 203.0.113.77");
    expect(s).not.toMatch(/jane\.doe|201-4499|201-7788|5552014455|203\.0\.113\.77/);
    expect(s).toContain("j***@example.com");
    expect(s).toContain("[phone …99]");
    expect(s).toContain("[phone …88]");
    expect(s).toContain("[phone …55]");
    expect(s).toContain("203.0.113.x");
  });

  it("replaces Luhn-valid card numbers and leaves other long numbers alone", () => {
    const s = scrubText("card 4242 4242 4242 4242 and 4000-0566-5566-5556; order 1234567890123");
    expect(s).not.toContain("4242 4242");
    expect(s).not.toContain("4000-0566");
    expect(s.match(/\[card\]/g)?.length).toBe(2);
    expect(s).toContain("1234567890123");
  });

  it("keeps what an inspection needs: UUIDs, dates, routes, numbers", () => {
    const s = scrubText("GET /api/crm/estimates/0b6f2c1e-9d4a-4c55-8f1e-2a7b9c3d4e5f 500 at 2026-10-02 14:03:11 after 1234ms (attempt 3)");
    expect(s).toBe("GET /api/crm/estimates/0b6f2c1e-9d4a-4c55-8f1e-2a7b9c3d4e5f 500 at 2026-10-02 14:03:11 after 1234ms (attempt 3)");
  });

  it("caps the length", () => {
    expect(scrubText("x".repeat(5000), 100)).toMatch(/^x{100}… \[4900 more chars\]$/);
  });
});

describe("scrubDetail", () => {
  it("drops the values of secret-named keys at any depth, keeping the keys", () => {
    const d = scrubDetail({
      password: "p", apiKey: "k", headers: { authorization: "Bearer x", cookie: "c", "x-signalwire-signature": "s" },
      card: { number: "4242424242424242", cvc: "123" }, client_secret: "cs", DATABASE_URL: "postgres://u:p@h/d",
      refresh_token: "r", nested: [{ access_token: "a", ok: "fine" }], code: "ECONNREFUSED", route: "/api/x",
    });
    expect(d).toMatchObject({
      password: "[redacted]", apiKey: "[redacted]", headers: { authorization: "[redacted]", cookie: "[redacted]", "x-signalwire-signature": "[redacted]" },
      card: "[redacted]", client_secret: "[redacted]", DATABASE_URL: "[redacted]", refresh_token: "[redacted]",
      nested: [{ access_token: "[redacted]", ok: "fine" }], code: "ECONNREFUSED", route: "/api/x",
    });
  });

  it("never throws: cycles, throwing getters, BigInt, functions, buffers, dates, non-objects", () => {
    const cyclic: any = { a: 1 };
    cyclic.self = cyclic;
    const hostile = Object.defineProperty({}, "boom", { enumerable: true, get() { throw new Error("getter exploded"); } });
    const d = scrubDetail({ cyclic, hostile, big: 10n ** 30n, fn: () => 1, buf: Buffer.from("secret"), when: new Date("2026-10-02T00:00:00Z"), nan: NaN });
    expect(d).toMatchObject({ cyclic: { a: 1, self: "[circular]" }, hostile: { boom: "[unreadable]" }, big: "1000000000000000000000000000000", buf: "[binary 6 bytes]", when: "2026-10-02T00:00:00.000Z", nan: "NaN" });
    expect(d).not.toHaveProperty("fn");
    expect(scrubDetail("a string")).toEqual({ value: "a string" });
    expect(scrubDetail(null)).toEqual({ value: null });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => scrubDetail(revoked.proxy)).not.toThrow();
  });

  it("keeps the whole detail under the size cap", () => {
    const d = scrubDetail({ a: "x".repeat(1900), list: Array.from({ length: 200 }, (_, i) => ({ i, text: "y".repeat(500) })) });
    expect(Buffer.byteLength(JSON.stringify(d))).toBeLessThanOrEqual(MAX_DETAIL_BYTES);
    expect(d.truncated).toBe(true);
  });
});

describe("errorFacts / stackFrames", () => {
  it("keeps name, scrubbed message, code and the top frames — relative paths, no node internals", () => {
    const err = Object.assign(new Error("insert failed for bob@example.com with key sk_live_abcdefghijk1"), { code: "23505" });
    const facts = errorFacts(err) as any;
    expect(facts.name).toBe("Error");
    expect(facts.message).toBe("insert failed for b***@example.com with key [redacted]");
    expect(facts.code).toBe("23505");
    expect(facts.stack.length).toBeGreaterThan(0);
    expect(facts.stack.join("\n")).not.toContain(process.cwd());
    expect(facts.stack.join("\n")).not.toMatch(/node:internal/);
    expect(stackFrames(undefined)).toEqual([]);
    expect(errorFacts("plain string")).toEqual({ thrown: "plain string" });
  });
});
