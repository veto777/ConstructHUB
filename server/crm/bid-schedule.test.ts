import { describe, expect, it } from "vitest";
import { crmNotificationChannel } from "@shared/schema";
import { bidConfirmationEmail, bidReminderText, bidWhen, customerAddress } from "./bid-schedule";
import { pickAppointment, pickBid } from "../../client/src/components/job-stage";

const org = { name: "Alpine Exteriors", phone: "813-815-2031", email: "office@alpine.test", timezone: "America/Los_Angeles" };
const at = new Date("2026-10-23T21:00:00Z"); // 2:00 PM PDT

describe("Schedule Bid — client confirmation", () => {
  it("says when in the company's time zone, where and who, and how to change it", () => {
    const m = bidConfirmationEmail({
      org, customer: { displayName: "Forrest Hild" }, startsAt: at, endsAt: null,
      address: "4783 Bayshore Drive, Blaine, WA", estimator: "Veto",
    });
    expect(m.subject).toBe("Your appointment with Alpine Exteriors is confirmed — Friday, October 23 at 2:00 PM PDT");
    expect(m.text).toContain("Hi Forrest,");
    expect(m.text).toContain("Where: 4783 Bayshore Drive, Blaine, WA");
    expect(m.text).toContain("Who's coming: Veto");
    expect(m.text).toContain("call 813-815-2031 or reply to this email");
    expect(m.html).not.toContain("<script");
  });

  it("escapes the client's name in the HTML", () => {
    const m = bidConfirmationEmail({ org, customer: { displayName: "<b>Bob</b>" }, startsAt: at, endsAt: null, address: null, estimator: null });
    expect(m.html).toContain("&lt;b&gt;Bob&lt;/b&gt;");
    expect(m.text).not.toContain("Where:");
  });

  it("formats the address from whatever parts the client has", () => {
    expect(customerAddress({ addressLine1: "4783 Bayshore Drive", addressLine2: null, city: "Blaine", state: "WA", postalCode: "98230" }))
      .toBe("4783 Bayshore Drive, Blaine, WA 98230");
    expect(customerAddress({ addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null })).toBeNull();
    expect(bidWhen(at, "America/New_York")).toBe("Friday, October 23 at 5:00 PM EDT");
  });
});

describe("Schedule Bid — the 30-minute reminder", () => {
  it("names the client, the time, the address and the link, and fits a text", () => {
    const t = bidReminderText({
      orgName: "Alpine Exteriors", customerName: "Forrest Hild", startsAt: at, timezone: org.timezone,
      address: "4783 Bayshore Drive, Blaine, WA", phone: "9704177172", link: "https://portal.constructhub.us/crm/clients/x",
      now: new Date(at.getTime() - 30 * 60_000),
    });
    expect(t).toBe("Alpine Exteriors: Bid with Forrest Hild at 2:00 PM (in 30 min) — 4783 Bayshore Drive, Blaine, WA · 9704177172. https://portal.constructhub.us/crm/clients/x");
    expect(t.length).toBeLessThanOrEqual(320);
  });

  it("is a text by default (on), not an email; an explicit choice wins", () => {
    expect(crmNotificationChannel({}, "bidReminder", "sms")).toBe(true);
    expect(crmNotificationChannel({}, "bidReminder", "inApp")).toBe(true);
    expect(crmNotificationChannel({}, "bidReminder", "email")).toBe(false);
    expect(crmNotificationChannel({ notificationPrefs: { bidReminder: { sms: false } } }, "bidReminder", "sms")).toBe(false);
    expect(crmNotificationChannel({ notificationPrefs: { bidReminder: { email: true } } }, "bidReminder", "email")).toBe(true);
    // Every other notification keeps text off by default.
    expect(crmNotificationChannel({}, "estimateViewed", "sms")).toBe(false);
  });
});

describe("Schedule Bid — the tracker", () => {
  const future = new Date(Date.now() + 2 * 86400000).toISOString();
  const later = new Date(Date.now() + 5 * 86400000).toISOString();
  it("a bid is never the job's start date, and the soonest upcoming bid is the one shown", () => {
    const appts = [
      { id: "b1", kind: "bid", startsAt: later, status: "scheduled", projectId: null },
      { id: "b2", kind: "bid", startsAt: future, status: "scheduled", projectId: null },
      { id: "b3", kind: "bid", startsAt: future, status: "canceled", projectId: null },
    ];
    expect(pickAppointment(appts, null)).toBeNull();
    expect(pickBid(appts)?.id).toBe("b2");
    expect(pickAppointment([...appts, { id: "v", startsAt: later, status: "scheduled", projectId: null }], null)?.id).toBe("v");
  });
});
