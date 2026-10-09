import { Section } from "@/components/app-ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Activity, ArrowRight, Hash, Phone, PhoneCall, ShieldBan, Sparkles, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState, MetricCard, StatusPill } from "@/components/crm-ui";
import { prettyPhone } from "@/lib/voice-studio";
import { inNativeApp } from "@/lib/app-shell";
import { CALL_ASSISTANT_FREE_SPAM_CALLS } from "@shared/plans";
import { CALL_ASSISTANT_SEPARATE_LINE, callAssistantOverageStatusLine, callAssistantTiers, formatUsd } from "@shared/plan-copy";
import type { VoiceStatus } from "./index";
import { CallAssistantPausedBanner } from "./paused-banner";
import { CallResults, type ResultsPick } from "./results";
import { GoogleList, GoogleListRow, GooglePill, GoogleStat, GoogleStatGrid } from "@/components/google";
import { fmtWhen, outcomeLabel, outcomeTone } from "./calls-shared";

type NumberRow = { id?: string | number; phoneNumber?: string; label?: string | null; location?: string | null; status?: string; isTest?: boolean };
type CallRow = { id: string | number; startedAt?: string; from?: string; fromNumber?: string; outcome?: string; summary?: string | null; durationSeconds?: number };

/**
 * Overview tab — is the add-on on, which numbers ring the assistant, minutes
 * used against the allowance, the published version, and the last few calls.
 * Reads GET /api/crm/voice/status (numbers+billing lane fills numbers/usage)
 * and GET /api/crm/voice/calls?limit=5 (calls+crm lane; an error here just
 * hides the list). OWNER: studio-frontend lane.
 */
