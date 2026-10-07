import { AppPage, Notice } from "@/components/app-ui";
import { GoogleList, GoogleListRow, GooglePill, GoogleSectionHeader } from "@/components/google";
/**
 * /admin/youtube — connect the company YouTube channel once, so the tutorial
 * videos can be uploaded by a script (server/youtube/*). Linked from the
 * Platform Admin console (/admin on the CRM host, crm-admin.tsx). It lives on
 * the main site so Google has ONE redirect URI to send the admin back to.
 *
 * Platform admins only: GET /api/admin/youtube/status answers 403 to anyone
 * else. The admin second factor (403 reauth) is handled like /admin/issues:
 * apiRequest opens the verify-identity dialog and retries. "Connect" is a
 * plain link — the server redirects the browser to Google and back here with
 * ?result=connected|failed. Nothing on this page ever receives a token.
 */
import { useEffect, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, Copy, ExternalLink, Loader2, Lock, Unplug, Youtube } from "lucide-react";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/components/feature-landing/primitives";
import { VerificationCancelled } from "@/components/recent-auth";

type Status = {
  connected: boolean;
  needsReconnect: boolean;
  channelId: string | null;
  channelTitle: string | null;
  scopes: string[];
  connectedAt: string | null;
  connectedBy: string | null;
  lastError: { code: string | null; message: string; at: string | null } | null;
  configured: boolean;
  expectedChannelId: string;
  redirectUri: string;
  requestedScopes: string[];
};

const STATUS_KEY = "/api/admin/youtube/status";
const CONNECT_URL = "/api/admin/youtube/connect";

/** What each permission lets the site do, in plain words. An unknown scope is shown as it is. */
const SCOPE_LABELS: Record<string, string> = {
  "https://www.googleapis.com/auth/youtube.upload": "Upload videos",
  "https://www.googleapis.com/auth/youtube.readonly": "See the channel (to check the right one was picked)",
  "https://www.googleapis.com/auth/yt-analytics.readonly": "Read the channel's view statistics",
  "https://www.googleapis.com/auth/youtube.force-ssl": "Manage captions and playlists",
};
const shortScope = (s: string) => s.replace("https://www.googleapis.com", "...");

function failure(err: unknown): { status: number; body: any } {
  const raw = String((err as Error | null)?.message ?? "");
  const status = Number(raw.slice(0, 3)) || 0;
  try { return { status, body: JSON.parse(raw.replace(/^\d{3}:\s*/, "")) }; } catch { return { status, body: null }; }
}
const getJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();
const mono = "break-all rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]";

