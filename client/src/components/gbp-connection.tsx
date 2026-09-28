import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
export function GbpConnection({locationId}:{locationId?:number}) {
  const {toast}=useToast();
  const {data,error}=useQuery<any>({queryKey:['/api/gbp/status'],refetchInterval:30000});
  const mutation=useMutation({mutationFn:async(path:string)=>{const r=await apiRequest('POST',path);return r.json();},onSuccess:(result)=>{
    queryClient.invalidateQueries({queryKey:['/api/gbp/status']});queryClient.invalidateQueries({queryKey:['/api/google-profile-reviews']});queryClient.invalidateQueries({queryKey:['/api/gbp/locations']});queryClient.invalidateQueries({queryKey:['/api/auth/me']});
    const errors=Object.values(result).filter((v:any)=>v?.kind).map((v:any)=>v.message);
    toast({title:errors.length?'Sync needs attention':result.message||'Sync complete',description:errors.join(' '),variant:errors.length?'destructive':undefined});
  },onError:(e:Error)=>toast({title:'Google Business Profile',description:e.message,variant:'destructive'})});
  const locations=(data?.locations||[]).filter((l:any)=>!locationId||l.id===locationId);
  const unique=[...new Map<number,any>(locations.map((l:any)=>[l.id,l])).values()];
  return <section className="rounded-lg border p-4 space-y-3" aria-label="Google Business Profile connection">
    <p>{error?'Unable to check Google connection':!data?'Checking Google connection…':data.connected?`Connected to Google Business Profile: ${data.email}`:data.reconnectRequired?'Reconnect Google Business Profile — access expired or was revoked.':'Google Business Profile not connected. Replies can be saved as drafts in ConstructHUB.'}</p>
    {typeof window!=='undefined' && new URLSearchParams(window.location.search).get('gbp')==='consent-failed' && <p role="alert">Google connection was not completed. Try again and allow Business Profile access.</p>}
    <div className="flex gap-2">
      <Button asChild variant="outline"><a href="/api/gbp/connect">{data?.connected?'Change Google account':data?.reconnectRequired?'Reconnect Google Business Profile':'Connect Google Business Profile'}</a></Button>
      {(data?.connected||data?.reconnectRequired) && <Button variant="outline" disabled={mutation.isPending} onClick={()=>mutation.mutate('/api/gbp/disconnect')}>Disconnect Google</Button>}
    </div>
    {unique.map(l=><div key={l.id} className="border-t pt-2 space-y-1">
      <div className="flex gap-3 items-center"><strong>{l.name}</strong><Button size="sm" disabled={!data?.connected||mutation.isPending} onClick={()=>mutation.mutate(`/api/gbp/locations/${l.id}/sync`)}>Sync now</Button></div>
      {locations.filter((s:any)=>s.id===l.id).map((s:any,i:number)=><p key={i} className="text-sm">{s.kind||'Reviews and performance'}: {s.last_success?`Last success ${new Date(s.last_success).toLocaleString()}`:'Never synced'}{s.last_error && <span role="alert" className="text-destructive"> — {s.last_error}</span>}</p>)}
    </div>)}
  </section>;
}
