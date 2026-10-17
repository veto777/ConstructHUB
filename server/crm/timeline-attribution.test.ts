/**
 * Timeline attribution — every line names WHO did it (owner order
 * 2026-10-17). Pure helpers from shared/crm-actor.ts, actors.ts and
 * notes-timeline.ts; no server or DB needed.
 *
 * Members by name, the owner as "Name (Owner)" ("Owner" when no name is set),
 * clients by the client's name, automatic work by its source. A historic row
 * with nothing recorded says so — never a guess from the file name.
 */
import { describe, it, expect } from "vitest";

// notes-timeline.ts pulls in tenancy → ../stripe, which throws without a key
// at module scope; the db module wants a URL. Neither is used here.
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";

const {
  commentTimelineText, photoTimelineText, resolveAttachmentActor, estimateFileTimelineText,
  estimateEventText, estimateEventActor, messageTimelineText, paymentTimelineText,
} = await import("./notes-timeline");
const { actorDirectoryOf } = await import("./actors");
const { activityText } = await import("./activity");
const {
  memberDisplayName, memberActor, clientActor, systemActor, actorLabel, uploadLabelActor, logLabelActor,
  UNRECORDED_TEAM_ACTOR, UNRECORDED_ACTOR,
} = await import("@shared/crm-actor");

const dir = actorDirectoryOf([
  { id: "m-owner", role: "owner", displayName: "Veto Smith", email: "veto@example.com" },
  { id: "m-gabe", role: "pm", displayName: "Gabe Varnadore", email: "gabe@example.com" },
  { id: "m-noname-owner", role: "owner", displayName: null, email: "boss@example.com" },
  { id: "m-noname", role: "field", displayName: null, email: "sam.ortiz@example.com", userDisplayName: null },
  { id: "m-username", role: "office", displayName: null, email: "x@example.com", userDisplayName: "Ana Ruiz" },
]);
const gabe = dir.member("m-gabe")!;
const owner = dir.member("m-owner")!;

describe("actor names", () => {
  it("a member reads by display name → user's own name → email local part; never an id", () => {
    expect(memberDisplayName({ role: "pm", displayName: "Gabe Varnadore", email: "g@x.com" })).toBe("Gabe Varnadore");
    expect(memberDisplayName({ role: "office", displayName: null, userDisplayName: "Ana Ruiz", email: "a@x.com" })).toBe("Ana Ruiz");
    expect(memberDisplayName({ role: "field", displayName: null, email: "sam.ortiz@example.com" })).toBe("sam.ortiz");
    expect(memberDisplayName({ role: "field", displayName: "sam@example.com", email: "sam@example.com" })).toBe("sam");
    expect(actorLabel(dir.member("m-username")!)).toBe("Ana Ruiz");
    expect(actorLabel(dir.member("m-noname")!)).toBe("sam.ortiz");
  });

  it("the owner is labelled — 'Name (Owner)', or 'Owner' when no name is set", () => {
    expect(actorLabel(owner)).toBe("Veto Smith (Owner)");
    expect(owner.isOwner).toBe(true);
    expect(actorLabel(dir.member("m-noname-owner")!)).toBe("Owner");
    expect(actorLabel(memberActor({ role: "owner", displayName: null, email: "boss@example.com" }))).not.toContain("boss");
    expect(actorLabel(gabe)).toBe("Gabe Varnadore");
  });

  it("clients by name, automatic sources by what did it", () => {
    expect(actorLabel(clientActor("Carley Geiss"))).toBe("Carley Geiss");
    expect(clientActor("  ").name).toBe("Client");
    expect(actorLabel(systemActor("HOVER import"))).toBe("HOVER import");
    expect(uploadLabelActor("HOVER import").kind).toBe("system");
    expect(uploadLabelActor("Carley Geiss")).toMatchObject({ kind: "client", name: "Carley Geiss" });
    // The stored kind wins over the name: a client called "Stripe" is the client.
    expect(uploadLabelActor("Stripe", "client")).toMatchObject({ kind: "client", name: "Stripe" });
    expect(uploadLabelActor("HOVER import", "system")).toMatchObject({ kind: "system" });
    expect(resolveAttachmentActor({ kind: "photo", fileName: "a.jpg", uploadedByLabel: "System", uploadedByKind: "client" }, { member: dir.member }))
      .toMatchObject({ kind: "client", name: "System" });
    expect(logLabelActor("client", "Carley Geiss")).toMatchObject({ kind: "client", name: "Carley Geiss" });
    expect(logLabelActor("Ava (Call Assistant)")).toMatchObject({ kind: "system", name: "Ava (Call Assistant)" });
  });

  it("a removed member falls back to the log row's name snapshot, never the id", () => {
    expect(dir.logActor({ actorMemberId: "m-gone", actorLabel: "Dave Lee" })).toMatchObject({ kind: "member", name: "Dave Lee" });
    expect(dir.logActor({ actorMemberId: "m-gone", actorLabel: "dave@example.com" }).name).toBe("dave");
    expect(dir.logActor({ actorMemberId: "m-owner", actorLabel: "old name" })).toBe(owner);
  });
});