export function OverviewPanel({ status, loading, onPickResult }: { status: VoiceStatus | null; loading: boolean; onPickResult?: (pick: ResultsPick) => void }) {
  // Every call, spam included: the empty state can't say "No calls yet" while the spam tile counts some (audit lane 1 A).
  const calls = useQuery<{ calls: CallRow[] } | CallRow[]>({ queryKey: ["/api/crm/voice/calls?limit=5&spam=all"], enabled: !!status?.enabled || !!status?.paused, retry: false });
  const recent: CallRow[] = Array.isArray(calls.data) ? calls.data : calls.data?.calls ?? [];

  if (loading || !status) {
    return (
      <div data-testid="panel-call-assistant-overview" className="pt-4">
        <EmptyState icon={Phone} title={loading ? "Loading…" : "Overview"} description="Status, numbers and minutes used will show here." />
      </div>
    );
  }

  const numbers = (status.numbers as NumberRow[]).filter((n) => n && n.status !== "released");
  const used = status.usage?.minutes ?? 0;
  // -1 = unlimited minutes (platform admins): no ceiling to measure against, never overage.
  const unlimitedMinutes = status.allowance.minutes < 0;
  const included = status.allowance.minutes || status.pricing.includedMinutes;
  const pct = !unlimitedMinutes && included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0;
  const overage = status.usage?.overageMinutes ?? 0;
  // Each call's overage is priced at the rate of the tier it was taken on (server/voice/billing-usage.ts): show the meter's cents.
  const overageCost = formatUsd(status.usage?.overageCents ?? overage * (status.pricing.overageCentsPerMinute ?? 0));
  const profileStatus = status.profile?.status ?? "draft";
  // The server probes the engine's /health (cached ~30 s); "configured" alone says nothing about whether calls get answered.
  const engine: { tone: "success" | "warning" | "danger"; text: string; hint: string } =
    !status.engine.configured ? { tone: "warning", text: "Engine not configured", hint: "The app has no engine secret set." }
    : !status.engine.reachable ? { tone: "danger", text: "Engine down", hint: "The voice engine is not answering; calls to your numbers can't be picked up right now." }
    : !status.engine.models ? { tone: "warning", text: "Engine starting", hint: "The engine is up but its speech models are still loading." }
    : { tone: "success", text: "Engine up", hint: "The voice engine is answering." };
  // An outside receptionist (Alpine's Janice) answering these lines and pushing her calls here (server/voice/ingest.ts):
  // the account is live through her even though ConstructHUB's own assistant was never published.
  const ext = status.external ?? null;
  const ownLive = status.profile?.publishedVersion != null;
  // Her calls never touch ConstructHUB's minute meter, so the minutes and spam tiles count her calls instead
  // (owner 2026-10-04: "why are the stats not updated such as spam this month and min").
  const extMonth = ext && !ownLive ? ext.thisMonth ?? null : null;
  const nextStep: { text: string; href: string; testid: string; label: string } =
    ext && !ownLive ? { text: `${ext.name} answers your calls — ${ext.callsLast30Days.toLocaleString("en-US")} in the last 30 days`, href: "/call-assistant?tab=calls", testid: "link-overview-next-calls", label: "View calls" }
    : !ownLive ? { text: "Set up and publish your assistant", href: "/call-assistant?tab=studio", testid: "link-overview-next-studio", label: "Continue" }
    : numbers.length === 0 ? { text: "Get a local number", href: "/call-assistant?tab=numbers", testid: "link-overview-next-numbers", label: "Continue" }
    : { text: "Try a test conversation", href: "/call-assistant?tab=simulator", testid: "link-overview-next-simulator", label: "Continue" };

  const paymentPaused = !status.enabled && status.paused === true;
  const tiers = callAssistantTiers();
  const heldTier = status.tier ? tiers.find((t) => t.tier === status.tier!.key) ?? null : null;
  const heldIndex = heldTier ? tiers.indexOf(heldTier) : -1;
  // Own assistant live AND an outside receptionist pushing calls: spam adds both (disjoint engines); the minutes tile
  // stays the billed meter and names her minutes in its hint (audit lane 1 B — the 7e2512b shape, mixed case).
  const extAlso = ext && ownLive ? ext.thisMonth ?? null : null;
  const spamThisMonth = (status.usage?.spamCallsThisMonth ?? 0) + (extAlso?.spam ?? 0);
  const freeSpamUsed = status.usage?.freeSpamCalls ?? 0;
  const freeSpamLimit = status.usage?.freeSpamCallsLimit ?? status.pricing.freeSpamCalls ?? CALL_ASSISTANT_FREE_SPAM_CALLS;
  return (
    <div data-testid="panel-call-assistant-overview" className="pt-4 space-y-4">
      {paymentPaused && <CallAssistantPausedBanner status={status} />}
      <Section flush className="border-0 bg-transparent">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="g-stat__label">Next step</div>
            <div className="g-card__title g-card__title--md" data-testid="text-overview-next-step">{nextStep.text}</div>
          </div>
          <GooglePill variant="solid" className="w-full sm:w-auto" href={nextStep.href} label={nextStep.label} testId={nextStep.testid} />
        </div>
      </Section>
      <GoogleStatGrid cols={4}>
        {ext && !ownLive ? (
          <GoogleStat label="Assistant" testId="metric-overview-assistant" href="/call-assistant?tab=calls"
            value="Live" hint={`${ext.name}, your own receptionist · last call ${new Date(ext.lastCallAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`} />
        ) : (
          <GoogleStat label="Assistant" testId="metric-overview-assistant" href="/call-assistant?tab=studio"
            value={paymentPaused ? <span className="text-amber-600 dark:text-amber-400">Paused</span> : <span className="capitalize">{profileStatus}</span>}
            hint={paymentPaused ? "Waiting for a payment" : ownLive ? `Version ${status.profile!.publishedVersion} is live` : "Not published yet"} />
        )}
        {ext && numbers.length === 0 ? (
          <GoogleStat label="Lines" value={ext.lines.length || 1} testId="metric-overview-numbers" href="/call-assistant?tab=calls"
            hint={`${ext.lines.length ? ext.lines.join(" & ") + " · " : ""}answered by ${ext.name}`} />
        ) : (
          <GoogleStat label="Numbers" value={numbers.length} testId="metric-overview-numbers" href="/call-assistant?tab=numbers"
            hint={`${status.allowance.numbers} included`} />
        )}
        {extMonth ? (
          <GoogleStat label="Minutes this month" value={extMonth.minutes.toLocaleString("en-US")} testId="metric-overview-minutes" href="/call-assistant?tab=calls"
            hint={`${extMonth.calls.toLocaleString("en-US")} calls answered by ${ext!.name} · not billed here`} />
        ) : (
          <GoogleStat label="Minutes this month" value={used.toLocaleString("en-US")} testId="metric-overview-minutes" href="/call-assistant?tab=calls"
            hint={`${unlimitedMinutes ? "Unlimited minutes" : `of ${included.toLocaleString("en-US")} · ${(status.usage?.calls ?? 0).toLocaleString("en-US")} calls${overage > 0 ? ` · ${overage} over${inNativeApp() ? "" : ` (${overageCost})`}` : ""}`}${extAlso ? ` · + ${extAlso.minutes.toLocaleString("en-US")} min answered by ${ext!.name}` : ""}`} />
        )}
        {extMonth ? (
          <GoogleStat label="Spam stopped this month" value={extMonth.spam.toLocaleString("en-US")} testId="metric-overview-spam" href="/call-assistant?tab=calls&view=spam"
            hint={`Screened out by ${ext!.name}`} />
        ) : (
          <GoogleStat label="Spam stopped this month" value={spamThisMonth.toLocaleString("en-US")} testId="metric-overview-spam" href="/call-assistant?tab=calls&view=spam"
            hint={`${Math.min(freeSpamUsed, freeSpamLimit).toLocaleString("en-US")} of ${freeSpamLimit.toLocaleString("en-US")} free spam calls used`} />
        )}
      </GoogleStatGrid>
      {/* "Calls this month" folded into the minutes tile (less is more); the testid stays for links/tests. */}
      <span className="sr-only" data-testid="metric-overview-calls">{extMonth ? extMonth.calls : status.usage?.calls ?? 0} calls this month</span>

      <CallResults onPick={(p) => {
        if (onPickResult) onPickResult(p);
        else window.location.assign(p === "spam" ? "/call-assistant?tab=calls&view=spam" : `/call-assistant?tab=calls&outcome=${p}`);
      }} />

      {/* The iPhone apps sell nothing (owner, 2026-10-04 — App Store 3.1.3(f)): no tier names, prices,
          "Change tier" / "Choose a tier" or the compare list — changing tiers is billing, not in the app. */}
      {!inNativeApp() && (
      <Section flush testId="card-overview-tier">
        <CardContent className="p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="g-stat__label">Your tier</div>
              <div className="g-card__title g-card__title--md" data-testid="text-overview-tier">
                {heldTier ? `${heldTier.name} a month and ${heldTier.numbersLabel}` : "No tier on this account"}
              </div>
            </div>
            {status.canManage !== false && (
              <GooglePill icon={ArrowRight} size="sm" href="/settings?tab=billing" label={heldTier ? "Change tier" : "Choose a tier"} testId="link-overview-change-tier" />
            )}
          </div>
          <details className="text-sm"><summary className="cursor-pointer py-2 font-medium">Compare tiers</summary>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm" data-testid="list-overview-tiers">
            {tiers.map((t, i) => (
              <li key={t.tier} className={`rounded-md border px-3 py-2 ${t === heldTier ? "border-primary/60 bg-primary/5" : ""}`} data-testid={`row-overview-tier-${t.tier}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {t === heldTier ? "Current" : heldIndex < 0 ? "" : i > heldIndex ? "Upgrade" : "Downgrade"}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">{t.monthly}/mo · {t.numbersLabel} · {t.overageShort}/min over</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Change tiers any time in Settings → Billing; the difference is prorated. A smaller tier keeps fewer numbers, and you see which ones stop answering before you confirm.
          </p>
          </details>
        </CardContent>
      </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section flush>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="g-card__title g-card__title--md">Minutes used</h3>
              <span className="text-sm text-muted-foreground tabular-nums" data-testid="text-overview-minutes-pct">{unlimitedMinutes ? "Unlimited" : `${pct}%`}</span>
            </div>
            {!unlimitedMinutes && <Progress value={pct} aria-label="Minutes used this month" data-testid="progress-overview-minutes" />}
            {/* Billing copy — the per-minute price stays out of the app (it sells nothing). */}
            {!inNativeApp() && (
            <details className="text-sm"><summary className="cursor-pointer py-2">Billing details</summary>
            <p className="text-xs text-muted-foreground">
              {status.usage?.month ? `For ${status.usage.month}. ` : ""}Every started minute of an answered call counts. <span data-testid="text-overview-overage-status">{callAssistantOverageStatusLine(status.overageBilling, status.pricing.overageCentsPerMinute)}</span> The first {freeSpamLimit.toLocaleString("en-US")} spam calls each month never count toward your minutes; blocked numbers are rejected before answering and cost nothing.
              {status.addon.preview ? " Pricing is being finalized." : ""}
            </p>
            <p className="text-xs" data-testid="text-overview-price">
              <span className="font-medium">{status.addon.name}:</span> {CALL_ASSISTANT_SEPARATE_LINE} Change tiers or add numbers in Settings → Billing.
            </p>
            </details>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary">{status.addon.name}</Badge>
              {status.addon.preview && <Badge variant="outline" data-testid="badge-overview-preview">Coming soon</Badge>}
              {status.plan && !inNativeApp() && <Badge variant="outline" className="capitalize">{status.plan} plan</Badge>}
              <StatusPill tone={engine.tone} data-testid="pill-overview-engine" title={engine.hint}>{engine.text}</StatusPill>
            </div>
          </CardContent>
        </Section>

        <Section flush>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="g-card__title g-card__title--md">Numbers ringing the assistant</h3>
              <GooglePill icon={ArrowRight} size="sm" variant="quiet" href="/call-assistant?tab=numbers" label="Manage" testId="link-overview-numbers" />
            </div>
            {numbers.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-overview-no-numbers">
                {inNativeApp()
                  ? "No number yet. Get a local number in the Numbers tab, then forward your existing line to it."
                  : "No number yet. Buy a local number in the Numbers tab, then forward your existing line to it."}
              </p>
            ) : (
              <GoogleList as="ul" testId="list-overview-numbers">
                {numbers.map((n, i) => (
                  <GoogleListRow
                    as="li"
                    size="md"
                    key={String(n.id ?? n.phoneNumber ?? i)}
                    testId={`row-overview-number-${i}`}
                    title={<span className="tabular-nums">{n.phoneNumber ? prettyPhone(n.phoneNumber) : "—"}</span>}
                    badges={n.isTest ? <span className="g-chip g-chip--sm">test</span> : undefined}
                    meta={[n.label, n.location]}
                    trailing={n.status ? <StatusPill tone={n.status === "active" ? "success" : "warning"}>{n.status}</StatusPill> : undefined}
                  />
                ))}
              </GoogleList>
            )}
          </CardContent>
        </Section>
      </div>

      <Section flush>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="g-card__title g-card__title--md">Recent calls</h3>
            <GooglePill icon={ArrowRight} size="sm" variant="quiet" href="/call-assistant?tab=calls" label="All calls" testId="link-overview-calls" />
          </div>
          {calls.isError || recent.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-overview-no-calls">
              {calls.isError ? "The call log isn't available yet." : "No calls yet. Once a forwarded line rings the assistant, every call shows here with its outcome and summary."}
            </p>
          ) : (
            <GoogleList as="ul" testId="list-overview-calls">
              {recent.map((c, i) => (
                <GoogleListRow
                  as="li"
                  size="md"
                  key={String(c.id)}
                  testId={`row-overview-call-${i}`}
                  leading={<Activity aria-hidden="true" />}
                  title={<span className="tabular-nums">{prettyPhone(c.from ?? c.fromNumber ?? "")}</span>}
                  href={`/call-assistant?tab=calls&call=${encodeURIComponent(String(c.id))}`}
                  titleTestId={`link-overview-call-${i}`}
                  badges={c.outcome ? <StatusPill tone={outcomeTone(c.outcome)}>{outcomeLabel(c.outcome)}</StatusPill> : undefined}
                  meta={[c.summary || null, c.startedAt ? fmtWhen(c.startedAt) : null]}
                />
              ))}
            </GoogleList>
          )}
        </CardContent>
      </Section>


    </div>
  );
}
