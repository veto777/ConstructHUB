/**
 * Social Media → Connected accounts, when ConstructHUB publishes for the customer (server/social/outstand.ts): one
 * button per network sends the customer to that network's own sign-in; they come back here with `connected=<network>`
 * (the accounts are read again) or, for Facebook and LinkedIn, `session=…` and a list of their pages to tick. Nothing
 * to buy or paste. Owner, 2026-10-11: "so we can add their social media for them".
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import { GoogleSectionHeader, GooglePill } from "@/components/google";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useUrlParam } from "@/hooks/use-url-param";
import { NetworkIcon } from "@/components/social-week";

const LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", instagram_direct: "Instagram (no Facebook Page)", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", pinterest: "Pinterest", threads: "Threads", x: "X", twitter: "X", bluesky: "Bluesky", reddit: "Reddit", mastodon: "Mastodon", tumblr: "Tumblr" };
const NOTE: Record<string, string> = {
  instagram: "Business or Creator account linked to your Facebook Page",
  instagram_direct: "Business or Creator account, signed in with Instagram",
  threads: "Your Threads profile",
  x: "Your X profile · links move to a reply",
  facebook: "Pick the Pages to post to",
  linkedin: "Your profile or company Pages",
  tiktok: "You choose who can view each post",
  bluesky: "Your Bluesky profile · signs in with an app password",
  pinterest: "Your Pinterest business account · pick a board for each pin",
  reddit: "Your Reddit account · pick a subreddit and a title for each post",
  mastodon: "Your Mastodon profile, on any server",
  tumblr: "Your Tumblr blogs · pick a blog for each post",
};
const BLUESKY_APP_PASSWORDS = "https://bsky.app/settings/app-passwords";

type Account = { id: string; platform: string; name: string };

/**
 * Bluesky connect. OAuth ("Sign in with Bluesky"): just the handle → we send them to Bluesky to approve (POST
 * …/native/bluesky/connect → redirect). App-password fallback: handle + an app password (POST …/native/bluesky/login).
 */
function BlueskyForm({ api, scope, mode, onDone, onCancel }: { api: string; scope: string; mode: "oauth" | "app_password"; onDone: (name: string) => void; onCancel: () => void }) {
  const [handle, setHandle] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const oauth = mode === "oauth";
  const start = useMutation({
    mutationFn: async () => (await apiRequest("POST", oauth ? `${api}/bluesky/connect${scope}` : `${api}/bluesky/login${scope}`,
      oauth ? { handle: handle.trim() } : { handle: handle.trim(), appPassword: appPassword.trim() })).json() as Promise<{ authUrl?: string; accounts?: Account[]; name?: string }>,
    onSuccess: (d) => { if (oauth && d.authUrl) window.location.assign(d.authUrl); else onDone(d.name ?? "Bluesky"); },
  });
  const ready = handle.trim().length >= 3 && (oauth || /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(appPassword.trim()));
  return (
    <form className="mb-4 rounded-lg border p-4" data-testid="social-bluesky-form" onSubmit={(e) => { e.preventDefault(); if (ready && !start.isPending) start.mutate(); }}>
      <p className="mb-1 text-sm font-medium">Connect Bluesky</p>
      <p className="mb-3 text-xs text-muted-foreground">
        {oauth
          ? <>Enter your Bluesky handle and we’ll send you to Bluesky to approve ConstructHUB. Nothing to paste — you sign in on Bluesky’s own page.</>
          : <>Bluesky signs in with an <strong>app password</strong>, not your main password. Make one at{" "}
            <a className="underline" href={BLUESKY_APP_PASSWORDS} target="_blank" rel="noreferrer">bsky.app/settings/app-passwords</a> (any name, leave “Allow access to your direct messages” off), then paste it here. It is used once and not kept.</>}
      </p>
      <div className={`grid gap-2 ${oauth ? "" : "sm:grid-cols-2"}`}>
        <Input aria-label="Bluesky handle" placeholder="yourbusiness.bsky.social" autoComplete="off" value={handle} onChange={(e) => setHandle(e.target.value)} data-testid="input-bluesky-handle" />
        {!oauth && <Input aria-label="Bluesky app password" placeholder="abcd-efgh-ijkl-mnop" autoComplete="off" type="password" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} data-testid="input-bluesky-app-password" />}
      </div>
      {start.isError && <p className="mt-2 text-sm text-destructive">{apiErrorMessage(start.error)}</p>}
      <div className="mt-3 flex gap-2">
        <GooglePill label={start.isPending ? (oauth ? "Opening Bluesky…" : "Connecting…") : (oauth ? "Continue to Bluesky" : "Connect Bluesky")} disabled={!ready || start.isPending} onClick={() => start.mutate()} testId="button-bluesky-connect" />
        <GooglePill variant="quiet" label="Cancel" disabled={start.isPending} onClick={onCancel} />
      </div>
    </form>
  );
}

