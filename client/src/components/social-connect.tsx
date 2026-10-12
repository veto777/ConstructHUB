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
import { useToast } from "@/hooks/use-toast";
import { useUrlParam } from "@/hooks/use-url-param";

const LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", instagram_direct: "Instagram (no Facebook Page)", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", pinterest: "Pinterest", threads: "Threads", twitter: "X" };
const NOTE: Record<string, string> = {
  instagram: "Business or Creator account linked to your Facebook Page",
  instagram_direct: "Business or Creator account, signed in with Instagram",
  threads: "Your Threads profile",
  facebook: "Pick the Pages to post to",
  linkedin: "Your profile or company Pages",
  tiktok: "You choose who can view each post",
};

type Account = { id: string; platform: string; name: string };

/** `via`: "native" = ConstructHUB's own apps (server/social/native.ts); "outstand" = the Outstand account. */
export function SocialConnect({ businessId, networks, accounts, connected, via = "outstand" }: { businessId: number | null; networks: readonly string[]; accounts: Account[]; connected: boolean; via?: "outstand" | "native" }) {
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
            <p className="mb-2 text-sm font-medium">Which {LABEL[pending.data.network] ?? pending.data.network} pages should ConstructHUB post to?</p>
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
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {networks.map((n) => {
          const mine = byNetwork(n);
          return (
            <div key={n} className="flex items-center justify-between gap-2 rounded-lg border p-3" data-testid={`network-${n}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium">{LABEL[n] ?? n}</p>
                <p className="truncate text-xs text-muted-foreground">{mine.length ? mine.map((a) => a.name).join(", ") : NOTE[n] ?? "Not connected"}</p>
              </div>
              <GooglePill size="sm" variant={mine.length ? "outline" : "solid"} label={mine.length ? "Add another" : "Connect"} disabled={start.isPending} onClick={() => start.mutate(n)} />
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        You sign in on the network's own page; ConstructHUB never sees your password. You can remove access any time here or in that network's settings.
        Google Business Profile posts use your Google connection under Google Business.
      </p>
      {connected && accounts.length > 0 && (
        <div className="mt-2"><GooglePill size="sm" variant="quiet" label="Disconnect all" disabled={disconnect.isPending} onClick={() => disconnect.mutate()} /></div>
      )}
    </section>
  );
}
