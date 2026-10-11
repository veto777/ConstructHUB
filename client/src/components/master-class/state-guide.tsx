/**
 * Module 1 — Business Formation & Licensing (/master-class?tab=state-guide&state=WA): one state's guide and the
 * lessons on running the business.
 *
 * What is free and what is paid follows the server (server/state-guides.ts): the state list carries only the
 * comparison facts, so a locked state shows its flags, its filing office and a locked tile for each other agency;
 * the full guide (agency links with their check status, notes, the written walkthrough or the checklist built
 * from the agency records) is fetched only once access is confirmed, and the server refuses it otherwise.
 *
 * The lessons on running the business (BUSINESS_LESSONS) are an outline here; their text is fetched from
 * /api/master-class/lessons/licensing (lesson-body.tsx ModuleLessons) once the module is open, under the same rule.
 *
 * The chosen state lives in the address (?state=) like the tab does, so a reload or a shared link reopens it.
 * Per-step checkboxes keep progress in this browser (components/guides/progress.ts).
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle, Award, Briefcase, Building2, Calculator, CheckCircle2, CircleDollarSign, DollarSign, ExternalLink,
  FileText, Handshake, HardHat, Heart, Lightbulb, Lock, MapPin, Scale, Search, Shield, Star, Users, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EmptyState, Notice, Section, Stat, StatGrid } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiErrorMessage } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { PROGRESS_NOTE, progressLabel, useChecklist } from "@/components/guides/progress";
import { AccessChecking, AccessError, LockedModule, UnlockBadge } from "./gate";
import { LessonOutline, useScrollToHash, type LessonMeta } from "./lesson";
import { ModuleLessons } from "./lesson-body";
import type { ModuleHomeProps } from "./module-home";

const KEY = "mc:licensing";

/** GET /api/state-guides — the free comparison facts (server/state-guides.ts publicStateGuide). */
export type PublicStateGuide = {
  id: number;
  stateCode: string;
  stateName: string;
  sosName: string;
  licensingRequired: boolean | null;
  workersCompType: string | null;
  salesTaxOnLabor: boolean | null;
  bAndOTax: boolean | null;
  bondRequired: boolean | null;
  linksCheckedAt: string | null;
  stepCount: number;
  walkthrough: "written" | "checklist";
};

export type LinkStatus = "verified" | "unconfirmed" | "dead" | "none";

export type StateGuideStep = {
  id?: number;
  stepNumber: number;
  title: string;
  description: string;
  url: string | null;
  urlLabel: string | null;
  category: string;
  isRequired: boolean | null;
  tips: string | null;
  source?: "agency-data";
};

/** GET /api/state-guides/:code — the paid guide (403/401 without the module). */
export type StateGuideDetail = PublicStateGuide & {
  sosUrl: string | null;
  entityTypes: string[] | null;
  licensingBoardName: string | null;
  licensingBoardUrl: string | null;
  licensingNotes: string | null;
  workersCompAgency: string | null;
  workersCompUrl: string | null;
  taxBoardName: string | null;
  taxBoardUrl: string | null;
  gcBondAmount: string | null;
  specialtyBondAmount: string | null;
  insuranceNotes: string | null;
  payrollNotes: string | null;
  overview: string | null;
  sosUrlStatus?: LinkStatus | null;
  licensingBoardUrlStatus?: LinkStatus | null;
  workersCompUrlStatus?: LinkStatus | null;
  taxBoardUrlStatus?: LinkStatus | null;
  /** The walkthrough written for this state (server/data/state-guide-steps.json); empty for most states. */
  steps: StateGuideStep[];
  /** The checklist built from the state's agency records (server/state-guides.ts agencyChecklist). */
  checklist: StateGuideStep[];
};

export const WORKERS_COMP_LABEL: Record<string, string> = {
  state_fund: "State fund",
  state_fund_or_private: "State or private",
  private_or_state: "Private or state",
  private: "Private",
};
export const workersCompLabel = (type: string | null | undefined) => (type && WORKERS_COMP_LABEL[type]) || (type ? type.replace(/_/g, " ") : "—");

