/**
 * Press Releases automation UI (owner, 2026-10-17: "needs automation"), kept apart from the page's own design
 * (client/src/pages/press-releases.tsx mounts these with one line each). Every component fetches its own data.
 *
 *   PressStatusStrip         the account's pipeline in one line: next idea → monthly draft → when it goes out → where it is shared
 *   PressAutomationSettings  "Send it for me" (beside the autopilot switch) and "When a release goes live, share it to:"
 *   ReleaseAutomationBadges  on a release row: "Goes out Thu, Oct 23, 10:00 AM · Hold", why a send did not happen, where it was shared
 *   WriterSendControl        in the writer: the same countdown and Hold, or "Send it for me" for a clean draft
 *
 * Server side: server/press/send.ts (scheduling, Hold, the send at the time) and server/press/share.ts (auto-share).
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { PressAutopilotView, PressIdea, PressReleaseView, PressShareSettingsView, PressTier } from "@shared/press";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Notice, Section, StatusPill } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/* ── Data hooks ───────────────────────────────────────────────────────────── */

type Overview = { credits: Record<PressTier, number>; releases: PressReleaseView[]; autopilot: PressAutopilotView };
const getJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();
export const PRESS_KEYS = { overview: ["/api/press/overview"], ideas: ["/api/press/ideas"], share: ["/api/press/share"] } as const;
/** The page's own overview query (same key, so it is fetched once). */
export const usePressOverview = () => useQuery<Overview>({ queryKey: PRESS_KEYS.overview, queryFn: () => getJson("/api/press/overview"), refetchInterval: 30_000 });
export const usePressIdeas = () => useQuery<{ ideas: PressIdea[] }>({ queryKey: PRESS_KEYS.ideas, queryFn: () => getJson("/api/press/ideas"), staleTime: 60_000 });
export const usePressShare = () => useQuery<PressShareSettingsView>({ queryKey: PRESS_KEYS.share, queryFn: () => getJson("/api/press/share"), staleTime: 60_000 });
/** One release, fresh (the writer keeps its own copy). */
export const usePressRelease = (id: number | null | undefined) =>
  useQuery<PressReleaseView>({ queryKey: ["/api/press/releases", id], queryFn: () => getJson(`/api/press/releases/${id}`), enabled: !!id });
const refreshAll = () => Promise.all([
  queryClient.invalidateQueries({ queryKey: PRESS_KEYS.overview }),
  queryClient.invalidateQueries({ queryKey: ["/api/press/releases"] }),
]);

/* ── Words ────────────────────────────────────────────────────────────────── */

