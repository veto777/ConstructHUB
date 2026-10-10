import { AppPage } from "@/components/app-ui";
import { GoogleSectionHeader } from "@/components/google";
/**
 * /admin/code-api — platform admins issue Code API tokens: 24- or 48-hour
 * chdev_ tokens that give an AI agent or a developer the ConstructHUB source
 * code (backend + frontend) through /api/dev/v1. Owner, 2026-10-10: "an API
 * that has access to all backend and frontend code that can add or change
 * certain things or add scripts or code … the Account admin with Google
 * access and verification … can create this in the admin portal".
 *
 * Every token writes only to its own branch (devapi/…) on GitHub; nothing
 * runs or deploys until the owner merges and deploys it. Issuing needs a
 * Google re-verification from the last 15 minutes AND the admin's
 * authenticator code (server/dev-api/routes.ts).
 */
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, GitBranch, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDocumentTitle } from "@/components/feature-landing/primitives";
import { VerificationCancelled } from "@/components/recent-auth";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";

const KEY = "/api/admin/dev-tokens";
const PAGE = "/admin/code-api";

type TokenItem = {
  id: string; name: string; holderType: "agent" | "person"; scopes: ("read" | "write")[]; prefix: string; suffix: string;
  branch: string; compareUrl: string | null; status: "live" | "expired" | "revoked"; createdByEmail: string;
  createdAt: string; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null; submittedAt: string | null;
};
type Payload = {
  configured: boolean; apiUrl: string; baseBranch: string | null; hours: { min: number; max: number }; maxLive: number;
  verification: { googleLinked: boolean; totpEnabled: boolean; googleVerifiedUntil: string | null }; tokens: TokenItem[];
};
type Issued = { token: string; apiUrl: string; item: TokenItem };
type Activity = {
  commits: { sha: string; at: string; subject: string }[];
  files: { path: string; status: string; additions: number | null; deletions: number | null }[];
  sensitive: string[];
  requests: { at: string; method: string; path: string; status: number }[];
};

const time = (v: string) => new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function left(v: string, now: number): string {
  const ms = new Date(v).getTime() - now;
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return h ? `${h} h ${m} min left` : `${m} min left`;
}

function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function CopyButton({ value, label = "Copy", testId }: { value: string; label?: string; testId?: string }) {
  const { toast } = useToast();
  return (
    <Button type="button" variant="outline" size="sm" data-testid={testId}
      onClick={() => navigator.clipboard.writeText(value).then(() => toast({ title: "Copied" }), () => toast({ title: "Copy failed", variant: "destructive" }))}>
      <Copy className="mr-1.5 h-4 w-4" />{label}
    </Button>
  );
}

const STATUS_STYLE: Record<TokenItem["status"], string> = {
  live: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
  expired: "text-muted-foreground",
  revoked: "border-red-500/50 text-red-700 dark:text-red-400",
};

function TokenActivity({ id }: { id: string }) {
  const { data, isLoading, error } = useQuery<Activity>({ queryKey: [`${KEY}/${id}/activity`] });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-destructive">{apiErrorMessage(error)}</p>;
  return (
    <div className="space-y-3 text-sm" data-testid={`activity-${id}`}>
      {data.sensitive.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Review these closely before merging</AlertTitle>
          <AlertDescription>They run on your machines at install, build or deploy time: {data.sensitive.join(", ")}</AlertDescription>
        </Alert>
      )}
      <div>
        <p className="font-medium">Files changed ({data.files.length})</p>
        {data.files.length ? (
          <ul className="mt-1 space-y-0.5 font-mono text-xs">
            {data.files.map((f) => (
              <li key={f.path}>{f.status === "added" ? "+" : f.status === "deleted" ? "−" : "~"} {f.path}
                {f.additions != null && <span className="text-muted-foreground"> (+{f.additions} −{f.deletions})</span>}</li>
            ))}
          </ul>
        ) : <p className="text-muted-foreground">No changes yet.</p>}
      </div>
      <div>
        <p className="font-medium">Commits ({data.commits.length})</p>
        <ul className="mt-1 space-y-0.5">
          {data.commits.map((c) => <li key={c.sha}><span className="font-mono text-xs">{c.sha.slice(0, 8)}</span> {c.subject} <span className="text-muted-foreground">· {time(c.at)}</span></li>)}
        </ul>
      </div>
      <div>
        <p className="font-medium">Last requests</p>
        <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto font-mono text-xs">
          {data.requests.map((r, i) => <li key={i}>{time(r.at)} {r.method} {r.path} → {r.status}</li>)}
          {!data.requests.length && <li className="font-sans text-muted-foreground">None yet.</li>}
        </ul>
      </div>
    </div>
  );
}

