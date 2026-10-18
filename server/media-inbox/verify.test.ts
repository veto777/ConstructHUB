import { afterEach, describe, expect, it } from "vitest";
import { checkMailbox, classify, verifyDeps } from "./verify";
import { NOT_A_CONTACT } from "./worker";

const orig = { ...verifyDeps };
afterEach(() => Object.assign(verifyDeps, orig));

describe("mailbox check", () => {
  it("reads the recipient's own refusal as a missing mailbox", () => {
    expect(classify({ stage: "rcpt", code: 550, text: "5.1.1 User Unknown" })).toBe("no");
    expect(classify({ stage: "rcpt", code: 550, text: "5.4.1 Recipient address rejected: Access denied." })).toBe("no");
    expect(classify({ stage: "rcpt", code: 250, text: "2.1.5 OK" })).toBe("ok");
  });

  it("never blames the mailbox for a refusal aimed at us, a timeout or a temporary error", () => {
    expect(classify({ stage: "rcpt", code: 550, text: "5.7.1 Service unavailable; client host blocked using Spamhaus" })).toBe("unknown");
    expect(classify({ stage: "mail", code: 550, text: "sender rejected" })).toBe("unknown");
    expect(classify({ stage: "rcpt", code: 450, text: "4.2.1 try later" })).toBe("unknown");
    expect(classify({ stage: "ehlo", code: 0, text: "timeout" })).toBe("unknown");
  });

  it("tries the next mail server after a timeout, and stops at a real answer", async () => {
    const asked: string[] = [];
    verifyDeps.resolveMx = async () => [{ exchange: "b.mx", priority: 10 }, { exchange: "a.mx", priority: 0 }];
    verifyDeps.rcptReply = async (host) => { asked.push(host); return host === "a.mx" ? { stage: "ehlo", code: 0, text: "timeout" } : { stage: "rcpt", code: 550, text: "5.1.1 User Unknown" }; };
    expect(await checkMailbox("x@example.com", "media@constructhub.us")).toEqual({ verdict: "no", reply: "550 5.1.1 User Unknown" });
    expect(asked).toEqual(["a.mx", "b.mx"]);
  });

  it("skips addresses that are never a cold contact", () => {
    for (const e of ["applicationsprogramming@azfamily.com", "jobs@x.com", "billing@x.com", "hr@x.com"]) expect(NOT_A_CONTACT.test(e)).toBe(true);
    for (const e of ["news@x.com", "editor@x.com", "info@x.com", "tips@x.com", "apple@x.com"]) expect(NOT_A_CONTACT.test(e)).toBe(false);
  });
});
