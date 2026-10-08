import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { LockKeyhole } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CrmPage } from "@/components/crm-ui";
import { crmPageRefusal, crmPageRule, crmPermissionPhrase, type CrmPageRule } from "@shared/crm-access";

/**
 * What a seat sees on a page its permissions don't cover (a deep link, an old
 * bookmark, a link a colleague pasted): what the page is, which switch it
 * needs, and who can flip it — instead of a page of failed requests. The
 * server refuses the data either way; this is only the polite front.
 */
export function CrmNoAccess({ rule, orgName }: { rule: CrmPageRule; orgName?: string | null }) {
  return (
    <CrmPage>
      <Card data-testid="crm-no-access">
        <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <LockKeyhole className="h-6 w-6" strokeWidth={1.8} />
          </div>
          <h1 className="text-lg font-semibold" data-testid="text-no-access-title">
            {rule.title} isn’t part of your access
          </h1>
          <p className="max-w-md text-sm text-muted-foreground" data-testid="text-no-access-body">
            This page needs the {crmPermissionPhrase(rule.anyOf)} permission, which is switched off for your seat
            {orgName ? ` at ${orgName}` : ""}. Ask your admin — an owner or admin can turn it on for you under
            Team &amp; Company.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button asChild data-testid="button-no-access-home"><Link href="/crm">Back to Home</Link></Button>
            <Button asChild variant="outline" data-testid="button-no-access-schedule"><Link href="/crm/schedule">My schedule</Link></Button>
          </div>
        </CardContent>
      </Card>
    </CrmPage>
  );
}

/** Wraps the CRM routes: a page the seat may not open renders the ask-your-admin card instead. */
export function CrmAccessGate({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: me, isLoading } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  // A gated page waits for /api/crm/me before it mounts, so a seat without the permission never sees
  // the page flash or fires its (refused) requests. Open pages mount straight away.
  if (isLoading && crmPageRule(location)) return null;
  const refusal = me?.permissions ? crmPageRefusal(location, me.permissions) : null;
  if (refusal) return <CrmNoAccess rule={refusal} orgName={me?.org?.name} />;
  return <>{children}</>;
}
