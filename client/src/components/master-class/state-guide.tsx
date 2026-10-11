/**
 * Module 1 — Business Formation & Licensing (/master-class?tab=state-guide&state=WA): one state's guide and the
 * lessons on running the business.
 *
 * What is free and what is paid follows the server (server/state-guides.ts): the state list carries only the
 * comparison facts, so a locked state shows its flags, its filing office and a locked tile for each other agency;
 * the full guide (agency links with their check status, notes, the written walkthrough or the checklist built
 * from the agency records) is fetched only once access is confirmed, and the server refuses it otherwise.
 *
 * The chosen state lives in the address (?state=) like the tab does, so a reload or a shared link reopens it.
 * Per-step checkboxes keep progress in this browser (components/guides/progress.ts).
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle, AlertTriangle, Award, Ban, Briefcase, Building2, Calculator, CheckCircle2, CircleDollarSign, Clock, DollarSign, ExternalLink,
  FileText, Handshake, HardHat, Heart, Lightbulb, Lock, MapPin, Phone, Scale, Search, Shield, Star, Target, Truck, Users, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EmptyState, Notice, Section, Stat, StatGrid } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiErrorMessage } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { PROGRESS_NOTE, progressLabel, useChecklist } from "@/components/guides/progress";
import { AccessChecking, AccessError, LockedModule, UnlockBadge } from "./gate";
import { Lesson, LessonOutline, useScrollToHash, type LessonMeta } from "./lesson";
import { AppLink, InApp, type ModuleHomeProps } from "./module-home";

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

    <Lesson id="subcontractors" title="Working with Subcontractors (1099)" icon={Handshake} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Using subs will always be easier than building a W-2 crew, but there are critical legal and operational realities you need to understand.
      </p>
      <div className="space-y-2">
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted border border-border">
          <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Insurance & Workers Comp:</strong> Every sub MUST carry their own insurance and workers comp. If they don't and one of their employees gets hurt on your jobsite, the liability falls back on YOU. Always verify their certificates of insurance (COIs) and make sure they're current.
          </p>
        </div>
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted border border-border">
          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Subcontractor Agreement:</strong> Create a contract stating they are responsible for their own employees, taxes, fees, and liability. This is your legal protection. Without it, you're exposed.
          </p>
        </div>
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted border border-border">
          <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">1099 Rule — No Schedule Dictation:</strong> You cannot dictate a sub's schedule. This is a hard legal requirement for 1099 classification. If you control when and how they work, the IRS can reclassify them as W-2 employees, exposing you to back taxes, penalties, and fines.
          </p>
        </div>
      </div>

      <h4 className="font-semibold text-sm mt-3">Quality vs. Efficiency Trade-off</h4>
      <p className="text-sm text-muted-foreground">
        Controlling quality is always harder with subs — it's a constant balance of quality vs. efficiency and less hands-on work. Most subs will NOT clean up jobsites or do the small things to cater to clients (covering furniture, cleaning up after themselves, communicating updates). These details always reflect on YOUR company, not the sub.
      </p>

      <h4 className="font-semibold text-sm mt-3">Keeping Subs Anonymous to Clients</h4>
      <p className="text-sm text-muted-foreground">
        Most clients don't like knowing a company uses subs — they hired YOU, not a mystery crew. Make sure subs keep this anonymous:
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
        {[
          "Subs should NOT wear their own logos or company decals on the jobsite",
          "Provide branded shirts and vehicle magnets with YOUR company logo",
          "Amazon does this with their delivery drivers — branded vans, branded uniforms",
          "Uber, Lyft, and FedEx all operate with 1099 contractors using company branding",
          "FedEx drivers use company trucks despite being classified as 1099",
          "There are gray areas in this space — but consistent branding is key to client trust"
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
            <span>{item}</span>
          </div>
        ))}
      </div>

      <h4 className="font-semibold text-sm mt-3">Non-Competes vs NDAs</h4>
      <p className="text-sm text-muted-foreground">
        Non-compete agreements have been largely abolished due to freedom of rights rulings. You can no longer force a sub to sign one. However, you CAN have them sign an <strong>NDA (Non-Disclosure Agreement)</strong> which limits who they can talk to — restricting them from sharing your client lists, pricing structures, operational processes, or contacting your clients directly. This is your best legal protection for keeping your business intelligence private.
      </p>
    </Lesson>

    <Lesson id="sales" title="Sales — The Most Important Role" icon={CircleDollarSign} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        The most important role in any construction business is <strong>SALES</strong>. Without sales, nothing else matters — not your crew, not your tools, not your license. Everything starts with closing jobs.
      </p>

      <div className="p-3 rounded-lg border border-border bg-muted">
        <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
          <Target className="h-4 w-4 text-muted-foreground" /> Close Rate Benchmarks
        </h4>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-lg font-semibold text-muted-foreground">33%+</p>
            <p className="text-[10px] text-muted-foreground">Great Sales (1 of 3)</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-yellow-500">20%</p>
            <p className="text-[10px] text-muted-foreground">Average</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-muted-foreground">&lt;15%</p>
            <p className="text-[10px] text-muted-foreground">Dangerous</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Anything below 15% is dangerous because of the cost of leads. At $50-150/lead, a low close rate can be financially devastating for a business.
        </p>
      </div>

      <h4 className="font-semibold text-sm mt-3">Hiring a Sales Rep</h4>
      <div className="space-y-2">
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted border border-border">
          <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Commission only — 8-10% of revenue minus sales tax.</strong> Do NOT put a sales rep on salary. This is a huge long-term exposure. Commission-only reps perform better because if they don't sell, they don't eat.
          </p>
        </div>
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted border border-border">
          <Lightbulb className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Poaching from competitors:</strong> This is what Elon Musk does — he recruits top talent from Microsoft and Google. Hiring a proven sales rep from a competitor saves you training time and they already know the trade. However, this is risky: they could flip on you, and they may have an NDA with their previous employer that could expose you legally. Always ask about prior arrangements before bringing them on.
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        <strong>Best places to recruit:</strong> Craigslist and Indeed are the best platforms to find a new sales rep or project manager. Post clear commission structures and expectations upfront.
      </p>

      <h4 className="font-semibold text-sm mt-3">Sales Tactics That Win Jobs</h4>
      <div className="space-y-2">
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted border border-border">
          <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Never say you're available same day — even if you are.</strong> Schedule estimates 1-2 days ahead. If you show up immediately, the client assumes you're not busy, which signals you don't have much work. A slight wait creates perceived demand and makes them value your time more.
          </p>
        </div>
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted border border-border">
          <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Stay in constant contact while bidding.</strong> Out of sight, out of mind — and that's deadly during the bidding process. Follow up after the estimate, send a thank-you text or email, check in 2-3 days later. Most contractors give a bid and disappear. The one who stays top of mind wins the job.
          </p>
        </div>
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted border border-border">
          <Award className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Differentiate yourself from the competition.</strong> Every homeowner is getting 3-5 bids. If your estimate looks like everyone else's — a number scribbled on a piece of paper — you blend in. Present a professional proposal with your branding, scope of work, timeline, warranty details, and photos of past work. Make it impossible for the client to compare you to the guy in a beat-up truck with a handwritten quote.
          </p>
        </div>
      </div>

      <h4 className="font-semibold text-sm mt-3">Avoid High-Pressure Sales Tactics</h4>
      <p className="text-sm text-muted-foreground">
        Don't fall into the trap of sleazy one-call-close tactics — "sign today or lose the price" pressure selling. High-pressure sales is an art form that takes years to master, and if you don't know what you're doing, it will backfire badly. You'll lose the sale, damage your reputation, and potentially earn a bad review that costs you far more than the job was worth. Homeowners talk to each other, post in neighborhood groups, and share experiences online. One pushy encounter can label your company as "aggressive" or "scammy" in an entire community. Instead, focus on building trust through professionalism, clear communication, and honest timelines. Let the quality of your proposal and follow-up do the selling — the best closers in construction don't need to pressure anyone because they've already built enough confidence during the estimate.
      </p>
    </Lesson>

    <Lesson id="reputation" title="Reputation & Review Management" icon={Star} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Your online reputation is the single most valuable asset in your business — more important than your trucks, your tools, or even your crew. Every decision you make with a client should be filtered through this question: <strong>"Is this worth risking a bad review?"</strong>
      </p>

      <div className="p-3 rounded-lg border border-border bg-muted">
        <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" /> The Real Cost of Bad Reviews
        </h4>
        <div className="grid grid-cols-2 gap-3 text-center mb-3">
          <div className="p-2 rounded border border-border">
            <p className="text-lg font-semibold text-muted-foreground">10-15%</p>
            <p className="text-[10px] text-muted-foreground">Business loss per year from a single bad review</p>
          </div>
          <div className="p-2 rounded border border-border">
            <p className="text-lg font-semibold text-muted-foreground">20-50%</p>
            <p className="text-[10px] text-muted-foreground">Business loss from damaging reviews (scam, abandoned job, etc.)</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          A standard negative review — "slow communication" or "went over budget" — will cost you roughly 10-15% of your annual revenue. But devastating reviews that use words like <strong>"walked off the job," "didn't finish the work," "ripped us off,"</strong> or <strong>"scammers"</strong> can destroy 20-50% of your business. These are the reviews that kill companies, because the number one thing a customer looks for in reviews is <strong>trustworthiness</strong>. Quality matters, but trust comes first — if a company looks untrustworthy, they're not getting the job no matter how good their work is.
        </p>
      </div>

      <h4 className="font-semibold text-sm mt-3">Resolve Disputes on Their Merits</h4>
      <p className="text-sm text-muted-foreground">
        Resolve unfinished work and disputes according to the contract and the customer's concerns. Keep that process separate from review requests. Ask every client for honest feedback, with no reward or preferred rating.
      </p>
      <div className="space-y-2 mt-2">
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted border border-border">
          <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Fix it first, then ask — with no strings attached.</strong> If a client has a remaining $500-1,000 complaint, resolve it because it's the right call, not as payment for a review. Afterward, ask for an honest review exactly as you would any client. Never make the fix, a discount, or any reward conditional on a review or its star rating — Google removes incentivized reviews, and the FTC's consumer-review rule (16 CFR Part 465) carries civil penalties for buying positive reviews. A client whose problem you solved often writes the best review you'll get anyway.
          </p>
        </div>
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted border border-border">
          <Ban className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Never get into a pissing contest with a client.</strong> You will always lose. Even if you're right, even if the client is being unreasonable — the public will side with the homeowner every time. A back-and-forth argument in Google Reviews makes you look petty and unprofessional. Responding to negative reviews should be calm, professional, and focused on resolution — never defensive or combative.
          </p>
        </div>
      </div>

      <h4 className="font-semibold text-sm mt-3">What Clients Actually Look For in Reviews</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
        {[
          { rank: "1", trait: "Trustworthiness", desc: "Did they do what they said? Did they show up? Did they finish? This is the #1 filter and the reason 'scam' reviews are devastating", weight: "text-muted-foreground" },
          { rank: "2", trait: "Communication", desc: "Did they keep the client in the loop? Were they responsive? Did they return calls and texts promptly?", weight: "text-muted-foreground" },
          { rank: "3", trait: "Quality of Work", desc: "Was the craftsmanship good? Did they pay attention to details? Were there callbacks or warranty issues?", weight: "text-yellow-500" },
          { rank: "4", trait: "Timeline & Reliability", desc: "Did they start and finish on time? Were there unexplained delays? Did they manage expectations?", weight: "text-muted-foreground" },
          { rank: "5", trait: "Cleanliness & Respect", desc: "Did they protect the property? Clean up daily? Treat the home and family with respect?", weight: "text-muted-foreground" },
          { rank: "6", trait: "Price Fairness", desc: "Was pricing transparent? Were there surprise charges? Interestingly, price is one of the least-mentioned traits in positive reviews", weight: "text-muted-foreground" },
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-md border border-border/30">
            <div className={`w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-semibold ${item.weight} shrink-0`}>{item.rank}</div>
            <div>
              <p className="text-xs font-semibold">{item.trait}</p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 p-3 rounded-md bg-muted border border-border mt-2">
        <Lightbulb className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium mb-1">The Math That Should Change How You Handle Every Client</p>
          <p className="text-xs text-muted-foreground">
            If your business does $500K/year and a single bad review costs you 10-15%, that's $50,000-$75,000 in lost revenue — every year it sits there. A devastating "scam" or "abandoned job" review at 20-50% impact is $100,000-$250,000 per year. Now compare that to the $500-1,000 of disputed work you're arguing about. The math is not even close. Resolve the dispute fairly, document the agreed outcome, and keep any request for an honest review separate.
          </p>
        </div>
      </div>

      <h4 className="font-semibold text-sm mt-3">Handling Difficult Clients</h4>
      <p className="text-sm text-muted-foreground">
        Some clients will never be satisfied — no matter how good your work is, how many extras you throw in, or how many times you come back to fix things. These clients exist in every market, and you need to recognize them early. Their goal may be to get free work, negotiate after the fact, or simply find fault with everything. Some are looking for blood from the start, and you may be their chosen victim before you even pick up a hammer.
      </p>

      <div className="space-y-2 mt-2">
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted border border-border">
          <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">The goal is always the same: walk away without a lawsuit or a bad review.</strong> You won't win every client relationship, but you can control how it ends. A clean exit — where the client feels heard and you part on neutral terms — is worth more than being "right." Standing your ground with a difficult client is not a winning approach. Pride has no ROI in this business.
          </p>
        </div>
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted border border-border">
          <Shield className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Never get personal — no politics, religion, personal views, or opinions.</strong> Keep every interaction 100% professional and focused on the work. Even casual small talk can turn dangerous. If a client brings up a topic you disagree with — don't engage, don't push back, don't even hint at your position. They may seem fine in the moment, but disagreements plant seeds of resentment that surface later as "difficult to work with" reviews or refusal to pay. You are there to build, not to debate.
          </p>
        </div>
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted border border-border">
          <Handshake className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Always be agreeable — stay neutral, stay relevant, stay professional.</strong> Even when the client is wrong about a construction method, a timeline, or a material choice — correct them with facts, not attitude. "I totally understand why you'd think that, and here's what we've found works best..." will always land better than "That's not how it works." Agreeable doesn't mean pushover — it means you control the conversation without creating conflict. The contractors who build the biggest businesses are the ones who know how to manage people, not just projects.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
        <div className="p-2.5 rounded-md border border-border/30">
          <p className="text-xs font-semibold text-muted-foreground mb-1">Red Flags of a Problem Client</p>
          <div className="space-y-1">
            {[
              "Mentions lawsuits or attorneys early in the process",
              "Has left multiple 1-star reviews for other businesses",
              "Constantly compares your pricing to other bids",
              "Wants to negotiate the price after work has started",
              "Refuses to sign a contract or put anything in writing",
              "Changes scope repeatedly without acknowledging cost changes",
              "Becomes overly friendly too fast — could be setting you up for a favor later",
            ].map((flag, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                <X className="h-2.5 w-2.5 text-muted-foreground shrink-0 mt-0.5" />
                <span>{flag}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="p-2.5 rounded-md border border-border/30">
          <p className="text-xs font-semibold text-muted-foreground mb-1">How to De-Escalate & Exit Clean</p>
          <div className="space-y-1">
            {[
              "Document everything — texts, emails, photos of completed work",
              "Communicate in writing, not just phone calls or in-person",
              "Offer a resolution before they escalate — be the bigger person",
              "If they want free work, trade it for a written positive review",
              "Never raise your voice, curse, or get emotional on a jobsite",
              "If it's unsalvageable, offer a partial refund to close the chapter",
              "Consult your attorney before walking off any job mid-contract",
            ].map((tip, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                <CheckCircle2 className="h-2.5 w-2.5 text-muted-foreground shrink-0 mt-0.5" />
                <span>{tip}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <InApp>Review requests, reminders and replies — including AI drafts for your approval — run from <AppLink href="/google-reviews">Google Reviews</AppLink>; the Google Business module covers the profile side.</InApp>
    </Lesson>

    <Lesson id="hiring" title="Hiring & Staffing Strategy" icon={Users} storageKey={KEY} contentClassName="space-y-3">
      <div className="flex items-start gap-2 p-2.5 rounded-md bg-muted border border-border">
        <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">Avoid hiring too fast.</strong> In the early stages, do NOT hire a ton of help like PMs or secretaries. The majority of the work will fall back on you regardless. Every salary you add is overhead that eats into margins before you have consistent revenue to support it.
        </p>
      </div>

      <h4 className="font-semibold text-sm mt-3">Project Managers (PMs)</h4>
      <p className="text-sm text-muted-foreground">
        Your PM is the most trusted person in the operation. In the beginning, this should be YOU. Don't rush to fill this role until the workload is genuinely too large to keep up with.
      </p>
      <div className="p-3 rounded-lg border border-border/40 bg-muted/30">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Typical PM Salary</p>
            <p className="text-sm font-semibold">$45,000 – $75,000/yr</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Depends On</p>
            <p className="text-sm font-semibold">Experience & Scope</p>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Incentivize PMs with performance bonuses, paid time off, and potentially a company vehicle. But don't buy assets you can't afford — if you're not closing enough work to support it, a company truck becomes a liability, not a perk.
      </p>
    </Lesson>

    <Lesson id="branding" title="Branding & Professional Image" icon={Award} storageKey={KEY} contentClassName="space-y-3">
      <p className="text-sm text-muted-foreground">
        Creating the illusion of size is critical for customer trust. Clients want to know they're hiring a real company that isn't going anywhere — not a one-person operation that might disappear.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {[
          { icon: Truck, text: "Have at least a few company vehicles with a full wrap — this signals permanence and professionalism" },
          { icon: Users, text: "All reps should wear branded uniforms — never trashy clothes, even if you're doing physical work" },
          { icon: Shield, text: "Clients want to know they'll be taken care of by a company with staff, even if you're running lean" },
          { icon: Building2, text: "If you're owner-operator, never tell the client you're the owner — say you're a PM or sales rep" },
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-2 p-2.5 rounded-md border border-border/30">
            <item.icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">{item.text}</p>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 p-3 rounded-md bg-muted border border-border mt-2">
        <Lightbulb className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium mb-1">Why Separation Between You and the Brand Matters</p>
          <p className="text-xs text-muted-foreground">
            If a client knows you're the owner doing the install, they take you less seriously. There should be a clear separation between you and the brand. Tell them you're the PM or the sales rep — it creates a perception of structure, hierarchy, and accountability that makes clients feel safer about their investment. They want to see a company with departments, not a solo operator with a pickup truck.
          </p>
        </div>
      </div>
    </Lesson>

    <Section flush className="border-border bg-muted" testId="card-business-structure-summary">
      <CardContent className="p-4">
        <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-muted-foreground" /> The Bottom Line on Business Structure
        </h4>
        <p className="text-sm text-muted-foreground">
          How your company is structured can make you or break you, especially in the early stages. Keep overhead low, use subs strategically with proper contracts, hire sales commission-only, don't rush into salaried positions, and always project a professional image. The companies that survive year one are the ones that sell well and spend smart — not the ones that hire fastest.
        </p>
      </CardContent>
    </Section>
        </>
      )}
    </div>
  );
}
