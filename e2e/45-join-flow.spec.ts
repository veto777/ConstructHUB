import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { ALPINE_ORG, deleteInvitation, makeInvitation, q } from "./db";

/**
 * The join loop's signed-out leg, covered at the API level (the e2e dev
 * server runs DEV_AUTH_BYPASS_USER1, so a browser context can never be
 * signed out): invitation → signup with next= → verification email →
 * verify-email redirects BACK to the invite instead of home. Shipped broken:
 * the verify redirect dropped next, and the invitee landed on a bare home
 * page with no path back to the accept screen. Also pins the open-redirect
 * guard (backslash and protocol-relative next values are refused).
 */

function outboxTo(email: string): Array<{ html: string | null; text: string | null; subject: string | null }> {
  const file = path.join(process.cwd(), "tmp", "email-outbox.jsonl");
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((m) => (m.to ?? []).includes(email));
}

async function signupAndGetVerifyLink(page: any, email: string, next?: string) {
  const r = await page.request.post("/api/auth/signup", {
    data: { email, password: "e2e-password-123", displayName: "E2E Joiner", ...(next ? { next } : {}) },
  });
  expect(r.status(), await r.text()).toBe(200);
  const mails = outboxTo(email);
  const mail = mails[mails.length - 1];
  const body = `${mail.html ?? ""}${mail.text ?? ""}`;
  const m = body.match(/\/api\/auth\/verify-email\?token=[a-f0-9]+/);
  expect(m, "verification link in the email").toBeTruthy();
  return m![0];
}

test.describe("join flow — signed-out leg (API level)", () => {
  test("signup with next= returns to the invite after email verification", async ({ page }) => {
    const email = `e2e-joinloop-${Date.now().toString(36)}@example.com`;
    const inviteToken = await makeInvitation(ALPINE_ORG, email);
    try {
      const next = `/crm/join?token=${inviteToken}`;
      const verifyPath = await signupAndGetVerifyLink(page, email, next);

      const res = await page.request.get(verifyPath, { maxRedirects: 0 });
      expect(res.status()).toBe(302);
      expect(res.headers()["location"]).toBe(next);
    } finally {
      await q(`delete from users where email = $1`, [email]);
      await deleteInvitation(inviteToken);
    }
  });

  test("signup without next= lands on the classic verified home", async ({ page }) => {
    const email = `e2e-joinloop-${Date.now().toString(36)}b@example.com`;
    try {
      const verifyPath = await signupAndGetVerifyLink(page, email);
      const res = await page.request.get(verifyPath, { maxRedirects: 0 });
      expect(res.status()).toBe(302);
      expect(res.headers()["location"]).toBe("/?auth=verified");
    } finally {
      await q(`delete from users where email = $1`, [email]);
    }
  });

  test("hostile next= values are refused (open-redirect guard)", async ({ page }) => {
    for (const [i, hostile] of ["//evil.com/x", "/\\evil.com/x"].entries()) {
      const email = `e2e-joinloop-${Date.now().toString(36)}h${i}@example.com`;
      try {
        const verifyPath = await signupAndGetVerifyLink(page, email, hostile);
        const res = await page.request.get(verifyPath, { maxRedirects: 0 });
        expect(res.status()).toBe(302);
        expect(res.headers()["location"], `next=${hostile} must not be honored`).toBe("/?auth=verified");
      } finally {
        await q(`delete from users where email = $1`, [email]);
      }
    }
  });
});
