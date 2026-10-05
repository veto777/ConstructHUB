import { AppPage, PageHeader } from "@/components/app-ui";
/**
 * /invite/:code — the link in a trial invite email (owner, 2026-10-02: "you aren't emailing someone else a code.
 * You are emailing them an invite or the system creates a code that can be redeemed").
 *
 * Signed out: create an account or sign in, and come straight back here (next=/invite/<code>).
 * Signed in: one click activates the trial on the account shown (never silently on whatever account the browser
 * happens to hold).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicPageHeader } from "@/components/public-page-chrome";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { inNativeApp } from "@/lib/app-shell";

export default function InvitePage() {
  const [, params] = useRoute("/invite/:code");
  const code = decodeURIComponent(params?.code ?? "").trim().toUpperCase();
  const here = `/invite/${encodeURIComponent(code)}`;
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const [done, setDone] = useState<string | null>(null);

  const redeem = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/beta-codes/redeem", { code })).json(),
    onSuccess: (d: any) => {
      setDone(typeof d?.message === "string" ? d.message : "Your trial is active.");
      // The trial is a plan grant: billing, limits and every gated page change with it.
      for (const key of ["/api/beta-codes/status", "/api/stripe/subscription", "/api/entitlements", "/api/agency/me", "/api/dashboard"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const card = (body: React.ReactNode) => (
    <AppPage width="narrow">
      <div className="space-y-4" data-testid="card-invite">
        {body}
      </div>
    </AppPage>
  );

  if (isLoading) return card(<p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading your invite…</p>);

  // The iPhone apps sell nothing (App Store 3.1.3(f)): an invite grants a trial plan — that
  // changes billing state, so it isn't activated inside the app. No trial copy, no activation.
  if (inNativeApp()) {
    return card(<>
      <h1 className="text-2xl font-semibold" data-testid="text-invite-title">This invite can't be activated in the app</h1>
      <p className="text-sm text-muted-foreground">Open your invite link in a browser to use it.</p>
      {/^[A-Z0-9-]{4,40}$/.test(code) && <p className="text-xs text-muted-foreground">Invite code: <span className="font-mono">{code}</span></p>}
    </>);
  }

  if (!/^[A-Z0-9-]{4,40}$/.test(code)) {
    return (
      <>
        {!user && <PublicPageHeader next="/" />}
        {card(<>
          <h1 className="text-xl font-semibold">This invite link is incomplete</h1>
          <p className="text-sm text-muted-foreground">Open the link from your invite email again, or enter the code in Settings → Account.</p>
        </>)}
      </>
    );
  }

  if (!user) {
    return (
      <>
        <PublicPageHeader next={here} />
        {card(<>

          <h1 className="text-2xl font-semibold" data-testid="text-invite-title">You're invited to ConstructHUB</h1>
          <p className="text-sm text-muted-foreground">
            Someone gave you a free trial. Create your account or sign in, and the trial starts as soon as you're back on this page.
          </p>
          <div className="flex flex-col gap-2 pt-2">
            <Button asChild size="lg" data-testid="button-invite-signup">
              <Link href={`/auth?mode=signup&next=${encodeURIComponent(here)}`}>Create your account</Link>
            </Button>
            <Button asChild size="lg" variant="outline" data-testid="button-invite-signin">
              <Link href={`/auth?next=${encodeURIComponent(here)}`}>I already have an account</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Invite code: <span className="font-mono">{code}</span></p>
        </>)}
      </>
    );
  }

  if (done) {
    return card(<>
      <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden="true" />
      <PageHeader title={<span data-testid="text-invite-done">Your trial is active</span>} />
      <p className="text-sm text-muted-foreground">{done}</p>
      <Button asChild size="lg" className="w-full" data-testid="button-invite-dashboard"><Link href="/">Open your dashboard</Link></Button>
    </>);
  }

  return card(<>

    <PageHeader title={<span data-testid="text-invite-title">Accept your free trial</span>} description="Activate your invite on the account below." />
    <p className="text-sm text-muted-foreground">
      The trial goes on the account you're signed in to: <strong className="text-foreground break-all" data-testid="text-invite-account">{user.email}</strong>.
    </p>
    <Button size="lg" className="w-full" onClick={() => redeem.mutate()} disabled={redeem.isPending} data-testid="button-invite-accept">
      {redeem.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Activating…</> : "Start my trial"}
    </Button>
    {redeem.isError && <p role="alert" className="text-sm text-destructive" data-testid="text-invite-error">{apiErrorMessage(redeem.error, "Couldn't activate this invite.")}</p>}
    <p className="text-xs text-muted-foreground">Not you? Sign out from the menu, then open the invite link again.</p>
  </>);
}
