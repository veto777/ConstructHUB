import { AppPage, PageHeader, Section, Toolbar } from "@/components/app-ui";
/**
 * /admin/access — platform admins give an account one of the plans for 1–1000
 * days (no card), extend it by granting again, and revoke it. Owner,
 * 2026-10-02: "add a section where i can give people access for 1-1000 days.
 * however long i want and have a revoke button". Reached from the sidebar
 * ("Access grants · ADMIN").
 *
 * GET /api/admin/access-grants?q= answers 403 to anyone but a platform admin
 * (server/access-grants.ts); the grant itself is the account's Stripe-less
 * subscription row, which stops counting at its end date.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarClock, KeyRound, Loader2, Lock, Search, ShieldOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VerificationCancelled } from "@/components/recent-auth";
import { useDocumentTitle } from "@/components/feature-landing/primitives";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { formatUsd } from "@/lib/pricing-display";
import { PLANS, PLAN_KEYS, type PlanKey } from "@shared/plans";
import {
  ACCESS_GRANT_MAX_DAYS, ACCESS_GRANT_MIN_DAYS, ACCESS_GRANT_NOTE_MAX, ACCESS_GRANT_QUICK_DAYS, ACCESS_SOURCE_LABELS,
  grantEndsAt, validGrantDays,
  type AccessGrantAccount, type AccessGrantResult, type AccessGrantRow, type AccessGrantsPayload, type AccessRevokeResult,
} from "@shared/access-grants";

const GRANTS_KEY = "/api/admin/access-grants";

const dateOnly = (v: string | Date) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const dateTime = (v: string | Date) =>
  new Date(v).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const openEnded = (v: string | null) => !!v && new Date(v).getUTCFullYear() >= 2099;
const plural = (n: number, one: string) => `${n.toLocaleString("en-US")} ${one}${n === 1 ? "" : "s"}`;

/** Status code and JSON body of a failed fetch ("403: {...}"). */
function failure(err: unknown): { status: number; body: any } {
  const raw = String((err as Error | null)?.message ?? "");
  const status = Number(raw.slice(0, 3)) || 0;
  try { return { status, body: JSON.parse(raw.replace(/^\d{3}:\s*/, "")) }; } catch { return { status, body: null }; }
}

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

function refreshGrants() {
  void queryClient.invalidateQueries({ queryKey: [GRANTS_KEY] });
}

const SOURCE_STYLES: Record<string, string> = {
  stripe: "border-sky-500/50 text-sky-700 dark:text-sky-400",
  grant: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
  trial_code: "border-amber-500/50 text-amber-700 dark:text-amber-400",
  none: "text-muted-foreground",
};

/** "Granted · Pro · ends Nov 1, 2026" for an account's current access. */
function AccessSummary({ account }: { account: AccessGrantAccount }) {
  const a = account.access;
  const end = a.endsAt && !openEnded(a.endsAt)
    ? `${a.source === "stripe" ? "period ends" : "ends"} ${dateOnly(a.endsAt)}`
    : a.endsAt ? "no end date" : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm" data-testid={`text-access-${account.id}`}>
      <Badge variant="outline" className={`font-medium ${SOURCE_STYLES[a.source]}`} data-testid={`badge-access-source-${account.id}`}>
        {ACCESS_SOURCE_LABELS[a.source]}
      </Badge>
      {a.planName && <span className="font-medium">{a.planName}</span>}
      {!a.planName && a.paidStripe && a.status && <span className="text-muted-foreground">({a.status.replace(/_/g, " ")})</span>}
      {end && <span className="text-muted-foreground">· {end}</span>}
      {account.isPlatformAdmin && <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full leading-none">ADMIN</span>}
    </div>
  );
}

/**
 * Plan, days (1–1000, with quick picks and a live end date) and a note, then a
 * confirm dialog. Used inline under a search result and in the Extend dialog.
 */
