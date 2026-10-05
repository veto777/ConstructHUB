import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { VerificationCancelled } from "@/components/recent-auth";

/**
 * Self-serve account deletion — shown ONLY inside the iPhone apps (App Store 5.1.1(v); owner, 2026-10-04: "just dont
 * delete in the original site/mobile … we just want the native app to have the deletions"). The website keeps its
 * email-support request (settings/me-account.tsx). Server: server/account/delete.ts.
 */
type Preflight = {
  blockers: { kind: "crm_team"; orgId: string; orgName: string; members: number }[];
  activeSubscriptions: number;
  eraseAfterDays: number;
};

export function AccountDeletionCard() {
  const pre = useQuery<Preflight>({ queryKey: ["/api/account/delete/preflight"] });
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const del = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/account/delete", { confirm: "DELETE" })).json(),
    onSuccess: (d: any) => setDone(typeof d?.eraseAfter === "string" ? d.eraseAfter : ""),
  });

  if (done !== null) {
    const when = done ? new Date(done).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null;
    return (
      <div className="space-y-3" data-testid="card-account-deleted">
        <CheckCircle2 className="h-8 w-8 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Your account was deleted</h2>
        <p className="text-sm text-muted-foreground">
          You've been signed out everywhere and your subscription was cancelled.
          {when ? ` Your remaining data will be erased by ${when}.` : ""} A confirmation email is on its way.
        </p>
        <Button onClick={() => window.location.assign("/")} data-testid="button-account-deleted-close">Close</Button>
      </div>
    );
  }

  const blockers = pre.data?.blockers ?? [];
  const days = pre.data?.eraseAfterDays ?? 30;
  const failed = del.isError && !(del.error instanceof VerificationCancelled);
  return (
    <div className="space-y-4" data-testid="card-account-deletion">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-destructive">Delete your account</h2>
        <p className="text-sm text-muted-foreground">This closes your ConstructHUB account for good — on the website and in every app.</p>
      </div>
      <ul className="list-disc pl-5 space-y-1 text-sm">
        <li>You're signed out everywhere and can't sign in again with this account.</li>
        <li>{pre.data?.activeSubscriptions ? "Your subscription is cancelled now." : "Nothing is billed after this."}</li>
        <li>Connected Google, Ads and social accounts are disconnected, and API keys stop working.</li>
        <li>Your data — locations, reviews, CRM clients, estimates, calls and files — is permanently erased within {days} days.</li>
        <li>Payment and invoice records are kept without your name or email, as the law requires.</li>
      </ul>

      {blockers.length > 0 ? (
        <div role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm" data-testid="text-account-deletion-blocked">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
          <span>
            Your team still uses {blockers.map((b) => `${b.orgName} (${b.members} other ${b.members === 1 ? "person" : "people"})`).join(", ")}.
            Remove them in CRM → Team &amp; Company first, then come back here.
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="account-delete-confirm">Type DELETE to confirm</Label>
          <Input id="account-delete-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off"
            autoCapitalize="characters" data-testid="input-account-delete-confirm" />
          <Button variant="destructive" className="w-full" disabled={typed.trim() !== "DELETE" || del.isPending || pre.isLoading}
            onClick={() => del.mutate()} data-testid="button-account-delete">
            {del.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting…</> : <><Trash2 className="h-4 w-4 mr-2" />Delete my account</>}
          </Button>
        </div>
      )}
      {failed && <p role="alert" className="text-sm text-destructive" data-testid="text-account-delete-error">{apiErrorMessage(del.error, "Couldn't delete your account.")}</p>}
    </div>
  );
}
