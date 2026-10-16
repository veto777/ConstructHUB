import { AgencyWorkspace } from "@/components/agency-workspace";
import { PublicPageHeader } from "@/components/public-page-chrome";
import {
  FixChecklist,
  ReportFilters,
  initialReportFilters,
} from "@/components/site-scan-fixes";
import { ScanIndexingSummary } from "./site-connections";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { emptyCategoryMessage, ownLocation } from "@/components/site-scan-helpers";
import { Switch } from "@/components/ui/switch";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppPage, Notice } from "@/components/app-ui";
import { GoogleAiOverview, GoogleSectionHeader, GoogleList, GoogleListRow, GooglePill } from "@/components/google";
import { MetricStrip, StatCell, StatusBadge, scoreTone } from "@/components/tool";
import { SamplePreview, showSample } from "@/components/sample-preview";
import { HelpButton } from "@/components/help-button";
import { cn } from "@/lib/utils";
import { ChevronRight, Download, ExternalLink, Search, Trash2 } from "lucide-react";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import { useUrlParam } from "@/hooks/use-url-param";
import { useToolView } from "@/hooks/use-tool-view";
import { useInToolShell } from "@/components/tool/in-shell";
import { SITE_SCAN_VIEWS } from "@/components/website-tool/nav";
const api = async (method: string, url: string, body?: unknown) =>
  (await apiRequest(method, url, body)).json();
// Google's rounded field shape for the native selects (the surface supplies the hairline colour).
const selectClass =
  "h-10 w-full rounded-full border bg-background px-4 text-sm sm:w-auto";
const categoryLabel: Record<string, string> = {
  overall: "Overall",
  local: "Local",
  content: "Content",
  technical: "Technical",
  performance: "Performance",
  "ai-readiness": "AI Readiness",
};
const labelFor = (key: string) =>
  categoryLabel[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
// Colour follows the label actually shown: guidance impact when present, else severity.
const toneClass: Record<string, string> = {
  critical: "text-red-600",
  warning: "text-amber-600",
  info: "text-sky-600",
  High: "text-red-600",
  Medium: "text-amber-600",
  Low: "text-sky-600",
};
const labMetricLabel: Record<string, string> = {
  "largest-contentful-paint": "Largest Contentful Paint",
  "cumulative-layout-shift": "Cumulative Layout Shift",
  "total-blocking-time": "Total Blocking Time",
  "speed-index": "Speed Index",
  "total-byte-weight": "Total page weight",
  "uses-optimized-images": "Image optimization",
  "uses-responsive-images": "Responsive images",
};
function fieldMetric(key: string, m: any) {
  const name = key
    .replace(/_(MS|SCORE)$/, "")
    .toLowerCase()
    .replace(/_/g, " ");
  const value =
    typeof m?.percentile !== "number"
      ? ""
      : key.endsWith("_MS") ||
          // CrUX reports these in milliseconds without the _MS suffix.
          ["INTERACTION_TO_NEXT_PAINT", "EXPERIMENTAL_TIME_TO_FIRST_BYTE"].includes(key)
        ? ` (75th percentile ${m.percentile} ms)`
        : key === "CUMULATIVE_LAYOUT_SHIFT_SCORE"
          ? ` (75th percentile ${(m.percentile / 100).toFixed(2)})`
          : ` (75th percentile ${m.percentile})`;
  return `${name.charAt(0).toUpperCase() + name.slice(1)}: ${m?.category ?? "no rating"}${value}`;
}
function PageSpeedDetails({ psi }: { psi: any[] }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium">
        PageSpeed measurements and field data
      </summary>
      <div className="mt-2 space-y-3 text-sm">
        {psi.map((p: any, i: number) => (
          <div key={i} className="space-y-1 border-b py-3 last:border-b-0">
            <p className="break-all font-medium">
              {p.strategy === "desktop"
                ? "Desktop"
                : p.strategy === "mobile"
                  ? "Mobile"
                  : "PageSpeed"}
              {p.url ? ` · ${p.url}` : ""}
            </p>
            {p.unavailable ? (
              <p className="text-muted-foreground">
                PageSpeed data unavailable: {p.unavailable}
              </p>
            ) : (
              <>
                <p>
                  Performance score:{" "}
                  {typeof p.score === "number" ? p.score : "Not reported"}
                </p>
                {p.lab && (
                  <ul className="list-disc pl-5">
                    {Object.entries(p.lab).map(([k, v]: [string, any]) => (
                      <li key={k}>
                        {labMetricLabel[k] ?? k}:{" "}
                        {v?.display ?? v?.value ?? "Not reported"}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-muted-foreground">
                  {p.field
                    ? "Real-user field data (this page):"
                    : p.originField
                      ? "No real-user data for this page; site-wide field data:"
                      : "No real-user field data reported by Google for this page or site."}
                </p>
                {(p.field || p.originField) && (
                  <ul className="list-disc pl-5">
                    {Object.entries(p.field || p.originField).map(
                      ([k, m]: [string, any]) => (
                        <li key={k}>{fieldMetric(k, m)}</li>
                      ),
                    )}
                  </ul>
                )}
              </>
            )}
          </div>
        ))}
        <details>
          <summary className="cursor-pointer text-sm">Raw data</summary>
          <pre className="whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(psi, null, 2)}
          </pre>
        </details>
      </div>
    </details>
  );
}
/** History and location picker page size; sent to the server so both page the same way. */
const PAGE_SIZE = 25;
const whole = (value: string, min: number, max: number) =>
  /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;
function canonicalUrl(value: string) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return value;
  }
}
const severityOrder: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};
function Copy({ text, label = "Copy draft" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState<"" | "done" | "failed">("");
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          // Blocked or unavailable clipboard access must not look like a copy.
          try {
            await navigator.clipboard.writeText(text);
            setCopied("done");
          } catch {
            setCopied("failed");
          }
        }}
      >
        {copied === "done" ? "Copied" : label}
      </Button>
      {copied === "failed" && (
        <span role="alert" className="text-sm text-red-600">
          Could not copy: your browser blocked clipboard access. Select the
          text and copy it manually.
        </span>
      )}
    </>
  );
}
const pageCount = (n: number) => `${n} ${n === 1 ? "page" : "pages"}`;
/** A scan's state in the history, in plain words. */
const SCAN_STATUS_WORDS: Record<string, string> = { queued: "Waiting to start", running: "Scanning", completed: "Done", failed: "Failed" };
/** The scored categories as the history card lines them up (the report's own order). */
const CATEGORY_CELLS: [string, string][] = [["technical", "Technical"], ["content", "Content"], ["local", "Local"], ["performance", "Performance"], ["ai-readiness", "AI readiness"]];
/**
 * Made-up scans for the sample preview of an empty history: the same site twice, so the card shows a score and its
 * move. Shown only while the account has no scan at all; never stored or sent (components/sample-preview.tsx).
 */
const SAMPLE_SCANS = [
  { id: "sample-2", url: "https://sample-roofing.example", status: "completed", created_at: "2026-10-01T15:00:00Z", pages: 42, page_cap: 150, client: "Sample Roofing Co.", scores: { overall: 78, categories: { technical: 84, content: 71, local: 69, performance: 80, "ai-readiness": 74 } } },
  { id: "sample-1", url: "https://sample-roofing.example", status: "completed", created_at: "2026-09-01T15:00:00Z", pages: 40, page_cap: 150, client: "Sample Roofing Co.", scores: { overall: 71, categories: { technical: 76, content: 68, local: 62, performance: 75, "ai-readiness": 70 } } },
];
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

