import { AppPage, PageHeader, AppTabsList, Section } from '@/components/app-ui';
import { GoogleSurface } from '@/components/google';
import { Tabs, TabsTrigger } from '@/components/ui/tabs';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, apiErrorMessage, queryClient } from '@/lib/queryClient';
import { AgencyWorkspace, Pager, selectClass, useAgencyFilter } from '@/components/agency-workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useUrlParam } from '@/hooks/use-url-param';
import { PlanRequired } from '@/components/plan-required';
const knownTabs=['locations','clients','team','onboarding','jobs','settings'];
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export default function AgencyPage(){
  const [tabParam,setTabParam]=useUrlParam('tab');
  const [message,setMessage]=useState(''),[failed,setFailed]=useState(false),[busy,setBusy]=useState(false),[offset,setOffset]=useState(0),[search,setSearch]=useState('');
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[notes,setNotes]=useState(''),[tags,setTags]=useState(''),[folder,setFolder]=useState(''),[editId,setEditId]=useState<number|null>(null);
  const [role,setRole]=useState('viewer'),[allClients,setAllClients]=useState(false),[clientIds,setClientIds]=useState('');
  const [client,setClient]=useState(''),[subject,setSubject]=useState(''),[business,setBusiness]=useState(''),[address,setAddress]=useState(''),[placeId,setPlaceId]=useState('');
  const [agencyName,setAgencyName]=useState(''),[acceptAll,setAcceptAll]=useState(false);
  const {data:me}=useQuery<any>({queryKey:['/api/agency/me']});
  // `entitled`: the open workspace's owner has the plan that includes the agency workspace (/me always answers).
  const entitled=!!me?.entitled;
  const admin=me&&['owner','admin'].includes(me.role),write=me&&me.role!=='viewer';
  const tabs=['locations','clients',...(admin?['team']:[]),'onboarding','jobs',...(me?.role==='owner'?['settings']:[])];
  // ?tab= keeps the open tab across reloads and shared links; one this role can't open falls back to Locations.
  const tab=tabParam&&(me?tabs:knownTabs).includes(tabParam)?tabParam:'locations';
  const {data:google}=useQuery<any>({queryKey:['/api/agency/google'],enabled:entitled});
  const connectedGoogle=google?.accounts?.filter((g:any)=>g.connected)??[];
  const {data:list,refetch}=useQuery<any>({queryKey:['/api/agency',tab,search,offset],enabled:entitled&&tab!=='locations'&&tab!=='settings',queryFn:()=>apiRequest('GET',`/api/agency/${tab}?q=${encodeURIComponent(search)}&offset=${offset}`).then(r=>r.json()),refetchInterval:tab==='jobs'||tab==='onboarding'?10000:false});
  const {data:clients}=useQuery<any>({queryKey:[`/api/agency/clients?q=${encodeURIComponent(search)}`],enabled:entitled});
  const say=(text:string,error=false)=>{setMessage(text);setFailed(error);};
  // The message sits above the forms; bring it into view when a long form's button (e.g. on a phone) sets it.
  const messageRef=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(message)messageRef.current?.scrollIntoView?.({block:'nearest'});},[message]);
  async function run(path:string,body?:any,method='POST'){setBusy(true);say('');try{const r=await apiRequest(method,'/api/agency'+path,body);await r.json();say('Saved. Queued work appears in Jobs or Onboarding.');await refetch();await queryClient.invalidateQueries({queryKey:['/api/agency/me']});}catch(e){say(apiErrorMessage(e),true);}finally{setBusy(false);}}
  // Name the missing field before a request instead of the server's generic rejection.
  function saveClient(){
    if(!name.trim())return say('Enter the client name.',true);
    if(email.trim()&&!emailPattern.test(email.trim()))return say('Enter a valid contact email, or leave it blank.',true);
    run('/clients'+(editId?'/'+editId:''),{name,contactEmail:email.trim()||null,notes,tags:tags.split(',').map(t=>t.trim()).filter(Boolean),folder:folder||null},editId?'PUT':'POST');
  }
  function saveMember(){
    const ids=clientIds.split(',').map(s=>s.trim()).filter(Boolean);
    if(!emailPattern.test(email.trim()))return say('Enter the email address of a registered ConstructHUB user.',true);
    if(ids.some(s=>!/^\d+$/.test(s)))return say('Client IDs must be numbers from the list below, separated by commas.',true);
    run('/team',{email:email.trim(),role,allClients,clientIds:ids.map(Number)},'PUT');
  }
  function sendOnboarding(){
    if(!client)return say('Choose a client.',true);
    if(!subject)return say(connectedGoogle.length?'Choose the agency Google account the client should invite.':'Connect the agency Google account first.',true);
    if(!business.trim())return say('Enter the exact business name on Google.',true);
    if(!address.trim()&&!placeId.trim())return say('Provide an address or Place ID.',true);
    run('/onboarding',{clientId:Number(client),subject,businessName:business,address:address.trim()||undefined,placeId:placeId.trim()||undefined});
  }
  const otherWorkspaces=me?.workspaces?.filter((w:any)=>w.user_id!==me.actor)??[];
  const switcher=<div className="flex flex-wrap gap-3 items-center text-sm"><label>Workspace <select className={selectClass} aria-label="Workspace" value={me?.owner||''} onChange={async e=>{await run('/workspace',{owner:Number(e.target.value)});queryClient.clear();window.location.reload();}}><option value={me?.actor}>My workspace</option>{otherWorkspaces.map((w:any)=><option value={w.user_id} key={w.user_id}>{w.name}</option>)}</select></label><span>{me?.role}</span></div>;
  // Without the plan: say so, and still let a team member open an agency workspace they belong to.
  if(me&&!entitled)return <GoogleSurface page><AppPage><PageHeader title="Agency workspace" description="Manage clients, locations and the people who look after them."/>
    {otherWorkspaces.length>0&&<section className="space-y-2" aria-label="Workspaces you belong to"><p>You're a member of {otherWorkspaces.length===1?'an agency workspace':'agency workspaces'}. Open one to work on its clients.</p>{switcher}</section>}
    {message&&<p ref={messageRef} role={failed?'alert':'status'} className={failed?'text-destructive':undefined}>{message}</p>}
    <PlanRequired module="agencyWorkspace" className="max-w-3xl"/>
  </AppPage></GoogleSurface>;
  // The Google Business group: Google's blue like its siblings (owner, 2026-10-07).
  return <GoogleSurface page><AppPage><PageHeader title="Agency workspace" description="Manage clients, locations and the people who look after them." actions={tab==='locations'?<Button asChild><a href="/locations?import=gbp">Add location</a></Button>:undefined}/>
    {switcher}
    <Tabs value={tab} onValueChange={t=>{setTabParam(t==='locations'?null:t);setOffset(0);say('');}}><AppTabsList>{tabs.map(t=><TabsTrigger key={t} value={t}>{t[0].toUpperCase()+t.slice(1)}</TabsTrigger>)}</AppTabsList></Tabs>
    {message&&<p ref={messageRef} role={failed?'alert':'status'} className={failed?'text-destructive':undefined}>{message}</p>}
    {tab==='locations'?<AgencyWorkspace/>:<Section title={tab[0].toUpperCase()+tab.slice(1)} contentClassName="space-y-4 text-sm">
      {tab!=='settings'&&<Input aria-label="Search agency records" placeholder="Search records or clients…" value={search} onChange={e=>{setSearch(e.target.value);setOffset(0);}}/>}
      {/* Owner-only, and "Current setting" is only known once /api/agency/me answers (a ?tab=settings link renders before it). */}
      {tab==='settings'&&me?.role==='owner'&&<fieldset disabled={busy} className="space-y-3"><legend>Agency settings</legend><Input aria-label="Agency name" placeholder={me?.workspace?.name||'Agency name'} value={agencyName} onChange={e=>setAgencyName(e.target.value)}/><label className="flex gap-2"><input type="checkbox" checked={acceptAll} onChange={e=>setAcceptAll(e.target.checked)}/>Auto-accept all location invitations for connected agency Google accounts</label><p>Unmatched invitations stay unassigned; they are never assigned to a guessed client. Current setting: {me?.workspace?.auto_accept_all?'enabled':'disabled'}.</p><Button onClick={()=>run('/settings',{name:agencyName||me?.workspace?.name||'Agency',autoAcceptAll:acceptAll},'PUT')}>Save agency settings</Button><a className="block text-primary underline" href="/api/gbp/connect">Connect agency Google account</a><Button variant="outline" onClick={()=>run('/google/refresh',{})}>Refresh Google listings in background</Button></fieldset>}
      {tab==='clients'&&<>
        {write&&<fieldset disabled={busy} className="grid gap-3"><legend>{editId?'Edit client':'New client'}</legend><Input aria-label="Client name" placeholder="Client name" value={name} onChange={e=>setName(e.target.value)}/><Input aria-label="Contact email" placeholder="Contact email" value={email} onChange={e=>setEmail(e.target.value)}/><details><summary className="cursor-pointer py-2">More client details</summary><div className="space-y-3"><Input aria-label="Client folder" placeholder="Folder (optional)" value={folder} onChange={e=>setFolder(e.target.value)}/><Input aria-label="Client tags" placeholder="Tags, comma separated" value={tags} onChange={e=>setTags(e.target.value)}/><Textarea aria-label="Client notes" placeholder="Notes" value={notes} onChange={e=>setNotes(e.target.value)}/></div></details><Button onClick={saveClient}>{editId?'Save client':'Create client'}</Button>{editId&&<Button variant="ghost" onClick={()=>{setEditId(null);setName('');setEmail('');setNotes('');setTags('');setFolder('');}}>New client</Button>}</fieldset>}
        {list?.items?.map((c:any)=><article key={c.id} className="border-b py-3 break-words"><strong>{c.name}</strong><p>{c.contact_email} · {c.folder} · {c.tags.join(', ')}</p><p>{c.notes}</p>{write&&<Button variant="outline" onClick={()=>{setEditId(c.id);setName(c.name);setEmail(c.contact_email||'');setNotes(c.notes);setTags(c.tags.join(', '));setFolder(c.folder||'');}}>Edit {c.name}</Button>}</article>)}
      </>}
      {tab==='team'&&<><details><summary className="cursor-pointer py-2">Team roles and access</summary><p>Members need a ConstructHUB login. Owners manage membership; admins manage clients, managers manage locations, and viewers have read access. Unassigned locations require all-client access.</p></details>{me?.role==='owner'&&<fieldset disabled={busy} className="space-y-3"><legend>Add or update member</legend><Input aria-label="Member email" placeholder="Registered member email" value={email} onChange={e=>setEmail(e.target.value)}/><select className={selectClass} aria-label="Member role" value={role} onChange={e=>setRole(e.target.value)}>{['admin','manager','viewer'].map(r=><option key={r}>{r}</option>)}</select><label className="flex gap-2"><input type="checkbox" checked={allClients} onChange={e=>setAllClients(e.target.checked)}/>All clients</label><Input aria-label="Member client IDs" placeholder="Client IDs, comma separated" value={clientIds} onChange={e=>setClientIds(e.target.value)}/><p className="text-sm">{clients?.items?.map((c:any)=>`${c.id}: ${c.name}`).join(' · ')}</p><Button onClick={saveMember}>Save member</Button></fieldset>}{list?.items?.map((m:any)=><div key={m.member_id} className="border p-3">{m.email} · {m.role} · {m.all_clients?'All clients':m.client_ids.join(', ')}{me?.role==='owner'&&<Button variant="outline" onClick={()=>run('/team/'+m.member_id,undefined,'DELETE')}>Remove member</Button>}</div>)}</>}
      {tab==='onboarding'&&<>{write&&<fieldset disabled={busy} className="space-y-3"><legend>Email Google manager instructions</legend><select className={selectClass} aria-label="Onboarding client" value={client} onChange={e=>setClient(e.target.value)}><option value="">Choose client</option>{clients?.items?.map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}</select><select className={selectClass} aria-label="Agency Google account" value={subject} onChange={e=>setSubject(e.target.value)}><option value="">Choose connected agency Google email</option>{connectedGoogle.map((g:any)=><option key={g.subject} value={g.subject}>{g.email}</option>)}</select><Input aria-label="Onboarding business name" placeholder="Exact business name on Google" value={business} onChange={e=>setBusiness(e.target.value)}/><Input aria-label="Onboarding address" placeholder="Full address" value={address} onChange={e=>setAddress(e.target.value)}/><Input aria-label="Onboarding Place ID" placeholder="Place ID (best match)" value={placeId} onChange={e=>setPlaceId(e.target.value)}/>{google&&!connectedGoogle.length&&<p role="note" className="text-sm">No agency Google account is connected, so instructions can't name a Manager email yet. {me?.role==='owner'?<a className="text-primary underline" href="/api/gbp/connect">Connect agency Google account</a>:'Ask the workspace owner to connect the agency Google account.'}</p>}<Button disabled={!!google&&!connectedGoogle.length} onClick={sendOnboarding}>Email manager instructions</Button><details><summary className="cursor-pointer py-2">What the client receives</summary><p>The client keeps ownership and adds the exact agency email as Manager. Reminders follow after three and six days; requests expire after 30 days.</p></details></fieldset>}{list?.items?.map((r:any)=><article key={r.id} className="border-b py-3 space-y-2 break-words"><strong>{r.business_name}</strong><p>{r.sent_at?r.status:'Email queued'} · {r.contact_email} → {r.agency_email}</p>{r.error&&<p role="alert">{r.error}</p>}<Input aria-label="Copyable onboarding link" readOnly value={r.link}/><Button variant="outline" onClick={()=>Promise.resolve().then(()=>navigator.clipboard.writeText(r.link)).then(()=>say('Link copied'),()=>say('Select the link and copy it manually',true))}>Copy link</Button>{write&&<Button variant="outline" onClick={()=>run(`/onboarding/${r.id}/remind`,{})}>Send reminder</Button>}</article>)}</>}
      {tab==='jobs'&&<>{list?.items?.map((j:any)=><article key={j.id} className="border-b py-3 break-words"><strong>{j.business_name}</strong> · {j.action} · {j.status}{j.error&&<p role="alert">{j.error}</p>}</article>)}{list&&!list.items?.length&&<p>No queued actions.</p>}</>}
      {tab!=='settings'&&<Pager offset={offset} total={list?.total??(list?.items?.length===50?offset+51:offset+(list?.items?.length||0))} onChange={setOffset}/>}
    </Section>}
  </AppPage></GoogleSurface>;
}
