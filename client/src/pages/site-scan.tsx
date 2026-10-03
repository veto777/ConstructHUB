import { AgencyWorkspace } from "@/components/agency-workspace";
import { PublicPageHeader } from "@/components/public-page-chrome";
import {
  FixChecklist,
  ReportFilters,
  initialReportFilters,
} from "@/components/site-scan-fixes";
import { ScanIndexingSummary } from "./site-connections";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppPage, PageHeader, Section, Notice } from "@/components/app-ui";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import { useUrlParam } from "@/hooks/use-url-param";
const api = async (method: string, url: string, body?: unknown) =>
  (await apiRequest(method, url, body)).json();
const selectClass =
  "h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-auto";
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
          <div key={i} className="space-y-1 rounded-xl border p-3">
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
export function ScanReport({
  report,
  draft,
  summary = false,
  onDone,
}: {
  report: any;
  draft?: string;
  summary?: boolean;
  onDone?: (keys: string[], done: boolean) => void;
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
          <div key={name} className="rounded-xl border bg-card p-3.5 sm:p-4">
            <div className="text-xs font-medium text-muted-foreground">
              {labelFor(name)}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
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
        <div role="note" className="rounded-xl border p-3 text-sm">
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
                ? "Server owner: add PAGESPEED_API_KEY and enable the PageSpeed Insights API, then use Rescan / retry PageSpeed."
                : "Use Rescan / retry PageSpeed to measure again."}
            </p>
          )}
        </div>
      )}
      {["technical", "performance", "local", "content", "ai-readiness"].map(
        (category) => (
          <section key={category}>
            <h2 className="mb-3 text-base font-semibold">
              {labelFor(category)}
            </h2>
            <div className="space-y-3">
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
                    className="space-y-2 rounded-xl border bg-card p-4"
                  >
                    <h3 className="text-base font-semibold">
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
                <p className="text-sm text-muted-foreground">
                  {summary
                    ? "Verify your email to see all findings in this category."
                    : category === "performance" &&
                        report.scores.categories.performance === null
                      ? "Not scored: PageSpeed data was unavailable for this scan (see Why Performance is N/A above)."
                      : report.findingTotal
                        ? "No findings in this category on the current results page. Use filters or Next findings to see more."
                        : "No findings from available checks."}
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
        <Section
          title="GBP JSON-LD draft"
          description="Review for accuracy before publishing. Unknown values are omitted."
        >
          <Copy text={JSON.stringify(report.jsonLdDraft, null, 2)} />
          <pre className="mt-3 whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(report.jsonLdDraft, null, 2)}
          </pre>
        </Section>
      )}
      {draft && (
        <Section>
          <h2 className="text-base font-semibold" role="heading" aria-level={2}>
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
        </Section>
      )}
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
  const { data: agencyMe } = useQuery<any>({ queryKey: ["/api/agency/me"] });
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
  useEffect(() => {
    if (!url && data?.locations?.[0]?.website) {
      setUrl(data.locations[0].website);
      setLocationId(String(data.locations[0].id));
    }
  }, [data]);
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
  const scheduleFor = (target: string, enabled: boolean, extra = {}) =>
    action(async () => {
      await api("POST", "/api/sitescan/schedule", {
        url: target,
        enabled,
        ...extra,
      });
    });
  return (
    <AppPage testId="page-site-scan">
      <PageHeader
        title="Site Scan"
        description="Find website issues, compare your Google Business Profile, and draft your next fixes."
      />
      <AgencyWorkspace compact />
      <Section
        title="Start a scan"
        description="Up to 5 scans/day, 20 PageSpeed requests/day and 3 AI drafts/day. Larger scans take minutes."
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <label className="block min-w-0 flex-1 space-y-1.5 text-sm sm:max-w-xs">
              <span className="text-muted-foreground">
                Search client locations
              </span>
              <Input
                value={locationQ}
                onChange={(e) => {
                  setLocationQ(e.target.value);
                  setLocationOffset(0);
                }}
              />
            </label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!locationOffset}
                onClick={() =>
                  setLocationOffset(Math.max(0, locationOffset - PAGE_SIZE))
                }
              >
                Previous locations
              </Button>
              <span className="text-sm tabular-nums text-muted-foreground">
                {data?.locationTotal
                  ? `${locationOffset + 1}–${Math.min(locationOffset + PAGE_SIZE, data.locationTotal)} of ${data.locationTotal}`
                  : "No Business Profile-linked locations"}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  locationOffset + PAGE_SIZE >= (data?.locationTotal || 0)
                }
                onClick={() => setLocationOffset(locationOffset + PAGE_SIZE)}
              >
                Next locations
              </Button>
            </div>
          </div>
          <details className="rounded-xl border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">
              Bulk scan client sites ({checked.length} selected)
            </summary>
            <div className="space-y-3 pt-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
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
                >
                  Select this page
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setChecked([])}
                >
                  Clear selection
                </Button>
              </div>
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
              <Button
                variant="outline"
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
              >
                Queue selected sites
              </Button>
              <p className="text-xs text-muted-foreground">
                Up to 1,000 sites per day. Each selected location needs a
                synced GBP website. Work runs in the background with shared
                provider budgets.
              </p>
            </div>
          </details>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">Linked GBP location</span>
              <select
                className={`${selectClass} block`}
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  const l = data?.locations.find(
                    (l: any) => String(l.id) === e.target.value,
                  );
                  if (l?.website) setUrl(l.website);
                }}
              >
                <option value="">No GBP comparison</option>
                {data?.locations.map((l: any) => (
                  <option key={l.id} value={l.id}>
                    {l.business_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">Website URL</span>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-website.com"
              />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">Page cap</span>
              <Input
                type="number"
                min={1}
                max={500}
                value={cap}
                aria-invalid={!whole(cap, 1, 500)}
                onChange={(e) => setCap(e.target.value)}
              />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">
                PageSpeed pages (mobile + desktop)
              </span>
              <Input
                type="number"
                min={0}
                max={5}
                value={psi}
                aria-invalid={!whole(psi, 0, 5)}
                onChange={(e) => setPsi(e.target.value)}
              />
            </label>
          </div>
          {limitsError && (
            <p className="text-sm text-red-600">{limitsError}</p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              disabled={busy || !url || !!limitsError}
              className="w-full sm:w-auto"
              onClick={() =>
                action(async () => {
                  const r = await api("POST", "/api/sitescan", {
                    url,
                    locationId: locationId ? Number(locationId) : undefined,
                    pageCap: Number(cap),
                    psiPages: Number(psi),
                  });
                  setSelected(r.id);
                  setShare("");
                })
              }
            >
              Start scan
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              disabled={busy || !url || !!limitsError}
              onClick={() =>
                scheduleFor(
                  url,
                  !data?.schedules.some(
                    (s: any) => s.url === canonicalUrl(url),
                  ),
                  {
                    locationId: locationId ? Number(locationId) : undefined,
                    pageCap: Number(cap),
                    psiPages: Number(psi),
                  },
                )
              }
            >
              {data?.schedules.some((s: any) => s.url === canonicalUrl(url))
                ? "Disable monthly rescan"
                : "Enable monthly rescan"}
            </Button>
          </div>
          <div className="space-y-2 border-t pt-4">
            <h2 className="text-sm font-semibold">
              Monthly rescans ({data?.schedules?.length ?? 0} of 10)
            </h2>
            {!data?.schedules?.length ? (
              <p className="text-sm text-muted-foreground">
                No monthly rescans. Enter a website URL above and choose
                Enable monthly rescan.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.schedules.map((s: any) => (
                  <li
                    key={s.url}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2.5 text-sm"
                  >
                    <span className="min-w-0 break-all">
                      {s.url} · up to {s.page_cap} pages · next run{" "}
                      {new Date(s.next_at).toLocaleDateString()}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Disable schedule for ${s.url}`}
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
                    >
                      Disable
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>
      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <Section
        title="History & score trend"
        flush
        testId="section-scan-history"
      >
        <div className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
          {listError && (
            <Notice tone="danger">
              Could not load scan history:{" "}
              {apiErrorMessage(listError, "please refresh and try again.")}
            </Notice>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Search history"
              placeholder="Search history"
              value={historyQ}
              onChange={(e) => {
                setHistoryQ(e.target.value);
                setHistoryOffset(0);
              }}
              className="h-10 sm:w-56"
            />
            <select
              aria-label="Status"
              className={selectClass}
              value={historyStatus}
              onChange={(e) => {
                setHistoryStatus(e.target.value);
                setHistoryOffset(0);
              }}
            >
              {["", "queued", "running", "completed", "failed"].map((v) => (
                <option key={v} value={v}>
                  {v || "All statuses"}
                </option>
              ))}
            </select>
            {/* Each button is disabled when it would not change the list, so neither looks dead. */}
            <Button
              variant="outline"
              size="sm"
              disabled={!locationId || clientFilter === locationId}
              onClick={() => {
                setClientFilter(locationId);
                setHistoryOffset(0);
              }}
            >
              History for selected client
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!clientFilter}
              onClick={() => {
                setClientFilter("");
                setHistoryOffset(0);
              }}
            >
              All clients
            </Button>
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {clientFilter
              ? `Showing scans for ${
                  data?.locations?.find(
                    (l: any) => String(l.id) === clientFilter,
                  )?.business_name ?? "the selected client"
                }.`
              : locationId
                ? "Showing scans for all clients."
                : data?.locationTotal
                  ? "Showing scans for all clients. Choose a Linked GBP location above to see one client's history."
                  : "Showing scans for all clients. Per-client history is available for Business Profile-linked locations."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!historyOffset}
              onClick={() =>
                setHistoryOffset(Math.max(0, historyOffset - PAGE_SIZE))
              }
            >
              Previous scans
            </Button>
            <span className="text-sm tabular-nums text-muted-foreground">
              {data?.total || 0} scans
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={historyOffset + PAGE_SIZE >= (data?.total || 0)}
              onClick={() => setHistoryOffset(historyOffset + PAGE_SIZE)}
            >
              Next scans
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {data?.jobs.map((j: any, index: number) => (
              <Button
                variant={selected === j.id ? "default" : "outline"}
                className="h-auto max-w-full whitespace-normal break-all text-left"
                key={j.id}
                onClick={() => {
                  setSelected(j.id);
                  setShare("");
                }}
              >
                {new Date(j.created_at).toLocaleDateString()} · {j.url} ·{" "}
                {j.scores?.overall ?? j.status}
                {(() => {
                  const old = data.jobs
                    .slice(index + 1)
                    .find(
                      (p: any) =>
                        p.url === j.url && typeof p.scores?.overall === "number",
                    );
                  const delta =
                    old && typeof j.scores?.overall === "number"
                      ? j.scores.overall - old.scores.overall
                      : null;
                  return delta === null
                    ? ""
                    : ` (${delta > 0 ? "+" : ""}${delta} since prior scan)`;
                })()}
              </Button>
            ))}
            {data?.jobs.length === 0 && (
              <p className="text-sm text-muted-foreground">No scans yet.</p>
            )}
          </div>
        </div>
      </Section>
      {selected && jobError && (
        <Notice tone="danger">
          {/^(400|404):/.test((jobError as any).message)
            ? "This report was not found. Choose a scan from your history."
            : apiErrorMessage(jobError, "Could not load this report.")}
        </Notice>
      )}
      {job && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="min-w-0 text-xl font-semibold break-all">
              {job.url}
            </h2>
            <Button
              variant="outline"
              size="sm"
              className="text-red-600"
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
            >
              Delete scan
            </Button>
          </div>
          <p role="status" className="text-sm text-muted-foreground">
            {job.status} · {job.pages} of {pageCount(job.pageCap)} checked
          </p>
          {job.error && (
            <p role="alert" className="text-sm text-destructive">
              {job.error}
            </p>
          )}
          {job.report && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await api("POST", `/api/sitescan/jobs/${selected}/plan`);
                    })
                  }
                >
                  {busy ? "Working…" : "Generate AI fix plan"}
                </Button>
                <Button variant="outline" asChild>
                  <a href={`/api/sitescan/jobs/${selected}/pdf`}>Export PDF</a>
                </Button>
                <Button
                  variant="outline"
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
                >
                  {job.shareEnabled ? "Replace share link" : "Create share link"}
                </Button>
                {job.shareEnabled && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      action(async () => {
                        await api(
                          "DELETE",
                          `/api/sitescan/jobs/${selected}/share`,
                        );
                        setShare("");
                      })
                    }
                  >
                    Revoke share link
                  </Button>
                )}
              </div>
              {share ? (
                <div className="space-y-1">
                  <p className="break-all text-sm">
                    Read-only link (30 days):{" "}
                    <a href={share} className="text-primary underline">
                      {share}
                    </a>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Copy key={share} text={share} label="Copy link" />
                    <span className="text-sm text-muted-foreground">
                      Copy this link now; it is shown only once.
                    </span>
                  </div>
                </div>
              ) : (
                job.shareEnabled && (
                  <p className="text-sm text-muted-foreground">
                    A share link is active. For security it is shown only when
                    created; use Replace share link to get a new one (the old
                    link stops working).
                  </p>
                )
              )}
              <Section title="Follow up" flush testId="section-scan-followup">
                <div className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
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
                    >
                      Rescan / retry PageSpeed
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                    <label className="block min-w-0 flex-1 space-y-1.5 text-sm sm:max-w-xs">
                      <span className="text-muted-foreground">
                        Send to my web person — email
                      </span>
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </label>
                    <Button
                      variant="outline"
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
                    >
                      Send prioritized checklist
                    </Button>
                  </div>
                  {mailResult && (
                    <p role="status" className="text-sm">
                      {mailResult}
                    </p>
                  )}
                  <details className="rounded-xl border px-4 py-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      White-label PDF branding
                    </summary>
                    {delegated ? (
                      <p className="py-2 text-sm text-muted-foreground">
                        PDF branding is managed by the workspace owner.
                      </p>
                    ) : (
                      <div className="space-y-3 pt-3">
                        <label className="block space-y-1.5 text-sm">
                          <span className="text-muted-foreground">
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
                          <span className="text-muted-foreground">
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
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() => {
                                setLogo(null);
                                setBrandNotice(
                                  "Logo removed from the form. Save PDF branding to apply it.",
                                );
                              }}
                            >
                              Remove logo
                            </Button>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
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
                          >
                            Save PDF branding
                          </Button>
                          {brand?.name && (
                            <Button
                              variant="ghost"
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
                            >
                              Remove branding
                            </Button>
                          )}
                        </div>
                        {brandNotice && (
                          <p role="status" className="text-sm">
                            {brandNotice}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Branding is applied on the next PDF download. No
                          remote logo URL is fetched.
                        </p>
                      </div>
                    )}
                  </details>
                </div>
              </Section>
              <ReportFilters
                filters={filters}
                setFilters={setFilters}
                total={Math.max(
                  job.report.fixTotal || 0,
                  job.report.findingTotal || 0,
                )}
              />
              <ScanReport
                report={job.report}
                draft={job.aiDraft}
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
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Shared Site Scan</h1>
      {error && <p role="alert">This report link is unavailable or revoked.</p>}
      <ReportFilters
        filters={filters}
        setFilters={setFilters}
        total={Math.max(
          data?.report?.fixTotal || 0,
          data?.report?.findingTotal || 0,
        )}
      />
      <ScanReport report={data?.report} draft={data?.aiDraft} />
    </main>
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
    <PublicPageHeader next="/free-site-scan" />
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
