import { Section, StatusPill } from '@/components/app-ui';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, apiErrorMessage, queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { BrandIcon } from '@/components/brand-icon';
import { GOOGLE_CONNECTION_LABEL, connectionAction, lastSyncText, type GoogleConnection, type GoogleConnectionState } from '@shared/gbp-connection';

type Linkage = {
  accounts: { subject: string; email: string; connected: boolean; reconnectRequired: boolean }[];
  errors: { grantEmail?: string; message: string }[];
  locations: { id: number; state: 'synced'|'reconnect'|'available'|'unlinked'; unlinkedByUser?: boolean; accountEmail?: string; lastSuccess?: string|null; lastError?: string|null;
    listing?: { accountResource: string; gbpName: string; grantSubject: string } }[];
};
const refreshAll = () => ['/api/agency/locations','/api/agency/dashboard','/api/gbp/status','/api/gbp/connection','/api/gbp/linkage','/api/locations','/api/google-profile-reviews','/api/gbp/locations','/api/auth/me']
  .forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));

/** The one Google-connection truth (shared/gbp-connection.ts, GET /api/gbp/connection): every page reads this. */
export function useGoogleConnection(locationId?: number, enabled = true) {
  return useQuery<GoogleConnection>({
    enabled,
    queryKey: ['/api/gbp/connection', locationId ?? 'all'],
    queryFn: () => apiRequest('GET', '/api/gbp/connection' + (locationId ? `?locationId=${locationId}` : '')).then(r => r.json()),
    staleTime: 30_000,
  });
}

const PILL_TONE: Record<GoogleConnectionState, 'success' | 'warning' | 'neutral'> = { connected: 'success', needs_reconnect: 'warning', not_connected: 'neutral' };
/** "Connected" / "Needs reconnect" / "Not connected" — the same pill on every page. */
export function GoogleConnectionPill({ state, testId }: { state: GoogleConnectionState; testId?: string }) {
  return <StatusPill tone={PILL_TONE[state]} data-testid={testId}>{GOOGLE_CONNECTION_LABEL[state]}</StatusPill>;
}

