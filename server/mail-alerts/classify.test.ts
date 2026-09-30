import { it, expect, describe } from "vitest";
import { classifyMail, parseMail, GMAIL_QUERY } from "./classify";
const mail = {
  from: "noreply@porkbun.com",
  to: "alerts@example.test",
  subject: "Domain expiry notice",
  text: "example.test expires soon",
};
describe("mail allowlist, MIME and confirmations", () => {
  it("drops unrelated messages and sender suffix spoofs", () => {
    expect(
      classifyMail({ ...mail, from: "noreply@porkbun.com.attacker.test" }),
    ).toBeNull();
    expect(classifyMail({ ...mail, from: "friend@example.test" })).toBeNull();
    expect(
      classifyMail({ ...mail, subject: "Your weekly newsletter" }),
    ).toBeNull();
    expect(classifyMail({ ...mail, from: "person@google.com" })).toBeNull();
  });
  it("raises registrar transfer attempts to critical without taking an action", () => {
    expect(
      classifyMail({ ...mail, subject: "Domain transfer requested" }),
    ).toMatchObject({ category: "registrar", severity: "critical" });
  });
  it("classifies all required provider families", () => {
    for (const [from, subject, category] of [
      ["mybusiness-noreply@google.com", "Your profile was suspended", "gbp"],
      ["sc-noreply@google.com", "Indexing coverage issue", "gsc"],
      ["ads-noreply@google.com", "Policy disapproval", "ads"],
      ["noreply@notify.cloudflare.com", "Member invitation", "cloudflare"],
      ["support@blotato.com", "Publishing failed", "blotato"],
    ])
      expect(classifyMail({ ...mail, from, subject })?.category).toBe(category);
  });
  it("decodes MIME and safely extracts only Google confirmation links", async () => {
    const m = await parseMail(
      "From: forwarding-noreply@google.com\r\nTo: alerts@example.test\r\nSubject: Gmail Forwarding Confirmation\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" +
        Buffer.from(
          "Confirmation code: 123456789\nhttps://evil.test/confirm\nhttps://mail.google.com/mail/vf-test",
        ).toString("base64"),
    );
    expect(classifyMail(m)).toMatchObject({
      code: "123456789",
      link: "https://mail.google.com/mail/vf-test",
    });
    expect(
      classifyMail({
        ...m,
        text: "https://mail.google.com.attacker.test/mail/vf-test",
      })?.link,
    ).toBeNull();
  });
  it("strips HTML scripts, bounds raw payloads and limits Gmail query", async () => {
    expect(
      (
        await parseMail({
          ...mail,
          text: undefined,
          html: "<script>secret()</script><p>Domain expiry</p>",
        })
      ).text,
    ).toBe("Domain expiry");
    await expect(parseMail("a".repeat(262145))).rejects.toThrow();
    expect(GMAIL_QUERY).toContain("newer_than:30d");
    expect(GMAIL_QUERY).toContain("from:sc-noreply@google.com");
  });
});