/** Ready-to-save text of the recovery codes. */
const recoveryText = (codes: string[]) =>
  ["ConstructHUB recovery codes", "Each code signs you in once if you lose your phone. Keep them somewhere safe.", "", ...codes].join("\n");

/**
 * Step 2: the authenticator app, set up right here (the same /api/auth/2fa/setup + /verify
 * that Settings → Security uses): QR code → first code → recovery codes to save → done.
 */
function TwoStepStep({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const [setup, setSetup] = useState<{ secret: string; qrCode: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const start = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/auth/2fa/setup")).json() as Promise<{ secret: string; qrCode: string }>,
    onSuccess: (d) => { setSetup({ secret: d.secret, qrCode: d.qrCode }); setCode(""); },
    onError: (e) => { if (!(e instanceof VerificationCancelled)) toast({ title: "Couldn't start the setup", description: apiErrorMessage(e), variant: "destructive" }); },
  });
  const verify = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/auth/2fa/verify", { code })).json() as Promise<{ codes?: string[] }>,
    onSuccess: (d) => {
      setCodes(d.codes ?? []); setSetup(null); setCode("");
      toast({ title: "Two-step sign-in is on" });
      void queryClient.invalidateQueries({ queryKey: [KEY] });
      void queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (e) => { setCode(""); toast({ title: "That code didn't work", description: apiErrorMessage(e, "Enter the code your app shows right now."), variant: "destructive" }); },
  });

  if (codes && !saved) {
    return (
      <div className="space-y-3" data-testid="twostep-recovery">
        <p className="text-sm"><CheckCircle2 className="mr-1.5 inline h-4 w-4 text-emerald-600" />Two-step sign-in is on. <strong>Save these recovery codes now.</strong> Each one gets you in once if you lose your phone, and you won't see them again.</p>
        <div className="grid grid-cols-2 gap-1 rounded bg-muted p-3 font-mono text-sm sm:grid-cols-5">{codes.map((c) => <span key={c}>{c}</span>)}</div>
        <div className="flex flex-wrap gap-2">
          <CopyButton value={recoveryText(codes)} label="Copy codes" testId="button-copy-recovery" />
          <Button type="button" variant="outline" size="sm" data-testid="button-download-recovery" onClick={() => {
            const url = URL.createObjectURL(new Blob([recoveryText(codes)], { type: "text/plain" }));
            const a = document.createElement("a"); a.href = url; a.download = "constructhub-recovery-codes.txt"; a.click(); URL.revokeObjectURL(url);
          }}>Download .txt</Button>
          <Button type="button" size="sm" onClick={() => setSaved(true)} data-testid="button-recovery-saved">I saved them</Button>
        </div>
      </div>
    );
  }
  if (enabled) {
    return <p className="text-sm text-muted-foreground" data-testid="twostep-on">Your authenticator app is set up. You'll type its 6-digit code when you issue a token.</p>;
  }
  if (!setup) {
    return (
      <div className="space-y-2" data-testid="twostep-start">
        <p className="text-sm">Issuing also needs the 6-digit code from an authenticator app on your phone, so a stolen Google login alone can't hand out access to the code. One-time setup, about a minute:</p>
        <ol className="ml-5 list-decimal space-y-0.5 text-sm text-muted-foreground">
          <li>Install <strong>Google Authenticator</strong> or <strong>Authy</strong> on your phone (free).</li>
          <li>Click the button below and scan the QR code with it.</li>
          <li>Type the 6-digit code it shows. Then save your recovery codes.</li>
        </ol>
        <Button size="sm" onClick={() => start.mutate()} disabled={start.isPending} data-testid="button-start-twostep">
          {start.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Set up authenticator app
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="twostep-scan">
      <p className="text-sm font-medium">Scan this with your authenticator app</p>
      <div className="flex flex-wrap items-start gap-4">
        <img src={setup.qrCode} alt="QR code for your authenticator app" className="h-44 w-44 rounded border bg-white p-2" data-testid="img-twostep-qr" />
        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <p className="text-muted-foreground">Can't scan? In the app choose "Enter a setup key" and type:</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-muted px-2 py-1 font-mono text-xs" data-testid="text-twostep-secret">{setup.secret}</code>
            <CopyButton value={setup.secret} label="Copy key" testId="button-copy-twostep-secret" />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="twostep-code">Code from the app</Label>
          <Input id="twostep-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" className="w-32 font-mono tracking-widest"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => { if (e.key === "Enter" && code.length === 6) verify.mutate(); }} data-testid="input-twostep-code" />
        </div>
        <Button onClick={() => verify.mutate()} disabled={code.length !== 6 || verify.isPending} data-testid="button-verify-twostep">
          {verify.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Turn on
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setSetup(null)}>Cancel</Button>
      </div>
    </div>
  );
}

