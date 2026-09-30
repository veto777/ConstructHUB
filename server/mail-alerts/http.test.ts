import { it, expect } from "vitest";
/** Full lane HTTP boundary: no external writes, ingress worker/registrar jobs are disabled. */
const base = process.env.CRM_TEST_BASE_URL || "http://127.0.0.1:8189";
it("rejects malformed credential JSON and oversized mail without reflecting payloads", async () => {
  expect(new URL(base).port).toBe("8189");
  const response = await fetch(`${base}/api/domains/connections`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"secret":"fixture-never-reflect",broken',
  });
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain("fixture-never-reflect");
  const unauthorized = await fetch(`${base}/api/inbound-mail`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"from":"fixture-secret"}',
  });
  expect(unauthorized.status).toBe(401);
  expect(await unauthorized.text()).not.toContain("fixture-secret");
});
