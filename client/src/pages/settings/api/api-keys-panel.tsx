import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { VerificationCancelled } from "@/components/recent-auth";
import { Copy, Check, KeyRound, Loader2, MoreHorizontal, ShieldAlert, Sparkles } from "lucide-react";
import { copyToClipboard, daysUntil, formatCount, formatDate, formatDateTime } from "../billing/format";
import {
  API_SCOPES, EXPIRY_CHOICES, maskedKey,
  type ApiKeyItem, type ApiKeysResponse, type ApiScope, type CreateApiKeyBody, type CreateApiKeyResponse,
} from "./types";

/** The one sentence every API surface repeats, word for word. */
export const API_NO_AI_NOTICE = "API keys give access to your ConstructHUB data. AI features are not available through the API.";

export type ApiKeysPanelProps = {
  /** "See plans" on the upgrade card (default: the pricing page). */
  onUpgrade?: () => void;
  /** Where the docs link goes (default: /developers). */
  docsHref?: string;
};

const KEYS_QUERY = ["/api/account/api-keys"] as const;
const refreshKeys = () => {
  void queryClient.invalidateQueries({ queryKey: [...KEYS_QUERY] });
  void queryClient.invalidateQueries({ queryKey: ["/api/account/api-usage"] });
};

/** A whole number from a text field, or null when blank; NaN when it isn't a count. */
function parseLimit(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n > 0 ? n : Number.NaN;
}

/**
 * Settings → API keys. The Ahrefs-style table (title, prefix…suffix, scope,
 * units consumed, limit, added, last used, expires, menu) with a Generate
 * dialog, the once-only reveal of a new key, rename / limit / revoke, the
 * monthly unit quota and the Starter upgrade card. Creating a key is a
 * sensitive action: the server asks for step-up verification (403 reauth) and
 * apiRequest runs the verification dialog and retries.
 */