/** One numbered step of the checklist: its state shows at a glance. */
function Step({ n, title, done, children, testId }: { n: number; title: string; done: boolean; children: ReactNode; testId: string }) {
  return (
    <div className="flex gap-3 rounded-lg border p-3 sm:p-4" data-testid={testId}>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${done ? "bg-emerald-600 text-white" : "bg-primary/10 text-primary"}`}>
        {done ? <CheckCircle2 className="h-4 w-4" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </div>
  );
}

function TokenRow({ t, now, onRevoke }: { t: TokenItem; now: number; onRevoke: (t: TokenItem) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border p-3 sm:p-4" data-testid={`token-${t.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{t.name} <span className="text-sm font-normal text-muted-foreground">· {t.holderType === "agent" ? "AI agent" : "Person"}</span></p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge variant="outline" className={STATUS_STYLE[t.status]}>{t.status === "live" ? left(t.expiresAt, now) : t.status}</Badge>
            <Badge variant="outline">{t.scopes.includes("write") ? "Read + write" : "Read only"}</Badge>
            {t.submittedAt && <Badge variant="outline" className="border-sky-500/50 text-sky-700 dark:text-sky-400">Submitted for review</Badge>}
            <span className="font-mono text-muted-foreground">{t.prefix}…{t.suffix}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Issued {time(t.createdAt)} by {t.createdByEmail}{t.lastUsedAt ? ` · last used ${time(t.lastUsedAt)}` : " · not used yet"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {t.compareUrl
            ? <Button asChild variant="outline" size="sm"><a href={t.compareUrl} target="_blank" rel="noreferrer"><GitBranch className="mr-1.5 h-4 w-4" />{t.branch}<ExternalLink className="ml-1 h-3 w-3" /></a></Button>
            : <span className="self-center font-mono text-xs">{t.branch}</span>}
          <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)} data-testid={`button-activity-${t.id}`}>{open ? "Hide" : "Changes"}</Button>
          {t.status === "live" && (
            <Button variant="destructive" size="sm" onClick={() => onRevoke(t)} data-testid={`button-revoke-${t.id}`}><ShieldOff className="mr-1.5 h-4 w-4" />Revoke</Button>
          )}
        </div>
      </div>
      {open && <div className="mt-3 border-t pt-3"><TokenActivity id={t.id} /></div>}
    </li>
  );
}

