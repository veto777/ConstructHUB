import { Section, StatGrid, Stat, Toolbar, StatusPill, appTable, appTableCards } from '@/components/app-ui';
import { useState } from 'react';
import { STARTING_MONTHLY_CENTS, formatUsd } from '@shared/plan-copy';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, apiErrorMessage, queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useUrlParam } from '@/hooks/use-url-param';
import { Link } from 'wouter';
import { MODULE_NAMES, PLANS, planForModule } from '@shared/plans';
export function useAgencyFilter() {
  const [client,setClient]=useUrlParam('clientId'),[q,setQ]=useUrlParam('q'),[status,setStatus]=useUrlParam('status'),[offset,setOffset]=useUrlParam('offset');
  const params=new URLSearchParams({q:q||'',status:status||'all',offset:offset||'0',...(client?{clientId:client}:{})});
  return {client:client||'',q:q||'',status:status||'all',offset:Number(offset||0),params,filters:Object.fromEntries(params),
    setClient:(v:string)=>{setClient(v||null);setOffset(null);},setQ:(v:string)=>{setQ(v||null);setOffset(null);},setStatus:(v:string)=>{setStatus(v==='all'?null:v);setOffset(null);},setOffset:(v:number)=>setOffset(v?String(v):null)};
}
export const selectClass='min-h-10 max-w-full rounded-lg border p-2 bg-background text-sm';
/** Street line plus city, state and ZIP. New locations store only the street line in `address`; older rows
 *  (and Places text-search adds) hold Google's full formatted address, so don't append the locality twice. */
