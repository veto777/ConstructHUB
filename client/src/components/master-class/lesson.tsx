import { ProgressNote } from "./progress-note";
/**
 * A module home's lessons: an outline that links to each lesson (durable `#lesson-<id>` anchors, so a copied
 * link reopens the same material), each lesson as one card with a "Mark done" control, and the progress kept
 * in this browser (components/guides/progress.ts).
 */
import { useEffect, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CheckCircle2, Circle } from "lucide-react";
import { Section } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { progressLabel, useChecklist } from "@/components/guides/progress";

export type LessonMeta = { id: string; title: string; icon?: LucideIcon };

const slug = (s: string) => s.replace(/[^a-zA-Z0-9_-]+/g, "-");

export function Lesson({ id, title, icon, description, storageKey, children, contentClassName, className, testId, available = true }: {
  id: string;
  title: ReactNode;
  icon?: LucideIcon;
  description?: ReactNode;
  /** The module's checklist key (one per module, e.g. "mc:gmb"). */
  storageKey: string;
  children: ReactNode;
  contentClassName?: string;
  className?: string;
  testId?: string;
  available?: boolean;
}) {
  const list = useChecklist(storageKey);
  const done = list.isDone(id);
  const boxId = `done-${slug(storageKey)}-${slug(id)}`;
  const label = typeof title === "string" ? title : id;
  return (
    <Section id={`lesson-${id}`} title={title} icon={icon} description={description}
      className={cn("scroll-mt-24", done && "border-primary/40", className)} contentClassName={contentClassName} testId={testId ?? `lesson-${id}`}
      actions={
        <label htmlFor={boxId} className="flex min-h-10 min-w-24 cursor-pointer select-none items-center gap-2 rounded-md px-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          <Checkbox id={boxId} checked={done} disabled={!list.ready || !available} onCheckedChange={(v) => { if (available) list.toggle(id, v === true); }} aria-label={`Mark "${label}" done`} data-testid={`checkbox-${slug(id)}-done`} />
          {done ? "Done" : "Mark done"}
        </label>
      }>
      {children}
    </Section>
  );
}

/**
 * The lesson list at the top of a module home. Unlocked: links with done marks and the progress line.
 * Locked: the same titles as a plain list — the outline is public, like the Google Ads guide's, the lessons are not.
 */
export function LessonOutline({ lessons, storageKey, locked = false, progress = true, title = "Lessons", description, testId, moduleName }: {
  lessons: LessonMeta[];
  storageKey: string;
  locked?: boolean;
  /** false: a plain table of contents (no done marks) — for lists that are read, not worked through. */
  progress?: boolean;
  title?: ReactNode;
  description?: ReactNode;
  testId?: string;
  moduleName?: string;
}) {
  const list = useChecklist(storageKey, { itemIds: lessons.map((lesson) => lesson.id) });
  const total = lessons.length;
  const done = lessons.filter((l) => list.isDone(l.id)).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const tracked = !locked && progress;
  return (
    <Section title={title} testId={testId ?? "lesson-outline"}
      description={description ?? (tracked ? <>{list.ready && <>{progressLabel(done, total)} · </>}<ProgressNote list={list} /></> : `${total} ${locked ? "lesson" : "section"}${total === 1 ? "" : "s"}`)}
      actions={tracked ? <Button variant="ghost" size="sm" disabled={done === 0} className={done === 0 ? "invisible" : undefined} onClick={() => {
        if (window.confirm(`Reset ${done} completed lesson${done === 1 ? "" : "s"} in ${moduleName ?? storageKey.replace(/^mc:/, "")}? This cannot be undone.`)) list.reset();
      }} data-testid="button-lessons-reset">Reset progress</Button> : undefined}>
      {tracked && list.ready && <Progress value={pct} className="mb-3 h-1.5" aria-label={`${pct}% of lessons done`} />}
      <ol className="grid gap-1 sm:grid-cols-2" data-testid="list-lessons">
        {lessons.map((l, i) => {
          const isDone = tracked && list.isDone(l.id);
          const row = (
            <>
              <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              {!tracked ? null : isDone
                ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" aria-hidden="true" />}
              <span className={cn("min-w-0 [overflow-wrap:anywhere]", isDone && "text-muted-foreground")}>{l.title}</span>
            </>
          );
          return (
            <li key={l.id}>
              {locked
                ? <div className="flex min-h-10 items-center gap-2 px-2 text-sm text-muted-foreground">{row}</div>
                : <a href={`#lesson-${l.id}`} className="flex min-h-10 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`link-lesson-${slug(l.id)}`}>{row}</a>}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

/** Once the lessons are on screen, a link that carried `#lesson-…` lands on that lesson. */
export function useScrollToHash(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const scroll = (attempt = 0) => {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      const target = document.getElementById(hash);
      if (target) target.scrollIntoView({ block: "start" });
      else if (attempt < 3) frame = requestAnimationFrame(() => scroll(attempt + 1));
    };
    const onHashChange = () => { cancelAnimationFrame(frame); scroll(); };
    frame = requestAnimationFrame(() => scroll());
    window.addEventListener("hashchange", onHashChange);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [ready]);
}
