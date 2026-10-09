import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  entitlement: vi.fn(), requeue: vi.fn(), load: vi.fn(), token: vi.fn(), upload: vi.fn(),
  quota: vi.fn(), finish: vi.fn(), fail: vi.fn(), source: vi.fn(), notify: vi.fn(),
}));
vi.mock("../entitlements", () => ({ getEntitlements: m.entitlement }));
vi.mock("./customer-store", () => ({
  requeueUpload: m.requeue, customerYoutubeStore: () => ({ load: m.load }),
  markQuotaSpent: m.quota, finishUpload: m.finish, failVideo: m.fail,
}));
vi.mock("./customer-media", () => ({ keyIsOwn: () => true, storedVideoSource: m.source }));
vi.mock("./client", () => ({ YoutubeError: class extends Error {}, getYoutubeAccessToken: m.token, uploadVideo: m.upload }));
import { runUpload } from "./customer-service";
import type { VideoRow } from "./customer-store";
const video = { id: "queued-video", user_id: 7, channel_id: "channel", file_deleted_at: null, file_name: "video.mp4", tags: [] } as unknown as VideoRow;
const allowed = (value: boolean) => ({ modules: { socialPublishing: value } });

beforeEach(() => {
  vi.resetAllMocks();
  m.entitlement.mockResolvedValue(allowed(true));
  m.load.mockResolvedValue({ refreshToken: "refresh", channelId: "channel" });
  m.source.mockReturnValue({ size: 10, read: vi.fn() });
  m.upload.mockResolvedValue({ videoId: "published", privacyStatus: "private", uploadStatus: "processed" });
  m.notify.mockResolvedValue(undefined);
});
const run = () => runUpload(video, { notify: m.notify });
const expectPaused = () => {
  expect(m.requeue).toHaveBeenCalledWith(video.id);
  for (const fn of [m.quota, m.source, m.upload, m.finish, m.fail, m.notify]) expect(fn).not.toHaveBeenCalled();
};

describe("customer upload dispatch entitlement", () => {
  it.each(["downgraded", "lapsed"])("requeues a %s owner before accessing their channel", async () => {
    m.entitlement.mockResolvedValue(allowed(false));
    await run();
    expectPaused();
    expect(m.load).not.toHaveBeenCalled();
    expect(m.token).not.toHaveBeenCalled();
  });

  it("rechecks after token preparation and pauses if access changed after the claim", async () => {
    m.token.mockImplementation(async () => { m.entitlement.mockResolvedValue(allowed(false)); });
    await run();
    expect(m.entitlement).toHaveBeenCalledTimes(2);
    expect(m.entitlement).toHaveBeenCalledWith(video.user_id);
    expectPaused();
  });

  it.each([1, 2])("preserves queued work when entitlement lookup %i fails", async (check) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    if (check === 2) m.entitlement.mockResolvedValueOnce(allowed(true));
    m.entitlement.mockRejectedValueOnce(new Error("unavailable"));
    try { await run(); expectPaused(); } finally { log.mockRestore(); }
  });

  it("uploads the retained video once its owner regains access", async () => {
    m.entitlement.mockResolvedValueOnce(allowed(false));
    await run();
    expectPaused();
    await run();
    expect(m.upload).toHaveBeenCalledTimes(1);
    expect(m.quota).toHaveBeenCalledWith(video.id);
    expect(m.finish).toHaveBeenCalledWith(video.id, { videoId: "published", privacy: "private", processed: true });
    expect(m.notify).toHaveBeenCalledWith(video, "published");
    expect(m.fail).not.toHaveBeenCalled();
  });
});