describe("timeline sentences", () => {
  it("photos name the uploader: member, owner, client, HOVER", () => {
    expect(photoTimelineText("progress--IMG_3305.jpeg", gabe).text)
      .toBe("Gabe Varnadore added a project photo (in progress) — IMG_3305.jpeg");
    expect(photoTimelineText("finished--roof.jpg", owner).text)
      .toBe("Veto Smith (Owner) added a project photo (finished) — roof.jpg");
    const client = photoTimelineText("IMG_0042.jpg", clientActor("Carley Geiss"));
    expect(client.text).toBe("Carley Geiss shared a photo — IMG_0042.jpg");
    expect(client.actionText).toBe("shared a photo — IMG_0042.jpg");
    expect(photoTimelineText("hover-123-9.jpg", systemActor("HOVER import")).text)
      .toBe("HOVER import added a photo — hover-123-9.jpg");
  });

  it("historic photos with nothing recorded say so — never 'Your team added' as if known", () => {
    const staged = photoTimelineText("progress--IMG_1.jpg", UNRECORDED_TEAM_ACTOR);
    expect(staged.text).toBe("Added by your team (uploader not recorded): a project photo (in progress) — IMG_1.jpg");
    expect(photoTimelineText("IMG_2.jpg", UNRECORDED_ACTOR).text).toBe("Photo added (uploader not recorded) — IMG_2.jpg");
  });

  it("resolveAttachmentActor uses real evidence only", () => {
    const m = dir.member;
    // 1. the row's own columns
    expect(resolveAttachmentActor({ kind: "photo", fileName: "progress--a.jpg", uploadedByMemberId: "m-gabe" }, { member: m })).toBe(gabe);
    expect(resolveAttachmentActor({ kind: "photo", fileName: "a.jpg", uploadedByLabel: "Carley Geiss" }, { member: m }))
      .toMatchObject({ kind: "client", name: "Carley Geiss" });
    // 2. an activity-log row for the same attachment
    expect(resolveAttachmentActor({ kind: "photo", fileName: "progress--a.jpg" }, { member: m, logged: owner })).toBe(owner);
    // 3. kinds only one code path makes; a HOVER name only with the HOVER job on file
    expect(resolveAttachmentActor({ kind: "contract", fileName: "c.pdf" }, { member: m }).name).toBe("System");
    expect(resolveAttachmentActor({ kind: "measurement", fileName: "m.pdf" }, { member: m }).name).toBe("HOVER import");
    expect(resolveAttachmentActor({ kind: "photo", fileName: "hover-77-1.jpg" }, { member: m, hoverJobIds: new Set(["77"]) }).name).toBe("HOVER import");
    expect(resolveAttachmentActor({ kind: "photo", fileName: "hover-77-1.jpg" }, { member: m, hoverJobIds: new Set() })).toBe(UNRECORDED_ACTOR);
    // 4. still unknown
    expect(resolveAttachmentActor({ kind: "photo", fileName: "progress--a.jpg" }, { member: m })).toBe(UNRECORDED_TEAM_ACTOR);
    expect(resolveAttachmentActor({ kind: "estimate", fileName: "x.pdf" }, { member: m })).toBe(UNRECORDED_TEAM_ACTOR);
    expect(resolveAttachmentActor({ kind: "photo", fileName: "IMG_9.jpg" }, { member: m })).toBe(UNRECORDED_ACTOR);
    // a member id that no longer resolves never shows as an id
    expect(resolveAttachmentActor({ kind: "photo", fileName: "a.jpg", uploadedByMemberId: "m-gone" }, { member: m }).name).toBe("Former team member");
  });

  it("estimate files name who attached them, and the original uploader when different", () => {
    expect(estimateFileTimelineText("warranty.pdf", "E-1", gabe, gabe).text).toBe("Gabe Varnadore attached warranty.pdf to estimate E-1");
    expect(estimateFileTimelineText("warranty.pdf", "E-1", systemActor("Auto-attach"), owner).text)
      .toBe("Auto-attach attached warranty.pdf to estimate E-1 (uploaded by Veto Smith (Owner))");
    expect(estimateFileTimelineText("w.pdf", "E-1", UNRECORDED_TEAM_ACTOR, null).text)
      .toBe("Added by your team (uploader not recorded): w.pdf on estimate E-1");
  });

  it("estimate events: member senders, client actions by the client's name", () => {
    const carley = estimateEventActor("client", dir, "Carley Geiss");
    expect(estimateEventText("sent", "E-7", estimateEventActor("m-gabe", dir, null))!.text).toBe("Gabe Varnadore sent estimate E-7 to the client");
    expect(estimateEventText("approved", "E-7", carley)!.text).toBe("Carley Geiss approved (signed) estimate E-7");
    expect(estimateEventText("viewed", "E-7", carley)!.text).toBe("Carley Geiss opened estimate E-7");
    expect(estimateEventActor("system", dir, null).name).toBe("System");
    expect(estimateEventText("sent", "E-7", estimateEventActor(null, dir, null))!.text).toBe("Estimate E-7 sent to the client (sender not recorded)");
    expect(estimateEventText("nonsense", "E-7", carley)).toBeNull();
  });

  it("comments, messages and payments name the person", () => {
    expect(commentTimelineText({ body: "Can we start Monday?", authorMemberId: null }, clientActor("Carley Geiss")))
      .toBe("Carley Geiss sent a message from the portal — “Can we start Monday?”");
    expect(commentTimelineText({ body: "Yes, 8 AM works.", authorMemberId: "m-gabe" }, gabe))
      .toBe("Gabe Varnadore replied — “Yes, 8 AM works.”");
    expect(commentTimelineText({ body: "x".repeat(120), authorMemberId: null }, clientActor("C")))
      .toBe(`C sent a message from the portal — “${"x".repeat(80)}…”`);
    expect(messageTimelineText("Message sent via email to joe@x.com: “Hi”", owner).text)
      .toBe("Veto Smith (Owner) sent a message via email to joe@x.com: “Hi”");
    expect(paymentTimelineText({ provider: "stripe", amountCents: 175000, method: "card", status: "succeeded" }, clientActor("Carley Geiss")).text)
      .toBe("Carley Geiss paid $1,750.00 via card through Stripe");
    expect(paymentTimelineText({ provider: "manual", amountCents: 5000, method: "check", status: "succeeded" }, gabe).text)
      .toBe("Gabe Varnadore recorded a payment of $50.00 via check");
  });

  it("no known-actor line ever reads 'Your team' or 'A team member'", () => {
    const lines = [
      photoTimelineText("progress--a.jpg", gabe).text,
      photoTimelineText("a.jpg", clientActor("Carley Geiss")).text,
      commentTimelineText({ body: "hi", authorMemberId: "m-owner" }, owner),
    ];
    for (const l of lines) expect(l).not.toMatch(/Your team|A team member|m-gabe|m-owner/);
  });
});

