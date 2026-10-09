import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateNextReminderTime, inReminderWindow } from "./review-reminders";

// Exercise the actual nested scheduler without starting routes, timers or a DB.
const source = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("routes.ts", source, ts.ScriptTarget.Latest, true);
let scheduler: ts.FunctionDeclaration | undefined;
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "processReminders") scheduler = node;
  ts.forEachChild(node, visit);
}
visit(ast);
if (!scheduler) throw new Error("Review reminder scheduler not found");
const executable = ts.transpileModule(scheduler.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
  const request = {
    id: 7, userId: 42, status: "sent", unsubscribed: false, deletedAt: null,
    nextReminderAt: new Date("2026-10-09T09:00:00Z") as Date | null,
    remindersSent: 1, lastReminderAt: null as Date | null,
    clientEmail: "client@example.invalid", clientName: "Client", companyName: "Company",
    token: "review-token", emailTheme: "default", bccEmail: null,
  };
  const settings = { enabled: true, maxReminders: 3, intervalHours: 24, timezone: "UTC", timeWindows: [{ start: 9, end: 12 }] };
  const storage = {
    getPendingReminders: vi.fn(async () => request.status === "sent" && !request.unsubscribed && !request.deletedAt && request.nextReminderAt && request.nextReminderAt <= new Date() ? [request] : []),
    getReminderSettings: vi.fn(async () => settings),
    updateReviewRequest: vi.fn(async (_id: number, update: Partial<typeof request>) => Object.assign(request, update)),
  };
  const usersWithModule = vi.fn(async () => new Set<number>());
  const send = vi.fn(async () => {});
  const failure = vi.fn();
  const query = { from: () => query, where: () => query, limit: async () => [{ companyLogoUrl: null }] };
  const dependencies = {
    storage, usersWithModule, calculateNextReminderTime, inReminderWindow,
    canonicalAppOrigin: () => "https://app.example.invalid",
    db: { select: () => query }, users: { id: "id" }, eq: () => true,
    isReviewSuppressed: vi.fn(async () => false), sendReviewReminderEmail: send,
    recordFailure: failure, console: { log: vi.fn(), error: vi.fn() },
  };
  const run = new Function(...Object.keys(dependencies), `${executable}\nreturn processReminders;`)(...Object.values(dependencies)) as () => Promise<void>;
  return { request, settings, storage, usersWithModule, send, failure, run };
}

afterEach(() => vi.useRealTimers());

describe("review reminder scheduler", () => {
  it("retains due reminders during a billing entitlement pause and sends after access is restored", async () => {
    const f = fixture();
    const due = f.request.nextReminderAt;
    await f.run();
    await f.run();
    expect(f.usersWithModule).toHaveBeenCalledWith([42], "reviewReminders");
    expect(f.send).not.toHaveBeenCalled();
    expect(f.storage.updateReviewRequest).not.toHaveBeenCalled();
    expect(f.request.nextReminderAt).toBe(due);
    expect(f.request.remindersSent).toBe(1);

    f.usersWithModule.mockResolvedValue(new Set([42]));
    await f.run();
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledWith("client@example.invalid", "Client", "Company", null, "review-token", "https://app.example.invalid", 2, "default", undefined);
    expect(f.request.remindersSent).toBe(2);
    expect(f.request.nextReminderAt?.toISOString()).toBe("2026-10-10T10:00:00.000Z");
    await f.run();
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.failure).not.toHaveBeenCalled();
  });

  it.each(["disabled", "exhausted"])("still cancels %s reminders", async (reason) => {
    const f = fixture();
    f.usersWithModule.mockResolvedValue(new Set([42]));
    if (reason === "disabled") f.settings.enabled = false;
    else f.settings.maxReminders = f.request.remindersSent;
    await f.run();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.request.nextReminderAt).toBeNull();
    expect(f.request.remindersSent).toBe(1);
    expect(f.failure).not.toHaveBeenCalled();
  });
});
