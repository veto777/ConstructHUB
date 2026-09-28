import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { storage } from "./storage";

const ids: number[] = [];
afterAll(async () => {
  for (const id of ids) await storage.permanentlyDeleteReviewRequest(id);
});

describe("review delivery suppression", () => {
  for (const status of ["sent", "scheduled"]) {
    it(`excludes trashed and unsubscribed ${status} requests, including after restore`, async () => {
      if (!new URL(process.env.DATABASE_URL!).pathname.startsWith("/constructhub_dev")) {
        throw new Error("Review delivery test requires a development database");
      }
      const request = await storage.createReviewRequest({
        userId: 1, clientName: "Delivery test", clientEmail: "delivery@example.invalid",
        googleProfileUrl: "https://www.google.com/", token: randomUUID(), status,
        nextReminderAt: new Date(0), scheduledFor: new Date(0),
      });
      ids.push(request.id);
      const pendingIds = async () => (await (status === "sent"
        ? storage.getPendingReminders() : storage.getScheduledReviews())).map(r => r.id);
      expect(await pendingIds()).toContain(request.id);
      await storage.deleteReviewRequest(request.id);
      expect(await pendingIds()).not.toContain(request.id);
      await storage.restoreReviewRequest(request.id);
      expect(await pendingIds()).toContain(request.id);
      await storage.updateReviewRequest(request.id, { unsubscribed: true });
      expect(await pendingIds()).not.toContain(request.id);
      await storage.deleteReviewRequest(request.id);
      await storage.restoreReviewRequest(request.id);
      expect(await pendingIds()).not.toContain(request.id);
    });
  }
});
