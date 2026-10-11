import { ProgressNote } from "./progress-note";
/**
 * The lesson bodies of a Master Class module, fetched from the server and rendered from blocks.
 *
 * The lesson TEXT is not in this bundle: GET /api/master-class/lessons/:module (server/master-class/routes.ts)
 * answers only for an account entitled to that module — 401 signed out, 403 without the module, the bundle or an
 * included course — so the client holds the public outline (titles, icons, lesson.tsx) and this renderer for the
 * block shapes server/master-class/content.ts defines. The fetch has its own states: a skeleton while loading, the
 * server's words and a retry on failure, an honest line for a lesson the server did not return. Never zeros, never
 * an empty page.
 *
 * Inline markup inside a block's text: **bold**, *emphasis* and [label](href); an href that starts with "/" is a
 * page of the platform. "{connectionsPlan}" is replaced by the plan that includes Cloudflare + Search Console, read
 * from shared/plans.ts — no plan name is typed in the lesson copy.
 */
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle, Ban, CheckCircle2, ExternalLink, Lightbulb, ShieldAlert, Wrench, X, type LucideIcon } from "lucide-react";
import { Fragment, useEffect, type ReactNode } from "react";
import { Link } from "wouter";
import { Notice, Section } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { apiErrorMessage } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { progressLabel, useChecklist } from "@/components/guides/progress";
import { planNamesWhere } from "@shared/plan-copy";
import { Lesson, useScrollToHash, type LessonMeta } from "./lesson";

/* ── The server's shapes (server/master-class/content.ts) ─────────────────────────────────────────────── */

export type LessonModuleKey = "licensing" | "gmb" | "website" | "seo" | "vetting";
export type Tone = "check" | "warn" | "x" | "tip" | "plain";
export type ListItem = string | { text: string; tone?: Tone };
export type LessonBlock =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "panels"; cols?: 2 | 3; items: { title: string; tone?: Tone; items: ListItem[] }[] }
  | { type: "cards"; cols?: 2 | 3; items: { title: string; text: string; href?: string }[] }
  | { type: "notes"; items: { lead?: string; text: string; tone?: Tone }[] }
  | { type: "tip"; title?: string; text: string | string[] }
  | { type: "callout"; tone: "warn" | "ban"; title: string; text: string | string[] }
  | { type: "list"; title?: string; tone?: Tone; cols?: 1 | 2; items: ListItem[] }
  | { type: "stats"; title?: string; items: { value: string; label: string }[]; note?: string }
  | { type: "ranked"; items: { title: string; text: string }[] }
  | { type: "tags"; label: string; items: string[] }
  | { type: "checklist"; storageKey: string; items: { id: string; text: string }[]; unit?: string; resetLabel?: string }
  | { type: "in-app"; text: string };
export type LessonBody = { id: string; title: string; blocks: LessonBlock[] };
/** GET /api/master-class/lessons/:module */
export type ModuleLessonsPayload = { module: LessonModuleKey; lessons: LessonBody[]; footer: LessonBlock[] };

/** The module's lesson bodies — asked for only once the module is open, so a locked tab never requests paid text. */
export function useLessonBodies(module: LessonModuleKey, enabled: boolean): UseQueryResult<ModuleLessonsPayload> {
  return useQuery<ModuleLessonsPayload>({ queryKey: ["/api/master-class/lessons", module], enabled });
}

/* ── Inline text ──────────────────────────────────────────────────────────────────────────────────────── */

/** The plan whose modules include Cloudflare + Search Console (shared/plans.ts) — read, never typed. */
const CONNECTIONS_PLAN = planNamesWhere((p) => p.modules.cloudflareSearchConsole);
const PLACEHOLDERS: Record<string, string> = { connectionsPlan: CONNECTIONS_PLAN };
const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g;
const slug = (s: string) => s.replace(/[^a-zA-Z0-9_-]+/g, "-");

