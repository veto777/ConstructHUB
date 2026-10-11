import { beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  tasks: new Map<number, any>(), sms: vi.fn(), email: vi.fn(), notify: vi.fn(), summaryClaimed: false,
  escalationClaimed: false, select: vi.fn(), inserts: new Set<string>(),
}));
vi.mock("../db", () => ({
  pool: { query: vi.fn(async (text: string, v: any[]) => {
    const t = f.tasks.get(Number(v[0]));
    if (text.includes("attempts = attempts + 1")) {
      if (!t || t.state !== "pending" || t.leased_until || t.next_attempt_at > v[3]) return { rows: [] };
      Object.assign(t, { lease_token: v[1], leased_until: v[2], attempts: t.attempts + 1 });
      return { rows: [{ ...t }] };
    }
    if (text.includes('SET result =')) {
      if (t?.lease_token !== v[1]) return { rows: [] };
      t.result = { sending: true }; return { rows: [{ id: t.id }] };
    }
    if (text.includes("state = 'done'")) {
      if (t?.lease_token === v[1]) Object.assign(t, { state: "done", result: JSON.parse(v[2]), leased_until: null, last_error: null });
    } else if (text.includes("last_error = $4")) {
      if (t?.lease_token === v[1]) Object.assign(t, { state: v[2], result: v[6] ? JSON.parse(v[6]) : null, last_error: v[3], next_attempt_at: v[4], leased_until: null });
    }
    return { rows: [] };
  }) },
  db: {
    select: () => ({ from: () => ({ where: () => Object.assign(Promise.resolve([{ id: "owner", role: "owner", phone: "+15555550123" }]), { limit: async () => [{ id: "call", orgId: "org" }] }) }) }),
    execute: async () => { const claimed = !f.summaryClaimed; f.summaryClaimed = true; return { rows: claimed ? [{ id: "call" }] : [] }; },
    insert: () => ({ values: (v: any) => ({ onConflictDoNothing: () => ({ returning: async () => { const exists = f.inserts.has(v.id); f.inserts.add(v.id); return exists ? [] : [{ id: v.id }]; } }) }) }),
    update: () => ({ set: (v: any) => ({ where: () => {
      if (v.sentCount === 1 && !v.lastSentAt) return { returning: async () => {
        if (f.escalationClaimed) return [];
        f.escalationClaimed = true; return [{ id: 1 }];
      } };
      return Promise.resolve();
    } }) }),
  },
}));
vi.mock("../crm/sms", () => ({ sendSms: f.sms, normalizePhone: (s: string) => s, resolveSmsSender: () => null }));
vi.mock("../email", () => ({ sendWithFallback: f.email }));
vi.mock("../crm/notify", () => ({ notifyMembers: f.notify }));
vi.mock("../crm/activity", () => ({ recordActivity: vi.fn() }));
vi.mock("../ops/issues", () => ({ recordFailure: vi.fn() }));
vi.mock("./org-profile", () => ({ loadOrgVoiceContext: async () => ({ org: { id: "org", name: "Test" } }), findVoiceNumber: vi.fn() }));

import { runCallTask, presentCallTask } from "./call-tasks";
import { deliverLeadNotification, callSummaryTaskSpecs } from "./leads";
import { sendFirstEscalation } from "./escalations";

function task(id: number, channel = "sms") {
  const row = { id, call_id: "call", org_id: "org", kind: "notification", task_key: `notification:${channel}:${id}`,
    payload: { channel, recipient: `recipient-${id}`, title: "Lead", body: "Request" }, state: "pending", attempts: 0,
    next_attempt_at: new Date(0), give_up_at: new Date(Date.now() + 86400000), created_at: new Date(), last_error: null };
  f.tasks.set(id, row); return row;
}
const ctx = { org: { id: "org", name: "Test" } } as any;
beforeEach(() => { f.tasks.clear(); f.inserts.clear(); f.summaryClaimed = f.escalationClaimed = false; vi.clearAllMocks(); f.sms.mockResolvedValue({ ok: true, provider: "signalwire", sid: "SM-test" }); f.email.mockResolvedValue({}); });

