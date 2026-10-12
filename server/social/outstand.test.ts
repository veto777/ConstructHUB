/** ConstructHUB's own publishing account (server/social/outstand.ts): mapping, the post body, statuses, webhooks, calls. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { accountFrom, isTenant, OutstandClient, outstandBody, outstandDeps, statusFrom, tenantFor, webhookSigned } from "./outstand";
import { clientFactory } from "./schedule";
import { BlotatoClient } from "./client";

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => { outstandDeps.http = fetch; outstandDeps.env = () => process.env; });
function fake(answer: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  outstandDeps.env = () => ({ OUTSTAND_API_KEY: "sk_live_fixture123" }) as any;
  outstandDeps.http = (async (url: any, init: any) => { calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : undefined }); return answer(String(url), init); }) as any;
  return calls;
}

describe("tenants and accounts", () => {
  it("names a tenant per user and business, and only those", () => {
    expect(tenantFor(12, 345)).toBe("chu12b345");
    expect(tenantFor(12, null)).toBe("chu12b0");
    expect(isTenant("chu12b345")).toBe(true);
    expect(isTenant("chu12b345; drop")).toBe(false);
    expect(() => new OutstandClient("../evil")).toThrow();
  });
  it("maps Outstand accounts to ours; a Facebook account is its own Page", () => {
    expect(accountFrom({ id: "Kx7vQ", network: "x", username: "brand", nickname: "Brand" })).toEqual({ id: "Kx7vQ", platform: "twitter", name: "Brand" });
    expect(accountFrom({ id: "fb1", network: "facebook", nickname: "Alpine Exteriors" })).toEqual({ id: "fb1", platform: "facebook", name: "Alpine Exteriors", pages: [{ id: "fb1", name: "Alpine Exteriors" }] });
    expect(accountFrom({ id: "g1", network: "google_business" })).toBeNull();
    expect(accountFrom({ id: "i1", network: "instagram", isActive: false })).toBeNull();
  });
  it("picks the provider from the stored secret", () => {
    expect(clientFactory("outstand:chu1b2").provider).toBe("outstand");
    expect(clientFactory("blotato-key-fixture")).toBeInstanceOf(BlotatoClient);
  });
});

describe("the post body", () => {
  const payload = (platform: string, target: Record<string, unknown> = {}, mediaUrls: string[] = ["https://cdn.example.com/a/photo%201.jpg"]) =>
    ({ post: { accountId: "acc1", content: { text: "New roof done", mediaUrls, platform }, target: { targetType: platform, ...target } } });
  it("carries text, media and the account", () => {
    expect(outstandBody(payload("instagram"))).toEqual({ accounts: ["acc1"], containers: [{ content: "New roof done", media: [{ url: "https://cdn.example.com/a/photo%201.jpg", filename: "photo 1.jpg" }] }] });
    expect(outstandBody(payload("linkedin", {}, []))).toEqual({ accounts: ["acc1"], containers: [{ content: "New roof done" }] });
  });
  it("translates the per-network options", () => {
    expect(outstandBody(payload("pinterest", { boardId: "b9", title: "Roofs" })).pinterest).toEqual({ board_id: "b9", title: "Roofs" });
    expect(outstandBody(payload("youtube", { title: "Tour", privacyStatus: "public", containsSyntheticMedia: true })).youtube).toEqual({ title: "Tour", privacyStatus: "public", madeForKids: false, containsSyntheticMedia: true });
    expect(outstandBody(payload("tiktok", { privacyLevel: "PUBLIC_TO_EVERYONE", isBrandedContent: true, isYourBrand: false, isAiGenerated: true })).tiktok)
      .toEqual({ privacyLevel: "PUBLIC_TO_EVERYONE", disableComment: true, disableDuet: true, disableStitch: true, brandContentToggle: true, brandOrganicToggle: false, isAigc: true });
    expect(outstandBody(payload("twitter", {}, [])).accounts).toEqual(["acc1"]);
  });
});

describe("statuses and webhooks", () => {
  it("reads a post's state for our account", () => {
    expect(statusFrom({ socialAccounts: [{ id: "a", status: "pending" }] })).toEqual({ state: "submitted", publicUrl: null, error: null });
    expect(statusFrom({ socialAccounts: [{ id: "a", status: "published", url: "https://facebook.com/p/1" }] })).toEqual({ state: "published", publicUrl: "https://facebook.com/p/1", error: null });
    expect(statusFrom({ socialAccounts: [{ id: "a", status: "failed", error: "(#100) Invalid image" }] }).error).toBe("The network refused it: (#100) Invalid image");
    expect(statusFrom({}).state).toBe("submitted");
  });
  it("accepts only webhooks signed with our secret", () => {
    const raw = Buffer.from('{"event":"post.published"}');
    const sig = "sha256=" + createHmac("sha256", "whsec").update(raw).digest("hex");
    expect(webhookSigned(raw, sig, "whsec")).toBe(true);
    expect(webhookSigned(raw, sig, "other")).toBe(false);
    expect(webhookSigned(Buffer.from("{}"), sig, "whsec")).toBe(false);
    expect(webhookSigned(raw, undefined, "whsec")).toBe(false);
    expect(webhookSigned(raw, sig, undefined)).toBe(false);
  });
});

describe("the client against a fake Outstand", () => {
  it("lists only this tenant's accounts", async () => {
    const calls = fake(() => ok({ success: true, data: [{ id: "i1", network: "instagram", username: "alpine" }, { id: "g1", network: "google_business" }] }));
    expect(await new OutstandClient("chu1b2").accounts()).toEqual([{ id: "i1", platform: "instagram", name: "alpine" }]);
    expect(calls[0].url).toBe("https://api.outstand.so/v1/social-accounts?tenantId=chu1b2&limit=100&offset=0");
    expect((calls[0].init.headers as any).Authorization).toBe("Bearer sk_live_fixture123");
  });
  it("submits once per post (idempotency key) and refuses a dropped account", async () => {
    let calls = fake(() => ok({ success: true, post: { id: "P1", socialAccounts: [{ id: "acc1", status: "pending" }] } }));
    const c = new OutstandClient("chu1b2");
    const p = { post: { accountId: "acc1", content: { text: "Hi", mediaUrls: [], platform: "facebook" }, target: {} } };
    expect(await c.submit(p, "0f6c2c64-2b3e-4b1b-9d76-4a0d2b8f9e11")).toEqual({ submissionId: "P1" });
    expect((calls[0].init.headers as any)["Idempotency-Key"]).toBe("0f6c2c64-2b3e-4b1b-9d76-4a0d2b8f9e11");
    calls = fake(() => ok({ success: true, post: { id: "P2", socialAccounts: [{ id: "someone-else" }] } }));
    await expect(c.submit(p, "k")).rejects.toMatchObject({ status: 409 });
  });
  it("says plainly what went wrong, never the vendor's raw failure", async () => {
    const c = new OutstandClient("chu1b2");
    fake(() => ok({ success: false, error: "Your organization does not have an active subscription.", code: "subscription_inactive" }, 402));
    await expect(c.status("P1")).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/paused on our side/) });
    fake(() => ok({ error: "API key rate limit exceeded" }, 429));
    await expect(c.status("P1")).rejects.toMatchObject({ status: 429 });
    fake(() => { throw new Error("socket hang up"); });
    await expect(c.status("P1")).rejects.toMatchObject({ status: 502 });
    outstandDeps.env = () => ({}) as any;
    await expect(c.status("P1")).rejects.toMatchObject({ status: 503 });
  });
  it("starts a connection tagged with the tenant, and finishes Facebook page picks", async () => {
    let calls = fake(() => ok({ success: true, data: { auth_url: "https://www.outstand.so/app/api/socials/facebook/org1?state=s" } }));
    const url = await new OutstandClient("chu1b2").authUrl("facebook", "https://constructhub.us/social-media?business=2&connected=facebook");
    expect(url).toMatch(/^https:\/\/www\.outstand\.so\//);
    expect(calls[0].url).toBe("https://api.outstand.so/v1/social-networks/facebook/auth-url");
    expect(calls[0].body).toEqual({ redirect_uri: "https://constructhub.us/social-media?business=2&connected=facebook", tenant_id: "chu1b2", force_account_selection: true });
    calls = fake(() => ok({ success: true, data: { network: "facebook", availablePages: [{ id: "pg1", name: "Alpine Exteriors", type: "page" }] } }));
    expect(await OutstandClient.pending("sess_abcdefgh")).toEqual({ network: "facebook", pages: [{ id: "pg1", name: "Alpine Exteriors", kind: "page" }] });
    calls = fake(() => ok({ success: true, connectedAccounts: [{ id: "fb1" }] }));
    expect(await OutstandClient.finalize("sess_abcdefgh", ["pg1"])).toBe(1);
    expect(calls[0].body).toEqual({ selectedPageIds: ["pg1"] });
    await expect(OutstandClient.pending("x")).rejects.toThrow(/expired/);
  });
  it("uploads in two steps: start, then confirm for the public address", async () => {
    let calls = fake(() => ok({ success: true, data: { id: "Vn4kP", upload_url: "https://r2.example.com/put?sig=1", expires_in: 3600 } }));
    const c = new OutstandClient("chu1b2");
    expect(await c.startUpload("roof.jpg")).toEqual({ presignedUrl: "https://r2.example.com/put?sig=1", contentType: "image/jpeg", publicUrl: null, uploadId: "Vn4kP" });
    expect(calls[0].body).toEqual({ filename: "roof.jpg", content_type: "image/jpeg" });
    calls = fake(() => ok({ success: true, data: { id: "Vn4kP", url: "https://media.outstand.so/roof.jpg" } }));
    expect(await c.confirmUpload!("Vn4kP")).toBe("https://media.outstand.so/roof.jpg");
    await expect(c.startUpload("notes.txt")).rejects.toThrow(/JPG/);
  });
});
