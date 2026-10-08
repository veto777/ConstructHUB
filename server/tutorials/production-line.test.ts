import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { TUT_NAME, assertName, TEMPLATE } from "../../scripts/tutorials/db";
import { THUMB_VARIANTS, thumbVariant, thumbnailHtml } from "../../scripts/tutorials/brand";
import { parseTutorialScript } from "@shared/help/step-script";

/**
 * The walkthrough production line (scripts/tutorials/, docs/tutorials/PRODUCER-GUIDE.md) — the rules
 * that keep it away from real data and keep four producers out of each other's way. Static: no
 * database, no browser, no voice engine.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

describe("recording databases", () => {
  it("only ever names a constructhub_tut_* database", () => {
    for (const ok of ["constructhub_tut_slot1", "constructhub_tut_template", "constructhub_tut_a_b2"]) expect(assertName(ok)).toBe(ok);
    for (const bad of ["constructhub", "constructhub_dev", "constructhub_dev_a1", "constructhub_tut_", "constructhub_tut_Slot1", "constructhub_tut_x; drop", "postgres", "x_constructhub_tut_slot1", "constructhub_tut_slot1\n"])
      expect(() => assertName(bad), bad).toThrow(/refusing/);
    expect(TUT_NAME.source).toBe("^constructhub_tut_[a-z0-9_]+$");
    expect(TEMPLATE).toMatch(TUT_NAME);
  });

  it("is pinned to 127.0.0.1:5432 and never prints or passes the password on a command line", () => {
    const src = read("scripts/tutorials/db.ts");
    expect(src).toContain('const ALLOWED_HOST = "127.0.0.1", ALLOWED_PORT = "5432";');
    expect(src).toMatch(/u\.hostname !== ALLOWED_HOST \|\| \(u\.port \|\| "5432"\) !== ALLOWED_PORT/);
    // psql and pg_dump get the connection from their environment (PGPASSWORD), never from argv.
    expect(src).not.toMatch(/spawn\("(psql|pg_dump)", \[[^\]]*(password|databaseUrl|url)/i);
    expect(src).not.toMatch(/console\.(log|warn|error)\([^)]*(password|databaseUrl\()/i);
    // The demo seed refuses anything else too.
    expect(read("scripts/tutorials/seed-demo.ts")).toContain("only writes to a constructhub_tut_* recording database on 127.0.0.1:5432");
  });
});

describe("the slot app", () => {
  const src = read("scripts/tutorials/app.ts");
  it("is built from an empty environment with every outbound channel shut", () => {
    expect(src).not.toMatch(/\.\.\.process\.env/);
    for (const flag of ['NODE_ENV: "development"', 'DEV_AUTH_BYPASS_USER1: "true"', 'SEO_JOBS_DISABLED: "true"', 'EMAIL_FORCE_SINK: "1"', "SMS_OUTBOX_PATH"]) expect(src, flag).toContain(flag);
    for (const secret of ["SMTP_", "SIGNALWIRE_", "STRIPE_", "R2_", "VOICE_ENGINE_URL", "EDGE_SEARCH_WORKER_ENABLED:", "GBP_CONTENT_WORKER_ENABLED:", "EMAIL_ALLOW_REAL"])
      expect(src.replace(/\/\*[\s\S]*?\*\//g, ""), secret).not.toContain(secret);
    // The sinks it relies on are still what the server does.
    expect(read("server/email.ts")).toContain('if (process.env.EMAIL_FORCE_SINK === "1") return false;');
    expect(read("server/crm/sms.ts")).toContain("process.env.SMS_OUTBOX_PATH");
  });
  it("uses port 8180+slot and stops the app by its listening pid", () => {
    expect(src).toContain("export const SLOT_PORT = (slot: number) => 8180 + slot;");
    expect(src).toMatch(/ss", \["-ltnpH", `sport = :\$\{port\}`\]/);
  });
});

describe("shared resources", () => {
  it("the voice engine is called under one machine-wide lock, with a pause, from a shared cache", () => {
    const narrate = read("scripts/tutorials/narrate.ts");
    expect(narrate).toMatch(/withLock\(TTS_LOCK, async \(\) => \{[\s\S]*synthesize\([\s\S]*await sleep\(BETWEEN_CALLS_MS\)/);
    expect(narrate).toContain("const BETWEEN_CALLS_MS = 250;");
    expect(narrate).toContain("cacheDir = TTS_CACHE");
    expect(narrate).not.toMatch(/console\.\w+\([^)]*secret/);
  });
  it("every ffmpeg runs under the encode lock, niced, with 4 threads", () => {
    expect(read("scripts/tutorials/lib.ts")).toContain('["flock", ["-x", ENCODE_LOCK, "nice", "-n", "10", cmd, ...args]]');
    for (const f of ["mux.ts", "check.ts", "thumbnail.ts"]) {
      const src = read(`scripts/tutorials/${f}`);
      const calls = [...src.matchAll(/run\("ffmpeg", \[([\s\S]*?)\], \{ nice: true \}\)/g)];
      expect(calls.length, f).toBeGreaterThan(0);
      expect(src.match(/run\("ffmpeg"/g)!.length, `${f}: an ffmpeg call is not niced`).toBe(calls.length);
      for (const c of calls) expect(/\.\.\.FF|"-threads", "4"/.test(c[1]), `${f}: an ffmpeg call has no -threads 4`).toBe(true);
    }
  });
  it("R2 is create-only", () => {
    const upload = read("scripts/tutorials/upload.ts");
    expect(upload).toContain('IfNoneMatch: "*"');
    expect(upload).not.toMatch(/DeleteObject|CopyObject/);
  });
});

describe("thumbnails", () => {
  it("picks one of four layouts from the help key, always the same one", () => {
    const keys = Array.from({ length: 60 }, (_, i) => `crm-video-${i}`);
    for (const k of keys) { expect(thumbVariant(k)).toBe(thumbVariant(k)); expect(thumbVariant(k)).toBeLessThan(THUMB_VARIANTS); }
    expect(new Set(keys.map(thumbVariant)).size).toBe(THUMB_VARIANTS);
  });
  it("uses only our own artwork and the bundled font", () => {
    const html = thumbnailHtml({ helpKey: "crm-x", headline: "Send estimates fast", accent: "estimates", kicker: "CRM Tutorial", shot: "/tmp/shot.png", shotSize: { width: 1920, height: 1080 }, ring: { x: 100, y: 100, width: 200, height: 60 } });
    expect(html).toContain("gator-standing-1024.v1.webp");
    expect(html).toContain("chub-logo-trimmed.png");
    expect(html).toContain("Anton-Regular.ttf");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('<span class="o">estimates</span>');
    expect(fs.existsSync(path.join(ROOT, "scripts/tutorials/assets/Anton-Regular.ttf"))).toBe(true);
    expect(read("scripts/tutorials/assets/Anton-OFL.txt")).toContain("SIL Open Font License");
  });
  it("a headline is two to five words and its accent is one of them", () => {
    const base = { helpKey: "crm-x", title: "x", viewport: { width: 1024, height: 576 }, steps: [{ action: "highlight", selector: "h1", caption: "c", narration: "n" }] };
    expect(() => parseTutorialScript({ ...base, steps: [{ action: "click", selector: "h1", caption: "c", narration: "n" }], thumbnail: { headline: "Send estimates fast", step: 0 } })).toThrow();
    expect(() => parseTutorialScript({ ...base, thumbnail: { headline: "Send estimates fast", accent: "fast", step: 0 } })).not.toThrow();
    expect(() => parseTutorialScript({ ...base, thumbnail: { headline: "Estimates", step: 0 } })).toThrow();
    expect(() => parseTutorialScript({ ...base, thumbnail: { headline: "Send estimates fast", accent: "slow", step: 0 } })).toThrow();
    expect(() => parseTutorialScript({ ...base, thumbnail: { headline: "Send estimates fast", step: 3 } })).toThrow();
  });
});