it("retries only the failed recipient/channel after a worker restart", async () => {
  task(1); const failed = task(2, "email"); task(3, "email");
  f.email.mockRejectedValueOnce(new Error("SMTP refused"));
  expect(await runCallTask(1)).toBe("done");
  expect(await runCallTask(2)).toBe("pending");
  expect(await runCallTask(3)).toBe("done");
  expect(failed.last_error).toBe("SMTP refused");
  expect(await runCallTask(2, { now: () => new Date(Date.now() + 60000) })).toBe("done");
  expect(await runCallTask(1)).toBeNull();
  expect(await runCallTask(3)).toBeNull();
  expect(f.sms).toHaveBeenCalledTimes(1);
  expect(f.email.mock.calls.map(c => c[0].to)).toEqual(["recipient-2", "recipient-3", "recipient-2"]);
});

it("stores SMS refusal and terminal reason, and does not resend a completed task", async () => {
  const row = task(1); row.give_up_at = new Date(0);
  f.sms.mockResolvedValueOnce({ ok: false, error: "Recipient opted out" });
  expect(await runCallTask(1)).toBe("failed");
  expect(row.last_error).toBe("Recipient opted out");
  expect(await runCallTask(1)).toBeNull();
});

it("parallel worker claims send a notification once", async () => {
  task(1);
  expect(await Promise.all([runCallTask(1), runCallTask(1)])).toEqual(["done", null]);
  expect(f.sms).toHaveBeenCalledTimes(1);
});

it("interrupted or ambiguous sends stop for review instead of automatic duplicate sends", async () => {
  const row = task(1) as any; row.attempts = 2; row.last_error = "Earlier definitive refusal"; row.result = { sending: true };
  expect(await runCallTask(1)).toBe("failed");
  expect(f.sms).not.toHaveBeenCalled();
  expect(row.last_error).toContain("outcome unknown");
  task(2, "email"); f.email.mockRejectedValueOnce(Object.assign(new Error("SMTP timeout"), { ambiguous: true }));
  expect(await runCallTask(2)).toBe("failed");
});

it("in-app replay uses the same notification identity", async () => {
  const payload = { channel: "inApp", recipient: "member", title: "Lead", body: "Request", link: "/crm" };
  await deliverLeadNotification(ctx, "call", payload); await deliverLeadNotification(ctx, "call", payload);
  expect(f.inserts.size).toBe(1);
});

it("claims the first escalation message before either racing sender reaches the provider", async () => {
  const row = { id: 1, orgId: "org", channel: "sms", recipient: "person" } as any;
  const results = await Promise.all([sendFirstEscalation(ctx.org, row, "body", "subject"), sendFirstEscalation(ctx.org, row, "body", "subject")]);
  expect(results.filter(r => r.ok)).toHaveLength(1);
  expect(f.sms).toHaveBeenCalledTimes(1);
});

it("plans summaries as stable recipient tasks without performing any sends", async () => {
  const first = await callSummaryTaskSpecs(ctx, { id: "call" } as any);
  expect(first).toEqual(await callSummaryTaskSpecs(ctx, { id: "call" } as any));
  expect(first.length).toBeGreaterThan(0);
  expect(first.every(t => t.kind === "notification" && t.key.startsWith("summary:"))).toBe(true);
  expect(f.notify).not.toHaveBeenCalled();
  expect(f.sms).not.toHaveBeenCalled();
});

it("presents the channel, recipient and failure reason in the drawer contract", () => {
  const view = presentCallTask({ id: 1, kind: "notification", key: "notification:email:one", payload: { channel: "email", recipient: "one@example.invalid" },
    state: "pending", attempts: 1, lastError: "SMTP refused", nextAttemptAt: new Date(), giveUpAt: new Date(), doneAt: null } as any);
  expect(view).toMatchObject({ label: "EMAIL — one@example.invalid", state: "retrying", lastError: "SMTP refused" });
});