/** A link to a platform page inside lesson text. */
export function AppLink({ href, children, testId }: { href: string; children: ReactNode; testId?: string }) {
  return <Link href={href} className="font-medium text-foreground underline underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={testId}>{children}</Link>;
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

export function Inline({ text }: { text: string }) {
  const filled = text.replace(/\{(\w+)\}/g, (m, key: string) => PLACEHOLDERS[key] ?? m);
  return (
    <>
      {filled.split(INLINE).map((part, i) => {
        if (!part) return null;
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="font-medium text-foreground">{part.slice(2, -2)}</strong>;
        const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
        if (link) {
          return link[2].startsWith("/")
            ? <AppLink key={i} href={link[2]}>{link[1]}</AppLink>
            : <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{link[1]}<ExternalLink className="h-3 w-3" aria-hidden="true" /></a>;
        }
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
        return part;
      })}
    </>
  );
}

/* ── Blocks ───────────────────────────────────────────────────────────────────────────────────────────── */

const MARK: Record<Tone, LucideIcon | null> = { check: CheckCircle2, warn: AlertTriangle, x: X, tip: Lightbulb, plain: null };

function Mark({ tone = "check", className }: { tone?: Tone; className?: string }) {
  const Icon = MARK[tone];
  return Icon ? <Icon className={cn("mt-0.5 h-3 w-3 shrink-0 text-muted-foreground", className)} aria-hidden="true" /> : null;
}

function Bullets({ items, tone = "check", cols = 1, className }: { items: ListItem[]; tone?: Tone; cols?: 1 | 2; className?: string }) {
  return (
    <ul className={cn(cols === 2 ? "grid grid-cols-1 gap-1 sm:grid-cols-2" : "space-y-1", "text-xs text-muted-foreground", className)}>
      {items.map((item, i) => {
        const text = typeof item === "string" ? item : item.text;
        const t = typeof item === "string" ? tone : item.tone ?? tone;
        return <li key={i} className="flex items-start gap-1.5"><Mark tone={t} /><span className="min-w-0 [overflow-wrap:anywhere]"><Inline text={text} /></span></li>;
      })}
    </ul>
  );
}

const paragraphs = (text: string | string[]) => (Array.isArray(text) ? text : [text]);
const gridCols = (cols: 2 | 3 | undefined) => (cols === 3 ? "grid grid-cols-1 gap-3 sm:grid-cols-3" : "grid grid-cols-1 gap-3 md:grid-cols-2");

/** An interactive checklist whose ticks the browser keeps (components/guides/progress.ts). */
function ChecklistBlock({ block }: { block: Extract<LessonBlock, { type: "checklist" }> }) {
  const list = useChecklist(block.storageKey, { itemIds: block.items.map((item) => item.id) });
  const base = slug(block.storageKey.replace(/^mc:/, ""));
  return (
    <div className="space-y-2" data-testid={`checklist-${base}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span role="status">{list.ready && <>{progressLabel(list.count, block.items.length)}{block.unit ? ` ${block.unit}` : ""} · </>}<ProgressNote list={list} /></span>
        {list.count > 0 && <Button variant="ghost" size="sm" className="!min-h-8" onClick={list.reset} data-testid={`button-${base}-reset`}>{block.resetLabel ?? "Reset"}</Button>}
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid={`list-${base}`}>
        {block.items.map((item) => {
          const done = list.isDone(item.id);
          const boxId = `${base}-${slug(item.id)}`;
          return (
            <li key={item.id}>
              <label htmlFor={boxId} className="flex min-h-10 cursor-pointer items-start gap-2 rounded-md border bg-background/60 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50">
                <Checkbox id={boxId} checked={done} disabled={!list.ready} onCheckedChange={(v) => list.toggle(item.id, v === true)} className="mt-0.5" data-testid={`checkbox-${base}-${slug(item.id)}`} />
                <span className={cn("min-w-0 [overflow-wrap:anywhere]", done && "line-through")}>{item.text}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function LessonBlockView({ block }: { block: LessonBlock }) {
  switch (block.type) {
    case "p": return <p className="text-sm text-muted-foreground"><Inline text={block.text} /></p>;
    case "h": return <h4 className="mt-3 text-sm font-semibold">{block.text}</h4>;
    case "panels": return (
      <div className={gridCols(block.cols)}>
        {block.items.map((panel) => (
          <div key={panel.title} className={cn("rounded-lg border p-3", panel.tone === "warn" || panel.tone === "x" ? "border-border bg-muted" : "bg-muted/30")}>
            <p className="mb-2 text-xs font-semibold">{panel.title}</p>
            <Bullets items={panel.items} tone={panel.tone ?? "check"} />
          </div>
        ))}
      </div>
    );
    case "cards": return (
      <div className={cn("grid grid-cols-1 gap-2", block.cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {block.items.map((card) => {
          const inner = (
            <>
              {card.href ? null : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold [overflow-wrap:anywhere]">{card.title}</p>
                <p className="text-xs text-muted-foreground"><Inline text={card.text} /></p>
              </div>
              {card.href && <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
            </>
          );
          const frame = "flex items-start gap-2 rounded-lg border bg-muted/30 p-3";
          return card.href
            ? <a key={card.title} href={card.href} target="_blank" rel="noopener noreferrer" className={cn(frame, "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")} data-testid={`link-${slug(card.title.toLowerCase())}`}>{inner}</a>
            : <div key={card.title} className={frame}>{inner}</div>;
        })}
      </div>
    );
    case "notes": return (
      <div className="space-y-2">
        {block.items.map((note, i) => (
          <div key={i} className="flex items-start gap-2 rounded-md border border-border bg-muted p-2.5">
            <Mark tone={note.tone ?? "plain"} className="h-3.5 w-3.5" />
            <p className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {note.lead && <><strong className="text-foreground"><Inline text={note.lead} /></strong> </>}<Inline text={note.text} />
            </p>
          </div>
        ))}
      </div>
    );
    case "tip": return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted p-3">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          {block.title && <p className="text-sm font-medium">{block.title}</p>}
          {paragraphs(block.text).map((t, i) => <p key={i} className="text-xs text-muted-foreground"><Inline text={t} /></p>)}
        </div>
      </div>
    );
    case "callout": {
      const Icon = block.tone === "ban" ? Ban : ShieldAlert;
      return (
        <div className="flex items-start gap-3 rounded-xl border bg-card p-4" role="note">
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-semibold">{block.title}</p>
            {paragraphs(block.text).map((t, i) => <p key={i} className="text-xs text-muted-foreground"><Inline text={t} /></p>)}
          </div>
        </div>
      );
    }
    case "list": return block.title ? (
      <div className="space-y-1.5 rounded-md bg-muted/50 p-3">
        <p className="text-xs font-medium">{block.title}</p>
        <Bullets items={block.items} tone={block.tone} cols={block.cols} />
      </div>
    ) : <Bullets items={block.items} tone={block.tone} cols={block.cols} />;
    case "stats": return (
      <div className="rounded-lg border border-border bg-muted p-3">
        {block.title && <h4 className="mb-2 text-sm font-semibold">{block.title}</h4>}
        <div className={cn("grid grid-cols-1 gap-3 text-center", block.items.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
          {block.items.map((s) => (
            <div key={s.label} className="rounded border border-border p-2">
              <p className="text-lg font-semibold text-muted-foreground [overflow-wrap:anywhere]">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
        {block.note && <p className="mt-2 text-xs text-muted-foreground"><Inline text={block.note} /></p>}
      </div>
    );
    case "ranked": return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {block.items.map((item, i) => (
          <div key={item.title} className="flex items-start gap-2.5 rounded-md border border-border/30 p-2.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{i + 1}</div>
            <div className="min-w-0">
              <p className="text-xs font-semibold">{item.title}</p>
              <p className="text-[10px] leading-relaxed text-muted-foreground">{item.text}</p>
            </div>
          </div>
        ))}
      </div>
    );
    case "tags": return (
      <div className="space-y-1.5 rounded-md bg-muted/50 p-3">
        <p className="text-xs font-medium">{block.label}</p>
        <div className="flex flex-wrap gap-1.5">{block.items.map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}</div>
      </div>
    );
    case "checklist": return <ChecklistBlock block={block} />;
    case "in-app": return <InApp><Inline text={block.text} /></InApp>;
    default: return null;
  }
}

export function LessonBlocks({ blocks, className }: { blocks: LessonBlock[]; className?: string }) {
  return <div className={cn("space-y-3", className)}>{blocks.map((b, i) => <LessonBlockView key={i} block={b} />)}</div>;
}

/* ── The module's lessons: fetch, states, render ──────────────────────────────────────────────────────── */

export type RenderLesson = (meta: LessonMeta, body: LessonBody | undefined, index: number) => ReactNode;

/** The lesson the server did not return — said plainly, never an empty card. */
function MissingLesson() {
  return <p className="text-sm text-muted-foreground" data-testid="text-lesson-missing">This lesson isn't available right now. Reload the page or come back later.</p>;
}

/**
 * Every lesson body of one open module: a skeleton while they load, the server's words and a retry if they
 * don't, then the lessons in the outline's order (plus any the server adds after it), and the module's footer.
 * `renderLesson` replaces the default card (a Lesson with Mark done) for homes with their own layout.
 */
export function ModuleLessons({ module, lessons, storageKey, open, renderLesson, children }: {
  module: LessonModuleKey;
  /** The public outline — the order the lessons render in. */
  lessons: LessonMeta[];
  storageKey: string;
  /** Access confirmed and the module unlocked; nothing is requested before. */
  open: boolean;
  renderLesson?: RenderLesson;
  /** Rendered after the lessons (a module's own form). */
  children?: ReactNode;
}) {
  const q = useLessonBodies(module, open);
  const queryClient = useQueryClient();
  const accessRevoked = q.isError && /^(401|403)\b/.test(q.error.message);
  useEffect(() => {
    if (!accessRevoked) return;
    // Remove protected text while retaining the denial/error state. A later network
    // failure or remount must not resurrect content from before access was revoked.
    queryClient.getQueryCache().find({ queryKey: ["/api/master-class/lessons", module], exact: true })
      ?.setState({ data: undefined, dataUpdatedAt: 0 });
  }, [accessRevoked, module, queryClient]);
  useScrollToHash(open && !!q.data && !accessRevoked);
  if (!open) return null;
  if (q.isPending) {
    return (
      <Section testId="lessons-loading">
        <p className="mb-3 text-sm text-muted-foreground" role="status">Loading the lessons…</p>
        <div className="space-y-3" aria-hidden="true">{lessons.slice(0, 4).map((l) => <Skeleton key={l.id} className="h-24 w-full" />)}</div>
      </Section>
    );
  }
  if (q.isError && (!q.data || accessRevoked)) {
    return (
      <Notice tone="danger" title="Couldn't load the lessons" testId="lessons-error"
        action={<Button variant="outline" size="sm" onClick={() => void q.refetch()} data-testid="button-lessons-retry">Try again</Button>}>
        {apiErrorMessage(q.error)} The outline above is yours; the lesson text comes from the server once it answers.
      </Notice>
    );
  }
  const byId = new Map(q.data.lessons.map((l) => [l.id, l]));
  const extras = q.data.lessons.filter((l) => !lessons.some((m) => m.id === l.id)).map((l): LessonMeta => ({ id: l.id, title: l.title }));
  const render = renderLesson ?? ((meta, body) => (
    <Lesson id={meta.id} title={meta.title} icon={meta.icon} storageKey={storageKey} contentClassName="space-y-3">
      {body ? <LessonBlocks blocks={body.blocks} /> : <MissingLesson />}
    </Lesson>
  ));
  return (
    <>
      {q.isError && <Notice tone="danger" title="Refresh failed — showing previously loaded lessons" testId="lessons-stale"
        action={<Button variant="outline" size="sm" disabled={q.isFetching} onClick={() => void q.refetch()} data-testid="button-lessons-retry">{q.isFetching ? "Retrying…" : "Try again"}</Button>}>
        {apiErrorMessage(q.error)} These lessons may be out of date.
      </Notice>}
      {[...lessons, ...extras].map((meta, i) => <Fragment key={meta.id}>{render(meta, byId.get(meta.id), i)}</Fragment>)}
      {q.data.footer.length > 0 && <div data-testid="lessons-footer"><LessonBlocks blocks={q.data.footer} /></div>}
      {children}
    </>
  );
}
