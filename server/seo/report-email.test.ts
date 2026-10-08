import { describe, expect, it } from "vitest";
import { smtpFailureIsDefinite } from "../email";

describe("a failed report email: certainly not sent, or not known", () => {
  it("before sending, or the server's own refusal, is certain; a send that broke off is not", () => {
    const err = (o: Record<string, unknown>) => Object.assign(new Error("x"), o);
    expect(smtpFailureIsDefinite(err({ stage: "verify", code: "ETIMEDOUT" }))).toBe(true);
    expect(smtpFailureIsDefinite(err({ stage: "rejected" }))).toBe(true);
    expect(smtpFailureIsDefinite(err({ stage: "send", responseCode: 552, command: "DATA" }))).toBe(true);
    expect(smtpFailureIsDefinite(err({ stage: "send", code: "EAUTH" }))).toBe(true);
    expect(smtpFailureIsDefinite(err({ stage: "send", code: "ECONNECTION", command: "CONN" }))).toBe(true);
    // Broke off or timed out mid-send: the server may have accepted it.
    expect(smtpFailureIsDefinite(err({ stage: "send", code: "ETIMEDOUT" }))).toBe(false);
    expect(smtpFailureIsDefinite(err({ stage: "send", code: "ESOCKET", command: "DATA" }))).toBe(false);
    expect(smtpFailureIsDefinite(err({ stage: "send" }))).toBe(false);
    expect(smtpFailureIsDefinite(new Error("unknown"))).toBe(false);
  });
});