/**
 * A number the scan needs, with the usual values as quick picks: the field itself takes any other value (owner's rule,
 * 2026-10-15: a fixed list of choices always accepts a typed value too). The value stays a string while typing so
 * clearing the field does not become 0.
 */
function NumberField({ id, label, value, onChange, min, max, presets, unit, hint, invalid, testId }: {
  id: string; label: string; value: string; onChange: (v: string) => void; min: number; max: number;
  presets: (number | { value: number; label: string })[]; unit: string; hint: string; invalid: boolean; testId?: string;
}) {
  return (
    <div className="space-y-1.5 text-sm">
      <label htmlFor={id} className="block g-text-2">{label}</label>
      <div className="flex flex-wrap items-center gap-2">
        <Input id={id} type="number" inputMode="numeric" min={min} max={max} value={value} aria-invalid={invalid} onChange={(e) => onChange(e.target.value)} className="h-10 w-24 tabular-nums" data-testid={testId} />
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => {
            const v = typeof p === "number" ? p : p.value, word = typeof p === "number" ? String(p) : p.label;
            return <GooglePill key={v} size="sm" selected={value === String(v)} ariaPressed={value === String(v)} label={word} ariaLabel={typeof p === "number" ? `${v} ${unit}` : `${word} (${v} ${unit})`} onClick={() => onChange(String(v))} />;
          })}
        </div>
      </div>
      <p className="text-xs g-text-2">{hint}</p>
    </div>
  );
}

/** One step of the "How this works" card. */
function HowStep({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <div className="tool-stat">
      <div className="tool-stat__label">Step {n}</div>
      <h3 className="text-[14px] font-semibold leading-5" style={{ color: "var(--tool-text)" }}>{title}</h3>
      <p className="tool-stat__note">{text}</p>
    </div>
  );
}

/**
 * One scan in the history, in the SEO Suite's card language (components/tool): the site, when it ran and for whom,
 * its state, then the overall score with its move since the scan before and each category's score. A scan that is
 * still running or failed says so in place of the figures. Without `onOpen` the card is a picture (the sample).
 */
