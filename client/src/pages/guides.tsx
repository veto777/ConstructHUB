/**
 * Guides (/guides): the library of playbooks, state licensing guides and setup walkthroughs — its own page,
 * rendered without the Social Media workbench (review GUIDE-1/GUIDE-2: /guides used to redirect into Social's
 * Guides tab, under a Social header and a business selector, and broke in all-clients mode).
 *
 *   Find a guide      search across titles and steps, and topic chips (?topic= in the address)
 *   Library           every destination the marketing lists (components/guides/library.ts LIBRARY), each marked
 *                     Free / with an account / Master Class (unlocked when /api/course-access says so) / plan
 *   Walkthroughs      the button-by-button guides with a checkbox per step; progress stays in this browser
 *
 * Social Media still embeds the same content in its Guides tab (GuidesContent embedded), under its own header,
 * with a link to this page. Google's typography and hairlines (owner, 2026-10-07) stay on the guide pages.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Search } from "lucide-react";
import { AppPage, Section } from "@/components/app-ui";
import { GooglePill, GoogleSectionHeader } from "@/components/google";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { useUrlParam } from "@/hooks/use-url-param";
import { cn } from "@/lib/utils";
import { SiteConnectionGuide } from "./site-connection-guide";
import { PROGRESS_NOTE, progressLabel, useChecklist } from "@/components/guides/progress";
import { LEGACY_ANCHORS, LIBRARY, TOPICS, WALKTHROUGHS, matchesQuery, type Access, type Topic, type Walkthrough } from "@/components/guides/library";
import type { CourseAccess } from "@/components/master-class/access";

const TOPIC_KEYS = new Set<string>(TOPICS.map((t) => t.key));
const CONNECTION_WORDS = ["connect your website", "site connection guide", "cloudflare", "search console", "nameservers", "dns", "limited key", "sitemaps"];

function accessLabel(a: Access, access: CourseAccess | undefined): string {
  switch (a.kind) {
    case "free": return "Free";
    case "account": return "Free with an account";
    case "master-class": return access?.any ? "Unlocked on your account" : "Master Class";
    case "plan": return a.plan ? `Free to read · connecting needs the ${a.plan} plan` : "Free to read";
  }
}

function WalkthroughCard({ w }: { w: Walkthrough }) {
  const list = useChecklist(`guide:${w.id}`);
  const done = w.steps.filter((_, i) => list.isDone(`step-${i + 1}`)).length;
  const complete = done === w.steps.length;
  return (
    <Section id={`guide-${w.id}`} title={w.title} className={cn("scroll-mt-6", complete && "border-primary/40")} testId={`guide-${w.id}`}
      description={<>{progressLabel(done, w.steps.length)}{complete ? " — all done" : ""} · {PROGRESS_NOTE}</>}
      actions={<>
        {done > 0 && <Button variant="ghost" size="sm" onClick={list.reset} data-testid={`button-guide-reset-${w.id}`}>Reset</Button>}
        <GooglePill size="sm" href={w.href} label={w.open} />
      </>}>
      <ol className="g-text space-y-3 text-sm leading-7" data-testid={`list-guide-steps-${w.id}`}>
        {w.steps.map((step, i) => {
          const id = `step-${i + 1}`;
          const isDone = list.isDone(id);
          const boxId = `guide-${w.id}-${id}`;
          return (
            <li key={id} className="flex items-start gap-3">
              <label htmlFor={boxId} className="flex min-h-7 cursor-pointer items-center">
                <Checkbox id={boxId} checked={isDone} onCheckedChange={(v) => list.toggle(id, v === true)} aria-label={`Mark step ${i + 1} of ${w.title} done`} data-testid={`checkbox-guide-${w.id}-${i + 1}`} />
              </label>
              <span className="w-5 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
              <span className={cn("min-w-0 [overflow-wrap:anywhere]", isDone && "text-muted-foreground")}>{step}</span>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

/** The library and the walkthroughs. `embedded`: inside Social Media's Guides tab, under Social's own page title. */
export function GuidesContent({ embedded }: { embedded?: boolean }) {
  // Social Media renders this inside its own page (no prop): anywhere but /guides counts as embedded.
  const [location] = useLocation();
  const isEmbedded = embedded ?? location !== "/guides";
  const [topicParam, setTopicParam] = useUrlParam("topic");
  const topic = topicParam && TOPIC_KEYS.has(topicParam) ? (topicParam as Topic) : null;
  const [q, setQ] = useState("");
  // The Master Class labels follow the account; signed out, the server answers "nothing unlocked".
  const { data: access } = useQuery<CourseAccess>({ queryKey: ["/api/course-access"] });

  // Older links (#guide-0 … #guide-8) still land on the walkthrough they meant.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const target = LEGACY_ANCHORS[hash] ?? (hash || null);
    if (!target) return;
    if (target !== hash) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${target}`);
    document.getElementById(target)?.scrollIntoView({ block: "start" });
  }, []);

  const inTopic = (t: Topic) => !topic || topic === t;
  const library = LIBRARY.filter((e) => inTopic(e.topic) && matchesQuery(q, [e.title, e.body]));
  const walkthroughs = WALKTHROUGHS.filter((w) => inTopic(w.topic) && matchesQuery(q, [w.title, ...w.steps]));
  const showConnection = inTopic("connections") && matchesQuery(q, CONNECTION_WORDS);
  const total = library.length + walkthroughs.length + (showConnection ? 1 : 0);
  const clear = () => { setQ(""); setTopicParam(null); };

  return (
    <section aria-label="Guides walkthroughs" className="space-y-5 sm:space-y-6">
      <GoogleSectionHeader as={isEmbedded ? "h2" : "h1"} title="Guides" flush
        description="Playbooks, state licensing guides and step-by-step walkthroughs for every tool. Tick the steps as you go."
        actions={isEmbedded
          ? <GooglePill size="sm" href="/guides" label="Open the Guides page" testId="link-guides-page" />
          : <GooglePill variant="solid" href="#walkthroughs" label="Walkthroughs" />} />

      <Section title="Find a guide" description={`${total} of ${LIBRARY.length + WALKTHROUGHS.length + 1} guides${q.trim() ? ` match “${q.trim()}”` : ""}`}>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search guides and steps…" aria-label="Search guides" className="pl-9" data-testid="input-guides-search" />
        </div>
        <nav aria-label="Guide topics" className="flex flex-wrap gap-2">
          <GooglePill size="sm" label="All" selected={!topic} onClick={() => setTopicParam(null)} ariaPressed={!topic} testId="chip-topic-all" />
          {TOPICS.map((t) => (
            <GooglePill key={t.key} size="sm" label={t.label} selected={topic === t.key} onClick={() => setTopicParam(topic === t.key ? null : t.key)} ariaPressed={topic === t.key} testId={`chip-topic-${t.key}`} />
          ))}
        </nav>
      </Section>

      {total === 0 && (
        <Section className="border-dashed" testId="guides-empty">
          <div className="flex flex-col items-center py-8 text-center">
            <BookOpen className="mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
            <h3 className="font-semibold">No guide matches</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">Nothing in the library or the walkthroughs mentions “{q.trim()}”{topic ? ` under ${TOPICS.find((t) => t.key === topic)?.label}` : ""}.</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={clear} data-testid="button-guides-clear">Show every guide</Button>
          </div>
        </Section>
      )}

      {library.length > 0 && (
        <Section id="library" title="Playbooks and guide libraries" description="Each one opens where it lives; the label says what it costs." testId="guides-library">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="list-guides-library">
            {library.map((e) => (
              <li key={e.id} className="flex flex-col rounded-xl border bg-background/60 p-4" data-testid={`library-${e.id}`}>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{e.title}</h3>
                  {e.count && <span className="text-xs text-muted-foreground">{e.count}</span>}
                </div>
                <p className="g-text-2 flex-1 text-sm">{e.body}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="outline" className="whitespace-normal text-left font-normal leading-snug" data-testid={`access-${e.id}`}>{accessLabel(e.access, access)}</Badge>
                  <GooglePill size="sm" href={e.href} label={e.open} testId={`link-library-${e.id}`} />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {showConnection && <div id="guide-connection" className="scroll-mt-6" data-testid="guide-connection"><SiteConnectionGuide /></div>}

      {walkthroughs.length > 0 && (
        <div id="walkthroughs" className="scroll-mt-6 space-y-5 sm:space-y-6">
          <GoogleSectionHeader title="Setup walkthroughs" count={walkthroughs.length} description="The buttons in order, with what each one does and doesn't do." flush />
          {walkthroughs.map((w) => <WalkthroughCard key={w.id} w={w} />)}
        </div>
      )}
    </section>
  );
}

export default function GuidesPage() {
  return (
    <AppPage width="narrow">
      <GuidesContent />
    </AppPage>
  );
}