/** The card: status, Connect / Disconnect, "Before you connect" and "Good to know". */
export function YoutubeChannelCard({ enabled = true, heading = "h2" }: { enabled?: boolean; heading?: "h1" | "h2" }) {
  const { toast } = useToast();
  const { data, isLoading, error, refetch } = useQuery<Status>({ queryKey: [STATUS_KEY], queryFn: () => getJson<Status>(STATUS_KEY), enabled, retry: false });
  const fail = useMemo(() => (error ? failure(error) : null), [error]);
  const disconnect = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/youtube/disconnect")).json() as Promise<{ removed: boolean; revokedAtGoogle: boolean }>,
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: [STATUS_KEY] });
      toast({
        title: "YouTube channel disconnected",
        description: r.revokedAtGoogle
          ? "The saved sign-in was deleted here and cancelled at Google."
          : "The saved sign-in was deleted here. Google did not confirm cancelling it — you can also remove ConstructHUB under your Google Account's third-party access.",
      });
    },
    onError: (e) => toast({ title: "Couldn't disconnect", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const copy = async (text: string) => {
    // Only claim the copy when the clipboard actually took it.
    try { await navigator.clipboard.writeText(text); toast({ title: "Copied" }); }
    catch { toast({ title: "Copy failed — select the text and copy it by hand", variant: "destructive" }); }
  };

  const header = (actions?: React.ReactNode) => (
    <GoogleSectionHeader as={heading} title="YouTube channel" description="Connect the company channel once so tutorial videos can be uploaded to it." actions={actions} />
  );

  if (!enabled) return null;
  if (isLoading && !data) {
    return <section data-testid="card-youtube">{header()}<div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" /></div></section>;
  }
  if (!data) {
    const verify = error instanceof VerificationCancelled || fail?.body?.reauth === true;
    const forbidden = !verify && (fail?.status === 401 || fail?.status === 403);
    return (
      <section data-testid={verify ? "card-youtube-verify" : "card-youtube-denied"}>
        {header()}
        <div className="py-8 text-center">
          <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-base font-medium">{verify ? "Verify it's you" : forbidden ? "Platform admins only" : "Couldn't load the YouTube connection"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {verify ? "Admin tools need a recent identity check." : forbidden ? "Only the people who run ConstructHUB can connect the company channel." : "Try again in a moment."}
          </p>
          {!forbidden && <GooglePill variant="solid" className="mt-4" label={verify ? "Verify identity" : "Try again"} onClick={() => void refetch()} testId="button-youtube-retry" />}
        </div>
      </section>
    );
  }

  const usable = data.connected && !data.needsReconnect;
  const connectLabel = data.needsReconnect ? "Reconnect YouTube channel" : data.connected ? "Connect again" : "Connect YouTube channel";
  const missing = data.connected ? data.requestedScopes.filter((s) => !data.scopes.includes(s)) : [];

  return (
    <section data-testid="card-youtube" data-connected={usable ? "true" : "false"} className="space-y-5">
      {header(<>
        {data.configured && <GooglePill variant={usable ? "outline" : "solid"} icon={Youtube} href={CONNECT_URL} label={connectLabel} testId="link-youtube-connect" />}
        {data.connected && (
          <GooglePill variant="danger" icon={Unplug} label={disconnect.isPending ? "Disconnecting…" : "Disconnect"} disabled={disconnect.isPending} testId="button-youtube-disconnect"
            onClick={() => { if (window.confirm("Disconnect the YouTube channel? Uploads stop until it is connected again. Videos already on YouTube stay there.")) disconnect.mutate(); }} />
        )}
      </>)}

      {!data.configured && (
        <Notice tone="warning" title="Google sign-in is not set up on this server" testId="notice-youtube-not-configured">
          The Google OAuth client is missing, so the channel cannot be connected from here.
        </Notice>
      )}

      {data.lastError && (
        <Notice tone="danger" title={data.connected ? "The last attempt to connect again did not work" : "The last attempt did not connect"} testId="notice-youtube-last-error">
          <span data-testid="text-youtube-last-error">{data.lastError.message}</span>
          {data.lastError.at && <span className="block text-xs opacity-80">{format(new Date(data.lastError.at), "MMM d, yyyy h:mm a")}</span>}
        </Notice>
      )}

      <GoogleList testId="list-youtube-status">
        <GoogleListRow
          size="md"
          testId="row-youtube-status"
          title={usable ? data.channelTitle || "Connected" : data.needsReconnect ? "Connection expired" : "Not connected"}
          badges={
            <span className={`g-chip g-chip--sm !normal-case ${usable ? "!text-[var(--g-green)]" : data.needsReconnect ? "!text-[var(--g-red)]" : ""}`} data-testid="badge-youtube-status">
              {usable ? <><CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden="true" />Connected</> : data.needsReconnect ? "Needs reconnect" : "Not connected"}
            </span>
          }
          meta={data.connected ? [
            <span key="id" data-testid="text-youtube-channel-id">Channel ID {data.channelId}</span>,
            data.connectedAt ? <span key="at">Connected {format(new Date(data.connectedAt), "MMM d, yyyy h:mm a")}</span> : null,
            data.connectedBy ? <span key="by">by {data.connectedBy}</span> : null,
          ] : [<span key="expected">Expected channel: Construct HUB ({data.expectedChannelId})</span>]}
          line={data.needsReconnect
            ? "Google no longer accepts the saved sign-in. Uploads are paused until the channel is connected again."
            : data.connected ? undefined : "No sign-in is saved. Uploads cannot run until the channel is connected."}
        />
        {data.connected && (
          <GoogleListRow
            size="md"
            testId="row-youtube-scopes"
            title="Permissions Google granted"
            line={
              <ul className="mt-1 space-y-0.5" data-testid="list-youtube-scopes">
                {data.scopes.map((s) => <li key={s}>{SCOPE_LABELS[s] ?? s} <span className="text-xs text-muted-foreground">({shortScope(s)})</span></li>)}
                {missing.map((s) => <li key={s} className="text-muted-foreground">Not granted: {SCOPE_LABELS[s] ?? s} <span className="text-xs">({shortScope(s)})</span></li>)}
              </ul>
            }
          />
        )}
      </GoogleList>

      <div data-testid="section-youtube-before">
        <h3 className="text-base font-medium">Before you connect</h3>
        <ol className="mt-2 list-decimal space-y-3 pl-5 text-sm">
          <li>
            In Google Cloud, open <strong>APIs &amp; Services → Credentials</strong>, click the web OAuth client, and under <strong>Authorized redirect URIs</strong> add exactly:
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <code className={mono} data-testid="text-youtube-redirect-uri">{data.redirectUri}</code>
              <GooglePill size="sm" icon={Copy} label="Copy" onClick={() => void copy(data.redirectUri)} testId="button-youtube-copy-redirect" />
            </div>
          </li>
          <li>
            In <strong>Google Auth Platform → Data access</strong>, add these scopes:
            <ul className="mt-1.5 space-y-1" data-testid="list-youtube-requested-scopes">
              {data.requestedScopes.map((s) => (
                <li key={s}><code className={mono}>{shortScope(s)}</code> <span className="text-muted-foreground">— {SCOPE_LABELS[s] ?? "requested"}</span></li>
              ))}
            </ul>
          </li>
          <li>
            Click <strong>{connectLabel}</strong> and, when Google asks which account or channel, pick the <strong>Construct HUB</strong> channel.
            If a different channel is picked, nothing is connected and this page names the channel that was chosen.
          </li>
        </ol>
        <p className="mt-3 text-sm">
          <a className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" data-testid="link-youtube-cloud-console">
            Open Google Cloud credentials <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </p>
      </div>

      <Notice tone="info" title="Good to know" testId="notice-youtube-good-to-know">
        <ul className="list-disc space-y-1 pl-4">
          <li>Google keeps videos uploaded through its API locked as Private when the app that uploaded them has not passed YouTube's API compliance audit. Ours has not been audited yet.</li>
          <li>A video uploaded this way can be made public by hand in YouTube Studio only if Google allows it for that upload. We cannot promise it will.</li>
          <li>The number of uploads per day is limited by Google's daily quota for the app.</li>
          <li>Every upload from here starts as Private.</li>
        </ul>
      </Notice>
    </section>
  );
}

export default function AdminYoutubePage() {
  useDocumentTitle("YouTube channel | ConstructHUB");
  const { toast } = useToast();
  // Back from Google: say what happened once, then drop ?result= so a refresh does not repeat it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("result");
    if (!result) return;
    if (result === "connected") toast({ title: "YouTube channel connected" });
    else if (result === "failed") toast({ title: "The channel was not connected", description: "The reason is shown on this page.", variant: "destructive" });
    window.history.replaceState(null, "", window.location.pathname);
  }, [toast]);
  return (
    <AppPage testId="page-admin-youtube" width="narrow">
      <YoutubeChannelCard heading="h1" />
    </AppPage>
  );
}
