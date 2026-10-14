import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { socialSetupProblem } from "./routes";
import { LEGACY_CONNECTION } from "./schedule";
import { encryptKey } from "./client";
import { destinationSchema } from "../../shared/social";
import { destinationLabel } from "../../client/src/components/social-drafts";

const original = process.env.SOCIAL_ENCRYPTION_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.SOCIAL_ENCRYPTION_KEY;
  else process.env.SOCIAL_ENCRYPTION_KEY = original;
});
const source = (file: string) => fs.readFileSync(new URL(file, import.meta.url), "utf8");
describe("film readiness", () => {
  it("reports missing server setup before a connection or submission", () => {
    delete process.env.SOCIAL_ENCRYPTION_KEY;
    expect(socialSetupProblem(undefined, 1)).toMatch(/not set up/);
    expect(socialSetupProblem("fs-b-placeholder", 1)).toMatch(/not set up/);
  });
  it("reports an unreadable connection without exposing cryptographic errors", () => {
    process.env.SOCIAL_ENCRYPTION_KEY = "ab".repeat(32);
    const box = encryptKey("native:chu1b0", 1);
    expect(socialSetupProblem(box, 1)).toBeNull();
    expect(socialSetupProblem(encryptKey("outstand:chu1b0", 1), 1)).toBeNull();
    expect(socialSetupProblem(undefined, 1)).toBeNull();
    expect(socialSetupProblem(box, 2)).toMatch(/could not be unlocked. Reconnect your accounts/);
    process.env.SOCIAL_ENCRYPTION_KEY = "cd".repeat(32);
    expect(socialSetupProblem(box, 1)).toMatch(/could not be unlocked. Reconnect your accounts/);
    expect(socialSetupProblem("fs-b-placeholder", 1)).toMatch(/could not be unlocked. Reconnect your accounts/);
  });
  it("asks a legacy (non-ConstructHUB) connection to reconnect through ConstructHUB", () => {
    process.env.SOCIAL_ENCRYPTION_KEY = "ab".repeat(32);
    expect(socialSetupProblem(encryptKey("an-old-third-party-api-key", 1), 1)).toBe(LEGACY_CONNECTION);
    expect(LEGACY_CONNECTION).toMatch(/Reconnect your accounts through ConstructHUB/);
  });
  it("labels accounts, pages and boards without provider ids, including missing names", () => {
    const fb = destinationSchema.parse({ accountId: "fs-b-fb", platform: "facebook", pageId: "fs-b-fb-page" });
    expect(destinationLabel(fb, [{ id: fb.accountId, name: "Summit", pages: [{ id: fb.pageId!, name: "Denver" }] }])).toBe("Denver · Facebook");
    expect(destinationLabel(fb, [])).toBe("Facebook page · Facebook");
    const pin = destinationSchema.parse({ accountId: "raw", platform: "pinterest", boardId: "raw-board" });
    expect(destinationLabel(pin, [{ id: "raw", name: " ", boards: [{ id: "raw-board", name: " " }] }])).toBe("Pinterest board · Pinterest");
  });
  it("wires both submit controls to one upfront setup notice and its reason", () => {
    const page = source("../../client/src/pages/social-media.tsx");
    expect(page.match(/testId="alert-social-setup"/g)).toHaveLength(1);
    // Post now / Schedule: every blocker, TikTok's rules included; Save draft: all but TikTok's (a draft isn't posted).
    expect(page.match(/disabled=\{!!postBlocker \|\| mutation.isPending\}/g)).toHaveLength(1);
    expect(page.match(/title=\{postBlocker \|\| undefined\}/g)).toHaveLength(1);
    expect(page.match(/disabled=\{!!draftBlocker \|\| mutation.isPending\}/g)).toHaveLength(1);
    expect(page).toContain("const postBlocker = draftBlocker || tiktokBlocker;");
    expect(page).toContain('aria-describedby={setupProblem ? "social-setup-reason" : undefined}');
    expect(page).toContain("{postBlocker && !setupProblem && (");
  });
  it("scrolls the queue heading into view after the selected tab mounts", () => {
    const page = source("../../client/src/pages/social-media.tsx");
    expect(page).toContain('if (tab === "queue") queueTop.current?.scrollIntoView({ block: "start" });');
    expect(page).toContain('}, [tab, isLoading]);');
    expect(page).toContain('<section ref={queueTop}');
  });
  it("gives mapping checkboxes distinct accessible names and visible focus", () => {
    const mapping = source("../../client/src/components/social-agency.tsx");
    expect(mapping).toContain('aria-label={`Map: ${a.name} · ${a.platform}`}');
    expect(mapping).toContain("focus-visible:outline-2");
    // The visible label shows the network's logo and name (18fb07f4), not its key.
    expect(mapping).toContain("Map <NetworkIcon platform={a.platform} /> {a.name} · {networkName(a.platform)}");
  });
});
