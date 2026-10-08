/**
 * JobCam share dialog — "Prefilled from ." with an empty recipient.
 *
 * GET /api/crm/customers/:id answers { customer: {...}, projects, estimates };
 * the dialog read displayName/email off the TOP level, so the name was blank
 * and the field never prefilled. The dialog now goes through shareRecipient
 * (shared/crm-customer-detail.ts) on the typed response.
 *
 * Unit tests for the helper, plus one dev-server test that the real route's
 * response prefills (CRM_TEST_BASE_URL, like the other route suites).
 */
import { describe, it, expect } from "vitest";
import { shareRecipient, type CrmCustomerDetailResponse } from "@shared/crm-customer-detail";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

const detail = (over: Partial<CrmCustomerDetailResponse["customer"]> = {}): CrmCustomerDetailResponse => ({
  customer: { id: "c1", displayName: "Joe & Mary Kane", email: "kanes@example.com", phone: "(941) 555-0101", ...over },
  projects: [], estimates: [],
});

describe("shareRecipient", () => {
  it("prefills the client's email and names them", () => {
    expect(shareRecipient({ state: "ready", detail: detail() }, "email"))
      .toEqual({ to: "kanes@example.com", hint: "Prefilled from Joe & Mary Kane.", prefilled: true });
  });

  it("prefills the phone on the text channel", () => {
    expect(shareRecipient({ state: "ready", detail: detail() }, "text"))
      .toEqual({ to: "(941) 555-0101", hint: "Prefilled from Joe & Mary Kane.", prefilled: true });
  });

  it("no email on file: says so, prefills nothing, never claims a prefill", () => {
    const r = shareRecipient({ state: "ready", detail: detail({ email: null }) }, "email");
    expect(r.to).toBe("");
    expect(r.prefilled).toBe(false);
    expect(r.hint).toBe("Joe & Mary Kane has no email address on file — type one here, or add it on the client's page.");
  });

  it("blank email / no phone are the same as none", () => {
    expect(shareRecipient({ state: "ready", detail: detail({ email: "   " }) }, "email").prefilled).toBe(false);
    expect(shareRecipient({ state: "ready", detail: detail({ phone: null }) }, "text").hint)
      .toBe("Joe & Mary Kane has no mobile number on file — type one here, or add it on the client's page.");
  });

  it("a job with no client: says so", () => {
    expect(shareRecipient({ state: "none" }, "email"))
      .toEqual({ to: "", hint: "This job has no client on file — type the email address to send it to.", prefilled: false });
  });

  it("still loading: no helper text at all", () => {
    expect(shareRecipient({ state: "loading" }, "email")).toEqual({ to: "", hint: null, prefilled: false });
  });

  it("the client could not be loaded: says so", () => {
    expect(shareRecipient({ state: "error" }, "text").hint)
      .toBe("Couldn't load the client's contact details — type the mobile number to send it to.");
  });

  it("never prints an empty name — the reported 'Prefilled from .'", () => {
    const states = [
      shareRecipient({ state: "ready", detail: detail({ displayName: "" }) }, "email"),
      shareRecipient({ state: "ready", detail: detail({ displayName: "  ", email: null }) }, "email"),
      // The old bug's input: the record handed over at the wrong nesting level.
      shareRecipient({ state: "ready", detail: { displayName: "Joe", email: "j@example.com" } as any }, "email"),
      shareRecipient({ state: "ready", detail: undefined }, "email"),
    ];
    for (const r of states) {
      expect(r.hint).not.toMatch(/from \./);
      expect(r.hint).not.toMatch(/^ /);
      if (r.prefilled) expect(r.to).not.toBe("");
    }
    expect(states[0].hint).toBe("Prefilled from the client on this job.");
    expect(states[2].prefilled).toBe(false);
  });
});

describe("GET /api/crm/customers/:id feeds the share dialog (dev server)", () => {
  it("nests the record under `customer`, and shareRecipient prefills from it", async () => {
    const me = await fetch(`${BASE}/api/crm/me`);
    if (me.status !== 200) throw new Error(`CRM dev server not reachable at ${BASE}. Start it first.`);
    const cookie = me.headers.get("set-cookie")?.split(";")[0] ?? "";
    const headers = { "content-type": "application/json", cookie };
    const run = Date.now().toString(36);
    const email = `vitest.jcshare.${run}@example.com`;
    const made = await fetch(`${BASE}/api/crm/customers`, {
      method: "POST", headers, body: JSON.stringify({ displayName: `Vitest jcshare ${run}`, email }),
    });
    expect(made.status).toBe(201);
    const { id } = await made.json();

    const res = await fetch(`${BASE}/api/crm/customers/${id}`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CrmCustomerDetailResponse;
    // The level the dialog used to read is empty…
    expect((body as any).displayName).toBeUndefined();
    expect((body as any).email).toBeUndefined();
    // …the record is one level down.
    expect(body.customer).toMatchObject({ id, displayName: `Vitest jcshare ${run}`, email });
    expect(shareRecipient({ state: "ready", detail: body }, "email"))
      .toEqual({ to: email, hint: `Prefilled from Vitest jcshare ${run}.`, prefilled: true });
    expect(shareRecipient({ state: "ready", detail: body }, "text").hint)
      .toBe(`Vitest jcshare ${run} has no mobile number on file — type one here, or add it on the client's page.`);
  });
});
