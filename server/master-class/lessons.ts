/**
 * The Master Class lesson registry and the rule that opens it — the pure half of server/master-class/routes.ts.
 *
 *   LESSON_MODULES    every module's lesson bodies (server/master-class/content/*): the four sold modules by their
 *                     category (server/state-guides.ts MODULE_CATEGORIES) and the "vetting" bonus lessons.
 *   lessonModuleOpen  may this account read a module's lessons? The four modules follow courseUnlocks().unlocked
 *                     for their category; the vetting lessons come with any purchase or an included course (`any`).
 *   lessonModule()    / findLesson() look a module or one lesson up; unknown → undefined (the route answers 404).
 *
 * Nothing here touches the database; server/master-class/master-class.test.ts exercises every rule and greps the
 * client sources for the lesson text.
 */
import type { CourseUnlocks } from "../state-guides";
import { MODULE_CATEGORIES } from "../state-guides";
import type { LessonBody, ModuleLessons } from "./content";
import { GMB } from "./content/gmb";
import { LICENSING } from "./content/licensing";
import { SEO } from "./content/seo";
import { VETTING } from "./content/vetting";
import { WEBSITE } from "./content/website";

export const LESSON_MODULE_KEYS = [...MODULE_CATEGORIES, "vetting"] as const;
export type LessonModuleKey = (typeof LESSON_MODULE_KEYS)[number];

export const LESSON_MODULES: Record<LessonModuleKey, ModuleLessons> = {
  licensing: LICENSING,
  gmb: GMB,
  website: WEBSITE,
  seo: SEO,
  vetting: VETTING,
};

export const isLessonModule = (key: string): key is LessonModuleKey => (LESSON_MODULE_KEYS as readonly string[]).includes(key);

/** The entitlement rule for a module's lessons, from the account's resolved unlocks. */
export function lessonModuleOpen(unlocks: Pick<CourseUnlocks, "unlocked" | "any">, module: LessonModuleKey): boolean {
  if (module === "vetting") return unlocks.any;
  return unlocks.unlocked[module] === true;
}

export const lessonModule = (key: string): ModuleLessons | undefined => (isLessonModule(key) ? LESSON_MODULES[key] : undefined);

export const findLesson = (key: string, id: string): LessonBody | undefined => lessonModule(key)?.lessons.find((l) => l.id === id);
