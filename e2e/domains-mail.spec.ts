import { test, expect } from "@playwright/test";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const suffix = Date.now();
const domain = `a7-browser-${suffix}.example.test`;
let location: number;
let notificationStart = 0,
  activityStart = 0;
test.beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/constructhub_dev_a7")
    throw new Error("a7 only");
  notificationStart = Number(
    (
      await pool.query(
        "SELECT COALESCE(max(id),0) id FROM user_notifications WHERE user_id=1",
      )
    ).rows[0].id,
  );
  activityStart = Number(
    (
      await pool.query(
        "SELECT COALESCE(max(id),0) id FROM account_activity WHERE user_id=1",
      )
    ).rows[0].id,
  );
  location = (
    await pool.query(
      "INSERT INTO business_locations(user_id,business_name,website) VALUES(1,$1,$2) RETURNING id",
      [`A7 Browser Fixture ${suffix}`, `https://${domain}`],
    )
  ).rows[0].id;
});
test.afterAll(async () => {
  await pool.query(
    "DELETE FROM mail_alert_messages WHERE user_id=1 AND subject LIKE $1",
    [`%${suffix}%`],
  );
  await pool.query(
    "DELETE FROM managed_domains WHERE user_id=1 AND domain=$1",
    [domain],
  );
  await pool.query("DELETE FROM business_locations WHERE user_id=1 AND id=$1", [
    location,
  ]);
  await pool.query(
    "DELETE FROM user_notifications WHERE user_id=1 AND kind IN ('mail.alert','mail.security') AND id>$1",
    [notificationStart],
  );
  await pool.query(
    "DELETE FROM account_activity WHERE user_id=1 AND kind='mail.alert' AND id>$1",
    [activityStart],
  );
  await pool.end();
});
test("manual inventory, server search, bulk client mapping and queued monitoring", async ({
  page,
}) => {
  await page.goto("/domains");
  await expect(
    page.getByRole("heading", { name: "Domains", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Manual domains").fill(domain);
  await page.getByRole("button", { name: "Add domains", exact: true }).click();
  await page.getByLabel("Search domains", { exact: true }).fill(domain);
  await expect(
    page.getByRole("cell", { name: domain, exact: false }).first(),
  ).toBeVisible();
  await page.getByLabel(`Select ${domain}`, { exact: true }).check();
  await page
    .getByLabel("Find client location")
    .fill(`A7 Browser Fixture ${suffix}`);
  await expect(
    page.getByLabel("Client location", { exact: true }).locator("option"),
  ).toHaveCount(2);
  await page
    .getByLabel("Client location", { exact: true })
    .selectOption(String(location));
  await page.getByRole("button", { name: "Map selected to client" }).click();
  await expect(
    page.getByRole("cell", { name: String(location), exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check selected domains" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved." }),
  ).toBeVisible();
  await page
    .getByText("Wix · Manual DNS only; nameserver change unavailable", {
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      "Wix does not allow changing nameservers for domains registered at Wix.",
      { exact: true },
    ),
  ).toBeVisible();
});
test("forwarding setup, shared-secret rejection, confirmation and critical transfer alert", async ({
  page,
  request,
}) => {
  await page.goto("/mail-alerts");
  const input = page.getByLabel("Forwarding address");
  await expect(input).toHaveValue(/^alerts\+[a-f0-9]{48}@/);
  const address = await input.inputValue();
  const denied = await request.post("/api/inbound-mail", {
    data: {
      from: "noreply@porkbun.com",
      to: address,
      subject: `Domain transfer ${suffix}`,
      text: domain,
    },
  });
  expect(denied.status()).toBe(401);
  const headers = { "x-inbound-mail-secret": "a7-local-test-secret" };
  expect(
    (
      await request.post("/api/inbound-mail", {
        headers,
        data: {
          from: "forwarding-noreply@google.com",
          to: address,
          subject: `Gmail Forwarding Confirmation ${suffix}`,
          text: "Confirmation code: 123456789\nhttps://mail.google.com/mail/vf-fixture",
        },
      })
    ).status(),
  ).toBe(202);
  expect(
    (
      await request.post("/api/inbound-mail", {
        headers,
        data: {
          from: "noreply@porkbun.com",
          to: address,
          subject: `Domain transfer request ${suffix}`,
          text: `Transfer attempt for ${domain}`,
        },
      })
    ).status(),
  ).toBe(202);
  await page.reload();
  await page.getByLabel("Search alerts").fill(String(suffix));
  await expect(page.getByText("123456789", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Confirm forwarding at Google" }),
  ).toHaveAttribute("href", "https://mail.google.com/mail/vf-fixture");
  await page.getByLabel("Alert severity").selectOption("critical");
  await expect(
    page.getByRole("heading", { name: `Domain transfer request ${suffix}` }),
  ).toBeVisible();
  await expect(page.getByText("123456789", { exact: true })).toHaveCount(0);
  await page.getByLabel("Select alert page").check();
  await page.getByRole("button", { name: "Mark selected as read" }).click();
  await expect(page.locator("article").getByText(/· Read ·/)).toBeVisible();
});

test("DNS preview requires confirmation and the shared step-up dialog before apply (mocked provider)", async ({
  page,
}) => {
  const jobId = "a7a7a7a7-0000-4000-8000-000000000007";
  let previewed = false,
    verified = false,
    applied = false;
  const before = {
    nameservers: ["old-a.example.test", "old-b.example.test"],
    records: [],
  };
  const after = {
    nameservers: ["new-a.example.test", "new-b.example.test"],
    records: [],
  };
  await page.route("**/api/domains**", async (route) => {
    const req = route.request(),
      p = new URL(req.url()).pathname;
    let data: any = { items: [] };
    if (p === "/api/domains")
      data = {
        items: [
          {
            id: "7",
            domain: "preview.example.test",
            registrar: "porkbun",
            state: before,
          },
        ],
        total: 1,
      };
    else if (p.endsWith("/guides")) data = { guides: [], workerEnabled: true };
    else if (p.endsWith("/jobs"))
      data = {
        items: previewed
          ? [
              {
                id: jobId,
                domain: "preview.example.test",
                kind: "change",
                status: applied ? "verifying" : "ready",
                before_state: before,
                after_state: after,
              },
            ]
          : [],
      };
    else if (p.endsWith("/preview")) {
      expect(req.postDataJSON()).toEqual({
        ids: [7],
        change: { kind: "nameservers", nameservers: after.nameservers },
      });
      previewed = true;
      data = { jobs: [jobId] };
    } else if (p.endsWith("/confirm")) {
      expect(req.postDataJSON()).toEqual({
        jobIds: [jobId],
        confirmed: true,
        emailWarningAccepted: true,
      });
      if (!verified)
        return route.fulfill({
          status: 403,
          json: { reauth: true, message: "Verify identity" },
        });
      applied = true;
      data = { queued: true };
    }
    await route.fulfill({ json: data });
  });
  await page.route("**/api/auth/reauth", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        value: "fixture-password",
      });
      verified = true;
    }
    await route.fulfill({
      json:
        route.request().method() === "GET"
          ? { method: "password" }
          : { ok: true },
    });
  });
  await page.goto("/domains");
  await page.getByLabel("Select preview.example.test", { exact: true }).check();
  await page
    .getByLabel("Nameservers", { exact: true })
    .fill(after.nameservers.join(", "));
  await page
    .getByRole("button", { name: "Preview nameservers", exact: true })
    .click();
  const preview = page
    .locator("details")
    .filter({ hasText: "preview.example.test" });
  await preview.locator("summary").click();
  await expect(
    preview.getByRole("heading", { name: "Before", exact: true }),
  ).toBeVisible();
  await expect(preview.getByText(/old-a.example.test/)).toBeVisible();
  expect(applied).toBe(false);
  await page.getByLabel(`Select job ${jobId}`).check();
  await page.getByLabel("I reviewed the changes", { exact: false }).check();
  await page.getByRole("button", { name: "Confirm selected previews" }).click();
  await expect(
    page.getByRole("heading", { name: "Verify your identity" }),
  ).toBeVisible();
  expect(applied).toBe(false);
  await page
    .getByLabel("Verification", { exact: true })
    .fill("fixture-password");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(preview.locator("summary")).toContainText("verifying");
  expect(applied).toBe(true);
});
