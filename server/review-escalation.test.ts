/**
 * Feedback routing (shared/review-flow.ts, server/review-escalation.ts, the client page): the owner's score
 * threshold persists and validates, a score below it goes to the private form first and alerts the owner and
 * is never shown the public review link or step, a score at or above it goes straight to the Google step
 * with the link shown.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), notify: vi.fn(),
  reviewData: {} as Record<string, unknown>,
}));
vi.mock("./db", () => ({ pool: { query: mocks.query } }));
vi.mock("./account-events", () => ({ notifyUser: mocks.notify }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.reviewData, isLoading: false, error: null }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock("wouter", () => ({ useRoute: () => [true, { token: "tok-1" }] }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));

import {
  DEFAULT_REVIEW_ESCALATION_THRESHOLD, caughtPrivatelyCount, describeReviewEscalationThreshold,
  normalizeReviewEscalationThreshold, reviewEscalationSettingsInput, routeAfterRating,
} from "@shared/review-flow";
import { escalatePrivateFeedback, getReviewEscalationThreshold, saveReviewEscalationThreshold } from "./review-escalation";
import ReviewFeedbackPage from "@/pages/review-feedback";

const GOOGLE = "https://g.page/r/example-contractor/review";
const root = path.resolve(import.meta.dirname, "..");
const src = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.reviewData = {
    id: 7, clientName: "Dana", companyName: "Acme Roofing", googleProfileUrl: GOOGLE, photos: [], status: "sent",
    feedbackRating: null, reviewSubmitted: false, lastStep: null, referralOffer: null, preview: false, escalationThreshold: 8,
  };
});

describe("threshold validation and persistence", () => {
  it("accepts whole numbers 1–10 and rejects everything else", () => {
    for (const n of [1, 5, 8, 10]) expect(reviewEscalationSettingsInput.safeParse({ reviewEscalationThreshold: n }).success).toBe(true);
    for (const bad of [0, 11, 7.5, -1, "8", null, undefined]) {
      expect(reviewEscalationSettingsInput.safeParse({ reviewEscalationThreshold: bad }).success, String(bad)).toBe(false);
    }
  });

  it("normalizes a missing or out-of-range stored value to the default of 8", () => {
    expect(DEFAULT_REVIEW_ESCALATION_THRESHOLD).toBe(8);
    for (const v of [undefined, null, 0, 11, 2.5, "", "x", NaN]) expect(normalizeReviewEscalationThreshold(v), String(v)).toBe(8);
    expect(normalizeReviewEscalationThreshold(10)).toBe(10);
    expect(normalizeReviewEscalationThreshold("6")).toBe(6);
  });

  it("reads the stored threshold per owner and falls back to the default without a row", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    expect(await getReviewEscalationThreshold(42)).toBe(8);
    expect(mocks.query.mock.calls[0][0]).toMatch(/FROM review_escalation_settings WHERE user_id=\$1/);
    expect(mocks.query.mock.calls[0][1]).toEqual([42]);
    mocks.query.mockResolvedValueOnce({ rows: [{ threshold: 10 }] });
    expect(await getReviewEscalationThreshold(42)).toBe(10);
  });

  it("upserts the owner's threshold and refuses an invalid one before touching the database", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    expect(await saveReviewEscalationThreshold(42, 9)).toEqual({ reviewEscalationThreshold: 9 });
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO review_escalation_settings\(user_id,threshold,updated_at\)[\s\S]*ON CONFLICT\(user_id\) DO UPDATE SET threshold=EXCLUDED\.threshold/);
    expect(params).toEqual([42, 9]);
    await expect(saveReviewEscalationThreshold(42, 11)).rejects.toThrow();
    await expect(saveReviewEscalationThreshold(42, 0)).rejects.toThrow();
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("the settings routes exist and the client page saves to them", () => {
    const routes = src("server/routes.ts");
    expect(routes).toContain('app.get("/api/review-escalation-settings"');
    expect(routes).toContain('app.put("/api/review-escalation-settings"');
    expect(routes).toMatch(/reviewEscalationSettingsInput\.safeParse\(req\.body\)/);
    const page = src("client/src/pages/google-reviews.tsx");
    expect(page).toContain('apiRequest("PUT", "/api/review-escalation-settings", { reviewEscalationThreshold })');
    expect(page).toContain('data-testid="select-escalation-threshold"');
    expect(page).toContain("10 — only 10s go straight to Google");
  });
});

describe("routing branch", () => {
  it("sends a score below the threshold to the private form first and the rest straight to the Google step", () => {
    expect(routeAfterRating(7, 8, false)).toBe("improvement");
    expect(routeAfterRating(8, 8, false)).toBe("describe");
    expect(routeAfterRating(9, 8, true)).toBe("referral");
    expect(routeAfterRating(1, 8, true)).toBe("improvement");
    // "Only 10s": a 9 still comes to the owner first.
    expect(routeAfterRating(9, 10, false)).toBe("improvement");
    expect(routeAfterRating(10, 10, false)).toBe("describe");
  });

  it("explains the threshold in the owner's words, with the only-10s position", () => {
    expect(describeReviewEscalationThreshold(8)).toBe("Scores below 8 go to private feedback first, alert you immediately and are never shown the Google link. Scores at or above 8 go straight to the Google ask and its link.");
    expect(describeReviewEscalationThreshold(10)).toMatch(/^Only a 10 goes straight to the Google ask and its link/);
    expect(describeReviewEscalationThreshold(10)).toMatch(/never shown the Google link\.$/);
  });

  it("hides the Google review link on the private-feedback branch (score below the threshold)", () => {
    const markup = renderToStaticMarkup(createElement(ReviewFeedbackPage, { initialStep: "improvement", initialRating: 6 }));
    expect(markup).not.toContain('data-testid="link-google-review-always"');
    expect(markup).not.toContain(`href="${GOOGLE}"`);
    expect(markup).toContain("What could we have done better?");
    expect(markup).not.toContain('data-testid="section-improvement-google-review"');
    expect(markup).not.toContain('data-testid="button-improvement-google-review"');
  });

  it("renders the Google review link on the straight-to-Google branch (score at or above the threshold)", () => {
    for (const step of ["describe", "review"]) {
      const markup = renderToStaticMarkup(createElement(ReviewFeedbackPage, { initialStep: step as any, initialRating: 9 }));
      expect(markup, step).toContain('data-testid="link-google-review-always"');
      expect(markup, step).toContain(`href="${GOOGLE}"`);
      expect(markup, step).not.toContain("What could we have done better?");
    }
  });

  it("shows the Google review link only once a rating at or above the threshold exists", () => {
    // No rating chosen yet: the link must not appear before the client has picked one.
    const before = renderToStaticMarkup(createElement(ReviewFeedbackPage, { initialStep: "rating", initialRating: 0 }));
    expect(before).not.toContain('data-testid="link-google-review-always"');
    // Below the threshold, even after finishing: still no link.
    const lowDone = renderToStaticMarkup(createElement(ReviewFeedbackPage, { initialStep: "done", initialRating: 3 }));
    expect(lowDone).not.toContain('data-testid="link-google-review-always"');
    // At or above the threshold the link is there.
    const highDone = renderToStaticMarkup(createElement(ReviewFeedbackPage, { initialStep: "done", initialRating: 10 }));
    expect(highDone).toContain('data-testid="link-google-review-always"');
    expect(highDone).toContain(`href="${GOOGLE}"`);
  });

  it("the server routes a below-threshold score to private feedback only: showReview follows the threshold", () => {
    const routes = src("server/routes.ts");
    const route = routes.slice(routes.indexOf('app.post("/api/review/:token/feedback"'), routes.indexOf('app.post("/api/review/:token/google-link-opened"'));
    // The real (non-preview) response: the public review step is offered only at or above the threshold.
    const real = route.slice(route.indexOf("const threshold = await getReviewEscalationThreshold"));
    expect(real).toContain("res.json({ success: true, showReview: !privateFirst, privateFirst });");
    expect(real).not.toContain("showReview: true");
    // The client page: the always-link sits behind isHighRating, and the private form never routes on
    // to the public review step or carries its own public-review button.
    const page = src("client/src/pages/review-feedback.tsx");
    expect(page).toMatch(/\{primaryUrl && isHighRating && \(\s*<div[^>]*>\s*<Button asChild[^>]*>\s*<a href=\{primaryUrl\}[^>]*data-testid="link-google-review-always"/);
    expect(page).not.toContain("section-improvement-google-review");
    expect(page).not.toContain("button-improvement-google-review");
    expect(page).not.toMatch(/postFeedback\("private"\)[\s\S]{0,200}setStep\("describe"\)/);
  });
});

describe("the owner alert on a sub-threshold score", () => {
  const request = {
    id: 7, userId: 42, clientName: "Dana", projectDescription: "Roof replacement", feedbackRating: 6,
    feedbackCategories: ["Communication", "Cleanup"], feedbackComments: "Crew left nails in the driveway.", escalationAlertedAt: null,
  };

  it("fires bell + email with name, score, job and text, plus Telegram when the owner linked the bot, then stamps the request", async () => {
    mocks.notify.mockResolvedValue({ inApp: true, email: "sent" });
    mocks.query.mockResolvedValue({ rows: [] });
    const telegram = vi.fn().mockResolvedValue(true);
    const chatIdFor = vi.fn().mockResolvedValue("12345");
    const r = await escalatePrivateFeedback(request, 8, { telegram, chatIdFor });
    expect(r).toEqual({ sent: true, telegram: true });
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    const [userId, kind, msg] = mocks.notify.mock.calls[0];
    expect(userId).toBe(42);
    expect(kind).toBe("reviews.private_feedback");
    expect(msg.title).toBe("Private feedback from Dana: 6/10");
    expect(msg.body).toContain("Job: Roof replacement");
    expect(msg.body).toContain("Areas: Communication, Cleanup");
    expect(msg.body).toContain('"Crew left nails in the driveway."');
    expect(msg.body).toContain("not shown the Google review link");
    expect(msg.actionUrl).toBe("/google-reviews");
    expect(chatIdFor).toHaveBeenCalledWith(42);
    expect(telegram).toHaveBeenCalledWith("12345", expect.stringContaining("Dana"));
    expect(telegram.mock.calls[0][1]).toContain("6/10");
    expect(telegram.mock.calls[0][1]).toContain("Roof replacement");
    expect(telegram.mock.calls[0][1]).toContain("Crew left nails in the driveway.");
    const stamp = mocks.query.mock.calls.find(([sql]) => /escalation_alerted_at=now\(\)/.test(sql));
    expect(stamp?.[1]).toEqual([7]);
  });

  it("skips Telegram when the owner never linked the bot, and still alerts without written text", async () => {
    mocks.notify.mockResolvedValue({ inApp: true, email: "off" });
    mocks.query.mockResolvedValue({ rows: [] });
    const telegram = vi.fn();
    const r = await escalatePrivateFeedback({ ...request, feedbackComments: null, feedbackCategories: null }, 8, { telegram, chatIdFor: async () => null });
    expect(r).toEqual({ sent: true, telegram: false });
    expect(telegram).not.toHaveBeenCalled();
    expect(mocks.notify.mock.calls[0][2].body).toContain("No written feedback yet.");
  });

  it("does not fire for a score at or above the threshold, nor twice for one request", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    expect(await escalatePrivateFeedback({ ...request, feedbackRating: 8 }, 8)).toEqual({ sent: false, telegram: false });
    expect(await escalatePrivateFeedback({ ...request, feedbackRating: 10 }, 10)).toEqual({ sent: false, telegram: false });
    expect(await escalatePrivateFeedback({ ...request, escalationAlertedAt: new Date() }, 8)).toEqual({ sent: false, telegram: false });
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("the alert survives a notification failure: the client's save never fails because of it", async () => {
    mocks.notify.mockRejectedValue(new Error("smtp down"));
    mocks.query.mockResolvedValue({ rows: [] });
    const r = await escalatePrivateFeedback(request, 8, { telegram: vi.fn(), chatIdFor: async () => null });
    expect(r.sent).toBe(false);
    expect(mocks.query.mock.calls.some(([sql]) => /escalation_alerted_at=now\(\)/.test(sql))).toBe(true);
  });

  it("is wired into the feedback route on the private form's save only, and the kind is registered", async () => {
    const routes = src("server/routes.ts");
    expect(routes).toMatch(/if \(privateFirst && stage === "private" && updated\) \{\s*await escalatePrivateFeedback\(updated, threshold\);/);
    expect(src("server/notification-kinds.ts")).toContain('"reviews.private_feedback"');
    const page = src("client/src/pages/review-feedback.tsx");
    expect(page).toContain('mutationFn: () => postFeedback("private")');
  });
});

describe("the stats row", () => {
  it("counts requests caught privately by their stamp, not by the current threshold", () => {
    const rows = [
      { privateFeedbackAt: "2026-10-10T12:00:00Z", feedbackRating: 6 },
      { privateFeedbackAt: new Date(), feedbackRating: 7 },
      { privateFeedbackAt: null, feedbackRating: 9 },
      { feedbackRating: 10 },
      { privateFeedbackAt: null, feedbackRating: null },
    ];
    expect(caughtPrivatelyCount(rows)).toBe(2);
    expect(caughtPrivatelyCount([])).toBe(0);
    const page = src("client/src/pages/google-reviews.tsx");
    expect(page).toContain('<Stat label="Caught privately" testId="stat-caught-privately"');
    expect(page).toContain("Private feedback · {review.feedbackRating}/10");
    expect(page).toContain('<Stat label="Awaiting response" testId="stat-pending" value={reviews.filter((r: any) => r.status === "sent" && !r.unsubscribed).length} />');
  });
});
