import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

type Linkage = {
  accounts: { subject: string; email: string; connected: boolean; reconnectRequired: boolean }[];
  errors: { grantEmail?: string; message: string }[];
  locations: { id: number; state: 'synced'|'reconnect'|'available'|'unlinked'; accountEmail?: string; lastSuccess?: string|null; lastError?: string|null;
    listing?: { accountResource: string; gbpName: string; grantSubject: string } }[];
};
const refreshAll = () => ['/api/gbp/status','/api/gbp/linkage','/api/locations','/api/google-profile-reviews','/api/gbp/locations','/api/auth/me']
  .forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));

export function useGbpLinkage() {
  return useQuery<Linkage>({ queryKey: ['/api/gbp/linkage'], staleTime: 60_000 });
}

/** Link a location to the Google listing a connected account manages, then run its first sync. */
function useLinkLocations() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (listings: NonNullable<Linkage['locations'][number]['listing']>[]) => {
      const r = await apiRequest('POST', '/api/gbp/import', { locations: listings });
      const imported = await r.json();
      for (const l of imported.locations ?? []) await apiRequest('POST', `/api/gbp/locations/${l.id}/sync`).catch(() => null);
      return imported;
    },
    onSuccess: (r) => { refreshAll(); toast({ title: `Linked ${r.imported} location${r.imported === 1 ? '' : 's'}`, description: 'Reviews and performance are syncing from Google.' }); },
    onError: (e: Error) => toast({ title: 'Could not link location', description: e.message, variant: 'destructive' }),
  });
}

/** "Google account" column: which account a location syncs through, or what it still needs. */
export function GbpLinkCell({ locationId }: { locationId: number }) {
  const { data, isLoading } = useGbpLinkage();
  const link = useLinkLocations();
  const row = data?.locations.find(l => l.id === locationId);
  if (isLoading) return <span className="text-xs text-muted-foreground">Checking…</span>;
  if (!row) return <span className="text-xs text-muted-foreground">—</span>;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (row.state === 'synced') return <div className="space-y-0.5" data-testid={`gbp-link-${locationId}`}>
    <Badge className="text-[10px] bg-green-600 hover:bg-green-600">Synced</Badge>
    <p className="text-xs text-muted-foreground truncate max-w-[220px]">via {row.accountEmail}</p>
    <p className={`text-[11px] ${row.lastError ? 'text-destructive' : 'text-muted-foreground'}`}>{row.lastError ? row.lastError : row.lastSuccess ? `Last sync ${new Date(row.lastSuccess).toLocaleString()}` : 'First sync pending'}</p>
  </div>;
  if (row.state === 'reconnect') return <div className="space-y-1" data-testid={`gbp-link-${locationId}`}>
    <Badge variant="destructive" className="text-[10px]">Reconnect</Badge>
    <p className="text-xs text-muted-foreground truncate max-w-[220px]">{row.accountEmail ? `${row.accountEmail} access expired` : 'Its Google account was disconnected'}</p>
    <a href="/api/gbp/connect" onClick={stop} className="text-xs text-primary underline">Reconnect Google account</a>
  </div>;
  if (row.state === 'available') return <div className="space-y-1" data-testid={`gbp-link-${locationId}`}>
    <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600">Ready to link</Badge>
    <p className="text-xs text-muted-foreground truncate max-w-[220px]">Managed by {row.accountEmail}</p>
    <Button size="sm" className="h-7 text-xs" disabled={link.isPending} onClick={(e) => { stop(e); link.mutate([row.listing!]); }} data-testid={`button-link-gbp-${locationId}`}>Link &amp; sync</Button>
  </div>;
  return <div className="space-y-1" data-testid={`gbp-link-${locationId}`}>
    <Badge variant="outline" className="text-[10px]">Not linked</Badge>
    <p className="text-xs text-muted-foreground max-w-[220px]">Not managed by a connected Google account.</p>
    <a href="/api/gbp/connect" onClick={stop} className="text-xs text-primary underline">Connect the Google account that manages it</a>
  </div>;
}

