/**
 * One module home (a tab of /master-class): its header card, then exactly one of the access states from
 * gate.tsx — checking, failed, locked (with the public lesson outline), or the outline and the lessons.
 * Every module tab goes through here so the four homes behave the same way.
 *
 * The lesson bodies are not in this bundle: once the module is open they are fetched from
 * /api/master-class/lessons/:module (lesson-body.tsx ModuleLessons), which answers only an entitled account.
 * This file holds no lesson text — the outline (titles, icons) is the public part.
 */
import type { LucideIcon } from "lucide-react";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Section } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import type { CourseAccess, MasterClassModule } from "./access";
import { AccessChecking, AccessError, LockedModule } from "./gate";
import { LessonOutline, useScrollToHash, type LessonMeta } from "./lesson";
import { ModuleLessons, type LessonModuleKey, type RenderLesson } from "./lesson-body";

export { AppLink, InApp } from "./lesson-body";

export type AccessStatus = "pending" | "error" | "success";

export type ModuleHomeProps = {
  access: CourseAccess | undefined;
  accessStatus: AccessStatus;
  accessError: unknown;
  onRetryAccess: () => void;
  /** The module row from the catalog (title, price) — null while the catalog loads or for a bonus tab. */
  module: MasterClassModule | null;
  onEnroll: () => void;
};

export function ModuleHome({ title, description, icon: Icon, badge, unlocked, lessons, lessonsModule, renderLesson, storageKey, what, moduleTitle, opensWith, outlineTitle, progress = true, children, testId, ...p }: ModuleHomeProps & {
  title: ReactNode;
  description: ReactNode;
  icon: LucideIcon;
  /** Why it is open (UnlockBadge) — shown beside the title when unlocked. */
  badge?: ReactNode;
  unlocked: boolean;
  /** The public outline: titles and icons, in order. */
  lessons: LessonMeta[];
  /** The server module whose lesson bodies this home shows (/api/master-class/lessons/:module). */
  lessonsModule: LessonModuleKey;
  /** A home's own lesson layout (the vetting tips); the default is a Lesson card with Mark done. */
  renderLesson?: RenderLesson;
  storageKey: string;
  /** What the paywall says is locked: "The Google Business lessons". */
  what: string;
  /** The module's name when its catalog row has not loaded. */
  moduleTitle: string;
  /** The paywall's own sentence for a bonus tab (LockedModule opensWith). */
  opensWith?: ReactNode;
  outlineTitle?: ReactNode;
  progress?: boolean;
  /** Shown after the lessons once they are open (a module's own form). */
  children?: ReactNode;
  testId?: string;
}) {
  const open = p.accessStatus === "success" && unlocked;
  useScrollToHash(open);
  return (
    <div className="space-y-4 sm:space-y-6" data-testid={testId}>
      <Section>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted" aria-hidden="true"><Icon className="h-5 w-5 text-muted-foreground" /></span>
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold sm:text-lg">
              {title}
              {p.accessStatus === "success" && (unlocked ? badge : <Badge variant="outline" className="gap-1 font-normal text-muted-foreground"><Lock className="h-3 w-3" aria-hidden="true" /> Locked</Badge>)}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
      </Section>
      {p.accessStatus === "pending" && <AccessChecking />}
      {p.accessStatus === "error" && <AccessError error={p.accessError} onRetry={p.onRetryAccess} />}
      {p.accessStatus === "success" && !unlocked && (
        <LockedModule what={what} module={p.module} moduleTitle={moduleTitle} opensWith={opensWith} access={p.access} onEnroll={p.onEnroll}>
          <LessonOutline lessons={lessons} storageKey={storageKey} locked title={outlineTitle} />
        </LockedModule>
      )}
      {open && (
        <>
          <LessonOutline lessons={lessons} storageKey={storageKey} title={outlineTitle} progress={progress} />
          <ModuleLessons module={lessonsModule} lessons={lessons} storageKey={storageKey} open renderLesson={renderLesson}>
            {children}
          </ModuleLessons>
        </>
      )}
    </div>
  );
}
