/**
 * Client 360 timeline attribution — who said/uploaded what. Pure helpers from
 * notes-timeline.ts; no server or DB needed.
 *
 * crm_client_comments is two-way (authorMemberId null = the client, set = a
 * team reply) and crm_attachments has no uploader column, so photo source is
 * read from the stored name. A contractor's reply or upload must never read
 * as the client's.
 */
import { describe, it, expect } from "vitest";

// notes-timeline.ts pulls in tenancy → ../stripe, which throws without a key
// at module scope; the db module wants a URL. Neither is used here.
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";

const { commentTimelineText, photoTimelineText } = await import("./notes-timeline");

describe("timeline attribution", () => {
  it("client-authored comments read as the client's portal message", () => {
    expect(commentTimelineText({ body: "Can we start Monday?", authorMemberId: null }, "m1", null))
      .toBe("Sent a message from the portal — “Can we start Monday?”");
  });

  it("team replies read as replies — 'You' for the viewer, the member's name otherwise", () => {
    const reply = { body: "Yes, 8 AM works.", authorMemberId: "m1" };
    expect(commentTimelineText(reply, "m1", "Mike")).toBe("You replied — “Yes, 8 AM works.”");
    expect(commentTimelineText(reply, "m2", "Mike")).toBe("Mike replied — “Yes, 8 AM works.”");
    expect(commentTimelineText(reply, "m2", null)).toBe("A team member replied — “Yes, 8 AM works.”");
    expect(commentTimelineText(reply, "m2", null)).not.toContain("from the portal");
  });

  it("long bodies are clipped at 80 characters", () => {
    const body = "x".repeat(120);
    expect(commentTimelineText({ body, authorMemberId: null }, null, null))
      .toBe(`Sent a message from the portal — “${"x".repeat(80)}…”`);
  });

  it("photo source comes from the stored name: crew stage tag, HOVER import, else the client", () => {
    expect(photoTimelineText("progress--roof.jpg")).toBe("Your team added a project photo (in progress) — roof.jpg");
    expect(photoTimelineText("finished--roof.jpg")).toBe("Your team added a project photo (finished) — roof.jpg");
    expect(photoTimelineText("hover-123456-abc.jpg")).toBe("HOVER photo imported — hover-123456-abc.jpg");
    expect(photoTimelineText("IMG_0042.jpg")).toBe("Client shared a photo — IMG_0042.jpg");
  });
});