export function GbpConnection({locationId}:{locationId?:number}) {
  const {toast}=useToast();
  const {data,error}=useQuery<any>({queryKey:['/api/gbp/status'],refetchInterval:30000});
  const {data:linkage}=useGbpLinkage();
  const link = useLinkLocations();
  const mutation=useMutation({mutationFn:async({path,body}:{path:string;body?:unknown})=>{const r=await apiRequest('POST',path,body);return r.json();},onSuccess:(result)=>{
    refreshAll();
    const errors=Object.values(result).filter((v:any)=>v?.kind).map((v:any)=>v.message);
    toast({title:errors.length?'Sync needs attention':result.message||'Sync complete',description:errors.join(' '),variant:errors.length?'destructive':undefined});
  },onError:(e:Error)=>toast({title:'Google Business Profile',description:e.message,variant:'destructive'})});
  const accounts: Linkage['accounts'] = data?.accounts ?? (data?.email ? [{subject:'',email:data.email,connected:!!data.connected,reconnectRequired:!!data.reconnectRequired}] : []);
  const rows = linkage?.locations ?? [];
  const count = (s: string) => rows.filter(r => r.state === s).length;
  const available = rows.filter(r => r.state === 'available' && r.listing).map(r => r.listing!);
  const locations=(data?.locations||[]).filter((l:any)=>!locationId||l.id===locationId);
  const unique=[...new Map<number,any>(locations.map((l:any)=>[l.id,l])).values()];
  const failedParam = typeof window!=='undefined' && new URLSearchParams(window.location.search).get('gbp')==='consent-failed';
  return <section className="rounded-lg border p-4 space-y-3" aria-label="Google Business Profile connection">
    {error ? <p>Unable to check Google connection</p> : !data ? <p>Checking Google connection…</p> : accounts.length === 0
      ? <p>Google Business Profile not connected. Replies can be saved as drafts in ConstructHUB.</p>
      : <div className="space-y-2">
          <p className="font-medium">Connected Google accounts</p>
          {accounts.map(a => <div key={a.subject || a.email} className="flex flex-wrap items-center gap-2 text-sm" data-testid="gbp-account">
            <Badge variant={a.connected ? 'default' : 'destructive'} className="text-[10px]">{a.connected ? 'Connected' : 'Reconnect needed'}</Badge>
            <span>{a.email}</span>
            {!a.connected && <a href="/api/gbp/connect" className="text-primary underline">Reconnect</a>}
            {a.subject && <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={mutation.isPending} onClick={()=>mutation.mutate({path:'/api/gbp/disconnect',body:{subject:a.subject}})}>Disconnect</Button>}
          </div>)}
        </div>}
    {failedParam && !data?.connected && <p role="alert">Google connection was not completed. Try again and allow Business Profile access.</p>}
    {!locationId && rows.length > 0 && accounts.length > 0 && <p className="text-sm text-muted-foreground" data-testid="gbp-link-summary">
      {count('synced')} synced · {count('available')} ready to link · {count('unlinked')} not in a connected account{count('reconnect') ? ` · ${count('reconnect')} need reconnect` : ''}
      {count('unlinked') > 0 && ' — if another Google login manages those listings, connect it too.'}
    </p>}
    {(linkage?.errors ?? []).map((e, i) => <p key={i} role="alert" className="text-sm text-destructive">{e.grantEmail ? `${e.grantEmail}: ` : ''}{e.message}</p>)}
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline"><a href="/api/gbp/connect">{accounts.length ? 'Connect another Google account' : 'Connect Google Business Profile'}</a></Button>
      {!locationId && available.length > 0 && <Button disabled={link.isPending} onClick={()=>link.mutate(available)} data-testid="button-link-all-gbp">Link &amp; sync {available.length} ready location{available.length === 1 ? '' : 's'}</Button>}
    </div>
    {unique.map(l=><div key={l.id} className="border-t pt-2 space-y-1">
      <div className="flex gap-3 items-center"><strong>{l.name}</strong>{l.account_email && <span className="text-xs text-muted-foreground">via {l.account_email}</span>}<Button size="sm" disabled={!data?.connected||mutation.isPending} onClick={()=>mutation.mutate({path:`/api/gbp/locations/${l.id}/sync`})}>Sync now</Button></div>
      {locations.filter((s:any)=>s.id===l.id).map((s:any,i:number)=><p key={i} className="text-sm">{s.kind||'Reviews and performance'}: {s.last_success?`Last success ${new Date(s.last_success).toLocaleString()}`:'Never synced'}{s.last_error && <span role="alert" className="text-destructive"> — {s.last_error}</span>}</p>)}
    </div>)}
  </section>;
}