/** One honest line: the state, the last sync, why, and the one next step. */
export function GoogleConnectionLine({ connection, className = '' }: { connection: GoogleConnection; className?: string }) {
  const action = connectionAction(connection);
  return <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-sm ${className}`} data-testid="google-connection-line" data-state={connection.state}>
    <GoogleConnectionPill state={connection.state} />
    <span className="text-muted-foreground" data-testid="google-connection-last-sync">{lastSyncText(connection.lastSync)}</span>
    {connection.state !== 'connected' && <span className="text-muted-foreground">{connection.detail}</span>}
    {action && <a href={action.href} className="text-primary underline" data-testid="google-connection-action">{action.label}</a>}
  </div>;
}

export function useGbpLinkage() {
  return useQuery<Linkage>({ queryKey: ['/api/gbp/linkage'], staleTime: 60_000 });
}

/** Link a location to the Google listing a connected account manages, then run its first sync. */
function useLinkLocations() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (listings: NonNullable<Linkage['locations'][number]['listing']>[]) => {
      const r = await apiRequest('POST', '/api/gbp/import', { locations: listings });
      return r.json();
    },
    onSuccess: (r) => {
      refreshAll();
      const issues: string[] = [];
      for (const result of Object.values(r.synced || {}) as any[]) {
        if (result?.message) issues.push(result.message);
        for (const part of Object.values(result || {}) as any[]) {
          if (part?.message) issues.push(part.message);
          if (Array.isArray(part?.warnings)) issues.push(...part.warnings);
        }
      }
      toast({ title: `Linked ${r.imported} location${r.imported === 1 ? '' : 's'}`,
        description: issues.length ? `Some Google data could not sync: ${[...new Set(issues)].join('; ')}`
          : 'First sync is queued. Check Agency jobs for progress.',
        variant: issues.length ? 'destructive' : 'default' });
    },
    onError: (e: Error) => toast({ title: 'Could not link location', description: apiErrorMessage(e), variant: 'destructive' }),
  });
}

function useUnlinkLocation() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: number) => (await apiRequest('POST', `/api/gbp/locations/${id}/unlink`)).json(),
    onSuccess: () => { refreshAll(); toast({ title: 'Location unlinked', description: 'It no longer syncs from Google. Its synced Google reviews and stats were removed.' }); },
    onError: (e: Error) => toast({ title: 'Could not unlink location', description: apiErrorMessage(e), variant: 'destructive' }),
  });
}

/** "Google account" column: which account a location syncs through, or what it still needs. */
export function GbpLinkCell({ locationId }: { locationId: number }) {
  const { data, isLoading } = useGbpLinkage();
  const link = useLinkLocations();
  const unlink = useUnlinkLocation();
  const unlinkButton = <Button size="sm" variant="outline" className="min-h-10 text-xs" disabled={unlink.isPending} data-testid={`button-unlink-gbp-${locationId}`}
    onClick={(e) => { e.stopPropagation(); if (window.confirm('Stop syncing this location from Google? Its synced Google reviews and performance stats will be removed from ConstructHUB. The location itself stays, and you can link it again anytime.')) unlink.mutate(locationId); }}>Unlink</Button>;
  const row = data?.locations.find(l => l.id === locationId);
  if (isLoading) return <span className="text-xs text-muted-foreground">Checking…</span>;
  if (!row) return <span className="text-xs text-muted-foreground">—</span>;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (row.state === 'synced') return <div className="space-y-0.5" data-testid={`gbp-link-${locationId}`}>
    <GoogleConnectionPill state="connected" />
    <p className="text-xs text-muted-foreground truncate max-w-[220px]">via {row.accountEmail}</p>
    <p className={`text-[11px] ${row.lastError ? 'text-destructive' : 'text-muted-foreground'}`}>{row.lastError ? row.lastError : lastSyncText(row.lastSuccess)}</p>
    {unlinkButton}
  </div>;
  if (row.state === 'reconnect') return <div className="space-y-1" data-testid={`gbp-link-${locationId}`}>
    <GoogleConnectionPill state="needs_reconnect" />
    <p className="text-xs text-muted-foreground truncate max-w-[220px]">{row.accountEmail ? `${row.accountEmail} access expired` : 'Its Google account was disconnected'}</p>
    <div className="flex gap-2 items-center"><a href="/api/gbp/connect" onClick={stop} className="text-xs text-primary underline">Reconnect Google account</a>{unlinkButton}</div>
  </div>;
  if (row.state === 'available') return <div className="space-y-1" data-testid={`gbp-link-${locationId}`}>
    <GoogleConnectionPill state="not_connected" />
    <p className="text-xs text-muted-foreground">{row.unlinkedByUser ? 'Unlinked by you' : 'Ready to link'}</p>
    <p className="text-xs text-muted-foreground truncate max-w-[220px]">Managed by {row.accountEmail}</p>
    <Button size="sm" variant="outline" className="min-h-10 text-xs" disabled={link.isPending} onClick={(e) => { stop(e); link.mutate([row.listing!]); }} data-testid={`button-link-gbp-${locationId}`}>Link &amp; sync</Button>
  </div>;
  // No Google account connected at all: the one next step is the connect button, right here on the row
  // (owner 2026-10-14: "fix this i cant sync it" — the only way in was a card further down the page).
  const noAccount = (data?.accounts ?? []).length === 0;
  return <div className="space-y-1" data-testid={`gbp-link-${locationId}`}>
    <GoogleConnectionPill state="not_connected" />
    <p className="text-xs text-muted-foreground max-w-[220px]">{noAccount ? 'Connect the Google account that owns this listing, then link it.' : 'Not managed by a connected Google account.'}</p>
    <Button asChild size="sm" variant={noAccount ? 'default' : 'outline'} className="min-h-10 text-xs" data-testid={`button-connect-gbp-${locationId}`}>
      <a href="/api/gbp/connect" onClick={stop}><BrandIcon brand="google" className="h-3.5 w-3.5" />{noAccount ? 'Connect Google Business Profile' : 'Connect its Google account'}</a>
    </Button>
  </div>;
}

/** What the page can still do while Google isn't connected; defaults to the reviews wording. */
const NOT_CONNECTED_COPY = {
  reviews: 'Google Business Profile not connected. Replies can be saved as drafts in ConstructHUB.',
  content: 'Google Business Profile not connected. Connect it and link a location to publish posts and photos.',
  locations: 'Google Business Profile not connected. Connect it to link your locations and sync their reviews and performance.',
} as const;

export function GbpConnection({locationId,context='reviews'}:{locationId?:number;context?:keyof typeof NOT_CONNECTED_COPY}) {
  const {toast}=useToast();
  const {data,error}=useQuery<any>({queryKey:['/api/gbp/status',locationId??'all'],queryFn:()=>apiRequest('GET','/api/gbp/status'+(locationId?'?locationId='+locationId:'')).then(r=>r.json()),refetchInterval:30000});
  const {data:linkage}=useGbpLinkage();
  const link = useLinkLocations();
  const mutation=useMutation({mutationFn:async({path,body}:{path:string;body?:unknown})=>{const r=await apiRequest('POST',path,body);return r.json();},onSuccess:(result)=>{
    refreshAll();
    const errors=Object.values(result).filter((v:any)=>v?.kind).map((v:any)=>v.message);
    toast({title:errors.length?'Sync needs attention':result.message||'Sync complete',description:errors.join(' '),variant:errors.length?'destructive':undefined});
  },onError:(e:Error)=>toast({title:'Google Business Profile',description:apiErrorMessage(e),variant:'destructive'})});
  const accounts: Linkage['accounts'] = data?.accounts ?? (data?.email ? [{subject:'',email:data.email,connected:!!data.connected,reconnectRequired:!!data.reconnectRequired}] : []);
  const rows = linkage?.locations ?? [];
  const count = (s: string) => rows.filter(r => r.state === s).length;
  const available = rows.filter(r => r.state === 'available' && r.listing && !r.unlinkedByUser).map(r => r.listing!);
  const locations=(data?.locations||[]).filter((l:any)=>!locationId||l.id===locationId);
  const unique=[...new Map<number,any>(locations.map((l:any)=>[l.id,l])).values()];
  const failedParam = typeof window!=='undefined' && new URLSearchParams(window.location.search).get('gbp')==='consent-failed';
  // The shared truth (shared/gbp-connection.ts) when the server sent it; per-location sync times come from it too.
  const connection: GoogleConnection | undefined = data?.connection;
  const truth = new Map((connection?.locations ?? []).map(l => [l.id, l]));
  return <Section title="Google connection" contentClassName="space-y-3 text-sm break-words">
    {connection && <GoogleConnectionLine connection={connection} />}
    {error ? <p>Unable to check Google connection</p> : !data ? <p>Checking Google connection…</p> : accounts.length === 0
      ? (connection?.state === 'needs_reconnect' ? null : <p>{NOT_CONNECTED_COPY[context]}</p>)
      : <div className="space-y-2">
          <p className="font-medium">Connected Google accounts</p>
          {accounts.map(a => <div key={a.subject || a.email} className="flex flex-wrap items-center gap-2 text-sm" data-testid="gbp-account">
            <GoogleConnectionPill state={a.connected?'connected':'needs_reconnect'} />
            <span>{a.email}</span>
            {!a.connected && <a href="/api/gbp/connect" className="text-primary underline">Reconnect</a>}
            {/* Go to the account: its profiles here (to import or open), or its Business Profile on Google. */}
            {a.connected && <Button asChild size="sm" variant="outline" className="min-h-10 text-xs" data-testid="button-view-google-profiles">
              <a href="/locations?import=gbp">View profiles</a>
            </Button>}
            {a.connected && <Button asChild size="sm" variant="outline" className="min-h-10 text-xs" data-testid="button-open-google-business">
              <a href={`https://business.google.com/locations?authuser=${encodeURIComponent(a.email)}`} target="_blank" rel="noopener noreferrer">Open in Google ↗</a>
            </Button>}
            {a.subject && <Button size="sm" variant="outline" className="min-h-10 text-xs border-destructive/50 text-destructive hover:bg-destructive/10" disabled={mutation.isPending} data-testid="button-disconnect-google-account"
              onClick={()=>{ if (window.confirm(`Disconnect ${a.email}? ConstructHUB's access to this Google account is revoked, its locations stop syncing, and the Google reviews and stats synced through it are removed. Your locations stay.`)) mutation.mutate({path:'/api/gbp/disconnect',body:{subject:a.subject}}); }}>Disconnect</Button>}
          </div>)}
        </div>}
    {failedParam && !data?.connected && <p role="alert">Google connection was not completed. Try again and allow Business Profile access.</p>}
    {!locationId && rows.length > 0 && accounts.length > 0 && <p className="text-sm text-muted-foreground" data-testid="gbp-link-summary">
      {count('synced')} connected · {count('available')} ready to link · {count('unlinked')} not in a connected account{count('reconnect') ? ` · ${count('reconnect')} needs reconnect` : ''}
      {count('unlinked') > 0 && ' — if another Google login manages those listings, connect it too.'}
    </p>}
    {(linkage?.errors ?? []).map((e, i) => <p key={i} role="alert" className="text-sm text-destructive">{e.grantEmail ? `${e.grantEmail}: ` : ''}{e.message}</p>)}
    <div className="flex flex-wrap gap-2">
      {/* With nothing connected, the line above already carries the one action (connect / reconnect). */}
      {(accounts.length > 0 || !connection) && <Button asChild variant="outline"><a href="/api/gbp/connect">{accounts.length ? 'Connect another Google account' : 'Connect Google Business Profile'}</a></Button>}
      {!locationId && available.length > 0 && <Button variant="outline" disabled={link.isPending} onClick={()=>link.mutate(available)} data-testid="button-link-all-gbp">Link &amp; sync {available.length} ready location{available.length === 1 ? '' : 's'}</Button>}
    </div>
    {unique.length>0&&<details open={context==='reviews'}><summary className="cursor-pointer min-h-10 py-2">Sync details</summary><div className="space-y-3">{unique.map(l=><div key={l.id} className="border-t pt-2 space-y-1">
      <div className="flex flex-wrap gap-3 items-center"><strong>{l.name}</strong>{l.account_email && <span className="text-xs text-muted-foreground">via {l.account_email}</span>}<Button size="sm" variant="outline" disabled={!data?.connected||mutation.isPending} onClick={()=>mutation.mutate({path:`/api/gbp/locations/${l.id}/sync`})}>Sync now</Button></div>
      {locations.filter((s:any)=>s.id===l.id).map((s:any,i:number)=><p key={i} className="text-sm">{s.kind||'Reviews and performance'}: {s.last_success?`Last success ${new Date(s.last_success).toLocaleString()}`:truth.get(l.id)?.lastSync?lastSyncText(truth.get(l.id)!.lastSync):'Never synced'}{s.last_error && <span role="alert" className="text-destructive"> — {s.last_error}</span>}</p>)}
    </div>)}</div></details>}
  </Section>;
}
