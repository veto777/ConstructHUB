import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { destinationSchema, platforms, type Destination } from "@shared/social";
const selectClass="rounded-md border bg-background px-3 py-2 text-sm max-w-full";
export const refreshSocial=()=>queryClient.invalidateQueries({queryKey:['/api/social']});
export function Pager({offset,setOffset,more,label}:{offset:number;setOffset:(n:number)=>void;more:boolean;label:string}) {
  return <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-25))}>Previous {label}</Button><span>Page {offset/25+1}</span><Button variant="outline" disabled={!more} onClick={()=>setOffset(offset+25)}>Next {label}</Button></div>;
}
export function BusinessSelector({value,onChange}:{value:string|null;onChange:(v:string)=>void}) {
  const [search,setSearch]=useState(''),[offset,setOffset]=useState(0),[linked,setLinked]=useState('all');
  const [selected,setSelected]=useState<Record<number,{name:string;cadence:number;period:string}>>({});
  const [bulk,setBulk]=useState(false),[text,setText]=useState(''),[bulkMedia,setBulkMedia]=useState(''),[schedule,setSchedule]=useState(''),[mode,setMode]=useState('approval'),[jobOffset,setJobOffset]=useState(0),[jobSearch,setJobSearch]=useState('');
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
  const {toast}=useToast();
  const {data,error}=useQuery<any>({queryKey:['/api/social','businesses',search,offset,linked],queryFn:async()=> (await apiRequest('GET',`/api/social/businesses?${new URLSearchParams({search,offset:String(offset),linked})}`)).json()});
  const {data:jobs}=useQuery<any>({queryKey:['/api/social','bulk',jobOffset,jobSearch],enabled:bulk,refetchInterval:15000,queryFn:async()=>(await apiRequest('GET',`/api/social/bulk?offset=${jobOffset}&search=${encodeURIComponent(jobSearch)}`)).json()});
  const mutation=useMutation({mutationFn:async(body:any)=>(await apiRequest('POST','/api/social/bulk',body)).json(),onSuccess:()=>{refreshSocial();setRequestId(crypto.randomUUID());toast({title:'Bulk work queued',description:'Review each business result below.'});},onError:(e:Error)=>toast({title:'Bulk action failed',description:e.message,variant:'destructive'})});
  const ids=Object.keys(selected).map(Number);
  function enqueue(kind:string,draft=true,enabled=true) {
    mutation.mutate({requestId,businessIds:ids,kind,...(kind==='post'?{text,draft,mediaUrls:bulkMedia.split('\n').map(v=>v.trim()).filter(Boolean),...(schedule?{scheduledTime:new Date(schedule).toISOString()}:{})}:{}),...(kind==='settings'?{enabled,mode,cadences:ids.map(businessId=>({businessId,cadence:selected[businessId].cadence,period:selected[businessId].period}))}:{})});
  }
  return <section className="border rounded-lg p-4 space-y-3" aria-label="Business and agency selector">
    <h2 className="font-semibold">Business / Google profile</h2>
    <div className="flex flex-wrap gap-2"><Input className="max-w-sm" aria-label="Search businesses" placeholder="Search business, city or phone" value={search} onChange={e=>{setSearch(e.target.value);setOffset(0);}}/>
      <select aria-label="Google linkage filter" className={selectClass} value={linked} onChange={e=>{setLinked(e.target.value);setOffset(0);}}><option value="all">All businesses</option><option value="linked">Google linked</option><option value="unlinked">Not linked</option></select>
      <Button variant="outline" onClick={()=>onChange('all')}>All-clients calendar</Button><Button variant="outline" onClick={()=>setBulk(!bulk)}>Bulk actions ({ids.length})</Button></div>
    {error&&<p role="alert">Could not load businesses.</p>}
    <p className="text-sm text-muted-foreground">{data?.total??0} businesses. Choose one to manage its accounts, posts and auto mode.</p>
    <div className="grid md:grid-cols-2 gap-2">{(data?.items||[]).map((b:any)=><div key={b.id} className="flex gap-2 items-center border rounded p-2">
      {bulk&&<input type="checkbox" aria-label={`Select ${b.business_name} for bulk`} checked={!!selected[b.id]} onChange={e=>setSelected(old=>{const next={...old};if(e.target.checked)next[b.id]={name:b.business_name,cadence:1,period:'week'};else delete next[b.id];return next;})}/>}
      <Button className="min-w-0 h-auto whitespace-normal text-left justify-start" variant={value===String(b.id)?'default':'ghost'} onClick={()=>onChange(String(b.id))}>{b.business_name}{b.city?` · ${b.city}`:''}{b.gbp_location_name?' · Google linked':''}</Button>
    </div>)}</div>
    <Pager offset={offset} setOffset={setOffset} more={offset+25<(data?.total||0)} label="businesses"/>
    {bulk&&<div className="space-y-3 border-t pt-3">
      <h3 className="font-semibold">Bulk actions for {ids.length} selected businesses</h3>
      <div className="flex gap-2"><Button variant="outline" onClick={()=>setSelected(old=>({...old,...Object.fromEntries((data?.items||[]).map((b:any)=>[b.id,old[b.id]||{name:b.business_name,cadence:1,period:'week'}]))}))}>Select this page</Button><Button variant="outline" onClick={()=>setSelected({})}>Clear selection</Button></div>
      <p className="text-sm">Selection is retained across search pages, up to 1,000 businesses. Each business uses its saved destination mapping.</p>
      <Textarea aria-label="Bulk post text" placeholder="Update for {business} in {city}. Call {phone}." value={text} onChange={e=>{setText(e.target.value);setRequestId(crypto.randomUUID());}}/>
      <p className="text-xs">Variables: {'{business}, {city}, {phone}'}. Missing facts fail that business with a visible error. Attachments are shared across selected businesses; each destination must satisfy its platform requirements.</p>
      <Textarea aria-label="Bulk media URLs" placeholder="Public HTTPS media URLs, one per line (optional)" value={bulkMedia} onChange={e=>{setBulkMedia(e.target.value);setRequestId(crypto.randomUUID());}}/>
      <Input aria-label="Bulk schedule time" type="datetime-local" value={schedule} onChange={e=>setSchedule(e.target.value)}/>
      <div className="flex flex-wrap gap-2"><Button disabled={!ids.length||!text.trim()||mutation.isPending} onClick={()=>enqueue('post')}>Create bulk drafts</Button><Button disabled={!ids.length||!text.trim()||mutation.isPending} onClick={()=>enqueue('post',false)}>Queue bulk posts</Button></div>
      <details><summary>Per-business cadence (defaults to once a week)</summary><div className="max-h-64 overflow-auto space-y-2">{ids.map(id=><div key={id} className="flex gap-2 items-center"><span className="flex-1">{selected[id].name}</span><Input className="w-20" type="number" min={1} max={7} aria-label={`Cadence for ${selected[id].name}`} value={selected[id].cadence} onChange={e=>setSelected({...selected,[id]:{...selected[id],cadence:Number(e.target.value)}})}/><select className={selectClass} aria-label={`Period for ${selected[id].name}`} value={selected[id].period} onChange={e=>setSelected({...selected,[id]:{...selected[id],period:e.target.value}})}><option value="week">per week</option><option value="day">per day</option></select></div>)}</div></details>
      <select aria-label="Bulk publishing mode" className={selectClass} value={mode} onChange={e=>setMode(e.target.value)}><option value="approval">Approval drafts</option><option value="automatic">Automatically publish without review</option></select>
      <div className="flex flex-wrap gap-2">{[['settings','Enable selected auto modes'],['disable','Disable selected auto modes'],['sync','Refresh selected GBP sources'],['generate','Generate selected drafts']].map(([kind,label])=><Button key={kind} variant="outline" disabled={!ids.length||mutation.isPending} onClick={()=>enqueue(kind==='disable'?'settings':kind,true,kind!=='disable')}>{label}</Button>)}</div>
      <p className="text-xs">Enabling uses each business’s existing content mix and AI budget. Automatic publishing is explicit permission for every selected business. Shared owner AI limits still apply.</p>
      <h3 className="font-semibold">Bulk results</h3><Input aria-label="Search bulk results" value={jobSearch} onChange={e=>{setJobSearch(e.target.value);setJobOffset(0);}} placeholder="Search business or status"/>
      {(jobs?.items||[]).map((j:any)=><p key={j.id} className="text-sm">{j.business_name} · {j.kind} · {j.state}{j.error?` — ${j.error}`:''}</p>)}
      <Pager offset={jobOffset} setOffset={setJobOffset} more={jobs?.hasMore||false} label="results"/>
    </div>}
  </section>;
}
export function MappingEditor({businessId,defaults}:{businessId:number;defaults:Destination[]}) {
  const [search,setSearch]=useState(''),[offset,setOffset]=useState(0),[draft,setDraft]=useState<Destination[]|null>(null);
  const choices=draft??defaults;
  const {toast}=useToast();
  const {data}=useQuery<any>({queryKey:['/api/social','accounts',businessId,search,offset],queryFn:async()=>(await apiRequest('GET',`/api/social/accounts?businessId=${businessId}&search=${encodeURIComponent(search)}&offset=${offset}`)).json()});
  const mutation=useMutation({mutationFn:async({path,body}:{path:string;body?:any})=>(await apiRequest(path==='/mapping'?'PUT':'POST',`/api/social${path}?businessId=${businessId}`,body)).json(),onSuccess:()=>{refreshSocial();toast({title:'Business account configuration saved'});},onError:(e:Error)=>toast({title:'Account mapping',description:e.message,variant:'destructive'})});
  const patch=(id:string,values:Partial<Destination>)=>setDraft(choices.map(d=>d.accountId===id?{...d,...values}:d));
  return <details className="border rounded-lg p-4"><summary className="font-medium cursor-pointer">Map accounts and pages to this business</summary><div className="space-y-3 pt-3">
    <p>Choose up to 20 destinations. These become composer defaults and bulk destinations. Saving a mapping pauses this business’s auto mode for review.</p>
    <Input aria-label="Search Blotato accounts" value={search} onChange={e=>{setSearch(e.target.value);setOffset(0);}} placeholder="Search account or platform"/>
    {(data?.items||[]).map((a:any)=>{const d=choices.find(d=>d.accountId===a.id);return <div key={a.id} className="border rounded p-3 space-y-2">
      <label className="flex gap-2"><input type="checkbox" disabled={!platforms.includes(a.platform)} checked={!!d} onChange={e=>setDraft(e.target.checked?[...choices,destinationSchema.parse({accountId:a.id,platform:a.platform})]:choices.filter(d=>d.accountId!==a.id))}/>{a.name} · {a.platform}</label>
      {d&&['facebook','linkedin','pinterest'].includes(a.platform)&&<><Button variant="outline" disabled={mutation.isPending} onClick={()=>mutation.mutate({path:`/accounts/${a.id}/pages`})}>Discover pages for {a.name}</Button><TargetPicker businessId={businessId} account={a} destination={d} onChange={value=>patch(a.id,a.platform==='pinterest'?{boardId:value||undefined}:{pageId:value||undefined})}/></>}
      {d&&['youtube','pinterest'].includes(a.platform)&&<Input aria-label={`Default title for ${a.name}`} value={d.title||''} onChange={e=>patch(a.id,{title:e.target.value})}/>}
    </div>;})}
    <Pager offset={offset} setOffset={setOffset} more={data?.hasMore||false} label="accounts"/>
    <p>{choices.length} destinations selected across pages.</p><Button disabled={mutation.isPending||choices.length>20} onClick={()=>mutation.mutate({path:'/mapping',body:{destinations:choices}})}>Save business mapping</Button>
  </div></details>;
}

