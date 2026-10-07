/**
 * /report-issue (platform, signed in or out) and /crm/report-issue (the same page inside the CRM frame):
 * "Report an issue" in every footer lands here. A report goes to the issue desk (docs/ops/ISSUE-DESK.md) as its
 * own ops_issues row — POST /api/issues/report — and the desk takes user reports before anything the app
 * captured itself, "I can't use the site" first.
 *
 * Nothing is sent that the page does not show: "What we send with your report" lists every automatic value
 * (the server keeps a shorter form of some: browser + OS instead of the whole user agent, the page path without
 * its query string, emails and phone numbers masked).
 *
 * Signed out it asks for an email — where the answer goes — and there is no "Your reports" list (that needs an account).
 */
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, ImagePlus, Loader2, Send, X } from "lucide-react";
import {
  USER_REPORT_IMPACTS, USER_REPORT_IMPACT_LABELS,
  type MyIssueReport, type PublicReportStatus, type UserReportDiagnostics, type UserReportImpact,
} from "@shared/ops-issues";
import { GooglePill, GoogleSectionHeader, GoogleSurface } from "@/components/google";
import { HelpButton } from "@/components/help-button";
import { PublicPageFooter } from "@/components/public-page-chrome";
import { StatusPill, type PillTone } from "@/components/crm-ui";
import { useDocumentTitle } from "@/components/feature-landing/primitives";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { recentClientErrors } from "@/lib/report-client-errors";
import { marketingUrl } from "@/lib/site";
import { cn } from "@/lib/utils";

const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
const SCREENSHOT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const STATUS_TONE: Record<PublicReportStatus, PillTone> = { received: "neutral", looking: "info", fix_ready: "warning", fixed: "success", not_a_bug: "neutral" };
const IMPACT_HINT: Record<UserReportImpact, string> = {
  blocker: "Looked at before everything else.",
  broken: "A feature fails, but you found another way.",
  minor: "A typo, something confusing, or an idea.",
};

type Mine = { account: { id: number; plan: string | null }; reports: MyIssueReport[] } | null;
type Sent = { id: number | null; reference: string | null; screenshot: "saved" | "not_saved" | "none"; email: string };

