/**
 * One module home (a tab of /master-class): its header card, then exactly one of the access states from
 * gate.tsx — checking, failed, locked (with the public lesson outline), or the lessons with their outline.
 * Every module tab goes through here so the four homes behave the same way.
 */
import type { LucideIcon } from "lucide-react";
import { Lock, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Section } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import type { CourseAccess, MasterClassModule } from "./access";
import { AccessChecking, AccessError, LockedModule } from "./gate";
import { LessonOutline, useScrollToHash, type LessonMeta } from "./lesson";

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

export function ModuleHome({ title, description, icon: Icon, badge, unlocked, lessons, storageKey, what, moduleTitle, opensWith, outlineTitle, progress = true, children, testId, ...p }: ModuleHomeProps & {
  title: ReactNode;
  description: ReactNode;
  icon: LucideIcon;
  /** Why it is open (UnlockBadge) — shown beside the title when unlocked. */
  badge?: ReactNode;
  unlocked: boolean;
  lessons: LessonMeta[];
  storageKey: string;
  /** What the paywall says is locked: "The Google Business lessons". */
  what: string;
  /** The module's name when its catalog row has not loaded. */
  moduleTitle: string;
  /** The paywall's own sentence for a bonus tab (LockedModule opensWith). */
  opensWith?: ReactNode;
  outlineTitle?: ReactNode;
  progress?: boolean;
  children: ReactNode;
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
          {children}
        </>
      )}
    </div>
  );
}

/** "In ConstructHUB: …" — where the lesson's work is done inside the platform, with the page it opens. */
export function InApp({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
      <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 [overflow-wrap:anywhere]"><strong className="text-foreground">In ConstructHUB:</strong> {children}</p>
    </div>
  );
}

/** A link to a platform page inside an InApp line. */
export function AppLink({ href, children, testId }: { href: string; children: ReactNode; testId?: string }) {
  return <Link href={href} className="font-medium text-foreground underline underline-offset-2 hover:text-primary" data-testid={testId}>{children}</Link>;
}