function TargetPicker({businessId,account,destination,onChange}:{businessId:number;account:any;destination:Destination;onChange:(id:string)=>void}) {
  const [search,setSearch]=useState(''),[offset,setOffset]=useState(0);
  const {data}=useQuery<any>({queryKey:['/api/social','targets',businessId,account.id,search,offset],queryFn:async()=>(await apiRequest('GET',`/api/social/accounts/${account.id}/targets?businessId=${businessId}&offset=${offset}&search=${encodeURIComponent(search)}`)).json()});
  const selected=destination.pageId||destination.boardId||'';
  return <div className="space-y-2"><Input aria-label={`Search pages for ${account.name}`} placeholder="Search page or board" value={search} onChange={e=>{setSearch(e.target.value);setOffset(0);}}/>
    <select className={selectClass} aria-label={`Map page for ${account.name}`} value={selected} onChange={e=>onChange(e.target.value)}>
      <option value="">{account.platform==='linkedin'?'Personal profile':'Choose page / board'}</option>
      {selected&&!(data?.items||[]).some((p:any)=>p.id===selected)&&<option value={selected}>{selected} (saved selection)</option>}
      {(data?.items||[]).map((p:any)=><option key={p.id} value={p.id}>{p.name}</option>)}
    </select><Pager offset={offset} setOffset={setOffset} more={data?.hasMore||false} label="pages"/></div>;
}