it("never records log-only SMS as done, including legacy ok:true providers", async () => {
  const row = task(1);
  f.sms.mockResolvedValueOnce({ ok: true, provider: "log" });
  expect(await runCallTask(1)).toBe("failed");
  expect(row.last_error).toContain("texting isn't set up");
});
it("persists uncertain SMS acceptance and never resends on a later worker pass", async () => {
  const row = task(1) as any;
  f.sms.mockResolvedValueOnce({ ok: false, provider: "signalwire", ambiguous: true, error: "Response lost" });
  expect(await runCallTask(1)).toBe("failed");
  expect(row.result).toEqual({ uncertain: true });
  expect(await runCallTask(1, { now: () => new Date(Date.now() + 86400000) })).toBeNull();
  expect(f.sms).toHaveBeenCalledTimes(1);
});
it("retains the carrier identifier for accepted SMS", async () => {
  const row = task(1) as any;
  f.sms.mockResolvedValueOnce({ ok: true, provider: "signalwire", sid: "SM-accepted" });
  expect(await runCallTask(1)).toBe("done");
  expect(row.result).toMatchObject({ sid: "SM-accepted", provider: "signalwire" });
});

it("summary recipient tasks recover independently after interruption", async () => {
  const specs = await callSummaryTaskSpecs(ctx, { id: "call", summary: "Callback requested" } as any);
  // Explicit SMS preference for this recovery scenario, alongside the in-app task.
  const smsSpec = { key: "summary:sms:owner", kind: "notification", payload: { channel: "sms", recipient: "+15555550123", title: "Call ended", body: "Callback requested" } };
  const rows = [...specs.filter(s => s.payload.channel === "inApp"), smsSpec].map((spec, i) => {
    const row = task(i + 1) as any;
    Object.assign(row, { task_key: spec.key, payload: spec.payload });
    return row;
  });
  f.sms.mockResolvedValueOnce({ ok: false, provider: "signalwire", error: "Carrier rejected" });
  for (const row of rows) await runCallTask(row.id);
  expect(rows.at(-1).state).toBe("pending");
  const inAppCount = f.inserts.size;
  for (const row of rows) await runCallTask(row.id, { now: () => new Date(Date.now() + 60000) });
  expect(rows.every(row => row.state === "done")).toBe(true);
  expect(f.inserts.size).toBe(inAppCount);
  expect(f.sms).toHaveBeenCalledTimes(2);
});

it("acknowledges summaries only with their durable notification tasks", async () => {
  const { acknowledgeCall } = await import("./internal-calls");
  const specs = await callSummaryTaskSpecs(ctx, { id: "call" } as any);
  const statements: string[] = [];
  const query = vi.fn(async (sql: string) => { statements.push(sql); return { rows: [] }; });
  const release = vi.fn();
  const pool = { connect: async () => ({ query, release }) };
  const args = { callId: "call", orgId: "org", accountUserId: 1, outcome: "info", billedMinutes: 1, at: new Date(), patch: { processedAt: new Date().toISOString() }, tasks: specs };
  await acknowledgeCall(args, pool);
  expect(statements[0]).toBe("BEGIN");
  expect(statements.findIndex(s => s.includes("INSERT INTO voice_call_tasks"))).toBeLessThan(statements.findIndex(s => s.includes("UPDATE voice_calls")));
  expect(statements.at(-1)).toBe("COMMIT");
  statements.length = 0;
  query.mockImplementation(async (sql: string) => {
    statements.push(sql);
    if (sql.includes("INSERT INTO voice_call_tasks")) throw new Error("Task storage unavailable");
    return { rows: [] };
  });
  await expect(acknowledgeCall(args, pool)).rejects.toThrow("Task storage unavailable");
  expect(statements.at(-1)).toBe("ROLLBACK");
  expect(statements.some(s => s.includes("UPDATE voice_calls"))).toBe(false);
  expect(f.sms).not.toHaveBeenCalled();
});
