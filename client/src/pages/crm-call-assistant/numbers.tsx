import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Hash, Loader2, Pencil, Plus, AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/crm-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { ADDONS } from "@shared/plans";
import { formatUsd } from "@shared/plan-copy";
import { BuyNumberWizard } from "./numbers-buy";
import { ForwardingInstructions } from "./numbers-forwarding";
import { NUMBERS_KEY, NumberStatusPill, formatDate, formatPhone, type NumbersResponse, type VoiceNumber } from "./numbers-shared";

/**
 * Numbers tab — buy-by-state wizard (state → area code / city → pick → label
 * + location), the org's numbers with release dates, and forwarding
 * instructions per carrier / CallRail. OWNER: numbers+billing lane (LANES.md).
 * API: /api/crm/voice/numbers* (server/voice/numbers.ts).
 */
export function NumbersPanel({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const q = useQuery<NumbersResponse>({ queryKey: [NUMBERS_KEY] });
  const [buying, setBuying] = useState(false);
  const [justBought, setJustBought] = useState<string | null>(null);
  const [editing, setEditing] = useState<VoiceNumber | null>(null);
  const [releasing, setReleasing] = useState<VoiceNumber | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [NUMBERS_KEY] });
    void queryClient.invalidateQueries({ queryKey: ["/api/crm/voice/status"] });
  };

  const release = useMutation({
    mutationFn: async (n: VoiceNumber) => (await apiRequest("DELETE", `${NUMBERS_KEY}/${n.id}`)).json(),
    onSuccess: (data: any, n) => {
      invalidate();
      toast({ title: data?.dismissed ? "Removed the unfinished purchase" : `${formatPhone(n.phoneNumber)} released`, description: data?.message });
      setReleasing(null);
    },
    onError: (e) => { toast({ title: "Couldn't release that number", description: apiErrorMessage(e), variant: "destructive" }); setReleasing(null); },
  });

  if (q.isLoading) {
    return <div className="pt-4" data-testid="panel-call-assistant-numbers"><p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />Loading numbers…</p></div>;
  }
  if (q.isError || !q.data) {
    return <div className="pt-4" data-testid="panel-call-assistant-numbers"><p className="text-sm text-destructive" role="alert">Couldn't load numbers. {apiErrorMessage(q.error)}</p></div>;
  }

  const d = q.data;
  const manage = canManage && d.canManage;
  const shown = d.numbers.filter((n) => n.status !== "released");
  const released = d.numbers.filter((n) => n.status === "released");
  const full = d.allowance.remaining <= 0;
  const showWizard = manage && d.configured && !full && (buying || shown.length === 0);

  return (
    <div data-testid="panel-call-assistant-numbers" className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium" data-testid="text-voice-numbers-allowance">
            {d.allowance.used} of {d.allowance.numbers} number{d.allowance.numbers === 1 ? "" : "s"} in use
          </p>
          <p className="text-xs text-muted-foreground">
            {d.allowance.includedNumbers} included with the add-on; more are {formatUsd(d.allowance.extraNumberMonthlyCents)}/mo each ({ADDONS.call_number.name}).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {d.mock && <Badge variant="outline" data-testid="badge-voice-numbers-mock-list">Mock carrier — not real numbers</Badge>}
          {manage && d.configured && !full && !showWizard && (
            <Button size="sm" onClick={() => setBuying(true)} data-testid="button-voice-number-add"><Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />Add a number</Button>
          )}
        </div>
      </div>

      {!d.configured && (
        <Card className="border-amber-500/40" data-testid="card-voice-numbers-unconfigured">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            <span>Numbers can't be bought on this server yet: the phone carrier isn't connected. Nothing will be charged.</span>
          </CardContent>
        </Card>
      )}

      {manage && full && d.configured && (
        <Card data-testid="card-voice-numbers-full">
          <CardContent className="p-4 text-sm space-y-2">
            <p>Every number your add-on includes is in use.</p>
            <p className="text-muted-foreground">
              Add the {ADDONS.call_number.name} add-on ({formatUsd(ADDONS.call_number.monthlyCents)}/mo each) in Billing for another, or release one you no longer need.
              {ADDONS.call_number.preview ? " (It isn't on sale yet.)" : ""}
            </p>
            {!ADDONS.call_number.preview && (
              <Button asChild size="sm" variant="outline"><a href="/settings?tab=billing" data-testid="link-voice-numbers-billing">Open Billing</a></Button>
            )}
          </CardContent>
        </Card>
      )}

      {!manage && shown.length === 0 && (
        <EmptyState icon={Hash} title="No numbers yet" description="Only members who manage settings can buy or release numbers." />
      )}

      {showWizard && (
        <BuyNumberWizard
          minDays={d.minDays}
          mock={d.mock}
          onBought={(n) => { setBuying(false); setJustBought(n.id); }}
          onCancel={shown.length > 0 ? () => setBuying(false) : undefined}
        />
      )}

      {shown.length > 0 && (
        <div className="grid gap-3" data-testid="list-voice-numbers">
          {shown.map((n) => (
            <Card key={n.id} data-testid={`card-voice-number-${n.id}`}>
              <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold tabular-nums" data-testid={`text-voice-number-phone-${n.id}`}>{formatPhone(n.phoneNumber)}</span>
                    <NumberStatusPill status={n.status} testId={`status-voice-number-${n.id}`} />
                    {n.isTest && <Badge variant="outline">Test number</Badge>}
                    {n.provider === "mock" && <Badge variant="outline">Mock</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {[n.label, n.location].filter(Boolean).join(" · ") || "No label"}
                    {n.forwardingFrom ? ` · forwarded from ${formatPhone(n.forwardingFrom)}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground" data-testid={`text-voice-number-dates-${n.id}`}>
                    {n.purchasedAt ? `Bought ${formatDate(n.purchasedAt)}` : "Not bought"}
                    {n.status === "active" && n.releaseEligibleAt
                      ? n.releasable ? " · can be released any time" : ` · can be released from ${formatDate(n.releaseEligibleAt)}`
                      : ""}
                    {` · ${n.monthlyCents > 0 ? `${formatUsd(n.monthlyCents)}/mo extra number` : "included"}`}
                  </p>
                  {n.lastError && <p className="text-xs text-destructive" data-testid={`text-voice-number-error-${n.id}`}>{n.lastError}</p>}
                </div>
                {manage && (
                  <div className="flex flex-wrap gap-2">
                    {n.status === "active" && (
                      <Button size="sm" variant="outline" onClick={() => setEditing(n)} data-testid={`button-voice-number-edit-${n.id}`}><Pencil className="h-4 w-4 mr-1.5" aria-hidden="true" />Edit</Button>
                    )}
                    {(n.status === "active" || n.status === "failed") && (
                      <Button size="sm" variant="ghost" className="text-destructive"
                        disabled={n.status === "active" && !n.releasable}
                        title={n.status === "active" && !n.releasable ? `The carrier keeps a number for ${d.minDays} days; release from ${formatDate(n.releaseEligibleAt)}.` : undefined}
                        onClick={() => setReleasing(n)} data-testid={`button-voice-number-release-${n.id}`}>
                        {n.status === "failed" ? "Dismiss" : "Release"}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {released.length > 0 && (
        <details className="text-sm" data-testid="details-voice-numbers-released">
          <summary className="cursor-pointer text-muted-foreground">{released.length} released number{released.length === 1 ? "" : "s"}</summary>
          <ul className="mt-2 space-y-1 pl-4 text-muted-foreground">
            {released.map((n) => <li key={n.id}>{formatPhone(n.phoneNumber)}{n.label ? ` — ${n.label}` : ""} · released {formatDate(n.releasedAt)}</li>)}
          </ul>
        </details>
      )}

      <ForwardingInstructions numbers={d.numbers} carriers={d.forwarding.carriers} advice={d.forwarding.advice} initialId={justBought} key={justBought ?? "fwd"} />

      {editing && <EditNumberDialog number={editing} onClose={() => setEditing(null)} onSaved={invalidate} />}

      <AlertDialog open={!!releasing} onOpenChange={(open) => { if (!open && !release.isPending) setReleasing(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{releasing?.status === "failed" ? "Remove this unfinished purchase?" : `Release ${formatPhone(releasing?.phoneNumber)}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {releasing?.status === "failed"
                ? "The carrier never confirmed this purchase. Removing it here doesn't call the carrier."
                : "Calls to it stop reaching the assistant right away, and the number goes back to the carrier — you may not get it back. Move any forwarding off it first."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={release.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (releasing) release.mutate(releasing); }}
              disabled={release.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-voice-number-release-confirm"
            >
              {release.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" /> : null}
              {releasing?.status === "failed" ? "Remove" : "Release number"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditNumberDialog({ number, onClose, onSaved }: { number: VoiceNumber; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [label, setLabel] = useState(number.label ?? "");
  const [location, setLocation] = useState(number.location ?? "");
  const [forwardingFrom, setForwardingFrom] = useState(number.forwardingFrom ? formatPhone(number.forwardingFrom) : "");
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `${NUMBERS_KEY}/${number.id}`, { label, location, forwardingFrom })).json(),
    onSuccess: () => { onSaved(); toast({ title: "Number updated" }); onClose(); },
    onError: (e) => toast({ title: "Couldn't save", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {formatPhone(number.phoneNumber)}</DialogTitle>
          <DialogDescription>The label and location show in the call log and tell the assistant which line was called.</DialogDescription>
        </DialogHeader>
        <form id="voice-number-edit" className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="voice-edit-label">Label</Label>
            <Input id="voice-edit-label" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} data-testid="input-voice-number-edit-label" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="voice-edit-location">Location</Label>
            <Input id="voice-edit-location" maxLength={120} value={location} onChange={(e) => setLocation(e.target.value)} data-testid="input-voice-number-edit-location" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="voice-edit-forward">Line forwarded to it</Label>
            <Input id="voice-edit-forward" inputMode="tel" value={forwardingFrom} onChange={(e) => setForwardingFrom(e.target.value)} data-testid="input-voice-number-edit-forwarding-from" />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form="voice-number-edit" disabled={save.isPending} data-testid="button-voice-number-edit-save">
            {save.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" /> : null}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