export function fullAddress(l:{address?:string|null;city?:string|null;state?:string|null;zipCode?:string|null}):string {
  const street=l.address?.trim()||'';
  if(street&&l.city&&l.state&&street.includes(`${l.city}, ${l.state}`))return street;
  return [street,l.city,[l.state,l.zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}
export function Pager({offset,total,onChange}:{offset:number;total:number;onChange:(n:number)=>void}) {
  return <div className="flex flex-wrap gap-2 items-center justify-between text-sm"><Button variant="outline" disabled={!offset} onClick={()=>onChange(Math.max(0,offset-50))}>Previous page</Button><span>{total?offset+1:0}–{Math.min(offset+50,total)} of {total}</span><Button variant="outline" disabled={offset+50>=total} onClick={()=>onChange(offset+50)}>Next page</Button></div>;
}
const statusLabels={all:'All statuses',synced:'Synced',reconnect:'Needs reconnect',unlinked:'Not linked',guard:'Guard alerts',unanswered:'Unanswered reviews',failed:'Failed posts'};
/** The agency bulk workspace when the open workspace's plan includes it. Without it, compact spots show nothing
 *  and the full list (the Locations page) is the owner's own location list, served by /api/locations. */
export function AgencyWorkspace(props:{onOpen?:(id:number)=>void;compact?:boolean}) {
  const {data:me,isError}=useQuery<any>({queryKey:['/api/agency/me']});
  if(!me&&!isError)return null;
  if(me?.entitled)return <AgencyBulkWorkspace {...props}/>;
  return props.compact?null:<OwnLocations onOpen={props.onOpen}/>;
}
function OwnLocations({onOpen}:{onOpen?:(id:number)=>void}) {
  const f=useAgencyFilter();
  const open=(id:number)=>onOpen?onOpen(id):window.location.assign(`/locations?location=${id}`);
  const {data:ent}=useQuery<{accessPlan:string|null}>({queryKey:['/api/entitlements']});
  const noPlan=!!ent&&!ent.accessPlan;
  const params=new URLSearchParams({paged:'true',q:f.q,status:f.status,offset:String(f.offset)});
  const {data,error}=useQuery<any>({queryKey:['/api/locations','paged',params.toString()],queryFn:()=>apiRequest('GET','/api/locations?'+params).then(r=>r.json())});
  const agencyPlan=PLANS[planForModule('agencyWorkspace')].name;
  return <Section title="Your locations" contentClassName="space-y-4">
    <Toolbar search={{value:f.q,onChange:f.setQ,placeholder:'Global location search'}} activeFilters={f.status==='all'?0:1} filters={<select className={selectClass} aria-label="Location status" value={f.status} onChange={e=>f.setStatus(e.target.value)}>{Object.entries(statusLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>}/>
    {error&&<p role="alert">Could not load locations.</p>}
    {/* One location: its profile up front, one click away (owner 2026-10-02: "no link or button to access the account"). */}
    {data&&data.total===1&&data.items.length===1&&!f.q&&f.status==='all'&&(()=>{const l=data.items[0];return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4" data-testid="own-location-single">
      <div className="min-w-0"><p className="font-semibold truncate">{l.businessName}</p><p className="text-sm text-muted-foreground truncate">{fullAddress(l)||'Address not set'} · {l.gbpLocationName?'Linked to Google':'Not linked to Google yet'}</p></div>
      <Button variant="outline" onClick={()=>open(l.id)} data-testid="button-open-single-location">Open your Business Profile</Button>
    </div>;})()}
    <div className="overflow-auto"><table className={appTable.table}><thead className={appTableCards.thead}><tr><th className="text-left p-2">Location</th><th className="text-left p-2">Address</th><th className="text-left p-2">Google link</th><th className="p-2"><span className="sr-only">Open</span></th></tr></thead><tbody>{data?.items.map((l:any)=><tr key={l.id} className={`${appTable.tr} ${appTableCards.tr}`} data-testid={`own-location-${l.id}`}><td className={`${appTableCards.td} !text-foreground break-words`}><button className="min-h-10 text-left font-medium hover:underline" onClick={()=>open(l.id)}>{l.businessName}</button></td><td className={`${appTableCards.td} !text-foreground break-words`}>{fullAddress(l)||'Not set'}</td><td className={`${appTableCards.td} !text-foreground break-words`}>{l.gbpLocationName?'Linked':'Not linked'}</td><td className={`${appTableCards.td} !text-foreground`}><Button size="sm" variant="outline" onClick={()=>open(l.id)} data-testid={`button-open-location-${l.id}`}>Open</Button></td></tr>)}</tbody></table></div>
    {data&&!data.items.length&&(f.q||f.status!=='all'
      ? <p className="text-sm text-muted-foreground">No locations match these filters.</p>
      : <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-4" data-testid="own-locations-empty">
          <p className="text-sm text-muted-foreground">{noPlan
            ? `No locations yet. Connect Google and we'll find your Business Profile; importing it and opening its profile page needs a plan, from ${formatUsd(STARTING_MONTHLY_CENTS)}/month.`
            : 'No locations yet. Bring in the Business Profile from your connected Google account, or add one by searching Google.'}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><a href="/locations?import=gbp" data-testid="button-import-own-profile">{noPlan ? 'See your Google profiles' : 'Import your Business Profile'}</a></Button>
            {noPlan && <Button asChild variant="outline"><a href="/pricing" data-testid="button-own-locations-see-plans">See plans</a></Button>}
          </div>
        </div>)}
    <Pager offset={f.offset} total={data?.total??0} onChange={f.setOffset}/>
    <p className="text-sm text-muted-foreground">Client workspaces, bulk actions across locations and CSV export are part of the {MODULE_NAMES.agencyWorkspace} on the <Link href="/pricing" className="text-primary underline">{agencyPlan} plan</Link>.</p>
  </Section>;
}
function AgencyBulkWorkspace({onOpen,compact=false}:{onOpen?:(id:number)=>void;compact?:boolean}) {
  const f=useAgencyFilter();const [clientSearch,setClientSearch]=useState(''),[expanded,setExpanded]=useState(!compact);
  const [ids,setIds]=useState<number[]>([]),[all,setAll]=useState(false),[action,setAction]=useState('sync'),[message,setMessage]=useState('');
  const [guard,setGuard]=useState('notify'),[aiMode,setAiMode]=useState('draft'),[tone,setTone]=useState('Warm and professional'),[signOff,setSignOff]=useState('');
  const [text,setText]=useState(''),[photoIds,setPhotoIds]=useState(''),[kind,setKind]=useState('post'),[start,setStart]=useState(''),[assign,setAssign]=useState('');
  const {data:me}=useQuery<any>({queryKey:['/api/agency/me']});
  const {data:clients}=useQuery<any>({queryKey:[`/api/agency/clients?q=${encodeURIComponent(clientSearch)}`]});
  const {data,error}=useQuery<any>({queryKey:['/api/agency/locations',f.params.toString()],queryFn:()=>apiRequest('GET','/api/agency/locations?'+f.params).then(r=>r.json())});
  // The pill must agree with the status filter (server/agency/access.ts), which derives "Needs reconnect"
  // from the Google grant — gbpLocationName alone stays set after the grant expires.
  const {data:linkage}=useQuery<any>({queryKey:['/api/gbp/linkage']});
  const googlePill=(l:any):{tone:'success'|'warning'|'neutral';label:string}=>{
    const st=linkage?.locations?.find((x:any)=>x.id===l.id)?.state as string|undefined;
    if(st==='synced')return{tone:'success',label:'Linked'};
    if(st==='reconnect')return{tone:'warning',label:'Needs reconnect'};
    if(st==='unlinked'||st==='available')return{tone:'neutral',label:'Not linked'};
    // Linkage still loading, off the first page, or withheld from a delegated workspace member: keep the
    // name-based answer rather than guessing.
    return{tone:l.gbpLocationName?'success':'neutral',label:l.gbpLocationName?'Linked':'Not linked'};
  };
  const {data:stats}=useQuery<any>({queryKey:['/api/agency/dashboard',f.params.toString()],queryFn:()=>apiRequest('GET','/api/agency/dashboard?'+f.params).then(r=>r.json())});
  const selectedKey=JSON.stringify(f.filters);
  const [selectionKey,setSelectionKey]=useState(selectedKey);
  const selected=selectionKey===selectedKey?ids:[],selectAll=selectionKey===selectedKey&&all;
  const writable=me?.role!=='viewer';
  const mutation=useMutation({mutationFn:async()=>{
    let payload:any={};
    if(action==='guard')payload={mode:guard,watched:['title','phoneNumbers','websiteUri','storefrontAddress','categories','profile.description','regularHours','specialHours','serviceArea','openInfo.openingDate','openInfo.status']};
    if(action==='ai-replies')payload={mode:aiMode,scope:'future',tone,signOff};
    if(action==='assign')payload={clientId:Number(assign)};
    if(action==='content')payload={approved:true,items:kind==='post'?[{kind,summary:text,photoIds:photoIds.split(',').filter(Boolean).map(Number)}]:photoIds.split(',').filter(Boolean).map(id=>({kind,summary:text,photoIds:[Number(id)]})),schedule:{start:start?new Date(start).toISOString():new Date().toISOString()}};
    return (await apiRequest('POST','/api/agency/bulk',{requestKey:crypto.randomUUID(),action,payload,selection:{ids:selected,allMatching:selectAll,filters:f.filters}})).json();
  },onSuccess:r=>{setMessage(`${r.queued} location actions queued. See Agency → Jobs for progress and failures.`);setIds([]);setAll(false);queryClient.invalidateQueries({queryKey:['/api/agency']});},onError:e=>setMessage(apiErrorMessage(e))});
  return <>{(!compact||expanded)&&stats&&<StatGrid cols={2}><Stat label="Locations" value={data?.total??'—'}/><Stat label="Need reconnect" value={stats.reconnect??0}/></StatGrid>}<Section title={compact ? "Agency locations" : "Your locations"} contentClassName="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><a href="/agency" className="text-sm text-muted-foreground underline">Agency</a><span className="text-sm">{me?.workspace?.name||'Clients & locations'} · {me?.role}</span>{compact&&<Button variant="outline" onClick={()=>setExpanded(!expanded)}>{expanded?'Hide bulk locations':'Bulk location actions'}</Button>}</div>
    {(!compact || expanded) && <>

    <Toolbar search={{value:f.q,onChange:f.setQ,placeholder:'Global location search'}} activeFilters={Number(!!f.client)+Number(f.status!=='all')} filters={<>
      <Input aria-label="Find client" placeholder="Find client…" value={clientSearch} onChange={e=>setClientSearch(e.target.value)}/>
      <select className={selectClass} aria-label="Client filter" value={f.client} onChange={e=>f.setClient(e.target.value)}><option value="">All accessible clients</option>{clients?.items?.map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <select className={selectClass} aria-label="Location status" value={f.status} onChange={e=>f.setStatus(e.target.value)}>{Object.entries(statusLabels).map(([k,v])=><option key={k} value={k}>{v}{stats&&k!=='all'?` (${stats[k]??0})`:''}</option>)}</select>
    </>}/></>}
    {error&&<p role="alert">Could not load locations.</p>}
    {expanded&&<>
      {(selectAll||selected.length>0)&&<div className="flex gap-2 flex-wrap items-center">
        <Button variant="outline" onClick={()=>{setSelectionKey(selectedKey);setAll(false);setIds(data?.items.map((l:any)=>l.id)||[]);}}>Select page</Button>
        <Button variant="outline" onClick={()=>{setSelectionKey(selectedKey);setAll(true);setIds([]);}}>Select all matching ({data?.total??0})</Button>
        <Button variant="ghost" onClick={()=>{setAll(false);setIds([]);}}>Clear selection</Button><span>{selectAll?data?.total:selected.length} selected</span>
        <a className="text-primary underline text-sm" href={'/api/agency/export?'+f.params+(!selectAll&&selected.length?'&ids='+selected.join(','):'')}>{!selectAll&&selected.length?'Export selected CSV':'Export matching CSV'}</a>
      </div>}
      {!selectAll&&!selected.length&&<details className="text-sm"><summary className="cursor-pointer py-2">More</summary><div className="flex flex-wrap gap-2 py-2"><Button variant="outline" onClick={()=>{setSelectionKey(selectedKey);setAll(false);setIds(data?.items.map((l:any)=>l.id)||[]);}}>Select page</Button><Button variant="outline" onClick={()=>{setSelectionKey(selectedKey);setAll(true);setIds([]);}}>Select all matching ({data?.total??0})</Button><a className="inline-flex min-h-10 items-center underline" href={'/api/agency/export?'+f.params}>Export matching CSV</a></div></details>}
      <div className="overflow-auto"><table className={appTable.table}><thead className={appTableCards.thead}><tr><th className={appTable.th}><span className="sr-only">Select</span></th><th className={appTable.th}>Location</th><th className={appTable.th}>Client</th><th className={appTable.th}>Address</th><th className={appTable.th}>Google</th></tr></thead><tbody>{data?.items.map((l:any)=><tr key={l.id} className={`${appTable.tr} grid grid-cols-[auto,1fr] items-start gap-x-3 gap-y-1 px-3.5 py-3 sm:table-row sm:p-0`} data-testid={`agency-location-${l.id}`}><td className="row-span-3 pt-2.5 sm:table-cell sm:px-4 sm:py-3 sm:align-middle"><input aria-label={`Select ${l.businessName}`} className="h-5 w-5 accent-[hsl(var(--primary))]" type="checkbox" checked={selectAll||selected.includes(l.id)} onChange={e=>{setSelectionKey(selectedKey);setAll(false);setIds(e.target.checked?[...selected,l.id]:selected.filter(id=>id!==l.id));}}/></td><td className="min-w-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle"><button className="min-h-10 text-left font-semibold leading-snug hover:underline sm:font-medium" onClick={()=>onOpen?onOpen(l.id):window.location.assign(`/locations?location=${l.id}`)}>{l.businessName}</button></td><td className="col-start-2 text-sm text-muted-foreground sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:text-foreground">{l.clientName||'Unassigned'}</td><td className="col-start-2 text-sm text-muted-foreground break-words sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:text-foreground">{fullAddress(l)||'No address'}</td><td className="col-start-2 pt-1 sm:table-cell sm:px-4 sm:py-3 sm:align-middle">{(()=>{const p=googlePill(l);return <StatusPill tone={p.tone}>{p.label}</StatusPill>})()}</td></tr>)}</tbody></table></div>
      <Pager offset={f.offset} total={data?.total??0} onChange={f.setOffset}/>
      {writable&&(selectAll||selected.length>0)&&<fieldset disabled={mutation.isPending} className="border rounded p-3 space-y-3"><legend>Apply to selected locations</legend>
        <select className={selectClass} aria-label="Bulk action" value={action} onChange={e=>setAction(e.target.value)}>{Object.entries({sync:'Sync now',link:'Link & sync',unlink:'Unlink',assign:'Assign client',guard:'Set Guard mode','ai-replies':'AI reply settings',content:'Schedule post/photo batch',scan:'Start Site Scans'}).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
        {action==='assign'&&<select className={selectClass} aria-label="Assign to client" value={assign} onChange={e=>setAssign(e.target.value)}><option value="">Choose client</option>{clients?.items?.map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        {action==='guard'&&<><select className={selectClass} aria-label="Guard mode" value={guard} onChange={e=>setGuard(e.target.value)}><option value="off">Off</option><option value="notify">Notify</option><option value="lockdown">Lockdown</option></select><p className="text-sm">Enabling requires a previously approved snapshot for each location. Open Profile Guard on each location to approve its values first. Locations without approval will fail safely.</p></>}
        {action==='ai-replies'&&<><select className={selectClass} aria-label="AI reply mode" value={aiMode} onChange={e=>setAiMode(e.target.value)}><option value="off">Off</option><option value="draft">Draft for approval</option><option value="auto">Auto-publish future 3–5 star replies</option></select><Input aria-label="Reply tone" value={tone} onChange={e=>setTone(e.target.value)}/><Input aria-label="Reply sign-off" placeholder="Sign-off" value={signOff} onChange={e=>setSignOff(e.target.value)}/><p className="text-sm">Applies to future reviews. Low ratings stay drafts. Choosing auto-publish explicitly authorizes future publication.</p></>}
        {action==='content'&&<><select className={selectClass} aria-label="Content kind" value={kind} onChange={e=>setKind(e.target.value)}><option value="post">Post</option><option value="photo">Photo batch</option></select><Textarea aria-label="Approved content" placeholder="Write or paste text for review. This stays a draft until you queue it." value={text} onChange={e=>setText(e.target.value)}/><Input aria-label="Media photo IDs" placeholder="Media library photo IDs, comma separated" value={photoIds} onChange={e=>setPhotoIds(e.target.value)}/><Input aria-label="Batch start time" type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/><p className="text-sm">Queueing approves this content for every selected location. Photos must belong to the agency. Publishing uses the existing content queue and daily budget.</p></>}
        {action==='unlink'&&<p>Unlink removes synced Google data in ConstructHUB and stops syncing. It does not remove the listing from Google.</p>}
        <Button variant="outline" disabled={(!selectAll&&!selected.length)||mutation.isPending} onClick={()=>mutation.mutate()}>{action==='content'?'Approve & queue batch':'Queue selected action'}</Button>
      </fieldset>}
    </>}
    {message&&<p role="status">{message}</p>}
  </Section></>;
}