export default function AdminCodeApiPage() {
  useDocumentTitle("Code API | ConstructHUB");
  const { toast } = useToast();
  const now = useNow();
  const { data, isLoading, error } = useQuery<Payload>({ queryKey: [KEY], refetchInterval: 60_000 });
  const [name, setName] = useState("");
  const [holder, setHolder] = useState<"agent" | "person">("agent");
  const [hours, setHours] = useState(24);
  const [access, setAccess] = useState<"read" | "write">("write");
  const [issued, setIssued] = useState<Issued | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [revoking, setRevoking] = useState<TokenItem | null>(null);

  const issue = useMutation({
    mutationFn: async () => (await apiRequest("POST", KEY, {
      name: name.trim(), holderType: holder, hours, scopes: access === "write" ? ["read", "write"] : ["read"], totpCode,
    })).json() as Promise<Issued>,
    onSuccess: (out) => { setIssued(out); setName(""); setTotpCode(""); void queryClient.invalidateQueries({ queryKey: [KEY] }); },
    onError: (e) => { setTotpCode(""); toast({ title: "Token not issued", description: apiErrorMessage(e), variant: "destructive" }); void queryClient.invalidateQueries({ queryKey: [KEY] }); },
  });
  const revoke = useMutation({
    mutationFn: async (t: TokenItem) => (await apiRequest("DELETE", `${KEY}/${t.id}`)).json(),
    onSuccess: () => { toast({ title: "Token revoked", description: "It stopped working at once. Its branch stays on GitHub." }); void queryClient.invalidateQueries({ queryKey: [KEY] }); },
    onError: (e) => toast({ title: "Could not revoke", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const verifiedUntil = data?.verification.googleVerifiedUntil ? new Date(data.verification.googleVerifiedUntil).getTime() : 0;
  const verified = verifiedUntil > now;
  const canIssue = !!data?.configured && !!data.verification.googleLinked && !!data.verification.totpEnabled && verified
    && !!name.trim() && /^\d{6}$/.test(totpCode) && !issue.isPending;
  // What still stands between the admin and the Issue button, in words.
  const issueBlocker = !data ? null
    : !data.configured ? "The Code API isn't switched on on this server yet."
    : !data.verification.googleLinked ? "Issuing needs an admin account that signs in with Google."
    : !verified && !data.verification.totpEnabled ? "Finish steps 1 and 2 above first."
    : !verified ? "Finish step 1 above (Continue with Google) first."
    : !data.verification.totpEnabled ? "Finish step 2 above (set up the authenticator app) first."
    : !name.trim() ? "Say who the token is for."
    : !/^\d{6}$/.test(totpCode) ? "Type the 6-digit code your authenticator app shows now."
    : null;
  const live = data?.tokens.filter((t) => t.status === "live") ?? [];
  const past = data?.tokens.filter((t) => t.status !== "live") ?? [];

  const agentBrief = issued ? [
    `ConstructHUB Code API: ${issued.apiUrl}`,
    `Token (expires ${time(issued.item.expiresAt)}): ${issued.token}`,
    `Send it as: Authorization: Bearer <token>`,
    `Start with GET ${issued.apiUrl}/ for the endpoint list.`,
    `You work on branch ${issued.item.branch}. Commit with POST /commits; when done, POST /submit. Nothing deploys until the owner reviews it.`,
  ].join("\n") : "";

  return (
    <AppPage testId="page-admin-code-api">
      <GoogleSectionHeader as="h1" title="Code API" description="Give an AI agent or a developer 24–48 hours of access to the ConstructHUB code. Their changes land on their own GitHub branch for you to review." flush />

      {isLoading && <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading…</p>}
      {error && <Alert variant="destructive"><AlertTitle>Could not load</AlertTitle><AlertDescription>{apiErrorMessage(error)}</AlertDescription></Alert>}

      {data && (<>
        {!data.configured && (
          <Alert variant="destructive" data-testid="alert-not-configured">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Not switched on yet</AlertTitle>
            <AlertDescription>This server has no repository connection (DEV_API_REPO_URL and a GitHub deploy key). Tokens can't be issued until it does.</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">API address</CardTitle>
            <CardDescription>Give this URL with the token. <code>GET</code> on it (no token needed) lists every endpoint.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-muted px-2 py-1 text-sm" data-testid="text-api-url">{data.apiUrl}</code>
            <CopyButton value={data.apiUrl} testId="button-copy-url" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Issue a token</CardTitle>
            <CardDescription>Each token gets its own branch from {data.baseBranch ?? "main"}. Reads and commits only; nothing it writes runs or goes live until you merge and deploy.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <Step n={1} title="Confirm it's you with Google" done={data.verification.googleLinked && verified} testId="google-status">
              {!data.verification.googleLinked ? (
                <p className="text-sm"><ShieldOff className="mr-1.5 inline h-4 w-4 text-destructive" />This admin account doesn't sign in with Google. Issuing needs one that does.</p>
              ) : verified ? (
                <p className="text-sm text-muted-foreground">Verified until {new Date(verifiedUntil).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} (15 minutes at a time).</p>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">Sign in to Google again. It's good for 15 minutes.</p>
                  <Button size="sm" data-testid="button-verify-google"
                    onClick={() => window.location.assign(`/api/auth/google?reauth=1&next=${encodeURIComponent(PAGE)}`)}>Continue with Google</Button>
                </div>
              )}
            </Step>
            <Step n={2} title="Authenticator app" done={data.verification.totpEnabled} testId="twostep-status">
              <TwoStepStep enabled={data.verification.totpEnabled} />
            </Step>
            <p className="pt-1 font-medium">3. Issue the token</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="token-name">Who is it for?</Label>
                <Input id="token-name" maxLength={80} placeholder="e.g. Codex — permit scrapers, or Jane (contract dev)" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-token-name" />
              </div>
              <div className="space-y-1.5">
                <Label>Used by</Label>
                <Select value={holder} onValueChange={(v) => setHolder(v as "agent" | "person")}>
                  <SelectTrigger data-testid="select-holder"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="agent">AI agent</SelectItem><SelectItem value="person">Person</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Access</Label>
                <Select value={access} onValueChange={(v) => setAccess(v as "read" | "write")}>
                  <SelectTrigger data-testid="select-access"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="write">Read + change code</SelectItem><SelectItem value="read">Read only</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Expires after</Label>
                <div className="flex gap-2">
                  {[data.hours.min, data.hours.max].map((h) => (
                    <Button key={h} type="button" variant={hours === h ? "default" : "outline"} size="sm" onClick={() => setHours(h)} data-testid={`button-hours-${h}`}>{h} hours</Button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="totp-code">Authenticator code</Label>
                <Input id="totp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" className="w-32 font-mono tracking-widest"
                  disabled={!data.verification.totpEnabled}
                  value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => { if (e.key === "Enter" && canIssue) issue.mutate(); }} data-testid="input-totp-code" />
              </div>
              <Button disabled={!canIssue} onClick={() => issue.mutate()} data-testid="button-issue">
                {issue.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Issue token
              </Button>
            </div>
            {issueBlocker && <p className="text-sm text-muted-foreground" data-testid="text-issue-blocker">{issueBlocker}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Live tokens ({live.length} of {data.maxLive})</CardTitle></CardHeader>
          <CardContent>
            {live.length ? <ul className="space-y-2">{live.map((t) => <TokenRow key={t.id} t={t} now={now} onRevoke={setRevoking} />)}</ul>
              : <p className="text-sm text-muted-foreground">No live tokens.</p>}
          </CardContent>
        </Card>

        {past.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Expired and revoked (last 14 days)</CardTitle>
              <CardDescription>Their branches stay on GitHub until you merge or delete them.</CardDescription></CardHeader>
            <CardContent><ul className="space-y-2">{past.map((t) => <TokenRow key={t.id} t={t} now={now} onRevoke={setRevoking} />)}</ul></CardContent>
          </Card>
        )}
      </>)}

      <Dialog open={!!issued} onOpenChange={(o) => { if (!o) setIssued(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Token for {issued?.item.name}</DialogTitle>
            <DialogDescription>Copy it now. You won't see it again. It expires {issued ? time(issued.item.expiresAt) : ""}.</DialogDescription>
          </DialogHeader>
          {issued && (
            <div className="space-y-3">
              <code className="block break-all rounded bg-muted p-2 text-xs" data-testid="text-issued-token">{issued.token}</code>
              <div className="flex flex-wrap gap-2">
                <CopyButton value={issued.token} label="Copy token" testId="button-copy-token" />
                <CopyButton value={agentBrief} label="Copy token + instructions" testId="button-copy-brief" />
              </div>
              <pre className="whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{`curl -H "Authorization: Bearer ${issued.token.slice(0, 15)}…" \\\n  "${issued.apiUrl}/files?path=package.json"`}</pre>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!revoking} onOpenChange={(o) => { if (!o) setRevoking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke "{revoking?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>The token stops working at once. Commits already made stay on branch {revoking?.branch}.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (revoking) revoke.mutate(revoking); setRevoking(null); }} data-testid="button-confirm-revoke">Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppPage>
  );
}
