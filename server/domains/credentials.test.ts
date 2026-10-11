import { describe, it, expect } from "vitest";
import { readDomainRecords } from "./service";
import { DomainError } from "./types";

/**
 * Saved registrar keys that can no longer be decrypted (rotated master key,
 * unencrypted legacy row, corrupt payload) must surface an actionable
 * "disconnect and reconnect" error — not the generic 500 "Domain operation
 * failed" the raw JSON.parse/decrypt throw produced (2026-10-11 findings).
 * decryptToken throws on malformed input before any network or DB access.
 */
describe("unreadable saved registrar credentials", () => {
  const capture = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (e) => e,
    );
  it("maps an unencrypted credential row to a reconnectable 502", async () => {
    const err = await capture(
      readDomainRecords(
        { id: 7, provider: "porkbun", label: "Acme", credentials: "plain-text" },
        "example.test",
      ),
    );
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).status).toBe(502);
    expect((err as DomainError).code).toBe("credentials_unreadable");
    expect((err as DomainError).message).toContain("Acme");
    expect((err as DomainError).message).toMatch(/disconnect/i);
  });
  it("maps a malformed encrypted credential to the same error", async () => {
    const err = await capture(
      readDomainRecords(
        {
          id: 8,
          provider: "namecom",
          label: "Beta",
          credentials: "v1:AAAA:BBBB:CCCC",
        },
        "example.test",
      ),
    );
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).status).toBe(502);
    expect((err as DomainError).code).toBe("credentials_unreadable");
  });
});