const CATEGORY_CONFIG: Record<string, { label: string; icon: LucideIcon }> = {
  formation: { label: "Business Formation", icon: Building2 },
  licensing: { label: "Licensing", icon: Shield },
  insurance: { label: "Insurance", icon: Heart },
  tax: { label: "Tax & Revenue", icon: Calculator },
  payroll: { label: "Payroll & Reporting", icon: Users },
};

export const BUSINESS_LESSONS: LessonMeta[] = [
  { id: "subcontractors", title: "Working with Subcontractors (1099)", icon: Handshake },
  { id: "sales", title: "Sales — The Most Important Role", icon: CircleDollarSign },
  { id: "reputation", title: "Reputation & Review Management", icon: Star },
  { id: "hiring", title: "Hiring & Staffing Strategy", icon: Users },
  { id: "branding", title: "Branding & Professional Image", icon: Award },
];

const checkedOn = (date: string | null | undefined) => (date ? new Date(`${date}T00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : null);

/**
 * One state-agency tile. Unlocked and with a checked URL it opens the agency; with no usable URL it is an honest
 * web search for the agency, never a guessed link. Locked, it shows the agency's role and a lock — the paid
 * guide holds the names and links.
 */
function AgencyTile({ icon: Icon, role, name, agency, url, status, stateName, unlocked, testid }: {
  icon: LucideIcon; role: string; name: string | null; agency: string; url: string | null;
  status?: LinkStatus | null; stateName: string; unlocked: boolean; testid: string;
}) {
  const usable = url && status !== "dead" ? url : null;
  const frame = "flex items-start gap-2 rounded-lg border bg-muted/30 p-3";
  const body = (
    <>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{role}</p>
        <p className="text-xs font-medium leading-snug [overflow-wrap:anywhere]">{unlocked ? (name || `Search for the ${agency}`) : "Unlocks with the guide"}</p>
        {unlocked && !usable && <p className="mt-0.5 text-[11px] text-muted-foreground">No checked link — searches the web</p>}
        {unlocked && usable && status === "unconfirmed" && <Badge variant="outline" className="mt-1 h-5 px-1.5 text-[10px] font-normal text-amber-700 dark:text-amber-400" title="The page didn't answer our automated check; the link is kept for you to try.">Link unconfirmed</Badge>}
      </div>
    </>
  );
  if (!unlocked) {
    return <div className={frame} data-testid={testid}>{body}<Lock className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /></div>;
  }
  const href = usable ?? `https://www.google.com/search?q=${encodeURIComponent(`${agency} ${stateName}`)}`;
  const title = usable
    ? `${name || agency} — opens the agency's site in a new tab.${status === "unconfirmed" ? " Our automated check couldn't confirm this page." : ""}`
    : `We don't have a checked link for the ${agency} — searches the web instead.`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={title} aria-label={title}
      className={cn(frame, "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")} data-testid={testid}>
      {body}
      {usable ? <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Search className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </a>
  );
}

function StateFlags({ g }: { g: PublicStateGuide }) {
  return (
    <div className="flex flex-wrap gap-2">
      {g.licensingRequired
        ? <Badge className="gap-1 bg-muted text-foreground hover:bg-muted"><Shield className="h-3 w-3" aria-hidden="true" /> License required</Badge>
        : <Badge variant="outline" className="gap-1"><AlertCircle className="h-3 w-3" aria-hidden="true" /> No state license</Badge>}
      {g.bondRequired && <Badge variant="secondary" className="gap-1"><Scale className="h-3 w-3" aria-hidden="true" /> Bond required</Badge>}
      {g.salesTaxOnLabor && <Badge variant="destructive" className="gap-1"><DollarSign className="h-3 w-3" aria-hidden="true" /> Tax on labor</Badge>}
      {g.bAndOTax && <Badge variant="outline" className="gap-1">B&amp;O tax</Badge>}
    </div>
  );
}

/** The ordered steps for a state with a checkbox per step: the written walkthrough, or the agency-record checklist. */
function StepList({ code, stateName, steps, written }: { code: string; stateName: string; steps: StateGuideStep[]; written: boolean }) {
  const list = useChecklist(`mc:state:${code}`);
  const done = steps.filter((s) => list.isDone(`step-${s.stepNumber}`)).length;
  return (
    <Section id="lesson-state-steps" className="scroll-mt-24" icon={Briefcase}
      title={written ? `Step-by-step walkthrough for ${stateName}` : `Checklist for ${stateName}`}
      description={<>{progressLabel(done, steps.length)} · {PROGRESS_NOTE}</>}
      actions={done > 0 ? <Button variant="ghost" size="sm" onClick={list.reset} data-testid="button-state-steps-reset">Reset</Button> : undefined}
      testId="section-state-steps">
      {written ? (
        <Notice tone="info" testId="notice-steps-written">A walkthrough written for {stateName}: every step names the agency, what it issues and what it costs where the state publishes a fee. Confirm fees and forms with the agency before you file; they change.</Notice>
      ) : (
        <Notice tone="info" title={`No walkthrough has been written for ${stateName} yet`} testId="notice-steps-checklist">
          This checklist is built from {stateName}'s agency records above — the agencies it names, their checked links and its license, bond and tax flags — and adds nothing those records don't say. Fees, forms and deadlines are the agency's to confirm.
        </Notice>
      )}
      <ol className="mt-3 space-y-3" data-testid="list-state-steps">
        {steps.map((step) => {
          const cat = CATEGORY_CONFIG[step.category] || CATEGORY_CONFIG.formation;
          const CatIcon = cat.icon;
          const id = `step-${step.stepNumber}`;
          const isDone = list.isDone(id);
          const boxId = `state-${code}-${id}`;
          return (
            <li key={id} className={cn("rounded-lg border bg-card p-4", isDone && "border-primary/40")} data-testid={`card-step-${step.stepNumber}`}>
              <div className="flex items-start gap-3">
                <label htmlFor={boxId} className="flex min-h-8 cursor-pointer items-center">
                  <Checkbox id={boxId} checked={isDone} onCheckedChange={(v) => list.toggle(id, v === true)} aria-label={`Mark step ${step.stepNumber} done`} data-testid={`checkbox-step-${step.stepNumber}`} />
                </label>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold tabular-nums">{step.stepNumber}</div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <h4 className={cn("text-sm font-semibold [overflow-wrap:anywhere]", isDone && "text-muted-foreground")}>{step.title}</h4>
                    <Badge variant="outline" className="gap-1 text-[10px]"><CatIcon className="h-2.5 w-2.5" aria-hidden="true" /> {cat.label}</Badge>
                    {step.isRequired ? <Badge className="bg-muted text-[10px] text-muted-foreground hover:bg-muted">Required</Badge> : <Badge variant="outline" className="text-[10px]">If it applies</Badge>}
                  </div>
                  <p className="mb-2 text-sm text-muted-foreground">{step.description}</p>
                  {step.tips && (
                    <div className="mb-2 flex items-start gap-2 rounded-md border border-border bg-muted p-2.5">
                      <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <p className="text-xs text-muted-foreground">{step.tips}</p>
                    </div>
                  )}
                  {step.url && (
                    <a href={step.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1.5 text-xs font-medium text-muted-foreground hover:underline" data-testid={`link-step-${step.stepNumber}`}>
                      <ExternalLink className="h-3 w-3" aria-hidden="true" /> {step.urlLabel || "Open the agency's page"}
                    </a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

export type StateGuideTabProps = ModuleHomeProps & {
  guides: PublicStateGuide[] | undefined;
  guidesStatus: "pending" | "error" | "success";
  guidesError: unknown;
  onRetryGuides: () => void;
  state: string | null;
  setState: (code: string | null) => void;
};

export function StateGuideTab(p: StateGuideTabProps) {
  const unlocked = p.access?.unlocked.licensing === true;
  const accessOk = p.accessStatus === "success";
  const code = (p.state || "").toUpperCase();
  const summary = p.guides?.find((g) => g.stateCode === code);
  const stateName = summary?.stateName ?? code;

  const detail = useQuery<StateGuideDetail>({
    queryKey: ["/api/state-guides", code],
    enabled: !!summary && unlocked && accessOk,
  });
  const lessons = useChecklist(KEY);
  const stepsList = useChecklist(`mc:state:${code}`);
  // The outline's "Your state's guide" entry is done when every step of the chosen state is.
  const stepTotal = detail.data ? (detail.data.steps.length || detail.data.checklist.length) : 0;
  const stepsDone = stepTotal > 0 && stepsList.count >= stepTotal;
  useEffect(() => { if (detail.data && code) lessons.toggle("state", stepsDone); }, [stepsDone, code, detail.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = accessOk && unlocked;
  useScrollToHash(open && (!code || detail.isSuccess));

  const outline: LessonMeta[] = [
    { id: "state", title: summary ? `Your state's guide — ${summary.stateName}` : "Your state's guide (pick a state)", icon: MapPin },
    ...BUSINESS_LESSONS,
  ];
  const writtenStates = p.guides?.filter((g) => g.walkthrough === "written").map((g) => g.stateName) ?? [];

  return (
    <div className="space-y-4 sm:space-y-6" data-testid="module-state-guide">
      <Section>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted" aria-hidden="true"><HardHat className="h-5 w-5 text-muted-foreground" /></span>
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold sm:text-lg">
              Business Formation &amp; Licensing
              {accessOk && (unlocked ? <UnlockBadge access={p.access} category="licensing" /> : <Badge variant="outline" className="gap-1 font-normal text-muted-foreground"><Lock className="h-3 w-3" aria-hidden="true" /> Locked</Badge>)}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick your state for the agencies that form, license, insure and tax a construction business there, with checked links; then the lessons on running the company.
              {writtenStates.length > 0 && <> {writtenStates.join(" and ")} also {writtenStates.length === 1 ? "has" : "have"} a written walkthrough; every other state gets a checklist built from its agency records.</>}
            </p>
          </div>
        </div>
      </Section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {p.guidesStatus === "pending" ? (
          <Skeleton className="h-10 w-full sm:w-72" aria-label="Loading the state list" />
        ) : (
          <Select value={code} onValueChange={(v) => p.setState(v)} disabled={!p.guides?.length}>
            <SelectTrigger className="w-full sm:w-72" aria-label="Your state" data-testid="select-state">
              <SelectValue placeholder="Select your state…" />
            </SelectTrigger>
            <SelectContent>
              {p.guides?.map((g) => (
                <SelectItem key={g.stateCode} value={g.stateCode}>{g.stateName}{g.walkthrough === "written" ? " · walkthrough" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {code && (
          <Button variant="ghost" size="sm" onClick={() => p.setState(null)} data-testid="button-clear-state">
            <X className="mr-1 h-4 w-4" aria-hidden="true" /> Clear
          </Button>
        )}
      </div>

      {p.guidesStatus === "error" && (
        <Notice tone="danger" title="Couldn't load the state list" testId="state-guides-error"
          action={<Button variant="outline" size="sm" onClick={p.onRetryGuides} data-testid="button-state-guides-retry">Try again</Button>}>
          {apiErrorMessage(p.guidesError)}
        </Notice>
      )}

      {p.accessStatus === "pending" && <AccessChecking />}
      {p.accessStatus === "error" && <AccessError error={p.accessError} onRetry={p.onRetryAccess} />}

      {accessOk && code && p.guides && !summary && (
        <Notice tone="warning" testId="notice-unknown-state">"{code}" isn't a state we have a guide for. Pick a state from the list.</Notice>
      )}

      {accessOk && !code && (
        <Section className="border-dashed" testId="state-guide-empty">
          <EmptyState icon={MapPin} title="Select your state" description="Choose a state above for its agencies, requirements and the ordered steps to start a construction business there." />
        </Section>
      )}

      {accessOk && summary && (
        <Section id="lesson-state" className="scroll-mt-24" testId="card-state-summary">
          <div className="mb-4 space-y-3">
            <h3 className="flex items-center gap-2 text-base font-semibold" data-testid="text-state-name">
              <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" /> {summary.stateName}
              {summary.walkthrough === "written" && <Badge variant="secondary" className="font-normal">Written walkthrough · {summary.stepCount} steps</Badge>}
            </h3>
            {unlocked && detail.data?.overview && <p className="max-w-2xl text-sm text-muted-foreground" data-testid="text-state-overview">{detail.data.overview}</p>}
            {!unlocked && <p className="max-w-2xl text-sm text-muted-foreground">The free facts for {summary.stateName}: whether it licenses contractors, requires a bond or taxes labor. The agencies, their links and the steps are in the full guide.</p>}
            <StateFlags g={summary} />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <AgencyTile icon={Building2} role="Form the entity" name={summary.sosName} agency={summary.sosName}
              url={detail.data?.sosUrl ?? null} status={detail.data?.sosUrlStatus} stateName={summary.stateName} unlocked={unlocked && !!detail.data} testid="link-agency-sos" />
            {summary.licensingRequired === false && detail.data && !detail.data.licensingBoardUrl && !detail.data.licensingBoardName ? (
              <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3" data-testid="link-agency-licensing">
                <Shield className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Get licensed</p>
                  <p className="text-xs font-medium leading-snug">No statewide license</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Check city, county and trade rules</p>
                </div>
              </div>
            ) : (
              <AgencyTile icon={Shield} role="Get licensed" name={detail.data?.licensingBoardName ?? null} agency="contractor licensing board"
                url={detail.data?.licensingBoardUrl ?? null} status={detail.data?.licensingBoardUrlStatus} stateName={summary.stateName} unlocked={unlocked && !!detail.data} testid="link-agency-licensing" />
            )}
            <AgencyTile icon={Heart} role="Workers' comp" name={detail.data?.workersCompAgency ?? null} agency="workers' compensation agency"
              url={detail.data?.workersCompUrl ?? null} status={detail.data?.workersCompUrlStatus} stateName={summary.stateName} unlocked={unlocked && !!detail.data} testid="link-agency-workers-comp" />
            <AgencyTile icon={Calculator} role="Taxes" name={detail.data?.taxBoardName ?? null} agency="department of revenue"
              url={detail.data?.taxBoardUrl ?? null} status={detail.data?.taxBoardUrlStatus} stateName={summary.stateName} unlocked={unlocked && !!detail.data} testid="link-agency-tax" />
          </div>
          {unlocked && detail.data && (
            <p className="mt-3 text-xs text-muted-foreground" data-testid="text-links-checked">
              {checkedOn(detail.data.linksCheckedAt) ? <>Agency links checked {checkedOn(detail.data.linksCheckedAt)}. </> : <>These agency links have not been through our link check yet. </>}
              A link marked <span className="text-amber-700 dark:text-amber-400">unconfirmed</span> didn't answer the automated check and is kept for you to try; a link that failed is replaced by a web search, never a guess.
            </p>
          )}
        </Section>
      )}

      {accessOk && summary && !unlocked && (
        <LockedModule what={`The full ${summary.stateName} guide`} module={p.module} moduleTitle="Business Formation & Licensing" access={p.access} onEnroll={p.onEnroll}>
          <Section title={`What's in the ${summary.stateName} guide`} icon={FileText} testId="card-state-included">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {["The filing office, licensing board, workers' comp and tax agencies, with checked links", "Entity types and the licensing, insurance and payroll notes", "Bond requirements and the amounts on file",
                summary.walkthrough === "written" ? `A walkthrough written for ${summary.stateName}: ${summary.stepCount} steps with links and tips` : `An ordered checklist built from ${summary.stateName}'s agency records`,
                "The lessons on subcontractors, sales, reputation, hiring and branding"].map((item) => (
                <div key={item} className="flex items-start gap-2 text-xs text-muted-foreground"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> {item}</div>
              ))}
            </div>
          </Section>
          <LessonOutline lessons={outline} storageKey={KEY} locked title="Lessons in this module" />
        </LockedModule>
      )}

      {accessOk && !code && !unlocked && (
        <LockedModule what="Each state's full guide and the business lessons" module={p.module} moduleTitle="Business Formation & Licensing" access={p.access} onEnroll={p.onEnroll}>
          <LessonOutline lessons={outline} storageKey={KEY} locked title="Lessons in this module" />
        </LockedModule>
      )}

      {open && summary && detail.isPending && (
        <Section testId="state-guide-loading">
          <p className="mb-3 text-sm text-muted-foreground" role="status">Loading the {summary.stateName} guide…</p>
          <div className="space-y-2" aria-hidden="true"><Skeleton className="h-16 w-full" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24 w-full" /></div>
        </Section>
      )}
      {open && summary && detail.isError && (
        <Notice tone="danger" title={`Couldn't load the ${summary.stateName} guide`} testId="state-guide-error"
          action={<Button variant="outline" size="sm" onClick={() => void detail.refetch()} data-testid="button-state-guide-retry">Try again</Button>}>
          {apiErrorMessage(detail.error)}
        </Notice>
      )}

      {open && summary && detail.data && (
        <>
          <StatGrid cols={5}>
            <Stat label="Entity types" value={detail.data.entityTypes?.length ?? "—"} hint={detail.data.entityTypes?.length ? detail.data.entityTypes.join(", ") : "not on file"} />
            <Stat label="State license" value={detail.data.licensingRequired ? "Required" : "None"} hint={detail.data.licensingRequired ? "statewide contractor license" : "local or trade rules may apply"} />
            <Stat label="Workers' comp" value={workersCompLabel(detail.data.workersCompType)} hint="how coverage is bought" />
            <Stat label="Tax on labor" value={detail.data.salesTaxOnLabor ? "Yes" : "No"} hint={detail.data.bAndOTax ? "sales tax on labor, plus a B&O tax" : "sales tax on labor"} />
            <Stat label="GC bond" value={detail.data.gcBondAmount || (detail.data.bondRequired ? "Required" : "None")} hint={detail.data.specialtyBondAmount ? `specialty ${detail.data.specialtyBondAmount}` : undefined} />
          </StatGrid>

          {detail.data.licensingNotes && (
            <Section title="Licensing details" icon={Shield} testId="card-licensing-notes"><p className="text-sm text-muted-foreground">{detail.data.licensingNotes}</p></Section>
          )}
          {detail.data.insuranceNotes && (
            <Section title="Insurance & workers' comp" icon={Heart} testId="card-insurance-notes"><p className="text-sm text-muted-foreground">{detail.data.insuranceNotes}</p></Section>
          )}
          {detail.data.payrollNotes && (
            <Section title="Payroll & tax reporting" icon={Users} testId="card-payroll-notes"><p className="text-sm text-muted-foreground">{detail.data.payrollNotes}</p></Section>
          )}

          <StepList code={code} stateName={summary.stateName} steps={detail.data.steps.length ? detail.data.steps : detail.data.checklist} written={detail.data.steps.length > 0} />
        </>
      )}

      {open && (
        <>
          <LessonOutline lessons={outline} storageKey={KEY} title="Lessons in this module" />
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-lg font-semibold"><Building2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> Building &amp; running your business</h3>
            <p className="text-sm text-muted-foreground">The way you structure your company — hiring, sales, branding, subcontractors — can make or break you, especially in the early stages. These lessons cover the operations most courses skip.</p>
          </div>

            <ModuleLessons module="licensing" lessons={BUSINESS_LESSONS} storageKey={KEY} open={open} />
        </>
      )}
    </div>
  );
}
