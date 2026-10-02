/**
 * /call-assistant for a SIGNED-IN visitor (the sidebar's "Call Assistant"). Owner, 2026-10-02: "why is the alpine
 * dashboard not updated here?" — signed in, the sidebar opened the sales page instead of their calls.
 *
 * A CRM member (GET /api/crm/me returns an org, the same test as the /crm-app gateway) goes straight to their
 * dashboard on the portal: results, calls, recordings, numbers, the Studio. Anyone else gets the feature page
 * (what it does and what it costs). Signed-out visitors never reach this file (PublicRouter serves the page).
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { portalUrl } from "@/lib/site";
import CallAssistantLandingPage from "@/pages/call-assistant-landing";

export default function CallAssistantEntry() {
  const { data, isLoading, error } = useQuery<any>({ queryKey: ["/api/crm/me"], retry: false });
  const [failed, setFailed] = useState(false);
  const member = !error && !!data?.org?.id && !failed;
  useEffect(() => {
    if (!member) return;
    // A host the browser can't open (e.g. portal.<IP> in local testing) falls back to the feature page, never a crash.
    try { window.location.replace(portalUrl("/crm/call-assistant")); } catch { setFailed(true); }
  }, [member]);
  if (isLoading || member) {
    return (
      <main className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground" data-testid="page-call-assistant-entry">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Opening your Call Assistant…
      </main>
    );
  }
  return <CallAssistantLandingPage />;
}