function ScanCard({ job, prior, selected, onOpen }: { job: any; prior: any | null; selected?: boolean; onOpen?: () => void }) {
  const overall = typeof job.scores?.overall === "number" ? job.scores.overall : null;
  const before = typeof prior?.scores?.overall === "number" ? prior.scores.overall : null;
  const running = ["queued", "running"].includes(job.status);
  const when = new Date(job.created_at).toLocaleDateString();
  return (
    <section className={cn("tool-panel", selected && "outline outline-2 outline-[color:var(--tool-accent)]")} aria-current={selected ? "true" : undefined} data-testid={`card-scan-${job.id}`}>
      <div className="tool-panel__head">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded text-[13px] font-semibold uppercase" style={{ color: "var(--tool-accent-ink)", background: "color-mix(in srgb, var(--tool-accent) 14%, transparent)" }} aria-hidden>{hostOf(job.url)[0]}</span>
        <div className="min-w-0">
          <h3 className="tool-panel__title">
            {onOpen ? <button type="button" className="tool-link text-left [overflow-wrap:anywhere]" onClick={onOpen} aria-label={`${job.url} — open this scan's report`}>{job.url}</button> : job.url}
          </h3>
          <p className="tool-muted text-[12px]">{when}{job.client ? ` · ${job.client}` : ""}{typeof job.pages === "number" ? ` · ${pageCount(job.pages)} checked${job.page_cap ? ` of up to ${job.page_cap}` : ""}` : ""}</p>
        </div>
        <span className="tool-chip">{SCAN_STATUS_WORDS[job.status] ?? job.status}</span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <a href={job.url} target="_blank" rel="noopener noreferrer" className="tool-btn tool-btn--icon tool-btn--quiet" aria-label={`Open ${hostOf(job.url)} in a new tab`} title="Open the website" tabIndex={onOpen ? undefined : -1}><ExternalLink aria-hidden /></a>
          {onOpen && <button type="button" className="tool-btn" onClick={onOpen} aria-current={selected ? "true" : undefined}>{selected ? "Showing below" : "Open report"}</button>}
        </div>
      </div>
      {job.status === "completed" && job.scores ? (
        <MetricStrip cols={[2, 3, 6]}>
          <StatCell label="Overall score" testId={`metric-overall-${job.id}`} value={overall === null ? null : <StatusBadge tone={scoreTone(overall)} size="lg">{overall}</StatusBadge>} none="Not scored"
            delta={before === null || overall === null ? null : { value: overall - before, period: "since the scan before", format: (n) => String(n) }}
            note={before === null ? "First scored scan of this site" : `Scan before: ${before}`} />
          {CATEGORY_CELLS.map(([k, label]) => (
            <StatCell key={k} label={label} value={typeof job.scores.categories?.[k] === "number" ? String(job.scores.categories[k]) : null}
              none={k === "performance" ? "Not scored: PageSpeed was off or unavailable" : "Not scored"} />
          ))}
        </MetricStrip>
      ) : (
        <p className="tool-panel__body text-sm g-text-2" role={job.status === "failed" ? "alert" : undefined}>
          {running ? "Scanning — the scores appear here when it finishes." : job.error || "The scan did not finish."}
        </p>
      )}
    </section>
  );
}
export function ScanReport({
  report,
  draft,
  summary = false,
  onDone,
  surface = false,
  actions,
  filters,
}: {
  report: any;
  draft?: string;
  summary?: boolean;
  onDone?: (keys: string[], done: boolean) => void;
  /** Inside the signed-in Google surface: the AI draft takes the AI-Overview block (the public pages have no surface tokens). */
  surface?: boolean;
  /** Report actions and filters, shown right after the scores (scores always come first). */
  actions?: ReactNode;
  /** The findings filters in effect, so an empty category says whether it is empty or just elsewhere. */
  filters?: { q?: string; category?: string };
}) {
  if (!report) return null;
  return (
    <div className="space-y-5">
      {!summary && !report.version && (
        <p className="text-sm text-muted-foreground">
          Older report: rescan to add cited guidance, evidence, platform steps
          and verified fix tracking.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Object.entries({
          overall: report.scores.overall,
          ...report.scores.categories,
        }).map(([name, value]) => (
          <div key={name} className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">
              {labelFor(name)}
            </div>
            <div className="mt-1 text-xl font-normal leading-6 tabular-nums">
              {value === null ? "N/A" : String(value)}
            </div>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {pageCount(report.pages)} checked.{" "}
        {summary
          ? "Preview shows up to five findings. Verify your email for all findings and coverage details."
          : `${report.remaining || 0} ${report.remaining === 1 ? "URL remains" : "URLs remain"} outside this report.`}{" "}
        Scores describe observed checks, not search rankings.
      </p>
      {report.scoreExplanation && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            What raised or lowered these scores?
          </summary>
          {Object.entries(report.scoreExplanation).map(([k, v]) => (
            <p key={k} className="my-2 text-sm">
              <strong>{labelFor(k)}:</strong> {String(v)}
            </p>
          ))}
        </details>
      )}
      {report.scores.categories.performance === null && (
        <div role="note" className="rounded-lg border p-4 text-sm">
          <strong>Why Performance is N/A</strong>
          {report.psi?.map((p: any, i: number) => (
            <p key={i} className="mt-1 text-muted-foreground">
              {p.strategy ? `${p.strategy}: ` : ""}
              {p.unavailable || "No measurement returned"}
            </p>
          ))}
          {!report.psi?.length && (
            <p className="mt-1 text-muted-foreground">
              No PageSpeed measurement was returned for this scan.
            </p>
          )}
          {!summary && (
            <p className="mt-1 text-muted-foreground">
              {report.psi?.some((p: any) =>
                ["no_key", "configuration"].includes(p.reason),
              )
                ? "Page speed measuring isn't switched on yet; the rest of the scan is complete. Use Rescan / retry PageSpeed later."
                : "Use Rescan / retry PageSpeed to measure again."}
            </p>
          )}
        </div>
      )}
      {actions}
      {["technical", "performance", "local", "content", "ai-readiness"]
        // A Category filter lists only that category; the others are not "empty", just filtered out.
        .filter((category) => !filters?.category || filters.category === category)
        .map(
        (category) => (
          <section key={category}>
            <h2 className="border-b pb-2 text-xl font-normal leading-6">
              {labelFor(category)}
            </h2>
            <div className="divide-y">
              {report.findings
                .filter((f: any) => f.category === category)
                .sort(
                  (a: any, b: any) =>
                    (a.guidance
                      ? (
                          { High: 0, Medium: 1, Low: 2 } as Record<
                            string,
                            number
                          >
                        )[a.guidance.impact]
                      : severityOrder[a.severity]) -
                    (b.guidance
                      ? (
                          { High: 0, Medium: 1, Low: 2 } as Record<
                            string,
                            number
                          >
                        )[b.guidance.impact]
                      : severityOrder[b.severity]),
                )
                .map((f: any) => (
                  <article
                    key={f.id}
                    className="space-y-2 py-4"
                  >
                    <h3 className="text-base font-medium leading-6">
                      <span
                        className={
                          toneClass[
                            f.guidance ? f.guidance.impact : f.severity
                          ] ?? "text-muted-foreground"
                        }
                      >
                        {f.guidance
                          ? `${f.guidance.impact.toUpperCase()} IMPACT`
                          : f.severity.toUpperCase()}
                      </span>{" "}
                      · {f.title}
                    </h3>
                    <p className="text-sm">
                      <strong>Why it matters for SEO:</strong>{" "}
                      {f.guidance
                        ? `${f.guidance.impact} impact — ${f.guidance.reason}`
                        : f.why}
                    </p>
                    {f.guidance && (
                      <>
                        <a
                          className="block text-sm text-primary underline"
                          href={f.guidance.source}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Authoritative guidance:{" "}
                          {new URL(f.guidance.source).hostname}
                        </a>
                        <ol className="list-decimal pl-5 text-sm text-muted-foreground">
                          {f.guidance.steps.map((step: string, i: number) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                      </>
                    )}
                    <p className="text-sm">
                      {!f.guidance && (
                        <>
                          <strong>How to fix:</strong> {f.fix}
                        </>
                      )}
                    </p>
                    <details>
                      <summary className="cursor-pointer text-sm">
                        Affected URLs ({f.urls.length})
                      </summary>
                      <ul className="break-all text-sm text-muted-foreground">
                        {f.urls.map((url: string) => (
                          <li key={url}>{url}</li>
                        ))}
                      </ul>
                    </details>
                  </article>
                ))}
              {!report.findings.some((f: any) => f.category === category) && (
                <p className="py-3 text-sm text-muted-foreground">
                  {summary
                    ? "Verify your email to see all findings in this category."
                    : category === "performance" &&
                        report.scores.categories.performance === null
                      ? "Not scored: PageSpeed data was unavailable for this scan (see Why Performance is N/A above)."
                      : emptyCategoryMessage({
                          shown: report.findings.length,
                          total: report.findingTotal,
                          offset: report.offset,
                          searching: !!filters?.q,
                        })}
                </p>
              )}
            </div>
          </section>
        ),
      )}
      {!summary && <FixChecklist report={report} onDone={onDone} />}
      {!summary && (
        <p className="text-sm text-muted-foreground">
          {report.profile
            ? `GBP comparison: ${report.profile.business_name}; profile last synced ${new Date(report.profile.synced_at).toLocaleString()}.`
            : "No synced GBP profile: NAP, service and service-area comparisons were not assessed."}
        </p>
      )}
      {report.psi?.length > 0 && <PageSpeedDetails psi={report.psi} />}
      {report.jsonLdDraft && (
        <section>
          <div className="border-b pb-3">
            <h2 className="text-xl font-normal leading-6">GBP JSON-LD draft</h2>
            <p className="mt-1 text-sm text-muted-foreground">Review for accuracy before publishing. Unknown values are omitted.</p>
          </div>
          <div className="mt-3"><Copy text={JSON.stringify(report.jsonLdDraft, null, 2)} /></div>
          <pre className="mt-3 whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(report.jsonLdDraft, null, 2)}
          </pre>
        </section>
      )}
      {draft && surface ? (
        /* Our own AI-generated plan, in the AI-Overview block (never a claim of Google's). */
        <GoogleAiOverview
          label="AI fix plan — draft"
          footnote="Review every claim before publishing. This has not been applied to your website."
          actions={<Copy text={draft} />}
          testId="ai-fix-plan"
        >
          <pre className="whitespace-pre-wrap break-all font-sans text-base leading-7">
            {draft}
          </pre>
        </GoogleAiOverview>
      ) : draft ? (
        <section className="rounded-lg border p-4">
          <h2 className="text-base font-medium" role="heading" aria-level={2}>
            AI fix plan — draft
          </h2>
          <p className="text-sm text-muted-foreground">
            Review every claim before publishing. This has not been applied to
            your website.
          </p>
          <Copy text={draft} />
          <pre className="mt-3 whitespace-pre-wrap break-all font-sans text-sm">
            {draft}
          </pre>
        </section>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {report.coverage?.notes?.join(" ")}
      </p>
    </div>
  );
}
export default function SiteScanPage() {
  const cache = useQueryClient();
  const [filters, setFilters] = useState(initialReportFilters);
  const [historyQ, setHistoryQ] = useState(""),
    [historyStatus, setHistoryStatus] = useState(""),
    [historyOffset, setHistoryOffset] = useState(0);
  const [locationQ, setLocationQ] = useState(""),
    [locationOffset, setLocationOffset] = useState(0),
    [clientFilter, setClientFilter] = useState("");
  const [checked, setChecked] = useState<number[]>([]),
    [email, setEmail] = useState(""),
    [mailResult, setMailResult] = useState("");
  const [agencyName, setAgencyName] = useState(""),
    [logo, setLogo] = useState<string | null>(null),
    [brandNotice, setBrandNotice] = useState(""),
    [notice, setNotice] = useState("");
  // Seed the branding form once from what is saved, so saving a new name keeps the saved logo.
  const brandSeeded = useRef(false);
  // Empty filters are omitted: the agency access layer rejects an empty status.
  const listParams = new URLSearchParams({
    q: historyQ,
    offset: String(historyOffset),
    limit: String(PAGE_SIZE),
    ...(historyStatus ? { status: historyStatus } : {}),
    ...(locationQ ? { locationQ } : {}),
    locationOffset: String(locationOffset),
    ...(clientFilter ? { locationId: clientFilter } : {}),
  });
  const reportParams = new URLSearchParams({
    ...filters,
    offset: String(filters.offset),
  });

  // New scan (/site-scan) and Scan history (/site-scan/history) are separate views in the Website tool; the open
  // report (?scan=) shows under either. Outside the full-screen tool both sections show, as before.
  const [view] = useToolView<"scan" | "history">("/site-scan", SITE_SCAN_VIEWS, "scan", ["scan"]);
  const inShell = useInToolShell();
  const showStart = !inShell || view === "scan", showHistory = !inShell || view === "history";
  const [scanParam, setScanParam] = useUrlParam("scan");
  const selected = scanParam ?? "",
    setSelected = (v: string | number) =>
      setScanParam(v === "" ? null : String(v), true);
  const [url, setUrl] = useState(""),
    [locationId, setLocationId] = useState(""),
    [cap, setCap] = useState("150"),
    [psi, setPsi] = useState("1"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [share, setShare] = useState("");
  // Same cached query AgencyWorkspace uses: a delegated member acts through a business.
  const { data: agencyMe, isFetched: agencyFetched } = useQuery<any>({ queryKey: ["/api/agency/me"] });
  const delegated = !!agencyMe && agencyMe.owner !== agencyMe.actor;
  // PDF branding is the account owner's; delegated members cannot read or change it.
  const { data: brand } = useQuery<any>({
    queryKey: ["/api/sitescan/branding"],
    enabled: !delegated,
    retry: false,
  });
  useEffect(() => {
    if (!brand || brandSeeded.current) return;
    brandSeeded.current = true;
    setAgencyName(brand.name || "");
    setLogo(brand.logo || null);
  }, [brand]);
  const { data, error: listError } = useQuery<any>({
    queryKey: ["/api/sitescan", listParams.toString()],
    queryFn: () => api("GET", "/api/sitescan?" + listParams),
    refetchInterval: (q) =>
      q.state.data?.jobs?.some((j: any) =>
        ["queued", "running"].includes(j.status),
      )
        ? 3000
        : false,
  });
  const { data: job, error: jobError } = useQuery<any>({
    queryKey: ["/api/sitescan/jobs/" + selected, reportParams.toString()],
    queryFn: () =>
      api("GET", "/api/sitescan/jobs/" + selected + "?" + reportParams),
    enabled: !!selected,
    retry: false,
    // Stop polling on an error too: an unknown or foreign scan id never recovers.
    refetchInterval: (q) =>
      q.state.error ||
      ["completed", "failed"].includes(q.state.data?.status)
        ? false
        : 3000,
  });
  // Numeric fields stay strings while typing so clearing them does not become 0.
  const limitsError = !whole(cap, 1, 500)
    ? "Page cap must be a whole number from 1 to 500."
    : !whole(psi, 0, 5)
      ? "PageSpeed pages must be a whole number from 0 to 5."
      : "";
  // The form opens on the signed-in account's own business (its location named like the account's company),
  // never on whichever client location happens to sort first. No match leaves it empty with the picker.
  // Prefilled once, so clearing the URL is not undone by the next list refetch.
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !data?.locations || !me || !agencyFetched) return;
    prefilled.current = true;
    const own: any = delegated ? null : ownLocation(data.locations as any[], me.companyName);
    if (own && !url) {
      setUrl(own.website);
      setLocationId(String(own.id));
    }
  }, [data, me, agencyFetched]);
  const currentSchedule = url
    ? data?.schedules?.find((s: any) => s.url === canonicalUrl(url))
    : undefined;
  const action = async (fn: () => Promise<void>) => {
    setError("");
    setNotice("");
    setBrandNotice("");
    setBusy(true);
    try {
      await fn();
      await cache.invalidateQueries({ queryKey: ["/api/sitescan"] });
      if (selected)
        await cache.invalidateQueries({
          queryKey: ["/api/sitescan/jobs/" + selected],
        });
    } catch (e: any) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  // Delete stays in the header while a scan has no report; with a report it sits with the other report actions.
  const deleteScan = job ? (
    <GooglePill
      icon={Trash2}
      variant="danger"
      size="sm"
      label="Delete scan"
      disabled={busy}
      onClick={() => {
        const id = job.id;
        if (
          !window.confirm(
            `Delete this scan of ${job.url}? Its report, fix progress and any share link are removed${
              ["queued", "running"].includes(job.status)
                ? " and the scan stops"
                : ""
            }. It still counts toward today's scan limit. This cannot be undone.`,
          )
        )
          return;
        void action(async () => {
          await api("DELETE", `/api/sitescan/jobs/${id}`);
          setSelected("");
          setShare("");
          cache.removeQueries({ queryKey: ["/api/sitescan/jobs/" + id] });
          setNotice("Scan deleted.");
        });
      }}
    />
  ) : null;
  const scheduleFor = (target: string, enabled: boolean, extra = {}) =>
    action(async () => {
      await api("POST", "/api/sitescan/schedule", {
        url: target,
        enabled,
        ...extra,
      });
    });
  const canStart = !busy && !!url && !limitsError;
  const startScan = () =>
    action(async () => {
      const r = await api("POST", "/api/sitescan", {
        url,
        locationId: locationId ? Number(locationId) : undefined,
        pageCap: Number(cap),
        psiPages: Number(psi),
      });
      setSelected(r.id);
      setShare("");
    });
  return (
    <AppPage className="max-sm:[&_.g-pill]:!min-h-11 max-sm:[&_button.g-chip]:!min-h-11" testId="page-site-scan">
      {/* Google's format (owner, 2026-10-07): quiet titles with a hairline, Google's search box, hairline rows, pills.
          The "i" follows the address: /site-scan is the feature's entry, /site-scan/history its Scan history section. */}
      <GoogleSectionHeader
        as="h1"
        title={!inShell ? "Site Scan" : view === "history" ? "Scan history" : "New scan"}
        description={!inShell || view === "scan" ? "Check a website for problems and get a fix list in priority order." : "Every scan you ran, with its score and how it moved since the scan before."}
        flush
        // The side menu already lists Scan history; from the history the one action is starting a scan.
        actions={inShell && view === "history" ? <GooglePill variant="solid" href="/site-scan" label="New scan" testId="link-site-scan-new" /> : undefined}
      />
      <AgencyWorkspace compact />
      {showStart && <section className="space-y-5" data-testid="section-start-scan">
        {!inShell && <GoogleSectionHeader
          title="Start a scan"
          description="Enter a website address and start; the report is ready in a few minutes."
        />}
        {/* The form leads (owner, 2026-10-15: the page "is confusing on what it's for"): the address, the two sizes,
            the optional profile comparison, then Start. Everything an agency does in bulk sits under it, folded. */}
        <form
          className="tool-panel"
          data-testid="form-new-scan"
          onSubmit={(e) => {
            e.preventDefault();
            if (canStart) void startScan();
          }}
        >
          <div className="tool-panel__head">
            <h2 className="tool-panel__title">Scan a website</h2>
            <span className="tool-muted text-[12px]">Reads the pages, scores them, and lists the fixes in priority order</span>
          </div>
          <div className="tool-panel__body space-y-4">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium g-text">Website URL</span>
              <Input
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-website.com"
                className="h-11 text-base"
                data-testid="input-scan-url"
              />
              <span className="block text-xs g-text-2">The home page is enough — the scan follows the site's own links from there.</span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                id="scan-page-cap"
                label="Pages to check"
                value={cap}
                onChange={setCap}
                min={1}
                max={500}
                presets={[25, 50, 100, 150]}
                unit="pages"
                invalid={!whole(cap, 1, 500)}
                hint="150 covers most contractor sites. Type any number up to 500 for a bigger one."
                testId="input-scan-page-cap"
              />
              <NumberField
                id="scan-psi-pages"
                label="Pages to speed-test"
                value={psi}
                onChange={setPsi}
                min={0}
                max={5}
                presets={[{ value: 0, label: "Off" }, 1, 3, 5]}
                unit="pages"
                invalid={!whole(psi, 0, 5)}
                hint="Each one is measured by Google PageSpeed on mobile and on desktop. Off skips the speed test."
                testId="input-scan-psi-pages"
              />
            </div>
            <div className="space-y-1.5 text-sm">
              <label htmlFor="scan-location" className="block g-text-2">
                Compare with a Google Business Profile <span className="g-text-2">(optional)</span>
              </label>
              <select
                id="scan-location"
                className={`${selectClass} block`}
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  const l = data?.locations.find(
                    (l: any) => String(l.id) === e.target.value,
                  );
                  if (l?.website) setUrl(l.website);
                }}
                data-testid="select-scan-location"
              >
                <option value="">No comparison</option>
                {data?.locations.map((l: any) => (
                  <option key={l.id} value={l.id}>
                    {l.business_name}
                  </option>
                ))}
              </select>
              <p className="text-xs g-text-2">
                {data?.locationTotal
                  ? "Checks the website's name, address, phone, services and service area against the profile, and fills in the address for you."
                  : "Link a location to its Google Business Profile under Locations to compare the website with the profile."}
              </p>
              {/* More locations than one page of the list: a search and pager for the picker (the bulk block below uses the same page). */}
              {(locationQ || (data?.locationTotal ?? 0) > PAGE_SIZE) && (
                <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="g-search min-w-0 flex-1 sm:max-w-xs" role="search">
                    <Search aria-hidden="true" />
                    <input
                      type="search"
                      aria-label="Search client locations"
                      placeholder="Search client locations"
                      value={locationQ}
                      onChange={(e) => {
                        setLocationQ(e.target.value);
                        setLocationOffset(0);
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <GooglePill
                      size="sm"
                      disabled={!locationOffset}
                      onClick={() =>
                        setLocationOffset(Math.max(0, locationOffset - PAGE_SIZE))
                      }
                      label="Previous locations"
                    />
                    <span className="text-sm tabular-nums g-text-2">
                      {data?.locationTotal
                        ? `${locationOffset + 1}–${Math.min(locationOffset + PAGE_SIZE, data.locationTotal)} of ${data.locationTotal}`
                        : "No matching locations"}
                    </span>
                    <GooglePill
                      size="sm"
                      disabled={
                        locationOffset + PAGE_SIZE >= (data?.locationTotal || 0)
                      }
                      onClick={() => setLocationOffset(locationOffset + PAGE_SIZE)}
                      label="Next locations"
                    />
                  </div>
                </div>
              )}
            </div>
            {limitsError && (
              <p role="alert" className="text-sm g-closed">{limitsError}</p>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <GooglePill
                type="submit"
                variant="solid"
                icon={Search}
                disabled={!canStart}
                className="w-full sm:w-auto"
                label={busy ? "Working…" : "Start scan"}
                testId="button-start-scan"
              />
              {/* The account's daily allowances, as the server counts them (server/sitescan/routes.ts, worker.ts). */}
              <p className="text-xs g-text-2" data-testid="text-scan-limits">
                You can run 5 scans, 20 PageSpeed tests and 3 AI fix plans a day. Bigger scans take a few minutes.
              </p>
            </div>
            {/* A toggle that shows its state for the URL above, not a bare "Disable" action beside Start scan. */}
            <div className="flex items-start gap-3 g-divider pt-4" data-testid="toggle-monthly-rescan">
              <Switch
                id="monthly-rescan"
                checked={!!currentSchedule}
                disabled={busy || !url || !!limitsError}
                onCheckedChange={(on) =>
                  scheduleFor(url, on, {
                    locationId: locationId ? Number(locationId) : undefined,
                    pageCap: Number(cap),
                    psiPages: Number(psi),
                  })
                }
              />
              <label htmlFor="monthly-rescan" className="text-sm">
                <span className="font-medium">Rescan this site every month</span>{" "}
                <span className="g-text-2">
                  {!url
                    ? "· Enter a website URL first."
                    : currentSchedule
                      ? `· On, next run ${new Date(currentSchedule.next_at).toLocaleDateString()}`
                      : "· Off for this site. Uses the sizes above and one of the day's scans each time."}
                </span>
              </label>
            </div>
          </div>
        </form>
        <section className="tool-panel" aria-labelledby="how-site-scan-works" data-testid="how-site-scan-works">
          <div className="tool-panel__head">
            <h2 id="how-site-scan-works" className="tool-panel__title">How this works</h2>
          </div>
          <MetricStrip cols={[1, 3, 3]}>
            <HowStep n={1} title="Enter the address and start" text="Put in the website's home page. Pick a Google Business Profile too if you want the site checked against what the profile says." />
            <HowStep n={2} title="We read the pages" text="The scanner reads the site's own HTML page by page, up to the number you set, and runs Google PageSpeed on the pages you chose. It never changes the website." />
            <HowStep n={3} title="Fix what matters first" text="Findings come back in priority order with the fix steps. Mark items done, export a PDF, send the checklist to your web person, and rescan to see what changed." />
          </MetricStrip>
        </section>
        <details className="tool-panel group" data-testid="agency-bulk-scan">
          <summary className="tool-panel__head cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
            <span className="tool-panel__title">Bulk scan client sites — for agencies ({checked.length} selected)</span>
            <span className="tool-muted text-[12px] sm:ml-auto">Queues one scan per location, with the sizes above</span>
          </summary>
          <div className="tool-panel__body space-y-3">
            <p className="flex items-center gap-1.5 text-sm g-text-2">
              Tick the locations to scan. Each one needs a website on its Google Business Profile.
              <HelpButton k="site-scan.agency-bulk" />
            </p>
            <div className="flex flex-wrap gap-2">
              <GooglePill
                size="sm"
                label="Select this page"
                onClick={() =>
                  setChecked([
                    ...new Set([
                      ...checked,
                      ...(data?.locations || [])
                        .filter((l: any) => l.website)
                        .map((l: any) => l.id),
                    ]),
                  ])
                }
              />
              <GooglePill
                variant="quiet"
                size="sm"
                onClick={() => setChecked([])}
                label="Clear selection"
              />
            </div>
            {!data?.locations?.length && (
              <p className="text-sm g-text-2">No Business Profile-linked locations{locationQ ? " match the search" : ""} yet.</p>
            )}
            {data?.locations.map((l: any) => (
              <label key={l.id} className="block text-sm">
                <input
                  type="checkbox"
                  checked={checked.includes(l.id)}
                  onChange={(e) =>
                    setChecked(
                      e.target.checked
                        ? [...checked, l.id]
                        : checked.filter((id) => id !== l.id),
                    )
                  }
                />{" "}
                {l.business_name} — {l.website || "No website"}
              </label>
            ))}
            {(data?.locationTotal ?? 0) > PAGE_SIZE && (
              <p className="text-xs g-text-2">
                Showing {locationOffset + 1}–{Math.min(locationOffset + PAGE_SIZE, data.locationTotal)} of {data.locationTotal}. Use the location search above to page through the rest.
              </p>
            )}
            <GooglePill
              label="Queue selected sites"
              disabled={busy || !checked.length || !!limitsError}
              onClick={() =>
                action(async () => {
                  const r = await api("POST", "/api/sitescan/bulk", {
                    locationIds: checked,
                    pageCap: Number(cap),
                    psiPages: Number(psi),
                  });
                  setChecked([]);
                  setSelected(r.jobs[0].id);
                })
              }
            />
            <p className="text-xs g-text-2">
              Up to 1,000 sites a day. The scans run in the background, one after another, and show up in Scan history.
            </p>
          </div>
        </details>
        <div className="space-y-2" data-testid="section-monthly-rescans">
          <h2 className="flex items-center gap-1.5 g-card__title g-card__title--md">
            Monthly rescans ({data?.schedules?.length ?? 0} of 10)
            <HelpButton k="site-scan.monthly-rescan" />
          </h2>
          {!data?.schedules?.length ? (
            <p className="text-sm g-text-2">
              None yet. Enter a website URL above and turn on “Rescan this site every month”.
            </p>
          ) : (
            <GoogleList as="ul" testId="list-scan-schedules">
              {data.schedules.map((s: any) => (
                <GoogleListRow
                  as="li"
                  key={s.url}
                  size="md"
                  title={s.url}
                  meta={[`Up to ${s.page_cap} pages`, `Next run ${new Date(s.next_at).toLocaleDateString()}`]}
                  trailing={
                    <GooglePill
                      size="sm"
                      ariaLabel={`Turn off monthly rescan for ${s.url}`}
                      disabled={busy}
                      // Agency members may only change a schedule through its business;
                      // the owner disables by URL, which also covers a deleted business.
                      onClick={() =>
                        scheduleFor(
                          s.url,
                          false,
                          delegated && s.location_id
                            ? { locationId: s.location_id }
                            : {},
                        )
                      }
                      label="Turn off"
                    />
                  }
                />
              ))}
            </GoogleList>
          )}
        </div>
      </section>}
      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {showHistory && <section className="space-y-3" data-testid="section-scan-history">
        {!inShell && <GoogleSectionHeader title="Scan history" titleAfter={<HelpButton k="site-scan.history" />} description="Every scan you ran, with its score and how it moved since the scan before." />}
        {listError && (
          <Notice tone="danger">
            Could not load scan history:{" "}
            {apiErrorMessage(listError, "please refresh and try again.")}
          </Notice>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="g-search w-full sm:w-72" role="search">
            <Search aria-hidden="true" />
            <input
              type="search"
              aria-label="Search history"
              placeholder="Search history"
              value={historyQ}
              onChange={(e) => {
                setHistoryQ(e.target.value);
                setHistoryOffset(0);
              }}
            />
          </div>
          <select
            aria-label="Status"
            className={selectClass}
            value={historyStatus}
            onChange={(e) => {
              setHistoryStatus(e.target.value);
              setHistoryOffset(0);
            }}
          >
            <option value="">All statuses</option>
            {(["queued", "running", "completed", "failed"] as const).map((v) => (
              <option key={v} value={v}>
                {SCAN_STATUS_WORDS[v]}
              </option>
            ))}
          </select>
          {/* Each button is disabled when it would not change the list, so neither looks dead. */}
          <GooglePill
            size="sm"
            disabled={!locationId || clientFilter === locationId}
            onClick={() => {
              setClientFilter(locationId);
              setHistoryOffset(0);
            }}
            label="History for selected client"
          />
          <GooglePill
            size="sm"
            disabled={!clientFilter}
            onClick={() => {
              setClientFilter("");
              setHistoryOffset(0);
            }}
            label="All clients"
          />
        </div>
        <p className="text-sm g-text-2" aria-live="polite">
          {clientFilter
            ? `Showing scans for ${
                data?.locations?.find(
                  (l: any) => String(l.id) === clientFilter,
                )?.business_name ?? "the selected client"
              }.`
            : locationId
              ? "Showing scans for all clients."
              : data?.locationTotal
                ? "Showing scans for all clients. Choose a Google Business Profile in the scan form to see one client's history."
                : "Showing scans for all clients. Per-client history is available for Business Profile-linked locations."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <GooglePill
            size="sm"
            disabled={!historyOffset}
            onClick={() =>
              setHistoryOffset(Math.max(0, historyOffset - PAGE_SIZE))
            }
            label="Previous scans"
          />
          <span className="text-sm tabular-nums g-text-2">
            {data?.total || 0} scans
          </span>
          <GooglePill
            size="sm"
            disabled={historyOffset + PAGE_SIZE >= (data?.total || 0)}
            onClick={() => setHistoryOffset(historyOffset + PAGE_SIZE)}
            label="Next scans"
          />
        </div>
        {data?.jobs.length > 0 && (
          <div className="space-y-3" data-testid="list-scan-history">
            {data.jobs.map((j: any, index: number) => (
              <ScanCard
                key={j.id}
                job={j}
                // The score moved against the newest earlier scan of the same site that has one.
                prior={data.jobs.slice(index + 1).find((p: any) => p.url === j.url && typeof p.scores?.overall === "number") ?? null}
                selected={selected === j.id}
                onOpen={() => {
                  setSelected(j.id);
                  setShare("");
                }}
              />
            ))}
          </div>
        )}
        {data?.jobs.length === 0 && (historyQ || historyStatus || clientFilter ? (
          <p className="text-sm g-text-2" data-testid="text-history-no-match">No scans match these filters.</p>
        ) : !showSample({ isError: !!listError && !data, total: data?.jobs.length, filtered: !!(historyQ || historyStatus || clientFilter), page: historyOffset }) ? (
          <p className="text-sm g-text-2" data-testid="text-history-no-page">No scans on this page.</p>
        ) : (
          // Nothing scanned yet: what the history looks like, on made-up numbers, until the first real scan replaces it.
          <SamplePreview what="what your scan history looks like after a scan" testId="sample-scan-history"
            cta={<GooglePill size="sm" variant="solid" href="/site-scan" label="Start your first scan" testId="link-sample-start-scan" />}>
            <div className="space-y-3">
              {SAMPLE_SCANS.map((j, i) => <ScanCard key={j.id} job={j} prior={SAMPLE_SCANS[i + 1] ?? null} />)}
            </div>
          </SamplePreview>
        ))}
      </section>}
      {selected && jobError && (
        <Notice tone="danger">
          {/^(400|404):/.test((jobError as any).message)
            ? "This report was not found. Choose a scan from your history."
            : apiErrorMessage(jobError, "Could not load this report.")}
        </Notice>
      )}
      {job && (
        <section className="space-y-4">
          <GoogleSectionHeader
            title={job.url}
            description={<span role="status">{job.status} · {job.pages} of {pageCount(job.pageCap)} checked</span>}
            flush
            actions={job.report ? undefined : deleteScan}
          />
          {job.error && (
            <p role="alert" className="text-sm g-closed">
              {job.error}
            </p>
          )}
          {job.report && (
            <>
              <ScanReport
                report={job.report}
                draft={job.aiDraft}
                surface
                filters={filters}
                actions={
                  <div className="space-y-4" data-testid="section-report-actions">
                    <div className="flex flex-wrap gap-2">
                      <GooglePill
                        variant="solid"
                        disabled={busy}
                        onClick={() =>
                          action(async () => {
                            await api("POST", `/api/sitescan/jobs/${selected}/plan`);
                          })
                        }
                        label={busy ? "Working…" : "Generate AI fix plan"}
                      />
                      <GooglePill icon={Download} href={`/api/sitescan/jobs/${selected}/pdf`} label="Export PDF" />
                      {/* Built from the crawl: the fix for "No XML sitemap found", and a cleaner one for sites whose sitemap is stale. */}
                      <GooglePill icon={Download} href={`/api/sitescan/jobs/${selected}/sitemap.xml`} label="Download sitemap.xml" testId="button-download-sitemap" />
                      <GooglePill
                        label={job.shareEnabled ? "Replace share link" : "Create share link"}
                        disabled={busy}
                        onClick={() => {
                          // Only a hash is stored, so a new link always replaces the old one.
                          if (
                            job.shareEnabled &&
                            !window.confirm(
                              "The current share link will stop working. Create a new link?",
                            )
                          )
                            return;
                          void action(async () => {
                            const r = await api(
                              "POST",
                              `/api/sitescan/jobs/${selected}/share`,
                            );
                            setShare(window.location.origin + r.path);
                          });
                        }}
                      />
                      {job.shareEnabled && (
                        <GooglePill
                          variant="quiet"
                          onClick={() =>
                            action(async () => {
                              await api(
                                "DELETE",
                                `/api/sitescan/jobs/${selected}/share`,
                              );
                              setShare("");
                            })
                          }
                          label="Revoke share link"
                        />
                      )}
                      {deleteScan}
                    </div>
                    {share ? (
                      <div className="space-y-1">
                        <p className="break-all text-sm">
                          Read-only link (30 days):{" "}
                          <a href={share} className="g-link">
                            {share}
                          </a>
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Copy key={share} text={share} label="Copy link" />
                          <span className="text-sm g-text-2">
                            Copy this link now; it is shown only once.
                          </span>
                        </div>
                      </div>
                    ) : (
                      job.shareEnabled && (
                        <p className="text-sm g-text-2">
                          A share link is active. For security it is shown only when
                          created; use Replace share link to get a new one (the old
                          link stops working).
                        </p>
                      )
                    )}
                    <section data-testid="section-scan-followup">
                      <GoogleSectionHeader title="Follow up" />
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          <GooglePill
                            disabled={busy}
                            onClick={() =>
                              action(async () => {
                                const r = await api(
                                  "POST",
                                  `/api/sitescan/jobs/${selected}/retry`,
                                );
                                setSelected(r.id);
                                setFilters(initialReportFilters);
                              })
                            }
                            // A rescan keeps the scan's own settings: with PageSpeed off, it stays off (nothing to retry).
                            label={job?.psiPages === 0 ? "Rescan (PageSpeed stays off)" : "Rescan / retry PageSpeed"}
                          />
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                          <label className="block min-w-0 flex-1 space-y-1.5 text-sm sm:max-w-xs">
                            <span className="g-text-2">
                              Send to my web person — email
                            </span>
                            <Input
                              type="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                            />
                          </label>
                          <GooglePill
                            label="Send prioritized checklist"
                            disabled={busy || !email}
                            className="w-full sm:w-auto"
                            onClick={() =>
                              action(async () => {
                                const r = await api(
                                  "POST",
                                  `/api/sitescan/jobs/${selected}/email`,
                                  { email },
                                );
                                setMailResult(
                                  r.sink
                                    ? "Checklist saved to local email sink."
                                    : "Checklist email sent.",
                                );
                              })
                            }
                          />
                        </div>
                        {mailResult && (
                          <p role="status" className="text-sm">
                            {mailResult}
                          </p>
                        )}
                        <details className="g-card border-t">
                          <summary className="cursor-pointer text-sm font-medium">
                            White-label PDF branding
                          </summary>
                          {delegated ? (
                            <p className="py-2 text-sm g-text-2">
                              PDF branding is managed by the workspace owner.
                            </p>
                          ) : (
                            <div className="space-y-3 pt-3">
                              <label className="block space-y-1.5 text-sm">
                                <span className="g-text-2">
                                  Agency name
                                </span>
                                <Input
                                  value={agencyName}
                                  onChange={(e) => {
                                    setAgencyName(e.target.value);
                                    setBrandNotice("");
                                  }}
                                />
                              </label>
                              <label className="block space-y-1.5 text-sm">
                                <span className="g-text-2">
                                  Agency logo (PNG/JPEG, up to 200 KB)
                                </span>
                                <Input
                                  type="file"
                                  accept="image/png,image/jpeg"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    setBrandNotice("");
                                    if (!f) return;
                                    if (f.size > 200000) {
                                      setError("Logo must be under 200 KB");
                                      return;
                                    }
                                    const r = new FileReader();
                                    r.onload = () => setLogo(String(r.result));
                                    r.readAsDataURL(f);
                                  }}
                                />
                              </label>
                              {logo && (
                                <div className="flex flex-wrap items-center gap-2">
                                  <img
                                    src={logo}
                                    alt="Logo for PDF exports"
                                    className="max-h-12 max-w-[160px] rounded-md border"
                                  />
                                  <GooglePill
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => {
                                      setLogo(null);
                                      setBrandNotice(
                                        "Logo removed from the form. Save PDF branding to apply it.",
                                      );
                                    }}
                                    label="Remove logo"
                                  />
                                </div>
                              )}
                              <div className="flex flex-wrap gap-2">
                                <GooglePill
                                  label="Save PDF branding"
                                  disabled={busy || !agencyName.trim()}
                                  onClick={() =>
                                    action(async () => {
                                      await api("POST", "/api/sitescan/branding", {
                                        name: agencyName,
                                        // Send the logo only when it changed; an omitted logo keeps the saved one
                                        // (the stored, normalized image can be larger than an upload may be).
                                        ...(logo === (brand?.logo ?? null)
                                          ? {}
                                          : { logo }),
                                      });
                                      await cache.invalidateQueries({
                                        queryKey: ["/api/sitescan/branding"],
                                      });
                                      const saved = cache.getQueryData<any>([
                                        "/api/sitescan/branding",
                                      ]);
                                      setBrandNotice(
                                        `PDF branding saved${(saved ? saved.logo : logo) ? " with logo" : " without a logo"}. It applies to your next PDF export.`,
                                      );
                                    })
                                  }
                                />
                                {brand?.name && (
                                  <GooglePill
                                    variant="quiet"
                                    label="Remove branding"
                                    disabled={busy}
                                    onClick={() => {
                                      if (
                                        !window.confirm(
                                          "Remove your PDF branding? Exports go back to the ConstructHUB title.",
                                        )
                                      )
                                        return;
                                      void action(async () => {
                                        await api("DELETE", "/api/sitescan/branding");
                                        await cache.invalidateQueries({
                                          queryKey: ["/api/sitescan/branding"],
                                        });
                                        setAgencyName("");
                                        setLogo(null);
                                        setBrandNotice(
                                          "PDF branding removed. Exports use the ConstructHUB title.",
                                        );
                                      });
                                    }}
                                  />
                                )}
                              </div>
                              {brandNotice && (
                                <p role="status" className="text-sm">
                                  {brandNotice}
                                </p>
                              )}
                              <p className="text-xs g-text-2">
                                Branding is applied on the next PDF download. No
                                remote logo URL is fetched.
                              </p>
                            </div>
                          )}
                        </details>
                      </div>
                    </section>
                    <ReportFilters
                      filters={filters}
                      setFilters={setFilters}
                      total={Math.max(
                        job.report.fixTotal || 0,
                        job.report.findingTotal || 0,
                      )}
                    />
                  </div>
                }
                onDone={(keys, done) => {
                  void action(async () => {
                    await api("POST", `/api/sitescan/jobs/${selected}/fixes`, {
                      keys,
                      done,
                    });
                  });
                }}
              />
              <ScanIndexingSummary scanId={job.id} />
            </>
          )}
        </section>
      )}
    </AppPage>
  );
}
export function SharedSiteScanPage() {
  const [filters, setFilters] = useState(initialReportFilters);
  const params = new URLSearchParams({
    ...filters,
    offset: String(filters.offset),
  });
  const token = window.location.pathname.split("/").pop();
  const { data, error } = useQuery<any>({
    queryKey: ["/api/sitescan/shared/" + token, params.toString()],
    queryFn: () => api("GET", "/api/sitescan/shared/" + token + "?" + params),
    retry: false,
  });
  return (
    <>
    <PublicPageHeader next="/free-site-scan" backWhenSignedIn />
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Shared Site Scan</h1>
      {error && <p role="alert">This report link is unavailable or revoked.</p>}
      <ScanReport
        report={data?.report}
        draft={data?.aiDraft}
        filters={filters}
        actions={
          <ReportFilters
            filters={filters}
            setFilters={setFilters}
            total={Math.max(
              data?.report?.fixTotal || 0,
              data?.report?.findingTotal || 0,
            )}
          />
        }
      />
    </main>
    </>
  );
}
export function FreeSiteScanPage() {
  const [url, setUrl] = useState(""),
    [email, setEmail] = useState(""),
    [access, setAccess] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [captchaToken, setCaptcha] = useState("");
  const captchaWidget = useRef<number | null>(null);
  const verify = new URLSearchParams(window.location.search).get("verify");
  const { data: config } = useQuery<any>({
    queryKey: ["/api/sitescan/public/config"],
  });
  useEffect(() => {
    if (!config?.captchaSiteKey) return;
    let stopped = false;
    const render = () => {
      const g = (window as any).grecaptcha;
      if (!stopped && g?.render)
        g.ready(() => {
          if (!stopped)
            captchaWidget.current = g.render("sitescan-captcha", {
              sitekey: config.captchaSiteKey,
              callback: setCaptcha,
              "expired-callback": () => setCaptcha(""),
              "error-callback": () => setCaptcha(""),
            });
        });
    };
    const script = document.createElement("script");
    script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
    script.onload = render;
    document.head.appendChild(script);
    return () => {
      stopped = true;
      script.remove();
    };
  }, [config?.captchaSiteKey]);
  const { data, error: reportError } = useQuery<any>({
    queryKey: ["sitescan-public", access, verify],
    enabled: !!access || !!verify,
    queryFn: () =>
      verify
        ? api("POST", "/api/sitescan/public/verify", { token: verify })
        : api("GET", "/api/sitescan/public/status/" + access),
    refetchInterval: (q) =>
      q.state.error || ["completed", "failed"].includes(q.state.data?.status)
        ? false
        : 3000,
    retry: false,
  });
  return (
    <>
    <PublicPageHeader next="/free-site-scan" backWhenSignedIn />
    <main className="max-w-4xl mx-auto p-8 space-y-6">
      <a href="/" className="text-primary">
        ConstructHUB
      </a>
      <h1 className="text-4xl font-bold">Free 60-second website scan</h1>
      <p>
        Discover the first fixes for your contractor website. We check up to 11
        pages; slow sites can take longer. Verify your email to unlock the
        complete quick-scan report.
      </p>
      {!verify && !access && (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const r = await api("POST", "/api/sitescan/public/start", {
                url,
                email,
                captchaToken,
              });
              setAccess(r.access);
            } catch (e: any) {
              setError(apiErrorMessage(e, "Could not start the scan."));
              // Tokens are single-use, including when a later server step fails.
              if (captchaWidget.current !== null) {
                (window as any).grecaptcha?.reset(captchaWidget.current);
                setCaptcha("");
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="block">
            Website URL
            <Input
              required
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label className="block">
            Email
            <Input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <div id="sitescan-captcha" />
          <Button
            disabled={
              busy || !config || (!!config.captchaSiteKey && !captchaToken)
            }
          >
            Scan my website
          </Button>
          <p className="text-xs">
            We use your email to deliver this report.{" "}
            <a href="/privacy" className="underline">
              Privacy policy
            </a>
          </p>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {reportError && (
        <p role="alert">
          The scan could not be loaded. The link may have expired or the request
          limit was reached.
        </p>
      )}
      {access && data?.status !== "failed" && (
        <p>
          Check your email for the verification link to unlock the full report.
        </p>
      )}
      {data &&
        (data.status === "failed" ? (
          <div className="space-y-3">
            <p role="status">
              We could not finish scanning this website. It may be offline,
              blocking automated checks, or too slow to respond. Check that the
              address opens in a browser, then try again.
            </p>
            <Button
              variant="outline"
              // A fresh page load also renders a fresh CAPTCHA for the next attempt.
              onClick={() => window.location.assign(window.location.pathname)}
            >
              Scan another site
            </Button>
          </div>
        ) : (
          <p role="status">Scan {data.status}.</p>
        ))}
      {data?.summary && <ScanReport report={data.summary} summary />}
      <ScanReport report={data?.report} />
    </main>
    </>
  );
}
export function SiteScanLeads() {
  const { data, error, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/sitescan-leads"],
    retry: false,
  });
  const leads: any[] = data?.leads || [];
  return (
    <section className="rounded-xl border bg-card text-card-foreground shadow-sm" data-testid="section-sitescan-leads">
      <div className="flex flex-col space-y-1.5 p-6 pb-3">
        <div className="text-base font-semibold leading-6">Site Scan leads</div>
        <p className="text-xs text-muted-foreground">
          Emails captured by the free website scan (latest 500).
        </p>
      </div>
      <div className="p-6 pt-0">
        {error ? (
          <p className="text-sm text-muted-foreground">
            Platform admin access required.
          </p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading leads…</p>
        ) : !leads.length ? (
          <p className="text-sm text-muted-foreground">
            No Site Scan leads yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Email</th>
                  <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Website</th>
                  <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Verified</th>
                  <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l: any) => (
                  <tr key={l.id} className="border-t transition-colors hover:bg-muted/40">
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 align-middle">{l.email}</td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 align-middle break-all">{l.url}</td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 align-middle">
                      {l.verified_at ? "Yes" : "No"}
                    </td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 align-middle">{l.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