function GrantForm({ account, initialPlan, onDone }: { account: AccessGrantAccount; initialPlan?: PlanKey | null; onDone?: () => void }) {
  const { toast } = useToast();
  const id = account.id;
  const [plan, setPlan] = useState<PlanKey>(initialPlan ?? account.access.plan ?? "starter");
  const [daysText, setDaysText] = useState("30");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const days = /^\d+$/.test(daysText.trim()) ? Number(daysText.trim()) : NaN;
  const daysOk = validGrantDays(days);
  const endsAt = daysOk ? grantEndsAt(days) : null;
  const noteOk = note.trim().length <= ACCESS_GRANT_NOTE_MAX;
  const blocked = account.access.paidStripe
    ? "This account pays through Stripe. A grant would replace a paid subscription, so change their plan in Stripe instead."
    : null;

  const grant = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", GRANTS_KEY, { userId: id, plan, days, ...(note.trim() ? { note: note.trim() } : {}) })).json() as Promise<AccessGrantResult>,
    onSuccess: (result) => {
      setConfirming(false);
      setNote("");
      refreshGrants();
      toast({ title: "Access granted", description: result.message });
      onDone?.();
    },
    onError: (err) => {
      setConfirming(false);
      toast({ title: "Couldn't grant access", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  if (blocked) {
    return <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground" data-testid={`text-grant-blocked-${id}`}>{blocked}</p>;
  }

  const current = account.access.source !== "none" && account.access.planName
    ? `${account.email} has ${account.access.planName} now (${ACCESS_SOURCE_LABELS[account.access.source].toLowerCase()}${account.access.endsAt && !openEnded(account.access.endsAt) ? `, ends ${dateOnly(account.access.endsAt)}` : ""}). This grant replaces it.`
    : null;

  return (
    <form
      className="space-y-4"
      data-testid={`form-grant-${id}`}
      onSubmit={(e) => { e.preventDefault(); if (daysOk && noteOk) setConfirming(true); }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`grant-plan-${id}`}>Plan</Label>
          <Select value={plan} onValueChange={(v) => setPlan(v as PlanKey)}>
            <SelectTrigger id={`grant-plan-${id}`} data-testid={`select-grant-plan-${id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAN_KEYS.map((key) => (
                <SelectItem key={key} value={key} data-testid={`option-grant-plan-${key}`}>
                  {PLANS[key].name} — {formatUsd(PLANS[key].monthlyCents)}/mo
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{PLANS[plan].tagline}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`grant-days-${id}`}>Days ({ACCESS_GRANT_MIN_DAYS}–{ACCESS_GRANT_MAX_DAYS.toLocaleString("en-US")})</Label>
          <Input
            id={`grant-days-${id}`}
            type="number"
            inputMode="numeric"
            min={ACCESS_GRANT_MIN_DAYS}
            max={ACCESS_GRANT_MAX_DAYS}
            step={1}
            value={daysText}
            onChange={(e) => setDaysText(e.target.value)}
            aria-invalid={!daysOk}
            className="w-full sm:w-32"
            data-testid={`input-grant-days-${id}`}
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick picks">
            {ACCESS_GRANT_QUICK_DAYS.map((n) => (
              <Button
                key={n}
                type="button"
                size="sm"
                variant={days === n ? "default" : "outline"}
                className="h-7 px-2.5 text-xs"
                onClick={() => setDaysText(String(n))}
                data-testid={`button-grant-days-${n}-${id}`}
              >
                {n === 365 ? "1 year" : n === 1000 ? "1,000 days" : `${n} days`}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <p className={`flex items-center gap-1.5 text-sm ${daysOk ? "" : "text-destructive"}`} data-testid={`text-grant-ends-${id}`} aria-live="polite">
        <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
        {daysOk && endsAt
          ? <span>Ends <strong>{dateTime(endsAt)}</strong> ({plural(days, "day")} from now)</span>
          : <span>Enter a whole number of days from {ACCESS_GRANT_MIN_DAYS} to {ACCESS_GRANT_MAX_DAYS.toLocaleString("en-US")}.</span>}
      </p>

      <div className="space-y-1.5">
        <Label htmlFor={`grant-note-${id}`}>Note <span className="font-normal text-muted-foreground">(optional, only admins see it)</span></Label>
        <Textarea
          id={`grant-note-${id}`}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Help importing their Google Business Profile"
          aria-invalid={!noteOk}
          data-testid={`input-grant-note-${id}`}
        />
        {!noteOk && <p className="text-xs text-destructive">Keep the note to {ACCESS_GRANT_NOTE_MAX} characters or fewer.</p>}
      </div>

      {current && <p className="text-xs text-muted-foreground" data-testid={`text-grant-replaces-${id}`}>{current}</p>}

      <Button type="submit" disabled={!daysOk || !noteOk || grant.isPending} data-testid={`button-grant-${id}`}>
        {grant.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" /> Grant access
      </Button>

      <AlertDialog open={confirming} onOpenChange={(open) => { if (!grant.isPending) setConfirming(open); }}>
        <AlertDialogContent data-testid="dialog-confirm-grant">
          <AlertDialogHeader>
            <AlertDialogTitle>Give {account.email} {PLANS[plan].name} access?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{PLANS[plan].name} for {plural(days || 0, "day")}, until {endsAt ? dateTime(endsAt) : "—"}. No card is charged.</p>
                <p>We email them that they have access. Access stops on its own at the end date, and you can revoke it any time.</p>
                {current && <p>{current}</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={grant.isPending} data-testid="button-cancel-grant">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={grant.isPending}
              onClick={(e) => { e.preventDefault(); grant.mutate(); }}
              data-testid="button-confirm-grant"
            >
              {grant.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Grant access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

function AccountResult({ account, open, onToggle }: { account: AccessGrantAccount; open: boolean; onToggle: () => void }) {
  const name = [account.displayName, account.companyName].filter(Boolean).join(" · ");
  const hasGrant = account.access.source === "grant";
  return (
    <li className="px-4 py-3" data-testid={`row-account-${account.id}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="break-all font-medium" data-testid={`text-account-email-${account.id}`}>{account.email}</p>
          <p className="text-xs text-muted-foreground">#{account.id}{name ? ` · ${name}` : ""}</p>
          <AccessSummary account={account} />
        </div>
        {account.isPlatformAdmin ? (
          <p className="text-xs text-muted-foreground sm:max-w-[14rem] sm:text-right">Platform admins already have every feature.</p>
        ) : (
          <Button
            type="button"
            variant={open ? "secondary" : "outline"}
            size="sm"
            className="shrink-0 self-start sm:self-center"
            onClick={onToggle}
            aria-expanded={open}
            data-testid={`button-open-grant-${account.id}`}
          >
            {open ? "Close" : hasGrant ? "Change or extend" : "Grant access"}
          </Button>
        )}
      </div>
      {open && !account.isPlatformAdmin && (
        <div className="mt-3 rounded-lg border bg-muted/30 p-4">
          <GrantForm account={account} onDone={onToggle} />
        </div>
      )}
    </li>
  );
}

/** A grant row as the account the Extend dialog's form needs. */
const accountOfGrant = (g: AccessGrantRow): AccessGrantAccount => ({
  id: g.userId, email: g.email, displayName: g.displayName, companyName: g.companyName, createdAt: null, isPlatformAdmin: false,
  access: { plan: g.plan, planName: g.planName, source: "grant", status: "active", endsAt: g.endsAt, grantId: g.id, paidStripe: false },
});

function GrantAccountCell({ g }: { g: AccessGrantRow }) {
  const name = [g.displayName, g.companyName].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0">
      <p className="break-all font-medium">{g.email}</p>
      <p className="text-xs text-muted-foreground">#{g.userId}{name ? ` · ${name}` : ""}</p>
      {g.note && <p className="mt-0.5 text-xs italic text-muted-foreground break-words" data-testid={`text-grant-note-${g.id}`}>“{g.note}”</p>}
    </div>
  );
}

/** Label + value on phones; the header row names the column on wider screens. */
function Cell({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 text-sm ${className}`}>
      <span className="text-xs text-muted-foreground md:hidden">{label}: </span>
      {children}
    </div>
  );
}

function ActiveGrants({ grants }: { grants: AccessGrantRow[] }) {
  const { toast } = useToast();
  // The grant each dialog is about stays set while the dialog animates closed (only `…Open` flips).
  const [extending, setExtending] = useState<AccessGrantRow | null>(null);
  const [extendOpen, setExtendOpen] = useState(false);
  const [revoking, setRevoking] = useState<AccessGrantRow | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const revoke = useMutation({
    mutationFn: async (g: AccessGrantRow) => (await apiRequest("POST", `${GRANTS_KEY}/${g.id}/revoke`)).json() as Promise<AccessRevokeResult>,
    onSuccess: (result) => {
      setRevokeOpen(false);
      refreshGrants();
      toast({ title: result.changed ? "Access revoked" : "Nothing to revoke", description: result.message });
    },
    onError: (err) => {
      setRevokeOpen(false);
      toast({ title: "Couldn't revoke", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  return (
    <Card className="overflow-hidden" data-testid="card-active-grants">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Active grants <span className="font-normal text-muted-foreground">({grants.length})</span></CardTitle>
      </CardHeader>
      {grants.length === 0 ? (
        <CardContent><p className="text-sm text-muted-foreground" data-testid="text-no-active-grants">No account has granted access right now.</p></CardContent>
      ) : (
        <>
          <div className="hidden border-y bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[minmax(0,3fr)_4.5rem_minmax(0,2fr)_6.5rem_6.5rem_4.5rem_12.5rem] md:gap-3">
            <span >Account</span>
            <span >Plan</span>
            <span >Granted by</span>
            <span >Started</span>
            <span >Ends</span>
            <span >Days left</span>
            <span className="text-right">Actions</span>
          </div>
          <ul className="divide-y border-t md:border-t-0">
            {grants.map((g) => (
              <li key={g.id} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,3fr)_4.5rem_minmax(0,2fr)_6.5rem_6.5rem_4.5rem_12.5rem] md:items-center md:gap-3" data-testid={`row-active-grant-${g.id}`}>
                <div><GrantAccountCell g={g} /></div>
                <Cell label="Plan"><Badge variant="outline" className="font-medium">{g.planName}</Badge></Cell>
                <Cell label="Granted by"><span className="break-all">{g.grantedBy.email}</span></Cell>
                <Cell label="Started"><span className="whitespace-nowrap" title={dateTime(g.grantedAt)}>{dateOnly(g.grantedAt)}</span></Cell>
                <Cell label="Ends"><span className="whitespace-nowrap" title={dateTime(g.endsAt)} data-testid={`text-grant-ends-at-${g.id}`}>{dateOnly(g.endsAt)}</span></Cell>
                <Cell label="Days left"><span className="font-medium" data-testid={`text-grant-days-left-${g.id}`}>{g.daysLeft.toLocaleString("en-US")}</span></Cell>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <Button type="button" size="sm" variant="outline" onClick={() => { setExtending(g); setExtendOpen(true); }} data-testid={`button-extend-grant-${g.id}`}>
                    <CalendarClock className="mr-1.5 h-4 w-4" aria-hidden="true" /> Extend
                  </Button>
                  <Button type="button" size="sm" variant="destructive" onClick={() => { setRevoking(g); setRevokeOpen(true); }} data-testid={`button-revoke-grant-${g.id}`}>
                    <ShieldOff className="mr-1.5 h-4 w-4" aria-hidden="true" /> Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" data-testid="dialog-extend-grant">
          <DialogHeader>
            <DialogTitle>Extend or change access</DialogTitle>
            <DialogDescription>
              {extending ? `${extending.email} has ${extending.planName} until ${dateTime(extending.endsAt)}. A new grant replaces the end date, counted from now.` : ""}
            </DialogDescription>
          </DialogHeader>
          {extending && <GrantForm key={extending.id} account={accountOfGrant(extending)} initialPlan={extending.plan} onDone={() => setExtendOpen(false)} />}
        </DialogContent>
      </Dialog>

      <AlertDialog open={revokeOpen} onOpenChange={(open) => { if (!revoke.isPending) setRevokeOpen(open); }}>
        <AlertDialogContent data-testid="dialog-confirm-revoke">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {revoking?.email}'s {revoking?.planName} access?</AlertDialogTitle>
            <AlertDialogDescription>
              Access ends now instead of {revoking ? dateOnly(revoking.endsAt) : ""}. Their data stays; plan features stop until they get a plan again. You can grant access again any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending} data-testid="button-cancel-revoke">Keep access</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={revoke.isPending}
              onClick={(e) => { e.preventDefault(); if (revoking) revoke.mutate(revoking); }}
              data-testid="button-confirm-revoke"
            >
              {revoke.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Revoke access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

const ENDED_STYLES: Record<string, string> = {
  revoked: "border-red-500/50 text-red-700 dark:text-red-400",
  expired: "text-muted-foreground",
  replaced: "border-amber-500/50 text-amber-700 dark:text-amber-400",
};
const ENDED_LABELS: Record<string, string> = { revoked: "Revoked", expired: "Expired", replaced: "Replaced" };

function EndedGrants({ grants }: { grants: AccessGrantRow[] }) {
  return (
    <Card className="overflow-hidden" data-testid="card-ended-grants">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Recently ended</CardTitle>
      </CardHeader>
      {grants.length === 0 ? (
        <CardContent><p className="text-sm text-muted-foreground" data-testid="text-no-ended-grants">No grant has ended yet.</p></CardContent>
      ) : (
        <>
          <div className="hidden border-y bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[minmax(0,3fr)_4.5rem_minmax(0,2fr)_6.5rem_3.5rem_6.5rem_minmax(0,2.2fr)] md:gap-3">
            <span >Account</span>
            <span >Plan</span>
            <span >Granted by</span>
            <span >Started</span>
            <span >Days</span>
            <span >Ended</span>
            <span >How</span>
          </div>
          <ul className="divide-y border-t md:border-t-0">
            {grants.map((g) => (
              <li key={g.id} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,3fr)_4.5rem_minmax(0,2fr)_6.5rem_3.5rem_6.5rem_minmax(0,2.2fr)] md:items-center md:gap-3" data-testid={`row-ended-grant-${g.id}`} data-status={g.status}>
                <div><GrantAccountCell g={g} /></div>
                <Cell label="Plan"><Badge variant="outline" className="font-medium">{g.planName}</Badge></Cell>
                <Cell label="Granted by"><span className="break-all">{g.grantedBy.email}</span></Cell>
                <Cell label="Started"><span className="whitespace-nowrap" title={dateTime(g.grantedAt)}>{dateOnly(g.grantedAt)}</span></Cell>
                <Cell label="Days">{g.days.toLocaleString("en-US")}</Cell>
                <Cell label="Ended">{g.endedAt ? <span className="whitespace-nowrap" title={dateTime(g.endedAt)}>{dateOnly(g.endedAt)}</span> : "—"}</Cell>
                <Cell label="How">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={`font-medium ${ENDED_STYLES[g.status] ?? ""}`} data-testid={`badge-ended-status-${g.id}`}>{ENDED_LABELS[g.status] ?? g.status}</Badge>
                    <span className="text-xs text-muted-foreground break-all">{g.endedHow}</span>
                  </span>
                </Cell>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

export default function AdminAccessPage() {
  useDocumentTitle("Access grants | ConstructHUB");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [openAccount, setOpenAccount] = useState<number | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useQuery<AccessGrantsPayload>({
    queryKey: [GRANTS_KEY, q],
    // apiRequest answers the admin second factor (403 reauth): the verify-identity dialog opens, then the same request is retried.
    queryFn: async () => (await apiRequest("GET", `${GRANTS_KEY}?q=${encodeURIComponent(q)}`)).json(),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const fail = useMemo(() => (error ? failure(error) : null), [error]);

  if (isLoading && !data) {
    return <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted-foreground" data-testid="page-admin-access-loading">Loading access grants…</div>;
  }
  if (!data && (error instanceof VerificationCancelled || fail?.body?.reauth === true)) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="page-admin-access-verify">
        <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">Verify it's you</h1>
        <p className="mt-1 text-sm text-muted-foreground">Admin tools need a recent identity check.</p>
        <Button className="mt-4" onClick={() => void refetch()} data-testid="button-admin-access-verify">Verify identity</Button>
      </div>
    );
  }
  if (!data) {
    const forbidden = fail?.status === 401 || fail?.status === 403;
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="page-admin-access-denied">
        <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">{forbidden ? "Platform admins only" : "Couldn't load access grants"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {forbidden ? "This page is for the people who run ConstructHUB." : apiErrorMessage(error, "Try again in a moment.")}
        </p>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-primary hover:underline underline-offset-4">Back to the dashboard</Link>
      </div>
    );
  }

  return (
    <AppPage testId="page-admin-access">
      <PageHeader title="Access grants" description="Give an account temporary access to a plan." />

      <Card className="overflow-hidden" data-testid="card-find-account">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Find an account</CardTitle>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Email, name, company or account #"
              aria-label="Search accounts"
              className="pl-9"
              data-testid="input-access-search"
            />
            {isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Searching" />}
          </div>
          <p className="text-xs text-muted-foreground">{q ? `Accounts matching “${q}” (up to 20).` : "The newest accounts. Search to find someone."}</p>
        </CardHeader>
        {data.accounts.length === 0 ? (
          <CardContent><p className="text-sm text-muted-foreground" data-testid="text-no-accounts">No account matches “{q}”.</p></CardContent>
        ) : (
          <ul className="divide-y border-t" data-testid="list-access-accounts">
            {data.accounts.map((account) => (
              <AccountResult
                key={account.id}
                account={account}
                open={openAccount === account.id}
                onToggle={() => setOpenAccount((cur) => (cur === account.id ? null : account.id))}
              />
            ))}
          </ul>
        )}
      </Card>

      <ActiveGrants grants={data.active} />
      <EndedGrants grants={data.ended} />
    </AppPage>
  );
}
