import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Activity, ArrowRight, Hash, Phone, PhoneCall, ShieldBan, Sparkles, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState, MetricCard, StatusPill } from "@/components/crm-ui";
import { prettyPhone } from "@/lib/voice-studio";
import { CALL_ASSISTANT_FREE_SPAM_CALLS } from "@shared/plans";
import { callAssistantIntroShort, callAssistantTiers, formatUsd } from "@shared/plan-copy";
import type { VoiceStatus } from "./index";
import { CallAssistantPausedBanner } from "./paused-banner";
import { CallResults, type ResultsPick } from "./results";
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
  const calls = useQuery<{ calls: CallRow[] } | CallRow[]>({ queryKey: ["/api/crm/voice/calls?limit=5"], enabled: !!status?.enabled || !!status?.paused, retry: false });
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
  const nextStep =
    !status.profile || status.profile.publishedVersion == null ? { text: "Set up and publish your assistant", href: "/call-assistant?tab=studio", testid: "link-overview-next-studio" }
    : numbers.length === 0 ? { text: "Get a local number", href: "/call-assistant?tab=numbers", testid: "link-overview-next-numbers" }
    : { text: "Try a test conversation", href: "/call-assistant?tab=simulator", testid: "link-overview-next-simulator" };

  const paymentPaused = !status.enabled && status.paused === true;
  const tiers = callAssistantTiers();
  const heldTier = status.tier ? tiers.find((t) => t.tier === status.tier!.key) ?? null : null;
  const heldIndex = heldTier ? tiers.indexOf(heldTier) : -1;
  const spamThisMonth = status.usage?.spamCallsThisMonth ?? 0;
  const freeSpamUsed = status.usage?.freeSpamCalls ?? 0;
  const freeSpamLimit = status.usage?.freeSpamCallsLimit ?? status.pricing.freeSpamCalls ?? CALL_ASSISTANT_FREE_SPAM_CALLS;
  return (
    <div data-testid="panel-call-assistant-overview" className="pt-4 space-y-4">
      {paymentPaused && <CallAssistantPausedBanner status={status} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard icon={Sparkles} label="Assistant" testid="metric-overview-assistant"
          value={paymentPaused
            ? <StatusPill tone="warning" className="text-sm">paused</StatusPill>
            : <StatusPill tone={profileStatus === "live" ? "success" : profileStatus === "paused" ? "warning" : "neutral"} className="text-sm">{profileStatus}</StatusPill>}
          context={paymentPaused ? "Waiting for a payment" : status.profile?.publishedVersion != null ? `Published version ${status.profile.publishedVersion}` : "Nothing published yet"} href="/call-assistant?tab=studio" />
        <MetricCard icon={Hash} label="Numbers" value={numbers.length} testid="metric-overview-numbers"
          context={`${status.allowance.numbers} included with your add-on`} href="/call-assistant?tab=numbers" />
        <MetricCard icon={Timer} label="Minutes this month" value={used.toLocaleString("en-US")} testid="metric-overview-minutes"
          context={unlimitedMinutes ? "Unlimited minutes" : `of ${included.toLocaleString("en-US")} included${overage > 0 ? ` · ${overage} over (${overageCost})` : ""}`} />
        <MetricCard icon={PhoneCall} label="Calls this month" value={status.usage?.calls ?? 0} testid="metric-overview-calls" href="/call-assistant?tab=calls" />
        <MetricCard icon={ShieldBan} label="Spam stopped this month" value={spamThisMonth.toLocaleString("en-US")} testid="metric-overview-spam"
          context={`${Math.min(freeSpamUsed, freeSpamLimit).toLocaleString("en-US")} of ${freeSpamLimit.toLocaleString("en-US")} free spam calls used`} href="/call-assistant?tab=calls&view=spam" />
      </div>

      <CallResults onPick={(p) => {
        if (onPickResult) onPickResult(p);
        else window.location.assign(p === "spam" ? "/call-assistant?tab=calls&view=spam" : `/call-assistant?tab=calls&outcome=${p}`);
      }} />

      <Card data-testid="card-overview-tier">
        <CardContent className="p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Your tier</div>
              <div className="font-semibold" data-testid="text-overview-tier">
                {heldTier ? `${heldTier.name} — ${heldTier.minutes} minutes and ${heldTier.numbersLabel} a month` : "No tier on this account"}
              </div>
            </div>
            {status.canManage !== false && (
              <Button asChild variant="outline" size="sm">
                <Link href="/settings?tab=billing" data-testid="link-overview-change-tier">{heldTier ? "Change tier" : "Choose a tier"} <ArrowRight className="h-4 w-4 ml-1" /></Link>
              </Button>
            )}
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm" data-testid="list-overview-tiers">
            {tiers.map((t, i) => (
              <li key={t.tier} className={`rounded-md border px-3 py-2 ${t === heldTier ? "border-primary/60 bg-primary/5" : ""}`} data-testid={`row-overview-tier-${t.tier}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {t === heldTier ? "Current" : heldIndex < 0 ? "" : i > heldIndex ? "Upgrade" : "Downgrade"}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">{t.monthly}/mo · {t.minutes} min · {t.numbersLabel} · {t.overageShort}/min over</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Change tiers any time in Settings → Billing; the difference is prorated. A smaller tier keeps fewer numbers, and you see which ones stop answering before you confirm.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Minutes used</h3>
              <span className="text-sm text-muted-foreground tabular-nums" data-testid="text-overview-minutes-pct">{unlimitedMinutes ? "Unlimited" : `${pct}%`}</span>
            </div>
            {!unlimitedMinutes && <Progress value={pct} aria-label="Minutes used this month" data-testid="progress-overview-minutes" />}
            <p className="text-xs text-muted-foreground">
              {status.usage?.month ? `For ${status.usage.month}. ` : ""}Minutes are billed per started minute. The first {freeSpamLimit.toLocaleString("en-US")} spam calls each month never count toward your minutes; blocked numbers are rejected before answering and cost nothing.
              {status.addon.preview ? " Pricing is being finalized." : ""}
            </p>
            <p className="text-xs" data-testid="text-overview-price">
              <span className="font-medium">{status.addon.name}:</span> Solo {callAssistantIntroShort()} (the intro price is for monthly billing and applies once, when the add-on is first added).
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary">{status.addon.name}</Badge>
              {status.addon.preview && <Badge variant="outline" data-testid="badge-overview-preview">Coming soon</Badge>}
              {status.plan && <Badge variant="outline" className="capitalize">{status.plan} plan</Badge>}
              <StatusPill tone={engine.tone} data-testid="pill-overview-engine" title={engine.hint}>{engine.text}</StatusPill>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Numbers ringing the assistant</h3>
              <Button asChild variant="ghost" size="sm"><Link href="/call-assistant?tab=numbers" data-testid="link-overview-numbers">Manage <ArrowRight className="h-4 w-4 ml-1" /></Link></Button>
            </div>
            {numbers.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-overview-no-numbers">No number yet. Buy a local number in the Numbers tab, then forward your existing line to it.</p>
            ) : (
              <ul className="divide-y rounded-md border text-sm" data-testid="list-overview-numbers">
                {numbers.map((n, i) => (
                  <li key={String(n.id ?? n.phoneNumber ?? i)} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid={`row-overview-number-${i}`}>
                    <span className="font-medium tabular-nums">{n.phoneNumber ? prettyPhone(n.phoneNumber) : "—"}</span>
                    {n.label && <span className="text-muted-foreground">{n.label}</span>}
                    {n.location && <span className="text-muted-foreground">· {n.location}</span>}
                    {n.isTest && <Badge variant="outline" className="text-[10px]">test</Badge>}
                    {n.status && <StatusPill tone={n.status === "active" ? "success" : "warning"} className="ml-auto">{n.status}</StatusPill>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Recent calls</h3>
            <Button asChild variant="ghost" size="sm"><Link href="/call-assistant?tab=calls" data-testid="link-overview-calls">All calls <ArrowRight className="h-4 w-4 ml-1" /></Link></Button>
          </div>
          {calls.isError || recent.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-overview-no-calls">
              {calls.isError ? "The call log isn't available yet." : "No calls yet. Once a forwarded line rings the assistant, every call shows here with its outcome and summary."}
            </p>
          ) : (
            <ul className="divide-y rounded-md border text-sm" data-testid="list-overview-calls">
              {recent.map((c, i) => (
                <li key={String(c.id)} data-testid={`row-overview-call-${i}`}>
                  <Link href={`/call-assistant?tab=calls&call=${encodeURIComponent(String(c.id))}`} className="flex flex-wrap items-center gap-2 px-3 py-2 hover:bg-muted/40" data-testid={`link-overview-call-${i}`}>
                    <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <span className="tabular-nums">{prettyPhone(c.from ?? c.fromNumber ?? "")}</span>
                    {c.outcome && <StatusPill tone={outcomeTone(c.outcome)}>{outcomeLabel(c.outcome)}</StatusPill>}
                    <span className="text-muted-foreground truncate flex-1 min-w-0">{c.summary ?? ""}</span>
                    {c.startedAt && <span className="text-xs text-muted-foreground">{fmtWhen(c.startedAt)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Next step</div>
            <div className="font-medium" data-testid="text-overview-next-step">{nextStep.text}</div>
          </div>
          <Button asChild><Link href={nextStep.href} data-testid={nextStep.testid}>Go <ArrowRight className="h-4 w-4 ml-1" /></Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
