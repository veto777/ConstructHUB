/**
 * Master Class lesson delivery (server/master-class/*).
 *
 *   1. The rule: lessonModuleOpen follows courseUnlocks per module; the vetting lessons open with any purchase.
 *   2. The registry: every module's lessons have unique ids, every in-app link is a route App.tsx serves, every
 *      placeholder is one the client fills, and the client's public outlines name exactly the server's lessons.
 *   3. The router, mounted in-process with the course access stubbed: 404 / 401 / 403 / 200 per module and per
 *      lesson, private no-store, a refusal that carries no lesson text, the dev preview.
 *   4. The source guard: no lesson sentence appears anywhere under client/ or shared/ — the paid text is not in
 *      the public bundle (the Codex re-score's remaining Master Class finding, 2026-10-11).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { blockTexts, type LessonBlock } from "./content";
import { LESSON_MODULE_KEYS, LESSON_MODULES, findLesson, isLessonModule, lessonModule, lessonModuleOpen } from "./lessons";
import { closedLessons, registerMasterClassRoutes, type MasterClassRouteDeps } from "./routes";
import { courseUnlocks } from "../state-guides";
import { GMB_LESSONS } from "@/components/master-class/module-gmb";
import { WEBSITE_LESSONS } from "@/components/master-class/module-website";
import { SEO_LESSONS } from "@/components/master-class/module-seo";
import { VETTING_EXTRA_LESSONS, VETTING_LESSONS } from "@/components/master-class/module-vetting";
import { BUSINESS_LESSONS } from "@/components/master-class/state-guide";

const root = path.resolve(import.meta.dirname, "../..");
const MODULES = [
  { id: 11, category: "licensing", title: "Business Formation & Licensing" },
  { id: 12, category: "gmb", title: "GMB Setup & Optimization" },
  { id: 13, category: "website", title: "Website & Online Presence" },
  { id: 14, category: "seo", title: "SEO & Directory Domination" },
];
const none = { included: false, purchases: [] };
const texts = (blocks: LessonBlock[]) => blocks.flatMap(blockTexts).filter(Boolean);
const everyText = Object.values(LESSON_MODULES).flatMap((m) => [...m.lessons.flatMap((l) => texts(l.blocks)), ...texts(m.footer ?? [])]);

describe("lessonModuleOpen — which lessons an account may read", () => {
  it("a module's lessons follow its own category; the vetting lessons follow any purchase", () => {
    const one = courseUnlocks({ included: false, purchases: [{ moduleId: 12, isBundle: false }] }, MODULES);
    expect(lessonModuleOpen(one, "gmb")).toBe(true);
    expect(lessonModuleOpen(one, "website")).toBe(false);
    expect(lessonModuleOpen(one, "licensing")).toBe(false);
    expect(lessonModuleOpen(one, "vetting")).toBe(true);
  });
  it("nothing bought opens nothing; included or the bundle opens everything", () => {
    for (const key of LESSON_MODULE_KEYS) expect(lessonModuleOpen(courseUnlocks(none, MODULES), key), key).toBe(false);
    for (const key of LESSON_MODULE_KEYS) expect(lessonModuleOpen(courseUnlocks({ included: true, purchases: [] }, MODULES), key), key).toBe(true);
    for (const key of LESSON_MODULE_KEYS) expect(lessonModuleOpen(courseUnlocks({ included: false, purchases: [{ moduleId: null, isBundle: true }] }, MODULES), key), key).toBe(true);
  });
  it("a purchase of a module no longer listed opens the vetting lessons (a purchase) but no module", () => {
    const u = courseUnlocks({ included: false, purchases: [{ moduleId: 99, isBundle: false }] }, MODULES);
    expect(lessonModuleOpen(u, "vetting")).toBe(true);
    expect(lessonModuleOpen(u, "seo")).toBe(false);
  });
});

describe("the lesson registry", () => {
  const appRoutes = [...fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8").matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);

  it("knows the four module categories and the vetting bonus, nothing else", () => {
    expect([...LESSON_MODULE_KEYS]).toEqual(["licensing", "gmb", "website", "seo", "vetting"]);
    expect(isLessonModule("gmb")).toBe(true);
    expect(isLessonModule("pricing")).toBe(false);
    expect(lessonModule("nope")).toBeUndefined();
    expect(findLesson("gmb", "setup")?.title).toBe("Claim, verify and set up the profile");
    expect(findLesson("gmb", "nope")).toBeUndefined();
  });

  it("every lesson has a unique id and a body with text", () => {
    for (const [key, mod] of Object.entries(LESSON_MODULES)) {
      const ids = mod.lessons.map((l) => l.id);
      expect(new Set(ids).size, key).toBe(ids.length);
      for (const l of mod.lessons) {
        expect(l.blocks.length, `${key}/${l.id}`).toBeGreaterThan(0);
        expect(texts(l.blocks).join(" ").length, `${key}/${l.id}`).toBeGreaterThan(80);
      }
    }
  });

  it("every in-app link is a route App.tsx serves, every external link is https, every placeholder is one the client fills", () => {
    const placeholders = new Set<string>();
    for (const text of everyText) {
      for (const m of text.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
        const href = m[1];
        if (href.startsWith("/")) expect(appRoutes, href).toContain(href.replace(/[#?].*$/, ""));
        else expect(href, href).toMatch(/^https:\/\//);
      }
      for (const m of text.matchAll(/\{(\w+)\}/g)) placeholders.add(m[1]);
      expect(text, text).not.toMatch(/\$\d[\d,]*\s*(\/|per)\s*(month|mo|year|yr)\b.*plan/i); // no plan price typed into a lesson
    }
    expect([...placeholders]).toEqual(["connectionsPlan"]);
    // The one placeholder is filled from the price book by the client renderer, never typed.
    expect(fs.readFileSync(path.join(root, "client/src/components/master-class/lesson-body.tsx"), "utf8")).toContain("connectionsPlan: CONNECTIONS_PLAN");
  });

  it("the client's public outlines name exactly the server's lessons, in order", () => {
    expect(GMB_LESSONS.map((l) => l.id)).toEqual(LESSON_MODULES.gmb.lessons.map((l) => l.id));
    expect(WEBSITE_LESSONS.map((l) => l.id)).toEqual(LESSON_MODULES.website.lessons.map((l) => l.id));
    expect(SEO_LESSONS.map((l) => l.id)).toEqual(LESSON_MODULES.seo.lessons.map((l) => l.id));
    expect(BUSINESS_LESSONS.map((l) => l.id)).toEqual(LESSON_MODULES.licensing.lessons.map((l) => l.id));
    const vetting = LESSON_MODULES.vetting.lessons.map((l) => l.id);
    expect(vetting).toEqual([...VETTING_LESSONS.map((l) => l.id), VETTING_EXTRA_LESSONS.brand, VETTING_EXTRA_LESSONS.checklist]);
    // The outline titles are the public part: the server's titles match them (the vetting cards show the server's longer title).
    for (const [meta, body] of [...GMB_LESSONS.map((m, i) => [m, LESSON_MODULES.gmb.lessons[i]] as const), ...WEBSITE_LESSONS.map((m, i) => [m, LESSON_MODULES.website.lessons[i]] as const), ...SEO_LESSONS.map((m, i) => [m, LESSON_MODULES.seo.lessons[i]] as const), ...BUSINESS_LESSONS.map((m, i) => [m, LESSON_MODULES.licensing.lessons[i]] as const)]) {
      expect(body.title, meta.id).toBe(meta.title);
    }
  });

  it("the interactive checklists retain their logical names within account-scoped storage", () => {
    const keys = everyBlock().filter((b): b is Extract<LessonBlock, { type: "checklist" }> => b.type === "checklist").map((b) => b.storageKey);
    expect(keys).toEqual(["mc:seo:maintenance", "mc:vetting:checklist"]);
  });
});

function everyBlock(): LessonBlock[] {
  return Object.values(LESSON_MODULES).flatMap((m) => [...m.lessons.flatMap((l) => l.blocks), ...(m.footer ?? [])]);
}

describe("the router — 404 / 401 / 403 / 200", () => {
  const ACCESS: Record<number, { included: boolean; purchases: { moduleId: number | null; isBundle: boolean | null }[] }> = {
    1: { included: true, purchases: [] },                                   // Unlimited: included
    2: { included: false, purchases: [{ moduleId: 12, isBundle: false }] }, // bought GMB only
    3: { included: false, purchases: [] },                                  // nothing
    4: { included: false, purchases: [{ moduleId: null, isBundle: true }] },// the bundle
  };
  const deps: MasterClassRouteDeps = { courseAccess: async (userId) => (userId === null ? none : ACCESS[userId] ?? none), modules: async () => MODULES };
  const auth = (req: any, res: any) => { if (req.user) return req.user; res.status(401).json({ message: "Not authenticated" }); return null; };
  let server: Server; let base = ""; let previewBase = "";
  let previewServer: Server;

  const mount = (devPreview: boolean) => {
    const app = express();
    app.use((req, _res, next) => { const u = req.header("x-user"); if (u) (req as any).user = { id: Number(u) }; next(); });
    registerMasterClassRoutes(app, auth, devPreview, deps);
    return app;
  };
  const get = async (url: string, user?: number) => {
    const res = await fetch(url, { headers: user ? { "x-user": String(user) } : {} });
    return { status: res.status, headers: res.headers, body: await res.json() };
  };
  beforeAll(async () => {
    server = mount(false).listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/master-class`;
    previewServer = mount(true).listen(0, "127.0.0.1"); await new Promise((r) => previewServer.once("listening", r));
    previewBase = `http://127.0.0.1:${(previewServer.address() as AddressInfo).port}/api/master-class`;
  });
  afterAll(() => { server.close(); previewServer.close(); });

  it("an unknown module or lesson is 404, before any access question", async () => {
    expect((await get(`${base}/lessons/pricing`)).status).toBe(404);
    expect((await get(`${base}/lessons/gmb/nope`, 1)).status).toBe(404);
    expect((await get(`${base}/lessons/nope/setup`, 1))).toMatchObject({ status: 404, body: { message: "Lesson module not found" } });
  });

  it("signed out is 401 with the sign-in code, and the body carries no lesson text", async () => {
    const r = await get(`${base}/lessons/gmb`);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ code: "sign_in_required", message: "Sign in to open your Master Class lessons." });
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    const single = await get(`${base}/lessons/gmb/setup`);
    expect(single.status).toBe(401);
    for (const r2 of [r, single]) for (const text of everyText.filter((t) => t.length > 40)) expect(JSON.stringify(r2.body)).not.toContain(text);
  });

  it("signed in without the module is 403 naming what opens it; the module bought is 200 with every lesson", async () => {
    const locked = await get(`${base}/lessons/website`, 2);
    expect(locked.status).toBe(403);
    expect(locked.body).toEqual({ code: "course_purchase_required", message: "These lessons open with the Website & Online Presence or the complete bundle." });
    expect(JSON.stringify(locked.body)).not.toContain("A contractor site has one job");
    const open = await get(`${base}/lessons/gmb`, 2);
    expect(open.status).toBe(200);
    expect(open.headers.get("cache-control")).toBe("private, no-store");
    expect(open.body.module).toBe("gmb");
    expect(open.body.lessons.map((l: any) => l.id)).toEqual(LESSON_MODULES.gmb.lessons.map((l) => l.id));
    expect(open.body.footer).toEqual([]);
    expect(JSON.stringify(open.body)).toContain("Add a second owner (you, if an agency set it up) before you do anything else");
  });

  it("one lesson by id follows the same gate", async () => {
    expect((await get(`${base}/lessons/gmb/setup`, 3))).toMatchObject({ status: 403, body: { code: "course_purchase_required" } });
    const r = await get(`${base}/lessons/gmb/setup`, 2);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ module: "gmb", id: "setup", title: "Claim, verify and set up the profile" });
    expect(r.body.blocks.length).toBeGreaterThan(2);
  });

  it("the vetting lessons come with any purchase and are refused with their own sentence otherwise", async () => {
    expect((await get(`${base}/lessons/vetting`, 2)).status).toBe(200);
    const r = await get(`${base}/lessons/vetting`, 3);
    expect(r).toMatchObject({ status: 403, body: { message: "The vetting lessons come with any Master Class module or the complete bundle." } });
  });

  it("an included course or the bundle opens every module, with the licensing footer", async () => {
    for (const user of [1, 4]) for (const key of LESSON_MODULE_KEYS) expect((await get(`${base}/lessons/${key}`, user)).status, `${user}/${key}`).toBe(200);
    const lic = await get(`${base}/lessons/licensing`, 1);
    expect(lic.body.footer).toHaveLength(1);
    expect(lic.body.footer[0]).toMatchObject({ type: "tip", title: "The Bottom Line on Business Structure" });
  });

  it("the dev preview opens everything, signed in or not, as /api/state-guides/:code does", async () => {
    expect((await get(`${previewBase}/lessons/seo`, 3)).status).toBe(200);
    expect((await get(`${previewBase}/lessons/seo`)).status).toBe(200); // courseUnlocks: devPreview opens all, like /api/state-guides/:code
  });

  it("closedLessons words the refusal from the module row, never from a typed title", () => {
    expect(closedLessons("seo", null, true).body.message).toBe("These lessons open with the module that covers them or the complete bundle.");
    expect(closedLessons("seo", "SEO & Directory Domination", false)).toMatchObject({ status: 401 });
  });
});

describe("source guard — the paid text ships in no client bundle", () => {
  const SKIP = new Set(["node_modules", ".cache", "dist"]);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?|json|md|html|css)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(root, "client"));
  walk(path.join(root, "shared"));
  const sources = files.map((f) => [f, fs.readFileSync(f, "utf8")] as const);

  it("walks the client and shared sources", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith("client/src/components/master-class/lesson-body.tsx"))).toBe(true);
  });

  it("a known lesson sentence from every module is found nowhere under client/ or shared/", () => {
    const known = [
      "A contract does not automatically transfer liability or determine employment status;",
      "Get those three right before anything else.",
      "Build these seven pages before anything else.",
      "Misuse of owner permissions",
      "Some companies falsely claim to have worked for or been affiliated with established brands",
      "Verify any required contractor license and its scope with the issuing agency",
    ];
    for (const sentence of known) {
      expect(everyText.some((t) => t.includes(sentence)), sentence).toBe(true);
      const plain = sentence.replace(/\*\*/g, "");
      for (const [file, text] of sources) expect(text.includes(plain) || text.includes(sentence), `${path.relative(root, file)} carries "${sentence}"`).toBe(false);
    }
  });

  it("no lesson paragraph, bullet, note or checklist item appears in any client or shared source", () => {
    const paid = everyText.map((t) => t.replace(/\*\*|\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")).filter((t) => t.length >= 40);
    expect(paid.length).toBeGreaterThan(300);
    const leaks: string[] = [];
    for (const [file, text] of sources) for (const t of paid) if (text.includes(t)) leaks.push(`${path.relative(root, file)}: ${t.slice(0, 60)}…`);
    expect(leaks).toEqual([]);
  });

  it("the built client, when one exists, carries none of it either", () => {
    const dist = path.join(root, "dist/public/assets");
    if (!fs.existsSync(dist)) return;
    const paid = everyText.map((t) => t.replace(/\*\*|\*/g, "")).filter((t) => t.length >= 40);
    for (const f of fs.readdirSync(dist).filter((n) => n.endsWith(".js"))) {
      const text = fs.readFileSync(path.join(dist, f), "utf8");
      for (const t of paid) expect(text.includes(t), `${f}: ${t.slice(0, 60)}`).toBe(false);
    }
  });
});
