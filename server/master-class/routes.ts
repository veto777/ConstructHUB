/**
 * Master Class lesson delivery: the paid lesson bodies leave the server only to an account entitled to them.
 *
 *   GET /api/master-class/lessons/:module            every lesson body of one module (+ its footer)
 *   GET /api/master-class/lessons/:module/:lessonId  one lesson body
 *
 * :module is a module category (licensing, gmb, website, seo) or "vetting". Answers: 404 unknown module or lesson;
 * 401 signed out (code sign_in_required); 403 signed in without the module, the bundle or an included course
 * (code course_purchase_required — the same rule as /api/state-guides/:code, server/state-guides.ts courseUnlocks,
 * resolved per module by server/master-class/lessons.ts lessonModuleOpen); 200 with the lessons. The outline
 * (titles) is public and lives in the client; the bodies live under server/master-class/content and ship in no
 * bundle (server/master-class/master-class.test.ts).
 *
 * Mounted from server/routes.ts registerRoutes() with the same getDevUser and DEV_AUTH_BYPASS the course routes use:
 *   (await import("./master-class/routes")).registerMasterClassRoutes(app, getDevUser, DEV_AUTH_BYPASS);
 */
import { Router, type Express, type Request, type Response } from "express";
import { courseUnlocks, type CourseAccess, type ModuleRef } from "../state-guides";
import { findLesson, lessonModule, lessonModuleOpen, type LessonModuleKey } from "./lessons";

export type MasterClassRouteDeps = {
  /** The account's included course and purchase rows (server/course-access.ts getCourseAccess). */
  courseAccess: (userId: number | null) => Promise<CourseAccess>;
  /** The module rows (id, category, title) a purchase resolves against. */
  modules: () => Promise<(ModuleRef & { title?: string | null })[]>;
};

/** The production wiring: course-access + the master_class_modules table, imported lazily like the course routes do. */
const liveDeps: MasterClassRouteDeps = {
  courseAccess: async (userId) => (await import("../course-access")).getCourseAccess(userId),
  modules: async () => {
    const { db } = await import("../db");
    const { masterClassModules } = await import("@shared/schema");
    return db.select({ id: masterClassModules.id, category: masterClassModules.category, title: masterClassModules.title }).from(masterClassModules);
  },
};

type Auth = (req: any, res: any) => any;

/** The refusal for a closed module, in the words the page shows. */
export function closedLessons(module: LessonModuleKey, moduleTitle: string | null | undefined, signedIn: boolean): { status: 401 | 403; body: { code: string; message: string } } {
  if (!signedIn) return { status: 401, body: { code: "sign_in_required", message: "Sign in to open your Master Class lessons." } };
  const message = module === "vetting"
    ? "The vetting lessons come with any Master Class module or the complete bundle."
    : `These lessons open with the ${moduleTitle || "module that covers them"} or the complete bundle.`;
  return { status: 403, body: { code: "course_purchase_required", message } };
}

export function masterClassRouter(auth: Auth, devPreview = false, deps: MasterClassRouteDeps = liveDeps): Router {
  const router = Router();

  /**
   * Resolves the request's access to one module: `open` with the lessons, or the refusal to send. The access is
   * resolved per request (private, no-store) so a purchase or a plan change shows on the next load.
   */
  async function gate(req: Request, res: Response, moduleKey: string) {
    const module = lessonModule(moduleKey);
    if (!module) return { status: 404, body: { message: "Lesson module not found" } } as const;
    // Signed out: getDevUser would already have sent a 401, so it is only asked when a session exists.
    const user = req.user ? auth(req, res) : null;
    if (req.user && !user) return null; // auth answered
    const [access, modules] = await Promise.all([deps.courseAccess(user?.id ?? null), deps.modules()]);
    res.setHeader("Cache-Control", "private, no-store");
    const unlocks = courseUnlocks(access, modules, devPreview);
    const key = moduleKey as LessonModuleKey;
    if (!lessonModuleOpen(unlocks, key)) return closedLessons(key, modules.find((m) => m.category === key)?.title, !!user);
    return { status: 200, module, key } as const;
  }

  router.get("/lessons/:module", async (req, res) => {
    try {
      const g = await gate(req, res, String(req.params.module));
      if (!g) return;
      if (g.status !== 200) return res.status(g.status).json(g.body);
      res.json({ module: g.key, lessons: g.module.lessons, footer: g.module.footer ?? [] });
    } catch (err) {
      console.error("Error loading Master Class lessons:", err);
      res.status(500).json({ message: "Could not load the lessons. Please try again." });
    }
  });

  router.get("/lessons/:module/:lessonId", async (req, res) => {
    try {
      const moduleKey = String(req.params.module);
      const lesson = findLesson(moduleKey, String(req.params.lessonId));
      if (!lesson) return res.status(404).json({ message: lessonModule(moduleKey) ? "Lesson not found" : "Lesson module not found" });
      const g = await gate(req, res, moduleKey);
      if (!g) return;
      if (g.status !== 200) return res.status(g.status).json(g.body);
      res.json({ module: g.key, ...lesson });
    } catch (err) {
      console.error("Error loading a Master Class lesson:", err);
      res.status(500).json({ message: "Could not load this lesson. Please try again." });
    }
  });

  return router;
}

/** Mount the lesson routes under /api/master-class (server/routes.ts registerRoutes). */
export function registerMasterClassRoutes(app: Express, auth: Auth, devPreview = false, deps?: MasterClassRouteDeps) {
  app.use("/api/master-class", masterClassRouter(auth, devPreview, deps));
}