/** "Thu, Oct 23, 10:00 AM" in the viewer's clock. */
export const sendTimeWords = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const dayWords = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const scrollTo = (testId: string) => document.querySelector(`[data-testid="${testId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });

/* ── Status strip ─────────────────────────────────────────────────────────── */

function Step({ n, label, value, target, testId }: { n: number; label: string; value: ReactNode; target: string; testId: string }) {
  return (
    <li className="min-w-0">
      <button type="button" onClick={() => scrollTo(target)} className="block h-full w-full rounded-lg px-3 py-2.5 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={testId}>
        <div className="text-xs text-muted-foreground"><span className="tabular-nums">{n}.</span> {label}</div>
        <div className="mt-0.5 truncate text-sm font-medium underline decoration-muted-foreground/40 underline-offset-4">{value}</div>
      </button>
    </li>
  );
}

/** Next idea → Draft on <date> → Goes out on <date> (or "You approve it") → Shares to <n places>. Each step scrolls to its control. */
export function PressStatusStrip() {
  const overview = usePressOverview(), ideas = usePressIdeas(), share = usePressShare();
  if (!overview.data) return null;
  const ap = overview.data.autopilot;
  const idea = ideas.data?.ideas[0];
  const scheduled = overview.data.releases.filter((r) => r.sendAt).sort((a, b) => a.sendAt!.localeCompare(b.sendAt!))[0];
  const places = (share.data?.chosen.social.length ?? 0) + (share.data?.chosen.gbp.length ?? 0);
  return (
    <Section title="How your releases run" testId="press-status-strip" contentClassName="p-2 pt-1 sm:p-3 sm:pt-2">
      <ol className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-4">
        <Step n={1} label="Next idea" value={idea ? idea.title : "No idea found yet"} target="press-ideas-section" testId="press-strip-idea" />
        <Step n={2} label="Monthly draft" value={ap.enabled ? (ap.nextDraftOn ? (ap.nextDraftOn === new Date().toISOString().slice(0, 10) ? "Draft today" : `Draft on ${dayWords(ap.nextDraftOn)}`) : "Paused: no credit") : "Off"} target="press-autopilot" testId="press-strip-draft" />
        <Step n={3} label="Goes out" value={scheduled ? `Goes out ${sendTimeWords(scheduled.sendAt!)}` : ap.sendForMe ? "2 business days after the draft" : "You approve it"} target={scheduled ? `press-release-${scheduled.id}` : "press-send-for-me"} testId="press-strip-send" />
        <Step n={4} label="When live" value={places ? `Shares to ${places} place${places === 1 ? "" : "s"}` : "Not shared anywhere"} target="press-sharing" testId="press-strip-share" />
      </ol>
    </Section>
  );
}

/* ── Settings: Send it for me + auto-share ────────────────────────────────── */

function SendForMeSetting({ ap, hasCredit }: { ap: PressAutopilotView; hasCredit: boolean }) {
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: async (sendForMe: boolean) => (await apiRequest("PUT", "/api/press/autopilot", { enabled: ap.enabled, dayOfMonth: ap.dayOfMonth, sendForMe })).json(),
    onSuccess: () => void refreshAll(),
    onError: (e: any) => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <label className="flex items-start gap-3" data-testid="press-send-for-me">
      <Switch checked={ap.sendForMe} onCheckedChange={(v) => save.mutate(v)} disabled={save.isPending || (!hasCredit && !ap.sendForMe)} aria-label="Send it for me" data-testid="press-send-for-me-switch" />
      <span className="text-sm">
        <span className="block font-medium">Send it for me</span>
        <span className="block text-muted-foreground">A monthly draft that passes every guideline check goes out 2 business days later at 10:00 AM, using one credit. You get a notification with the exact time and a Hold link. Editing the draft also stops it.</span>
      </span>
    </label>
  );
}

function ShareSettings() {
  const { toast } = useToast();
  const { data, isLoading } = usePressShare();
  const [picked, setPicked] = useState<{ social: string[]; gbp: number[] } | null>(null);
  const choice = picked ?? data?.chosen ?? { social: [], gbp: [] };
  const save = useMutation({
    mutationFn: async (): Promise<PressShareSettingsView> => (await apiRequest("PUT", "/api/press/share", choice)).json(),
    onSuccess: (v) => { queryClient.setQueryData(PRESS_KEYS.share, v); setPicked(null); toast({ title: "Saved", description: "Your next live release is shared to the places you picked." }); },
    onError: (e: any) => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const toggle = <K extends "social" | "gbp">(k: K, v: K extends "social" ? string : number) =>
    setPicked({ ...choice, [k]: (choice[k] as any[]).includes(v) ? (choice[k] as any[]).filter((x) => x !== v) : [...(choice[k] as any[]), v] });
  const dirty = picked !== null;

  return (
    <div className="space-y-3" data-testid="press-sharing">
      <div>
        <div className="text-sm font-medium">When a release goes live, share it to:</div>
        <p className="text-sm text-muted-foreground">One post per place, with the headline, “Our news is on the wire today.” and the live link. Nothing is written by AI.</p>
      </div>
      {isLoading || !data ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div> : (
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="min-w-0 space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">Social accounts</legend>
            {!data.social.connected || !data.social.options.length
              ? <p className="text-sm text-muted-foreground" data-testid="press-share-social-none">{(data.social.reason ?? "No social accounts are connected yet.").replace(/([^.])$/, "$1.")} <a className="underline underline-offset-2" href="/social-media">Social Media</a></p>
              : data.social.options.map((o) => (
                <label key={o.key} className={cn("flex items-start gap-2 text-sm", !o.ok && "text-muted-foreground")}>
                  <Checkbox checked={choice.social.includes(o.key)} disabled={!o.ok} onCheckedChange={() => toggle("social", o.key)} className="mt-0.5" data-testid={`press-share-${o.key}`} />
                  <span className="min-w-0 break-words">{o.label}{o.reason && <span className="block text-xs">{o.reason}</span>}</span>
                </label>
              ))}
          </fieldset>
          <fieldset className="min-w-0 space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">Google Business Profile</legend>
            {!data.gbp.allowed && <p className="text-sm text-muted-foreground" data-testid="press-share-gbp-reason">{data.gbp.reason}</p>}
            {data.gbp.allowed && !data.gbp.options.length && <p className="text-sm text-muted-foreground">{data.gbp.reason}</p>}
            {data.gbp.options.map((o) => (
              <label key={o.key} className={cn("flex items-start gap-2 text-sm", !o.ok && "text-muted-foreground")}>
                <Checkbox checked={choice.gbp.includes(o.locationId)} disabled={!o.ok} onCheckedChange={() => toggle("gbp", o.locationId)} className="mt-0.5" data-testid={`press-share-${o.key}`} />
                <span className="min-w-0 break-words">{o.label}</span>
              </label>
            ))}
          </fieldset>
        </div>
      )}
      {dirty && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="press-share-save">{save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

/** "Send it for me" and the auto-share choice, mounted under the autopilot switch. */
export function PressAutomationSettings() {
  const { data } = usePressOverview();
  if (!data) return null;
  const hasCredit = Object.values(data.credits).some((n) => n > 0);
  return (
    <div className="mt-4 space-y-4 border-t pt-4" data-testid="press-automation-settings">
      {(hasCredit || data.autopilot.sendForMe) && <SendForMeSetting ap={data.autopilot} hasCredit={hasCredit} />}
      <ShareSettings />
    </div>
  );
}

/* ── Per release ──────────────────────────────────────────────────────────── */

function useHold(id: number) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/press/releases/${id}/hold`, {})).json(),
    onSuccess: () => { void refreshAll(); toast({ title: "Held", description: "It stays a draft until you approve it." }); },
    onError: (e: any) => toast({ title: "Could not hold it", description: apiErrorMessage(e), variant: "destructive" }),
  });
}