/** Mastodon connect: the customer names their server; we register there and send them to its sign-in (POST …/native/mastodon/connect → redirect). */
function MastodonForm({ api, scope, onCancel }: { api: string; scope: string; onCancel: () => void }) {
  const [server, setServer] = useState("");
  const start = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${api}/mastodon/connect${scope}`, { server: server.trim() })).json() as Promise<{ authUrl: string }>,
    onSuccess: (d) => window.location.assign(d.authUrl),
  });
  const ready = /\.[a-z]{2,}$/i.test(server.trim().replace(/\/.*$/, ""));
  return (
    <form className="mb-4 rounded-lg border p-4" data-testid="social-mastodon-form" onSubmit={(e) => { e.preventDefault(); if (ready && !start.isPending) start.mutate(); }}>
      <p className="mb-1 text-sm font-medium">Connect Mastodon</p>
      <p className="mb-3 text-xs text-muted-foreground">Enter the server your account is on (the part after the second @ in your handle) and we’ll send you there to approve ConstructHUB. You sign in on your server’s own page.</p>
      <Input aria-label="Mastodon server" placeholder="mastodon.social" autoComplete="off" value={server} onChange={(e) => setServer(e.target.value)} data-testid="input-mastodon-server" />
      {start.isError && <p className="mt-2 text-sm text-destructive">{apiErrorMessage(start.error)}</p>}
      <div className="mt-3 flex gap-2">
        <GooglePill label={start.isPending ? "Opening your server…" : "Continue to Mastodon"} disabled={!ready || start.isPending} onClick={() => start.mutate()} testId="button-mastodon-connect" />
        <GooglePill variant="quiet" label="Cancel" disabled={start.isPending} onClick={onCancel} />
      </div>
    </form>
  );
}

/** `via`: "native" = ConstructHUB's own apps (server/social/native.ts); "outstand" = the Outstand account. */
export function SocialConnect({ businessId, networks, accounts, connected, via = "outstand", blueskyAuth = "app_password" }: { businessId: number | null; networks: readonly string[]; accounts: Account[]; connected: boolean; via?: "outstand" | "native"; blueskyAuth?: "oauth" | "app_password" }) {
  const api = `/api/social/${via}`;
  const { toast } = useToast();
  const qc = useQueryClient();
  const scope = businessId ? `?businessId=${businessId}` : "";
  const [justConnected, setJustConnected] = useUrlParam("connected");
  const [connectError, setConnectError] = useUrlParam("connect_error");
  useEffect(() => {
    if (!connectError) return;
    const why: Record<string, string> = { expired: "That sign-in link expired. Start again.", cancelled: "The sign-in was cancelled.", failed: "The network didn't let us read your pages. Start again, and allow every permission it asks for." };
    toast({ title: "Not connected", description: why[connectError] ?? why.failed, variant: "destructive" });
    setConnectError(null);
  }, [connectError]); // eslint-disable-line react-hooks/exhaustive-deps
  const [session, setSession] = useUrlParam("session");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bluesky, setBluesky] = useState(false);
  const [mastodon, setMastodon] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["/api/social"] });

  const start = useMutation({
    mutationFn: async (network: string) => (await apiRequest("POST", `${api}/connect${scope}`, { network })).json() as Promise<{ authUrl: string }>,
    onSuccess: (d) => { window.location.assign(d.authUrl); },
    onError: (e) => toast({ title: "Couldn't start connecting", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const reread = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${api}/refresh${scope}`)).json() as Promise<{ accounts: Account[] }>,
    onSuccess: (d, _v) => { refresh(); if (justConnected) toast({ title: `${LABEL[justConnected] ?? justConnected} connected`, description: `${d.accounts.length} account${d.accounts.length === 1 ? "" : "s"} connected for this business.` }); setJustConnected(null); },
    onError: (e) => { setJustConnected(null); toast({ title: "Couldn't read your accounts", description: apiErrorMessage(e), variant: "destructive" }); },
  });
  // Back from a network's sign-in: read the accounts again once.
  useEffect(() => { if (justConnected && !session && !reread.isPending) reread.mutate(); }, [justConnected, session]); // eslint-disable-line react-hooks/exhaustive-deps

  // Facebook / LinkedIn: the pages that sign-in can connect. The token comes off the address as soon as it is read.
  const [token] = useState(() => session);
  useEffect(() => { if (session) setSession(null); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = useQuery<{ network: string; pages: { id: string; name: string; kind: string | null }[] }>({
    queryKey: [`${api}/pending`, token], enabled: !!token, retry: false,
    queryFn: async () => (await apiRequest("GET", `${api}/pending/${encodeURIComponent(token!)}${scope}`)).json(),
  });
  const finalize = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${api}/pending/${encodeURIComponent(token!)}/finalize${scope}`, { pageIds: [...picked] })).json() as Promise<{ accounts: Account[] }>,
    onSuccess: (d) => { refresh(); setJustConnected(null); toast({ title: "Pages connected", description: `${d.accounts.length} account${d.accounts.length === 1 ? "" : "s"} connected for this business.` }); window.location.reload(); },
    onError: (e) => toast({ title: "Couldn't connect those pages", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const disconnect = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/social/disconnect${scope}`)).json(),
    onSuccess: () => { refresh(); toast({ title: "Social accounts disconnected" }); },
    onError: (e) => toast({ title: "Couldn't disconnect", description: apiErrorMessage(e), variant: "destructive" }),
  });

  // Both Instagram buttons list the Instagram accounts connected either way.
  const byNetwork = (n: string) => accounts.filter((a) => a.platform === (n === "instagram_direct" ? "instagram" : n));
  return (
    <section data-testid="social-connect">
      <GoogleSectionHeader
        title="Connected accounts"
        description="Connect this business's social accounts once. ConstructHUB posts for you — there's nothing to buy or set up elsewhere."
        actions={<span className={accounts.length ? "g-open text-sm" : "g-text-2 text-sm"}>{accounts.length ? `${accounts.length} connected` : "Not connected"}</span>}
      />
      {token && (
        <div className="mb-4 rounded-lg border p-4" data-testid="social-pick-pages">
          {pending.isLoading && <p className="text-sm">Loading the pages you can connect…</p>}
          {pending.isError && <p className="text-sm text-destructive">{apiErrorMessage(pending.error)} Start again with the button below.</p>}
          {pending.data && (<>
            <p className="mb-2 flex items-center gap-2 text-sm font-medium"><NetworkIcon platform={pending.data.network} />Which {LABEL[pending.data.network] ?? pending.data.network} pages should ConstructHUB post to?</p>
            {pending.data.pages.length === 0 && <p className="text-sm text-muted-foreground">This sign-in has no pages you manage. Sign in with the account that runs the business page.</p>}
            <div className="space-y-1.5">
              {pending.data.pages.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={picked.has(p.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); e.target.checked ? n.add(p.id) : n.delete(p.id); return n; })} data-testid={`check-page-${p.id}`} />
                  {p.name}{p.kind ? <span className="text-muted-foreground"> · {p.kind}</span> : null}
                </label>
              ))}
            </div>
            <div className="mt-3">
              <GooglePill label={finalize.isPending ? "Connecting…" : `Connect ${picked.size || ""} page${picked.size === 1 ? "" : "s"}`} disabled={!picked.size || finalize.isPending} onClick={() => finalize.mutate()} />
            </div>
          </>)}
        </div>
      )}
      {bluesky && via === "native" && (
        <BlueskyForm api={api} scope={scope} mode={blueskyAuth}
          onDone={(name) => { setBluesky(false); refresh(); toast({ title: "Bluesky connected", description: `${name} is connected for this business.` }); }}
          onCancel={() => setBluesky(false)} />
      )}
      {mastodon && via === "native" && <MastodonForm api={api} scope={scope} onCancel={() => setMastodon(false)} />}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {networks.map((n) => {
          const mine = byNetwork(n);
          const form = (n === "bluesky" || n === "mastodon") && via === "native";
          return (
            <div key={n} className="flex items-center justify-between gap-2 rounded-lg border p-3" data-testid={`network-${n}`}>
              <div className="flex min-w-0 items-center gap-3">
                <NetworkIcon platform={n} className="h-7 w-7" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{LABEL[n] ?? n}</p>
                  <p className="truncate text-xs text-muted-foreground">{mine.length ? mine.map((a) => a.name).join(", ") : NOTE[n] ?? "Not connected"}</p>
                </div>
              </div>
              <GooglePill size="sm" variant={mine.length ? "outline" : "solid"} label={mine.length ? "Add another" : "Connect"} disabled={start.isPending} onClick={() => (form ? (n === "mastodon" ? setMastodon(true) : setBluesky(true)) : start.mutate(n))} />
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        You sign in on the network's own page; ConstructHUB never sees your password (Bluesky: an app password you can revoke any time). You can remove access any time here or in that network's settings.
        Google Business Profile posts use your Google connection under Google Business.
      </p>
      {connected && accounts.length > 0 && (
        <div className="mt-2"><GooglePill size="sm" variant="quiet" label="Disconnect all" disabled={disconnect.isPending} onClick={() => disconnect.mutate()} /></div>
      )}
    </section>
  );
}