describe("activity-log sentences", () => {
  it("upload / delete / library rows read with the resolved actor", () => {
    const row = (action: string, meta: any) => ({ actorLabel: "snapshot", action, meta });
    expect(activityText(row("attachment.added", { kind: "photo", stage: "progress", fileName: "IMG_3305.jpeg" }), gabe))
      .toBe("Gabe Varnadore added a project photo (in progress) — IMG_3305.jpeg");
    expect(activityText(row("attachment.added", { kind: "photo", fileName: "a.jpg", byClient: true }), clientActor("Carley Geiss")))
      .toBe("Carley Geiss shared a photo — a.jpg");
    expect(activityText(row("attachment.deleted", { kind: "estimate", fileName: "w.pdf", number: "E-2" }), owner))
      .toBe("Veto Smith (Owner) removed w.pdf from estimate E-2");
    expect(activityText(row("attachment.attached", { kind: "estimate", fileName: "w.pdf", number: "E-2" }), gabe))
      .toBe("Gabe Varnadore attached w.pdf to estimate E-2 from the library");
    expect(activityText(row("attachment.default_on", { fileName: "w.pdf" }), gabe))
      .toBe("Gabe Varnadore set w.pdf to attach to all future estimates");
    expect(activityText(row("followup.updated", { done: true }), owner)).toBe("Veto Smith (Owner) marked a follow-up done");
    // Without a resolved actor the snapshot label still names the row.
    expect(activityText(row("estimate.created", { number: "E-9" }))).toBe("snapshot created estimate E-9");
  });
});
