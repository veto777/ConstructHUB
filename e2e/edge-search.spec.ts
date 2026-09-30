import { test, expect } from "@playwright/test";
import pg from "pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `a5-e2e-${randomUUID().slice(0, 8)}`;
let cf: number, gsc: number, old: any, scan: string;
test.beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/constructhub_dev_a5")
    throw Error("a5 only");
  old = (
    await db.query("SELECT password_hash,totp_enabled FROM users WHERE id=1")
  ).rows[0];
  await db.query(
    "UPDATE users SET password_hash=$1,totp_enabled=false WHERE id=1",
    [await bcrypt.hash("A5-browser-fixture-pass!", 10)],
  );
  const { rows } = await db.query(
    "INSERT INTO edge_connections(user_id,provider,subject,email,method) VALUES(1,'cloudflare',$1,'fixture@example.invalid','paste'),(1,'gsc',$1,'fixture@example.invalid','oauth') RETURNING id,provider",
    [tag],
  );
  cf = rows.find((r) => r.provider === "cloudflare").id;
  gsc = rows.find((r) => r.provider === "gsc").id;
  await db.query(
    "INSERT INTO business_locations(user_id,business_name,website) SELECT 1,$1||'-'||lpad(i::text,4,'0'),'https://'||$1||'-'||i||'.example.invalid/' FROM generate_series(1,1000) i",
    [tag],
  );
  for (const [id, provider] of [
    [cf, "cloudflare"],
    [gsc, "gsc"],
  ] as const)
    await db.query(
      "INSERT INTO edge_assets(user_id,connection_id,provider,external_id,name,domain,status) SELECT 1,$1,$2,md5($3||i::text),$3||'-'||lpad(i::text,4,'0'),$3||'-'||i||'.example.invalid',$4 FROM generate_series(1,1000) i",
      [
        id,
        provider,
        tag,
        provider === "cloudflare" ? "active" : "siteFullUser",
      ],
    );
  const a = (
    await db.query(
      "SELECT id FROM edge_assets WHERE connection_id=$1 ORDER BY id LIMIT 1",
      [gsc],
    )
  ).rows[0].id;
  await db.query("UPDATE edge_assets SET external_id=$2 WHERE id=$1", [
    a,
    `sc-domain:${tag}-1.example.invalid`,
  ]);
  await db.query(
    "INSERT INTO gsc_analytics(asset_id,dimension,date,key,clicks,impressions,position) VALUES($1,'date',current_date-5,'',7,70,3)",
    [a],
  );
  await db.query(
    "INSERT INTO gsc_inspections(asset_id,url,result) VALUES($1,$2,$3)",
    [
      a,
      `https://${tag}-1.example.invalid/`,
      JSON.stringify({
        indexStatusResult: {
          coverageState: "Submitted and indexed",
          verdict: "PASS",
        },
      }),
    ],
  );
  scan = randomUUID();
  await db.query(
    "INSERT INTO sitescan_jobs(id,user_id,url,page_cap,state,status,report) VALUES($1,1,$2,1,$3,'completed',$4)",
    [
      scan,
      `https://${tag}-1.example.invalid/`,
      JSON.stringify({ pages: [{ url: `https://${tag}-1.example.invalid/` }] }),
      JSON.stringify({
        scores: { overall: 80, categories: {} },
        findings: [],
        coverage: { notes: [] },
        pages: 1,
      }),
    ],
  );
});
test.afterAll(async () => {
  await db.query("DELETE FROM edge_connections WHERE id=ANY($1::int[])", [
    [cf, gsc],
  ]);
  await db.query(
    "DELETE FROM business_locations WHERE user_id=1 AND business_name LIKE $1",
    [tag + "%"],
  );
  await db.query("DELETE FROM sitescan_jobs WHERE id=$1", [scan]);
  await db.query(
    "UPDATE users SET password_hash=$1,totp_enabled=$2 WHERE id=1",
    [old.password_hash, old.totp_enabled],
  );
  await db.end();
});
test("Cloudflare 1,000-site list → bulk preview → confirmation → durable queue", async ({
  page,
}) => {
  await page.goto("/cloudflare");
  await expect(
    page.getByRole("heading", { name: "Cloudflare protection" }),
  ).toBeVisible();
  await page.getByLabel("Search sites", { exact: true }).fill(tag);
  await expect(page.getByText("1000 sites", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next sites" }).click();
  await expect(
    page.getByRole("button", { name: `${tag}-0026`, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Previous sites" }).click();
  await page.getByLabel("Select this page").check();
  await page.getByLabel("Rule pack").selectOption("ips");
  await page
    .getByLabel("Flagged IP addresses (comma separated)")
    .fill("192.0.2.5");
  await page
    .getByRole("button", { name: "Preview rules", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review before applying" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm and queue edge changes" })
    .click();
  await page
    .getByLabel("Verification", { exact: true })
    .fill("A5-browser-fixture-pass!");
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  await expect
    .poll(async () =>
      Number(
        (
          await db.query(
            "SELECT count(*) FROM edge_jobs WHERE connection_id=$1 AND kind='apply' AND state='queued'",
            [cf],
          )
        ).rows[0].count,
      ),
    )
    .toBe(25);
  await page.getByRole("button", { name: "Work queue", exact: true }).click();
  await expect(page.getByText(/apply · queued/).first()).toBeVisible();
  await page.getByRole("button", { name: "Guide", exact: true }).click();
  await expect(
    page.getByText("Put a client site behind Cloudflare", { exact: true }),
  ).toBeVisible();
});
test("Search Console 1,000-property list → cached analytics → bulk sync → URL inspection queue", async ({
  page,
}) => {
  await page.goto("/search-console");
  await page.getByLabel("Search sites", { exact: true }).fill(tag);
  await expect(page.getByText("1000 sites", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `${tag}-0001`, exact: true }).click();
  await expect(
    page.getByText("Clicks: 7 · Impressions: 70 · CTR: 10.00% · Position: 3.0"),
  ).toBeVisible();
  await expect(page.getByText(/Submitted and indexed · PASS/)).toBeVisible();
  await page.getByLabel("Select this page").check();
  await page.getByRole("button", { name: "Sync selected (25)" }).click();
  await expect
    .poll(async () =>
      Number(
        (
          await db.query(
            "SELECT count(*) FROM edge_jobs WHERE connection_id=$1 AND kind='sync'",
            [gsc],
          )
        ).rows[0].count,
      ),
    )
    .toBe(25);
  const a = (
    await db.query(
      "SELECT id FROM edge_assets WHERE connection_id=$1 ORDER BY id LIMIT 1",
      [gsc],
    )
  ).rows[0].id;
  await page
    .getByLabel("Property IDs and URLs")
    .fill(`${a}, https://${tag}-1.example.invalid/about`);
  await page
    .getByRole("button", { name: "Queue inspections", exact: true })
    .click();
  await expect
    .poll(async () =>
      Number(
        (
          await db.query(
            "SELECT count(*) FROM edge_jobs WHERE connection_id=$1 AND kind='inspect'",
            [gsc],
          )
        ).rows[0].count,
      ),
    )
    .toBe(1);
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Connect Google Search Console" }),
  ).toBeVisible();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Onboarding", exact: true }).click();
  await page.getByLabel("Search Locations", { exact: true }).fill(tag);
  await expect(page.getByText("1000 results", { exact: true })).toBeVisible();
});
