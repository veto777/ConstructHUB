import { expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ rearm: vi.fn(async () => 1), run: vi.fn(() => new Promise(() => {})), list: vi.fn(async () => []) }));
vi.mock("../db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "call" }] }) }) }) }, pool: {} }));
vi.mock("./context", () => ({ voiceContext: async () => ({ ctx: { org: { id: "org" } } }) }));
vi.mock("../crm/activity", () => ({ logActivity: vi.fn() }));
vi.mock("./call-tasks", () => ({ rearmCallTasks: f.rearm, runCallTasksFor: f.run, listCallTasks: f.list,
  deliveryStateOf: () => "pending", presentCallTask: (t: any) => t, callTaskWorkerStatus: () => ({ running: true }) }));
import { registerVoiceCallRoutes } from "./calls";
it("Retry now rearms and returns without waiting for a delivery provider", async () => {
  const routes = new Map<string, any>();
  const app: any = { get: vi.fn(), post: (path: string, fn: any) => routes.set(path, fn) };
  registerVoiceCallRoutes(app, vi.fn());
  const res: any = { json: vi.fn(), send: vi.fn(), setHeader: vi.fn(), type: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis() };
  await routes.get("/api/crm/voice/calls/:id/delivery/retry")({ params: { id: "call" } }, res);
  expect(f.rearm).toHaveBeenCalledWith("org", "call");
  expect(f.run).not.toHaveBeenCalled();
  expect(JSON.parse(res.send.mock.calls[0][0])).toMatchObject({ delivery: { state: "pending" } });
});