/** The page the person came from: `?from=` (the footers set it), else a same-site referrer. Path only. */
function cameFrom(): string {
  try {
    const from = new URLSearchParams(window.location.search).get("from");
    if (from && from.startsWith("/") && !from.startsWith("//")) return from.slice(0, 300);
    if (document.referrer) {
      const ref = new URL(document.referrer);
      if (ref.host === window.location.host && !/\/report-issue$/.test(ref.pathname)) return ref.pathname.slice(0, 300);
    }
  } catch { /* a malformed referrer: leave the field empty */ }
  return "";
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

const field = "g-input";
const label = "block text-sm font-medium text-[color:var(--g-text)]";
const hint = "mt-1 text-xs text-[color:var(--g-text-2)]";

function ReportIssueView({ crm = false }: { crm?: boolean }) {
  useDocumentTitle("Report an issue | ConstructHUB");
  const { data: mine, isLoading: mineLoading } = useQuery<Mine>({
    queryKey: ["/api/issues/mine"],
    queryFn: async () => {
      const res = await fetch("/api/issues/mine", { credentials: "include", cache: "no-store" });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    // A reply or a new status shows up without a reload.
    refetchInterval: (q) => (q.state.data ? 60_000 : false),
  });
  const signedIn = !!mine;

  const [trying, setTrying] = useState("");
  const [happened, setHappened] = useState("");
  const [page, setPage] = useState(cameFrom);
  const [impact, setImpact] = useState<UserReportImpact | "">("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [shot, setShot] = useState<{ name: string; type: string; data: string; bytes: number } | null>(null);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Read once per page view: the values below are what the box shows AND what the form posts.
  const diagnostics = useMemo<UserReportDiagnostics>(() => ({
    url: `${window.location.origin}${window.location.pathname}`,
    userAgent: navigator.userAgent,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    language: navigator.language,
    timezone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })(),
    time: new Date().toISOString(),
    recentErrors: recentClientErrors(),
  }), [sent]);

  async function chooseShot(file: File | undefined) {
    setError(null);
    if (!file) return setShot(null);
    if (!SCREENSHOT_TYPES.includes(file.type)) return setError({ message: "The screenshot must be a PNG, JPEG, WebP or GIF image.", field: "screenshot" });
    if (file.size > SCREENSHOT_MAX_BYTES) return setError({ message: "The screenshot is too large (5 MB at most).", field: "screenshot" });
    try {
      setShot({ name: file.name, type: file.type, bytes: file.size, data: await readAsDataUrl(file) });
    } catch {
      setError({ message: "That file couldn’t be read. Try another image.", field: "screenshot" });
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (trying.trim().length < 3) return setError({ message: "Tell us what you were trying to do (a few words is enough).", field: "trying" });
    if (happened.trim().length < 5) return setError({ message: "Tell us what happened instead.", field: "happened" });
    if (!impact) return setError({ message: "Choose how bad it is.", field: "impact" });
    if (!signedIn && !email.trim()) return setError({ message: "Add your email address so we can reply.", field: "email" });
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/issues/report", {
        trying, happened, page, impact, email: signedIn ? "" : email, website,
        diagnostics: { ...diagnostics, time: new Date().toISOString(), recentErrors: recentClientErrors() },
        screenshot: shot ? { type: shot.type, data: shot.data } : null,
      });
      const body = await res.json();
      setSent({ id: body.id, reference: body.reference, screenshot: body.screenshot, email: email.trim() });
      setTrying(""); setHappened(""); setImpact(""); setShot(null);
      void queryClient.invalidateQueries({ queryKey: ["/api/issues/mine"] });
      window.scrollTo?.(0, 0);
      document.querySelector("[data-testid='page-report-issue']")?.scrollIntoView?.({ block: "start" });
    } catch (err) {
      let fieldName: string | undefined;
      try { fieldName = JSON.parse(String((err as Error).message).replace(/^\d{3}:\s*/, "")).field; } catch { /* not our JSON */ }
      setError({ message: apiErrorMessage(err, "We couldn’t send your report. Check your connection and try again."), field: fieldName });
    } finally {
      setBusy(false);
    }
  }

  const invalid = (name: string) => (error?.field === name ? { "aria-invalid": true as const, "aria-describedby": "report-error" } : {});
  const helpHref = crm ? marketingUrl("/tutorials#group-crm") : "/tutorials";

  return (
    <>
      <GoogleSurface accent="brand" className="min-h-full" testId="page-report-issue">
        <div className="mx-auto w-full max-w-2xl px-4 pb-12 pt-5 sm:px-6 sm:pt-8">
          <GoogleSectionHeader
            as="h1" title="Report an issue" titleTestId="text-report-title" titleAfter={<HelpButton k="report-issue" />}
            description="Reports go straight to our issue desk. Anything that stops the site from working is looked at first."
          />

          {sent && (
            <div className="g-callout mb-6" role="status" data-testid="report-confirmation">
              <h3 className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-[color:var(--g-accent)]" aria-hidden="true" />
                <span>Thank you. Your report {sent.reference ? <strong data-testid="text-report-reference">{sent.reference}</strong> : null} was received.</span>
              </h3>
              <ul>
                <li>The issue desk reads every report. Reports that stop the site from working go first.</li>
                {signedIn
                  ? <li>Its status and our reply appear under “Your reports” below.</li>
                  : <li>We kept {sent.email || "your email address"} with the report so we can write back. Sign in next time to follow a report here.</li>}
                {sent.screenshot === "not_saved" && <li data-testid="text-report-screenshot-not-saved">Your report was saved, but the screenshot could not be stored. If the picture matters, email it to support@constructhub.us with the number above.</li>}
              </ul>
              <div className="mt-3">
                <GooglePill size="sm" label="Report something else" onClick={() => setSent(null)} testId="button-report-another" />
              </div>
            </div>
          )}

          {!sent && (
            <form onSubmit={submit} noValidate className="space-y-5" data-testid="form-report-issue">
              <div>
                <label htmlFor="report-trying" className={label}>What were you trying to do?</label>
                <input id="report-trying" className={cn(field, "mt-1.5")} value={trying} onChange={(e) => setTrying(e.target.value)} maxLength={300}
                  placeholder="Send an estimate to a client" autoComplete="off" data-testid="input-report-trying" {...invalid("trying")} />
              </div>

              <div>
                <label htmlFor="report-happened" className={label}>What happened instead?</label>
                <textarea id="report-happened" className={cn(field, "mt-1.5 min-h-[140px] resize-y py-2.5 leading-5")} value={happened} onChange={(e) => setHappened(e.target.value)}
                  maxLength={5000} placeholder="What you clicked, what you saw, and any message on the screen." data-testid="input-report-happened" {...invalid("happened")} />
                <p className={hint}>Please leave out passwords and card numbers. We never need them.</p>
              </div>

              <div>
                <label htmlFor="report-page" className={label}>Which page?</label>
                <input id="report-page" className={cn(field, "mt-1.5")} value={page} onChange={(e) => setPage(e.target.value)} maxLength={500}
                  placeholder="/search, or paste the address" autoComplete="off" inputMode="url" data-testid="input-report-page" />
                <p className={hint}>Filled in from where you came from. Change it if the problem is somewhere else.</p>
              </div>

              <fieldset {...invalid("impact")}>
                <legend className={label}>How bad is it?</legend>
                <div className="mt-2 space-y-2" role="radiogroup" aria-label="How bad is it?">
                  {USER_REPORT_IMPACTS.map((key) => (
                    <label key={key} className={cn(
                      "flex min-h-[52px] cursor-pointer items-start gap-3 rounded-lg border border-[color:var(--g-divider)] px-3.5 py-3 text-sm transition-colors hover:bg-[color:var(--g-hover)]",
                      impact === key && "border-[color:var(--g-accent)] bg-[color:var(--g-accent-soft)]")} data-testid={`option-report-impact-${key}`}>
                      <input type="radio" name="impact" value={key} checked={impact === key} onChange={() => setImpact(key)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--g-accent)]" data-testid={`radio-report-impact-${key}`} />
                      <span className="min-w-0">
                        <span className="block font-medium text-[color:var(--g-text)]">{USER_REPORT_IMPACT_LABELS[key]}</span>
                        <span className="block text-xs text-[color:var(--g-text-2)]">{IMPACT_HINT[key]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {!signedIn && !mineLoading && (
                <div>
                  <label htmlFor="report-email" className={label}>Your email</label>
                  <input id="report-email" type="email" className={cn(field, "mt-1.5")} value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254}
                    placeholder="you@company.com" autoComplete="email" inputMode="email" data-testid="input-report-email" {...invalid("email")} />
                  <p className={hint}>Only so we can reply about this report. <a className="g-link" href={`/auth?next=${encodeURIComponent(crm ? "/crm/report-issue" : "/report-issue")}`}>Sign in</a> instead to follow it here.</p>
                </div>
              )}

              {/* The honeypot: no person sees or reaches this field; a form-filling bot does. */}
              <div aria-hidden="true" className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label htmlFor="report-website">Website</label>
                <input id="report-website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>

              <div>
                <span className={label}>Screenshot <span className="font-normal text-[color:var(--g-text-2)]">(optional)</span></span>
                <input ref={fileRef} type="file" accept={SCREENSHOT_TYPES.join(",")} className="sr-only" tabIndex={-1}
                  onChange={(e) => { void chooseShot(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-report-screenshot" />
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <GooglePill size="sm" icon={ImagePlus} label={shot ? "Choose another image" : "Add a screenshot"} onClick={() => fileRef.current?.click()} testId="button-report-screenshot" />
                  {shot && (
                    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-[color:var(--g-text-2)]" data-testid="text-report-screenshot-name">
                      <span className="truncate">{shot.name}</span>
                      <span className="shrink-0 tabular-nums">({(shot.bytes / 1024 / 1024).toFixed(1)} MB)</span>
                      <button type="button" onClick={() => setShot(null)} aria-label="Remove the screenshot" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-[color:var(--g-hover)]">
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </div>
                <p className={hint}>One image, 5 MB at most. Only our team can open it.</p>
              </div>

              <details className="g-callout" data-testid="details-report-diagnostics">
                <summary className="cursor-pointer text-sm font-medium text-[color:var(--g-text)]">What we send with your report</summary>
                <p className="mt-2">Sent automatically so we can reproduce the problem. Nothing else is attached.</p>
                <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]" data-testid="list-report-diagnostics">
                  <dt className="text-[color:var(--g-text-2)]">Page</dt>
                  <dd className="break-all text-[color:var(--g-text)]">{page.trim() || "Not given"} <span className="text-[color:var(--g-text-2)]">(sent from {window.location.pathname})</span></dd>
                  <dt className="text-[color:var(--g-text-2)]">Browser and system</dt>
                  <dd className="break-words text-[color:var(--g-text)]">{diagnostics.userAgent} <span className="text-[color:var(--g-text-2)]">(we keep only the browser, its version and the operating system)</span></dd>
                  <dt className="text-[color:var(--g-text-2)]">Window size</dt>
                  <dd className="tabular-nums text-[color:var(--g-text)]">{diagnostics.viewport.width} × {diagnostics.viewport.height}</dd>
                  <dt className="text-[color:var(--g-text-2)]">Language, time zone</dt>
                  <dd className="text-[color:var(--g-text)]">{diagnostics.language || "Unknown"}, {diagnostics.timezone || "unknown"}</dd>
                  <dt className="text-[color:var(--g-text-2)]">Time</dt>
                  <dd className="text-[color:var(--g-text)]">{format(new Date(diagnostics.time), "MMM d, yyyy h:mm a")} (the moment you send)</dd>
                  <dt className="text-[color:var(--g-text-2)]">Account</dt>
                  <dd className="text-[color:var(--g-text)]" data-testid="text-report-account">
                    {mine ? <>Account number {mine.account.id}, plan: {mine.account.plan ?? "none"}</> : "Not signed in. The email address you type above."}
                  </dd>
                  <dt className="text-[color:var(--g-text-2)]">Errors this page saw</dt>
                  <dd className="min-w-0 text-[color:var(--g-text)]">
                    {diagnostics.recentErrors.length === 0 ? "None since this tab was opened." : (
                      <ul className="!mt-0 space-y-1 !pl-4">
                        {diagnostics.recentErrors.map((e, i) => <li key={`${e.at}-${i}`} className="break-words !text-[color:var(--g-text)]">{e.message}</li>)}
                      </ul>
                    )}
                  </dd>
                </dl>
                <p className="mt-3">Before anything is stored, email addresses and phone numbers in the text are masked, and anything that looks like a password, key or card number is removed.</p>
              </details>

              {error && <p id="report-error" role="alert" className="text-sm font-medium text-destructive" data-testid="text-report-error">{error.message}</p>}

              <div className="flex flex-wrap items-center gap-3">
                <GooglePill variant="solid" type="submit" icon={busy ? Loader2 : Send} label={busy ? "Sending…" : "Send report"} disabled={busy}
                  className={cn("min-h-[44px] px-6", busy && "[&>svg]:animate-spin")} testId="button-report-submit" />
                <a href={helpHref} className="g-link text-sm" data-testid="link-report-help">Looking for how something works? Open Help</a>
              </div>
            </form>
          )}

          {signedIn && (
            <section className="mt-10" aria-labelledby="your-reports" data-testid="section-your-reports">
              <GoogleSectionHeader title={<span id="your-reports">Your reports</span>} count={mine!.reports.length || null} flush />
              {mine!.reports.length === 0 ? (
                <p className="py-6 text-sm text-[color:var(--g-text-2)]" data-testid="empty-your-reports">You haven’t reported anything yet.</p>
              ) : (
                <ul className="divide-y divide-[color:var(--g-divider)]" data-testid="list-your-reports">
                  {mine!.reports.map((r) => (
                    <li key={r.id} className="py-3.5" data-testid={`row-report-${r.id}`}>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs tabular-nums text-[color:var(--g-text-2)]">#{r.id}</span>
                        <StatusPill tone={STATUS_TONE[r.status]} data-testid={`status-report-${r.id}`}>{r.statusLabel}</StatusPill>
                        <span className="text-xs text-[color:var(--g-text-2)]">{format(new Date(r.createdAt), "MMM d, yyyy")}</span>
                      </div>
                      <p className="mt-1 break-words text-sm text-[color:var(--g-text)]">{r.trying}</p>
                      <p className="text-xs text-[color:var(--g-text-2)]">{USER_REPORT_IMPACT_LABELS[r.impact]}</p>
                      {r.reply && (
                        <div className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-[color:var(--g-surface-2)] px-3 py-2 text-sm text-[color:var(--g-text)]" data-testid={`reply-report-${r.id}`}>
                          <span className="mb-0.5 block text-xs font-medium text-[color:var(--g-text-2)]">Reply from ConstructHUB{r.repliedAt ? ` · ${format(new Date(r.repliedAt), "MMM d")}` : ""}</span>
                          {r.reply}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </GoogleSurface>
      {!crm && <PublicPageFooter />}
    </>
  );
}

/** The same page inside the CRM frame (portal host). */
export function CrmReportIssuePage() {
  return <ReportIssueView crm />;
}

export default function ReportIssuePage() {
  return <ReportIssueView />;
}
