import { Section } from '@/components/app-ui';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, apiErrorMessage, queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { GbpLinkCell, useGbpLinkage } from '@/components/gbp-connection';
/** Google failures arrive as {message,kind,needsAuth}; turn the ones a contractor can act on into plain next steps. */
export function guardErrorMessage(e: unknown): string {
  let body: any = null;
  try { body = JSON.parse(String((e as any)?.message ?? '').replace(/^\d{3}:\s*/, '')); } catch { /* not a JSON error body */ }
  if (body?.needsAuth || body?.kind === 'auth') return 'Google access for this location has expired. Reconnect Google Business Profile, then try again.';
  if (body?.kind === 'invalid' && /^Invalid (accounts|locations) resource$/.test(body?.message ?? '')) return "This location's link to Google is not valid. Link it to Google again from the Locations page, then try again.";
  return apiErrorMessage(e);
}
export const fieldLabels:Record<string,string>={title:'Business name',phoneNumbers:'Phone numbers',websiteUri:'Website',storefrontAddress:'Address',categories:'Categories','profile.description':'Description',regularHours:'Regular hours',specialHours:'Special hours',serviceArea:'Service area','openInfo.openingDate':'Opening date','openInfo.status':'Open status'};
const pretty=(v:any)=>v===null||v===undefined?'Not set':typeof v==='string'?v:JSON.stringify(v,null,2);
export function GuardStatus({id}:{id:number}) {
  const {data,error}=useQuery<any[]>({queryKey:['/api/gbp/guard/status']});
  const g=data?.find(g=>g.id===id);
  return <span className="text-xs">{error?'Guard unavailable':!g?'Checking guard…':`Guard: ${g.mode}${g.pending?` · ${g.pending} pending`:''}${g.last_error?' · needs attention':''}`}</span>;
}
export function GoogleReport({type,id}:{type:'changes'|'reviews';id:number}) {
  const [open,setOpen]=useState(false),[explanation,setExplanation]=useState('');
  const {toast}=useToast(),url=`/api/gbp/reports/${type}/${id}`;
  const {data,error,refetch}=useQuery<any>({queryKey:[url],enabled:open});
  const mark=useMutation({mutationFn:()=>apiRequest('POST',url,{submitted:true}),onSuccess:()=>{void refetch();toast({title:'Marked reported locally'});},onError:(e:Error)=>toast({title:'Could not mark reported',description:guardErrorMessage(e),variant:'destructive'})});
  return <><Button size="sm" variant="outline" onClick={()=>setOpen(true)}>Report{type==='reviews'?' review':''}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Prepare report for Google</DialogTitle><DialogDescription>Google receives this report only when you submit Google's form. Marking it reported here only updates ConstructHUB.</DialogDescription></DialogHeader>
      {error?<p role="alert">Could not load report.</p>:!data?<p>Loading evidence…</p>:<>
        <p className="text-sm">{type==='changes'?"Google's redressal form is for misleading or fraudulent business information. For ordinary corrections, use your Business Profile. Paste the listing link into Google's form.":'Select this business and review in the Reviews Management Tool. A negative rating alone is not a policy violation.'}</p>
        {data.listingUrl?<a className="underline" href={data.listingUrl} target="_blank" rel="noreferrer">Open listing on Google Maps</a>:<p>Listing link unavailable. Find the listing on Google Maps before submitting.</p>}
        <label>Evidence from ConstructHUB<Textarea aria-label="Report evidence" readOnly rows={9} value={data.text}/></label>
        <label>Your explanation and evidence<Textarea value={explanation} onChange={e=>setExplanation(e.target.value)} placeholder="Describe the issue and include supporting evidence; do not invent facts."/></label>
        <Button onClick={()=>navigator.clipboard.writeText(data.text+explanation).then(()=>toast({title:'Report copied'}),()=>toast({title:'Select the evidence text and copy manually'}))}>Copy report</Button>
        <Button asChild variant="outline"><a href={data.formUrl} target="_blank" rel="noreferrer">Open Google's official form</a></Button>
        <Button disabled={mark.isPending||!!data.reportedAt} onClick={()=>mark.mutate()}>{data.reportedAt?'Reported locally':'I submitted the form — mark reported'}</Button>
      </>}
    </DialogContent></Dialog></>;
}
/** Not linked yet: say what Guard does and offer the one next step — Link & sync when a connected account manages the listing, otherwise connect Google. */
function GuardUnlinked({locationId}:{locationId:number}) {
  const {data}=useGbpLinkage();
  const ready=data?.locations.find(l=>l.id===locationId)?.state==='available';
  return <Card data-testid="card-guard-unlinked"><CardHeader className="pb-3"><CardTitle className="text-base">Profile Guard</CardTitle>
    <CardDescription>Link this profile to check for changes every 15 minutes.</CardDescription></CardHeader>
    <CardContent className="space-y-3 text-sm">{ready
      ?<><p>This listing is on a Google account you've connected. Link it to turn on Profile Guard.</p><GbpLinkCell locationId={locationId}/></>
      :<><p>It works once this location is linked to its Google Business Profile listing. Connect the Google account that manages the listing; if the listing is found there, you can link it here.</p>
        <Button asChild variant="outline" size="sm"><a href="/api/gbp/connect" data-testid="link-guard-connect-gbp">Connect Google Business Profile</a></Button></>}
    </CardContent></Card>;
}
export function ProfileGuard({locationId,linked}:{locationId:number;linked:boolean}) {
  const url=`/api/gbp/locations/${locationId}/guard`,{toast}=useToast();
  const {data,error}=useQuery<any>({queryKey:[url],enabled:linked,refetchInterval:30000});
  const [mode,setMode]=useState<string|null>(null),[watched,setWatched]=useState<string[]|null>(null),[preview,setPreview]=useState<any>(null);
  const mutation=useMutation({mutationFn:async({method,path,body}:{method:string;path:string;body?:any})=>(await apiRequest(method,path,body)).json(),onSuccess:()=>{void queryClient.invalidateQueries({queryKey:[url]});void queryClient.invalidateQueries({queryKey:['/api/gbp/guard/status']});},onError:(e:Error)=>toast({title:'Profile Guard',description:guardErrorMessage(e),variant:'destructive'})});
  if(!linked)return <GuardUnlinked locationId={locationId}/>;
  if(error)return <p role="alert">Unable to load Profile Guard.</p>;
  if(!data)return <p>Loading Profile Guard…</p>;
  const selected:string[]=watched??(data.snapshot?data.watched:Object.keys(fieldLabels));
  const act=(method:string,path:string,body?:any)=>mutation.mutateAsync({method,path,body});
  return <Section title="Profile Guard" contentClassName="space-y-4 text-sm">
    <details><summary className="cursor-pointer py-2">How checks work</summary><p className="text-sm">Checks every 15 minutes. Lockdown reasserts approved values after detection; it cannot block Google edits. Google may delay publication. Public suggestions cannot be distinguished reliably from other Google updates.</p></details>
    <p>Current mode: {data.mode}. {data.checkedAt?`Last checked ${new Date(data.checkedAt).toLocaleString()}`:'Not checked yet'}</p>
    {data.lastError&&<p role="alert">{data.lastError}</p>}
    <label className="block">Mode <select aria-label="Guard mode" className="border rounded p-2 bg-background" value={mode??data.mode} onChange={e=>setMode(e.target.value)}><option value="off">Off</option><option value="notify">Notify</option><option value="lockdown">Lockdown (auto-reject)</option></select></label>
    <details><summary className="cursor-pointer py-2">Watched fields</summary><fieldset className="grid grid-cols-2 gap-2"><legend>Watched fields</legend>{Object.entries(fieldLabels).map(([f,label])=><label key={f} className="text-sm flex gap-2"><input type="checkbox" checked={selected.includes(f)} onChange={e=>setWatched(e.target.checked?[...selected,f]:selected.filter(x=>x!==f))}/>{label}</label>)}</fieldset></details>
    {!data.snapshot&&<Button variant="outline" disabled={mutation.isPending} onClick={()=>act('POST',url+'/preview').then(setPreview).catch(()=>{})}>Preview current Google values</Button>}
    {(data.snapshot||preview)&&<details open={!data.snapshot}><summary>{data.snapshot?'Owner-approved snapshot':'Review these values before approving your snapshot'}</summary><dl>{Object.entries(data.snapshot??preview.snapshot).map(([f,v])=><div key={f} className="border-b py-2"><dt className="font-medium">{fieldLabels[f]}</dt><dd className="whitespace-pre-wrap break-all text-sm">{pretty(v)}</dd></div>)}</dl></details>}
    <p className="text-xs text-muted-foreground">Saving Guard settings asks you to confirm it’s you (password, authenticator or an emailed code): once, then not again for 12 hours. This stops anyone using a signed-in session from quietly turning Guard off.</p>
    <Button disabled={mutation.isPending} onClick={()=>act('PUT',url,{mode:mode??data.mode,watched:selected,...(!data.snapshot&&preview?{token:preview.token}:{})}).then(()=>{setPreview(null);toast({title:'Profile Guard settings saved'});}).catch(()=>{})}>{!data.snapshot&&preview?'Approve snapshot and save settings':'Save guard settings'}</Button>
    <Button className="ml-2" variant="outline" disabled={mutation.isPending||data.mode==='off'} onClick={()=>act('POST',url+'/check').catch(()=>{})}>Check now</Button>
    <h3 className="font-semibold">Pending changes and history</h3>
    {!data.changes.length&&<p>No detected changes.</p>}
    {data.changes.map((c:any)=><article className="border rounded p-3 space-y-2" key={c.id}>
      <p className="font-medium">{fieldLabels[c.field]??c.field} — {c.status}</p><p className="text-xs">{new Date(c.detected_at).toLocaleString()} · {c.source}</p>
      <div className="grid grid-cols-2 gap-3 text-sm"><div>Approved<pre className="whitespace-pre-wrap break-all">{pretty(c.old_value)}</pre></div><div>Detected<pre className="whitespace-pre-wrap break-all">{pretty(c.new_value)}</pre></div></div>
      {c.error&&<p role="alert">{c.error}</p>}<div className="flex flex-wrap gap-2">{c.status==='pending'&&<><Button variant="outline" disabled={mutation.isPending} onClick={()=>act('POST',url+`/changes/${c.id}`,{action:'approve'}).catch(()=>{})}>Approve</Button><Button disabled={mutation.isPending} variant="outline" onClick={()=>act('POST',url+`/changes/${c.id}`,{action:'reject'}).catch(()=>{})}>Reject</Button></>}<GoogleReport type="changes" id={c.id}/>{c.reported_at&&<span>Reported locally</span>}</div>
    </article>)}
  </Section>;
}