export function ApiKeysPanel({ onUpgrade, docsHref = "/developers" }: ApiKeysPanelProps = {}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data, isLoading, error } = useQuery<ApiKeysResponse>({ queryKey: [...KEYS_QUERY] });
  const keys = data?.keys ?? [];
  const plan = data?.plan;
  const apiEnabled = plan?.apiEnabled === true;
  const upgrade = onUpgrade ?? (() => navigate("/pricing"));

  const [generateOpen, setGenerateOpen] = useState(false);
  // Bumped after each successful create so the next Generate starts from a blank form
  // (Radix doesn't call onOpenChange when the dialog is closed from code).
  const [generateSession, setGenerateSession] = useState(0);
  const [newKey, setNewKey] = useState<CreateApiKeyResponse | null>(null);
  const [renaming, setRenaming] = useState<ApiKeyItem | null>(null);
  const [limiting, setLimiting] = useState<ApiKeyItem | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyItem | null>(null);

  const fail = (title: string) => (err: unknown) => {
    if (err instanceof VerificationCancelled) return;
    toast({ title, description: apiErrorMessage(err), variant: "destructive" });
  };

  const createMutation = useMutation({
    mutationFn: async (body: CreateApiKeyBody) => (await apiRequest("POST", "/api/account/api-keys", body)).json() as Promise<CreateApiKeyResponse>,
    onSuccess: (res) => { setGenerateOpen(false); setGenerateSession((n) => n + 1); setNewKey(res); refreshKeys(); },
    onError: fail("Couldn't create the key"),
  });
  // Once the reveal is dismissed the secret leaves React state and the mutation cache alike.
  const dismissNewKey = () => { setNewKey(null); createMutation.reset(); };
  const patchMutation = useMutation({
    mutationFn: async (v: { id: string; name?: string; monthlyUnitLimit?: number | null }) => {
      const { id, ...body } = v;
      return (await apiRequest("PATCH", `/api/account/api-keys/${encodeURIComponent(id)}`, body)).json();
    },
    onSuccess: (_d, v) => {
      setRenaming(null); setLimiting(null); refreshKeys();
      toast({ title: v.name !== undefined ? "Key renamed" : "Monthly limit updated" });
    },
    onError: fail("Couldn't update the key"),
  });
  const revokeMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/account/api-keys/${encodeURIComponent(id)}`)).json().catch(() => ({})),
    onSuccess: (_d, id) => {
      const name = keys.find((k) => k.id === id)?.name;
      setRevoking(null); refreshKeys();
      toast({ title: "Key revoked", description: name ? `${name} stops working now.` : undefined });
    },
    onError: fail("Couldn't revoke the key"),
  });

  return (
    <div className="space-y-6">
      <Alert data-testid="banner-api-no-ai">
        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Your data, your tools</AlertTitle>
        <AlertDescription>
          <span data-testid="text-api-no-ai">{API_NO_AI_NOTICE}</span>{" "}
          Read your data, schedule posts and update records with your own scripts or your own AI; anything you send through the API is
          stored exactly as sent. TruthCoder never generates content for an API call.{" "}
          <a href={docsHref} className="underline underline-offset-4" data-testid="link-api-docs">API reference</a>
        </AlertDescription>
      </Alert>

      {isLoading ? (
        <Card aria-busy="true"><CardContent className="pt-6 space-y-3"><Skeleton className="h-5 w-48" /><Skeleton className="h-2 w-full" /><Skeleton className="h-8 w-full" /></CardContent></Card>
      ) : error ? (
        <Card><CardContent className="pt-6"><p className="text-sm text-destructive" role="alert" data-testid="text-api-keys-error">Couldn't load your API keys. {apiErrorMessage(error)}</p></CardContent></Card>
      ) : (
        <>
          {plan && (apiEnabled ? <QuotaCard used={plan.usedThisMonth} limit={plan.unitsPerMonth} ratePerMinute={plan.ratePerMinute} /> : (
            <Card className="border-primary/30 bg-primary/5" data-testid="card-api-upgrade">
              <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">API access starts with Pro</p>
                    <p className="text-sm text-muted-foreground">
                      Your plan doesn't include the API. Pro, Growth and Agency include a monthly unit allowance for reading and updating your data.
                    </p>
                  </div>
                </div>
                <Button size="sm" onClick={upgrade} data-testid="button-api-upgrade">See plans</Button>
              </CardContent>
            </Card>
          ))}

          <Card data-testid="card-api-keys">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="text-base">API keys</CardTitle>
                <CardDescription>Each key is shown in full once, when it's created. Revoke a key you no longer use.</CardDescription>
              </div>
              <Button size="sm" onClick={() => setGenerateOpen(true)} disabled={!apiEnabled} data-testid="button-generate-key">
                <KeyRound className="h-4 w-4 mr-1.5" aria-hidden="true" />Generate API key
              </Button>
            </CardHeader>
            <CardContent>
              {keys.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-lg bg-muted/50 p-4" data-testid="text-api-keys-empty">
                  {apiEnabled ? "No API keys yet. Generate one to read your data from your own tools." : "No API keys on this account."}
                </p>
              ) : (
                <>
                  <div className="hidden lg:block">
                    <Table data-testid="table-api-keys">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Title</TableHead>
                          <TableHead>Key</TableHead>
                          <TableHead>Scope</TableHead>
                          <TableHead className="text-right">Units consumed</TableHead>
                          <TableHead className="text-right">Limit</TableHead>
                          <TableHead>Added</TableHead>
                          <TableHead>Last used</TableHead>
                          <TableHead>Expires</TableHead>
                          <TableHead><span className="sr-only">Actions</span></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {keys.map((k) => (
                          <TableRow key={k.id} data-testid={`row-api-key-${k.id}`}>
                            <TableCell className="font-medium" data-testid={`text-key-name-${k.id}`}>{k.name}</TableCell>
                            <TableCell><code className="text-xs" data-testid={`text-key-masked-${k.id}`}>{maskedKey(k)}</code></TableCell>
                            <TableCell data-testid={`text-key-scopes-${k.id}`}><ScopeBadges scopes={k.scopes} /></TableCell>
                            <TableCell className="text-right tabular-nums" data-testid={`text-key-units-${k.id}`}>{formatCount(k.unitsThisMonth)}</TableCell>
                            <TableCell className="text-right tabular-nums" data-testid={`text-key-limit-${k.id}`}>{k.monthlyUnitLimit === null ? <span className="text-muted-foreground">Plan</span> : formatCount(k.monthlyUnitLimit)}</TableCell>
                            <TableCell className="whitespace-nowrap" data-testid={`text-key-added-${k.id}`}>{formatDate(k.createdAt)}</TableCell>
                            <TableCell className="whitespace-nowrap" data-testid={`text-key-last-used-${k.id}`}>{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : <span className="text-muted-foreground">Never</span>}</TableCell>
                            <TableCell className="whitespace-nowrap" data-testid={`text-key-expires-${k.id}`}><Expiry item={k} /></TableCell>
                            <TableCell className="text-right">
                              <KeyMenu item={k} idSuffix="" onRename={setRenaming} onLimit={setLimiting} onRevoke={setRevoking} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <ul className="lg:hidden space-y-3" data-testid="list-api-keys">
                    {keys.map((k) => (
                      <li key={k.id} className="rounded-lg border p-3 space-y-2" data-testid={`card-api-key-${k.id}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{k.name}</p>
                            <code className="text-xs break-all">{maskedKey(k)}</code>
                          </div>
                          <KeyMenu item={k} idSuffix="-m" onRename={setRenaming} onLimit={setLimiting} onRevoke={setRevoking} />
                        </div>
                        <ScopeBadges scopes={k.scopes} />
                        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                          <dt className="text-muted-foreground">Units consumed</dt><dd className="tabular-nums text-right">{formatCount(k.unitsThisMonth)}</dd>
                          <dt className="text-muted-foreground">Limit</dt><dd className="tabular-nums text-right">{k.monthlyUnitLimit === null ? "Plan" : formatCount(k.monthlyUnitLimit)}</dd>
                          <dt className="text-muted-foreground">Added</dt><dd className="text-right">{formatDate(k.createdAt)}</dd>
                          <dt className="text-muted-foreground">Last used</dt><dd className="text-right">{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : "Never"}</dd>
                          <dt className="text-muted-foreground">Expires</dt><dd className="text-right"><Expiry item={k} /></dd>
                        </dl>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <GenerateKeyDialog
        key={generateSession}
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        planUnits={plan?.unitsPerMonth ?? 0}
        pending={createMutation.isPending}
        onSubmit={(body) => createMutation.mutate(body)}
      />
      <NewKeyDialog result={newKey} onClose={dismissNewKey} />
      <RenameDialog item={renaming} pending={patchMutation.isPending} onClose={() => setRenaming(null)} onSubmit={(name) => renaming && patchMutation.mutate({ id: renaming.id, name })} />
      <LimitDialog item={limiting} planUnits={plan?.unitsPerMonth ?? 0} pending={patchMutation.isPending} onClose={() => setLimiting(null)} onSubmit={(limit) => limiting && patchMutation.mutate({ id: limiting.id, monthlyUnitLimit: limit })} />
      <AlertDialog open={!!revoking} onOpenChange={(open) => { if (!open) setRevoking(null); }}>
        <AlertDialogContent data-testid="dialog-revoke-key">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {revoking?.name ?? "this key"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {revoking ? `${maskedKey(revoking)} stops working immediately. ` : ""}Anything using it will get 401 errors until it's given a new key. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-revoke-cancel">Keep key</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={revokeMutation.isPending}
              onClick={(e) => { e.preventDefault(); if (revoking) revokeMutation.mutate(revoking.id); }}
              data-testid="button-revoke-confirm"
            >
              {revokeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Revoke key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** This month's units against the plan's allowance, plus the per-key rate limit. */
function QuotaCard({ used, limit, ratePerMinute }: { used: number; limit: number; ratePerMinute: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((Math.max(0, used) / limit) * 100)) : 0;
  const exhausted = limit > 0 && used >= limit;
  return (
    <Card data-testid="card-api-quota">
      <CardContent className="pt-6 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-medium">API units this month</span>
          <span className={`tabular-nums ${exhausted ? "text-destructive" : "text-muted-foreground"}`} data-testid="text-api-quota">
            {limit < 0 ? `${formatCount(used)} used · unlimited` : `${formatCount(used)} of ${formatCount(limit)} used`}
          </span>
        </div>
        {limit > 0 && (
          <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-label="API units this month" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className={`h-full rounded-full ${exhausted ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
          </div>
        )}
        <p className="text-xs text-muted-foreground" data-testid="text-api-rate">
          A read costs 1 unit (+1 per 100 rows); a write costs 5. Units are counted per calendar month, and each key may make {formatCount(ratePerMinute)} requests per minute.
          {exhausted ? " This month's allowance is used up: calls get 429 until it resets." : ""}
        </p>
      </CardContent>
    </Card>
  );
}

function ScopeBadges({ scopes }: { scopes: ApiScope[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {API_SCOPES.filter((s) => scopes.includes(s.id)).map((s) => <Badge key={s.id} variant="secondary" className="text-[10px]">{s.label}</Badge>)}
    </span>
  );
}

function Expiry({ item }: { item: ApiKeyItem }) {
  if (!item.expiresAt) return <span className="text-muted-foreground">Never</span>;
  const days = daysUntil(item.expiresAt);
  if (days !== null && days <= 0) return <Badge variant="destructive" className="text-[10px]">Expired {formatDate(item.expiresAt)}</Badge>;
  return <span className={days !== null && days <= 7 ? "text-destructive" : undefined}>{formatDate(item.expiresAt)}</span>;
}

function KeyMenu({ item, idSuffix, onRename, onLimit, onRevoke }: {
  item: ApiKeyItem; idSuffix: string;
  onRename: (k: ApiKeyItem) => void; onLimit: (k: ApiKeyItem) => void; onRevoke: (k: ApiKeyItem) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${item.name}`} data-testid={`button-key-menu${idSuffix}-${item.id}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onRename(item)} data-testid="menu-key-rename">Rename</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onLimit(item)} data-testid="menu-key-limit">Set monthly limit</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onRevoke(item)} className="text-destructive focus:text-destructive" data-testid="menu-key-revoke">Revoke…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GenerateKeyDialog({ open, onOpenChange, planUnits, pending, onSubmit }: {
  open: boolean; onOpenChange: (open: boolean) => void; planUnits: number; pending: boolean; onSubmit: (body: CreateApiKeyBody) => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["read"]);
  const [limit, setLimit] = useState("");
  const [expiry, setExpiry] = useState("365");
  const parsedLimit = parseLimit(limit);
  const limitError = Number.isNaN(parsedLimit) ? "Enter a whole number of units, or leave it blank for the plan's allowance."
    : parsedLimit !== null && planUnits > 0 && parsedLimit > planUnits ? `Your plan allows ${formatCount(planUnits)} units a month; a key can't have more.`
    : null;
  const canSubmit = name.trim().length > 0 && scopes.length > 0 && !limitError && !pending;
  const toggle = (scope: ApiScope, on: boolean) => setScopes((prev) => (on ? Array.from(new Set([...prev, scope])) : prev.filter((s) => s !== scope)));
  const reset = () => { setName(""); setScopes(["read"]); setLimit(""); setExpiry("365"); };
  const submit = () => {
    if (!canSubmit) return;
    const days = EXPIRY_CHOICES.find((c) => c.value === expiry)?.days ?? null;
    const body: CreateApiKeyBody = { name: name.trim(), scopes: API_SCOPES.map((s) => s.id).filter((s) => scopes.includes(s)) };
    if (parsedLimit !== null && !Number.isNaN(parsedLimit)) body.monthlyUnitLimit = parsedLimit;
    if (days !== null) body.expiresInDays = days;
    onSubmit(body);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent data-testid="dialog-generate-key">
        <DialogHeader>
          <DialogTitle>Generate API key</DialogTitle>
          <DialogDescription>{API_NO_AI_NOTICE} You'll see the key once; store it somewhere safe.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="api-key-name">Title</Label>
            <Input id="api-key-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Zapier, my reporting script" autoFocus data-testid="input-key-name" />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Scope</legend>
            {API_SCOPES.map((s) => (
              <label key={s.id} className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox checked={scopes.includes(s.id)} onCheckedChange={(v) => toggle(s.id, v === true)} className="mt-0.5" data-testid={`checkbox-scope-${s.id}`} />
                <span><span className="font-medium">{s.label}</span> <span className="text-muted-foreground">— {s.blurb}</span></span>
              </label>
            ))}
            {scopes.length === 0 && <p className="text-xs text-destructive" role="alert">Pick at least one scope.</p>}
          </fieldset>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="api-key-limit">Monthly unit limit</Label>
              <Input id="api-key-limit" type="number" inputMode="numeric" min={1} max={planUnits > 0 ? planUnits : undefined} value={limit} onChange={(e) => setLimit(e.target.value)}
                placeholder={planUnits > 0 ? `Plan allowance (${formatCount(planUnits)})` : "Plan allowance"} aria-invalid={!!limitError} data-testid="input-key-limit" />
              {limitError ? <p className="text-xs text-destructive" role="alert" data-testid="text-key-limit-error">{limitError}</p>
                : <p className="text-xs text-muted-foreground">Caps this key below your plan's monthly units.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="api-key-expiry">Expires</Label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger id="api-key-expiry" data-testid="select-key-expiry"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPIRY_CHOICES.map((c) => <SelectItem key={c.value} value={c.value} data-testid={`option-key-expiry-${c.value}`}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">An expired key stops working on its own.</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!canSubmit} data-testid="button-generate-submit">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate key"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The one time the full key is on screen. */
function NewKeyDialog({ result, onClose }: { result: CreateApiKeyResponse | null; onClose: () => void }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!result) return;
    const ok = await copyToClipboard(result.key);
    setCopied(ok);
    toast(ok ? { title: "Key copied" } : { title: "Couldn't copy", description: "Select the key and copy it by hand.", variant: "destructive" });
  };
  return (
    <Dialog open={!!result} onOpenChange={(o) => { if (!o) { setCopied(false); onClose(); } }}>
      <DialogContent data-testid="dialog-new-key">
        <DialogHeader>
          <DialogTitle>{result?.item.name ?? "API key"} is ready</DialogTitle>
          <DialogDescription>Copy it now. For your security it won't be shown again; if you lose it, revoke it and generate a new one.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={result?.key ?? ""} className="font-mono text-xs" aria-label="New API key" onFocus={(e) => e.currentTarget.select()} data-testid="text-new-key" />
          <Button type="button" variant="outline" onClick={copy} aria-label="Copy key" data-testid="button-copy-key">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Send it as <code>Authorization: Bearer {result?.key ? `chub_${result.item.prefix}_…` : "chub_…"}</code> on requests to <code>/api/v1</code>.
        </p>
        <DialogFooter>
          <Button type="button" onClick={() => { setCopied(false); onClose(); }} data-testid="button-new-key-done">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The draft is remembered with the id of the key it was typed for: the dialog
 * closes from code after a successful save (no onOpenChange), so an untied
 * draft would pre-fill the next key's dialog with the previous key's text.
 */
function RenameDialog({ item, pending, onClose, onSubmit }: { item: ApiKeyItem | null; pending: boolean; onClose: () => void; onSubmit: (name: string) => void }) {
  const [draft, setDraft] = useState<{ id: string; name: string } | null>(null);
  const value = draft && draft.id === item?.id ? draft.name : item?.name ?? "";
  const close = () => { setDraft(null); onClose(); };
  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent data-testid="dialog-rename-key">
        <DialogHeader><DialogTitle>Rename key</DialogTitle><DialogDescription>{item ? maskedKey(item) : ""}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}>
          <div className="space-y-1.5">
            <Label htmlFor="api-key-rename">Title</Label>
            <Input id="api-key-rename" value={value} onChange={(e) => item && setDraft({ id: item.id, name: e.target.value })} maxLength={80} autoFocus data-testid="input-rename-key" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={!value.trim() || pending} data-testid="button-rename-submit">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LimitDialog({ item, planUnits, pending, onClose, onSubmit }: {
  item: ApiKeyItem | null; planUnits: number; pending: boolean; onClose: () => void; onSubmit: (limit: number | null) => void;
}) {
  // Same rule as RenameDialog: a draft belongs to the key it was typed for.
  const [draft, setDraft] = useState<{ id: string; value: string } | null>(null);
  const stored = item?.monthlyUnitLimit === null || item?.monthlyUnitLimit === undefined ? "" : String(item.monthlyUnitLimit);
  const value = draft && draft.id === item?.id ? draft.value : stored;
  const close = () => { setDraft(null); onClose(); };
  const parsed = parseLimit(value);
  const err = Number.isNaN(parsed) ? "Enter a whole number of units, or leave it blank for the plan's allowance."
    : parsed !== null && planUnits > 0 && parsed > planUnits ? `Your plan allows ${formatCount(planUnits)} units a month; a key can't have more.` : null;
  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent data-testid="dialog-limit-key">
        <DialogHeader>
          <DialogTitle>Monthly unit limit</DialogTitle>
          <DialogDescription>{item?.name}: units this key may spend each month. Blank means your plan's allowance{planUnits > 0 ? ` (${formatCount(planUnits)})` : ""}.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!err) onSubmit(parsed === null ? null : parsed); }}>
          <div className="space-y-1.5">
            <Label htmlFor="api-key-limit-edit">Units per month</Label>
            <Input id="api-key-limit-edit" type="number" inputMode="numeric" min={1} max={planUnits > 0 ? planUnits : undefined} value={value} onChange={(e) => item && setDraft({ id: item.id, value: e.target.value })} placeholder="Plan allowance" aria-invalid={!!err} autoFocus data-testid="input-limit-key" />
            {err && <p className="text-xs text-destructive" role="alert">{err}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={!!err || pending} data-testid="button-limit-submit">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ApiKeysPanel;