/** On a release row: the countdown with Hold, why a send did not happen, and where the live release was shared. */
export function ReleaseAutomationBadges({ release: r }: { release: PressReleaseView }) {
  const hold = useHold(r.id);
  const shared = r.shares.filter((s) => s.status === "queued").map((s) => s.label);
  const failed = r.shares.filter((s) => s.status === "failed" || s.status === "skipped");
  if (!r.sendAt && !shared.length && !failed.length && !(r.sendNote && r.status === "draft")) return null;
  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid={`press-release-auto-${r.id}`}>
      {r.sendAt && (
        <span className="flex items-center gap-1.5">
          <StatusPill tone="warning">Goes out {sendTimeWords(r.sendAt)}</StatusPill>
          <button type="button" className="font-medium underline underline-offset-2" onClick={() => hold.mutate()} disabled={hold.isPending} data-testid={`press-hold-${r.id}`}>Hold</button>
        </span>
      )}
      {!r.sendAt && r.sendNote && r.status === "draft" && <span className="text-muted-foreground">{r.sendNote}</span>}
      {shared.length > 0 && <span className="text-muted-foreground" data-testid={`press-shared-${r.id}`}>Shared to {[...new Set(shared)].join(", ")}</span>}
      {failed.map((s, i) => <span key={i} className="text-red-700 dark:text-red-400" title={s.detail ?? undefined}>Not shared to {s.label}{s.detail ? `: ${s.detail}` : ""}</span>)}
    </div>
  );
}

/** In the writer: the scheduled time with Hold, or "Send it for me" for a clean draft. */
export function WriterSendControl({ release }: { release: PressReleaseView | null }) {
  const { toast } = useToast();
  const fresh = usePressRelease(release?.id);
  // The writer's copy after its own saves, or this fresh one after Hold / Send it for me: whichever is newer.
  const r = fresh.data && (!release || fresh.data.updatedAt >= release.updatedAt) ? fresh.data : release;
  const hold = useHold(r?.id ?? 0);
  const schedule = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/press/releases/${r!.id}/send-for-me`, { on: true })).json(),
    onSuccess: () => { void refreshAll(); toast({ title: "Scheduled", description: "You get a notification with the time and a Hold link." }); },
    onError: (e: any) => toast({ title: "Not scheduled", description: apiErrorMessage(e), variant: "destructive" }),
  });
  if (!r || r.status !== "draft" || !r.text) return null;
  if (r.sendAt) {
    return (
      <Notice tone="info" title={`Goes out ${sendTimeWords(r.sendAt)}`} testId="press-writer-send"
        action={<Button size="sm" variant="outline" onClick={() => hold.mutate()} disabled={hold.isPending} data-testid="press-writer-hold">Hold</Button>}>
        It uses one credit then. Editing it stops the send.
      </Notice>
    );
  }
  if (r.issues.some((i) => i.blocking)) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm" data-testid="press-writer-send">
      <span className="text-muted-foreground">{r.sendNote ?? "Want it sent without coming back? It goes out 2 business days from now at 10:00 AM."}</span>
      <Button size="sm" variant="outline" onClick={() => schedule.mutate()} disabled={schedule.isPending} data-testid="press-writer-send-for-me">Send it for me</Button>
    </div>
  );
}
