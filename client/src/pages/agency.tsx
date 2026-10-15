import { AppPage, PageHeader, AppTabsList, Section } from '@/components/app-ui';
import { GoogleSurface, GoogleStat, GoogleStatGrid, GoogleList, GoogleListRow, GooglePill, relativeTime } from '@/components/google';
import { SamplePreview } from '@/components/sample-preview';
import { Tabs, TabsTrigger } from '@/components/ui/tabs';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, apiErrorMessage, queryClient } from '@/lib/queryClient';
import { AgencyWorkspace, Pager, selectClass, useAgencyFilter } from '@/components/agency-workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useUrlParam } from '@/hooks/use-url-param';
import { useLocation } from 'wouter';
import { useToolSlot } from '@/components/tool/shell';
import { agencyHref } from '@/components/google-business-tool/nav';
import { PlanRequired } from '@/components/plan-required';
import { Copy, ExternalLink, Mail, MapPin, Pencil, Plus, RefreshCw, Send, UserMinus, Users } from 'lucide-react';
const knownTabs=['locations','clients','team','onboarding','jobs','settings'];
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The queued actions as Locations → "Apply to selected locations" names them (agency-workspace.tsx). */
const ACTION_LABELS:Record<string,string>={sync:'Sync now',link:'Link & sync',unlink:'Unlink',assign:'Assign client',guard:'Set Watch mode','ai-replies':'AI reply settings',content:'Post/photo batch',scan:'Site Scan'};
/** What each onboarding status means (server/agency/onboarding.ts), in the client's words. */
const ONBOARDING_STATUS:Record<string,{label:string;tone:'good'|'bad'|'neutral'}>={queued:{label:'Email queued',tone:'neutral'},sent:{label:'Waiting on client',tone:'neutral'},opened:{label:'Client opened the steps',tone:'neutral'},'invitation received':{label:'Invitation found',tone:'good'},accepted:{label:'Accepted — linking',tone:'good'},linked:{label:'Linked',tone:'good'},expired:{label:'Expired',tone:'bad'}};
const ROLE_WORDS:Record<string,string>={owner:'Owner: everything, including members and settings.',admin:'Admin: adds clients (with all-client access), sees the Team list, edits clients and locations, queues work.',manager:'Manager: edits the clients and locations they have access to and queues work for them.',viewer:'Viewer: looks, changes nothing.'};
const n=(v:number|null|undefined)=>v==null?'—':v.toLocaleString();
/** Obviously made-up rows, shown only while the real list is empty (sample-preview.tsx rules). Never sent anywhere. */
const SAMPLE_CLIENTS=[{id:-1,name:'Sample Roofing Co.',contact_email:'owner@sample-roofing.example',folder:'North',tags:['roofing','sample'],notes:'Example client record.',location_count:3,open_onboarding:1},{id:-2,name:'Sample Plumbing LLC',contact_email:null,folder:null,tags:[],notes:'',location_count:0,open_onboarding:0}];
const SAMPLE_MEMBERS=[{member_id:-1,email:'sam@sample-agency.example',display_name:'Sam Sample',role:'manager',all_clients:false,client_names:['Sample Roofing Co.']},{member_id:-2,email:'alex@sample-agency.example',display_name:'Alex Example',role:'viewer',all_clients:true,client_names:[]}];
const SAMPLE_ONBOARDING=[{id:'sample-1',business_name:'Sample Roofing Co.',client_name:'Sample Roofing Co.',contact_email:'owner@sample-roofing.example',agency_email:'team@sample-agency.example',status:'opened',sent_at:new Date(Date.now()-2*86400000).toISOString(),reminders:0,error:null,link:'https://example.invalid/instructions'},{id:'sample-2',business_name:'Sample Plumbing LLC',client_name:'Sample Plumbing LLC',contact_email:'hello@sample-plumbing.example',agency_email:'team@sample-agency.example',status:'linked',sent_at:new Date(Date.now()-9*86400000).toISOString(),reminders:1,error:null,link:'https://example.invalid/instructions'}];
const SAMPLE_JOBS=[{id:'sample-1',business_name:'Sample Roofing Co.',client_name:'Sample Roofing Co.',action:'sync',status:'done',error:null,attempts:1,created_at:new Date(Date.now()-3600000).toISOString(),finished_at:new Date(Date.now()-3500000).toISOString(),location_id:0},{id:'sample-2',business_name:'Sample Plumbing LLC',client_name:'Sample Plumbing LLC',action:'guard',status:'failed',error:'Approve a Profile Watch snapshot on this location first.',attempts:1,created_at:new Date(Date.now()-7200000).toISOString(),finished_at:new Date(Date.now()-7100000).toISOString(),location_id:0}];
function Chip({tone='neutral',children}:{tone?:'good'|'bad'|'neutral';children:ReactNode}){return <span className={`g-chip g-chip--sm normal-case ${tone==='good'?'g-open':tone==='bad'?'g-closed':''}`}>{children}</span>;}
/** A short "How this works" card: at most three steps (the owner's program for bare form pages). */
function HowItWorks({steps,testId}:{steps:string[];testId?:string}){return <div className="g-callout" data-testid={testId}><h3>How this works</h3><ol className="mt-1 list-decimal space-y-1 pl-5">{steps.slice(0,3).map(s=><li key={s}>{s}</li>)}</ol></div>;}
export default function AgencyPage(){
  // Each tab is its own address (/agency/clients …) so the Google Business menu can link to it; an old ?tab= link moves there.
  const [path,navigate]=useLocation();
  const [oldTab]=useUrlParam('tab');
  const [urlClient]=useUrlParam('clientId');
  const seg=path.split('/')[2]||null;
  const tabParam=seg??oldTab;
  const setTabParam=(t:string|null)=>navigate(agencyHref(t??'locations'));
  useEffect(()=>{if(oldTab&&!seg&&knownTabs.includes(oldTab)){const rest=new URLSearchParams(window.location.search);rest.delete('tab');const q=rest.toString();navigate(`${agencyHref(oldTab)}${q?`${agencyHref(oldTab).includes('?')?'&':'?'}${q}`:''}`,{replace:true});}},[oldTab]);// eslint-disable-line react-hooks/exhaustive-deps
  const inShell=!!useToolSlot();
  const [message,setMessage]=useState(''),[failed,setFailed]=useState(false),[busy,setBusy]=useState(false),[offset,setOffset]=useState(0),[search,setSearch]=useState('');
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[notes,setNotes]=useState(''),[tags,setTags]=useState(''),[folder,setFolder]=useState(''),[editId,setEditId]=useState<number|null>(null);
  const [role,setRole]=useState('viewer'),[allClients,setAllClients]=useState(false),[clientIds,setClientIds]=useState<number[]>([]),[clientFind,setClientFind]=useState('');
  const [client,setClient]=useState(''),[subject,setSubject]=useState(''),[business,setBusiness]=useState(''),[address,setAddress]=useState(''),[placeId,setPlaceId]=useState('');
  const [agencyName,setAgencyName]=useState(''),[acceptAll,setAcceptAll]=useState(false),[settingsSeeded,setSettingsSeeded]=useState(false);
  const nameRef=useRef<HTMLInputElement>(null),memberRef=useRef<HTMLInputElement>(null);
  const {data:me}=useQuery<any>({queryKey:['/api/agency/me']});
  // `entitled`: the open workspace's owner has the plan that includes the agency workspace (/me always answers).
  const entitled=!!me?.entitled,teamEntitled=!!me?.teamEntitled;
  const admin=me&&['owner','admin'].includes(me.role),write=me&&me.role!=='viewer',owner=me?.role==='owner';
  // Adding a client is for the owner or an admin with all-client access (POST /api/agency/clients): the form is only shown to them.
  const canAddClients=!!admin&&!!me?.allClients;
  const tabs= !entitled&&teamEntitled ? (admin?['team']:['locations']) : ['locations','clients',...(admin?['team']:[]),'onboarding','jobs',...(owner?['settings']:[])];
  // ?tab= keeps the open tab across reloads and shared links; one this role can't open falls back to Locations.
  const tab=tabParam&&(me?tabs:knownTabs).includes(tabParam)?tabParam:(!entitled&&teamEntitled&&admin?'team':'locations');
  // The "i" follows the open tab: the Agency entry on Locations, its section entry ("agency.clients" …) on every other tab.
  // The tabs share one route, so the header cannot pick the section by path on its own.
  const helpKey=tab==='locations'?'agency':`agency.${tab}`;
  const {data:google}=useQuery<any>({queryKey:['/api/agency/google'],enabled:entitled});
  const connectedGoogle=google?.accounts?.filter((g:any)=>g.connected)??[];
  const {data:list,error:listError,refetch}=useQuery<any>({queryKey:['/api/agency',tab,search,offset],enabled:(entitled||(teamEntitled&&tab==='team'))&&tab!=='locations'&&tab!=='settings',queryFn:()=>apiRequest('GET',`/api/agency/${tab}?q=${encodeURIComponent(search)}&offset=${offset}`).then(r=>r.json()),refetchInterval:tab==='jobs'||tab==='onboarding'?10000:false});
  // The client list behind the pickers (Team access boxes, Onboarding's client select, folder suggestions): its own search.
  const {data:clients}=useQuery<any>({queryKey:[`/api/agency/clients?q=${encodeURIComponent(tab==='team'?clientFind:'')}`],enabled:entitled});
  const say=(text:string,error=false)=>{setMessage(text);setFailed(error);};
  // The message sits above the forms; bring it into view when a long form's button (e.g. on a phone) sets it.
  const messageRef=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(message)messageRef.current?.scrollIntoView?.({block:'nearest'});},[message]);
  // Settings start from what is saved (a ?tab=settings link renders before /me answers, so seed once it has).
  useEffect(()=>{if(me?.workspace&&!settingsSeeded){setAgencyName(me.workspace.name||'');setAcceptAll(!!me.workspace.auto_accept_all);setSettingsSeeded(true);}},[me,settingsSeeded]);
  // A link from a client's card (/agency/onboarding?clientId=…) lands with that client chosen.
  useEffect(()=>{if(urlClient&&/^\d+$/.test(urlClient))setClient(urlClient);},[urlClient]);
  /** Sends a change and says, in words for that action, what happened — never a generic "saved". */
  async function run(path:string,body:any,method:string,done:string):Promise<boolean>{setBusy(true);say('');try{const r=await apiRequest(method,'/api/agency'+path,body);await r.json();say(done);await refetch();await queryClient.invalidateQueries({queryKey:['/api/agency/me']});await queryClient.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/agency/clients')});return true;}catch(e){say(apiErrorMessage(e),true);return false;}finally{setBusy(false);}}
  const resetClientForm=()=>{setEditId(null);setName('');setEmail('');setNotes('');setTags('');setFolder('');};
  // Name the missing field before a request instead of the server's generic rejection.
  function saveClient(){
    if(!name.trim())return say('Enter the client name.',true);
    if(email.trim()&&!emailPattern.test(email.trim()))return say('Enter a valid contact email, or leave it blank.',true);
    const editing=!!editId;
    run('/clients'+(editId?'/'+editId:''),{name:name.trim(),contactEmail:email.trim()||null,notes,tags:tags.split(',').map(t=>t.trim()).filter(Boolean),folder:folder.trim()||null},editId?'PUT':'POST',editing?`${name.trim()} updated.`:`${name.trim()} added. Assign its locations on Locations, or email it the Google manager steps under Onboarding.`).then(ok=>{if(ok)resetClientForm();});
  }
  function saveMember(){
    if(!emailPattern.test(email.trim()))return say('Enter the email address of a registered ConstructHUB user.',true);
    if(entitled&&!allClients&&!clientIds.length)return say('Tick the clients this member may work on, or tick All clients.',true);
    run('/team',{email:email.trim(),role,allClients:entitled?allClients:true,clientIds:entitled&&!allClients?clientIds:[]},'PUT',`${email.trim()} saved as ${role}.`).then(ok=>{if(ok){setEmail('');setClientIds([]);setAllClients(false);}});
  }
  function sendOnboarding(){
    if(!client)return say('Choose a client.',true);
    const c=clients?.items?.find((x:any)=>String(x.id)===client);
    if(c&&!c.contact_email)return say(`${c.name} has no contact email yet. Add one under Clients first; the instructions are emailed to it.`,true);
    if(!subject)return say(connectedGoogle.length?'Choose the agency Google account the client should invite.':'Connect the agency Google account first.',true);
    if(!business.trim())return say('Enter the exact business name on Google.',true);
    if(!address.trim()&&!placeId.trim())return say('Provide an address or Place ID.',true);
    run('/onboarding',{clientId:Number(client),subject,businessName:business.trim(),address:address.trim()||undefined,placeId:placeId.trim()||undefined},'POST',`Instructions queued for ${c?.contact_email??'the client'}. The email goes out within a minute; the request below shows when it was sent and opened.`).then(ok=>{if(ok){setBusiness('');setAddress('');setPlaceId('');}});
  }
  const otherWorkspaces=me?.workspaces?.filter((w:any)=>w.user_id!==me.actor)??[];
  const switcher=<div className="flex flex-wrap gap-3 items-center text-sm"><label>Workspace <select className={selectClass} aria-label="Workspace" value={me?.owner||''} onChange={async e=>{await run('/workspace',{owner:Number(e.target.value)},'POST','Workspace opened.');queryClient.clear();window.location.reload();}}><option value={me?.actor}>My workspace</option>{otherWorkspaces.map((w:any)=><option value={w.user_id} key={w.user_id}>{w.name}</option>)}</select></label><span className="g-text-2">Your role here: <b className="font-medium g-text">{me?.role}</b></span></div>;
  // Without the plan: say so, and still let a team member open an agency workspace they belong to.
  if(me&&!entitled&&!teamEntitled)return <GoogleSurface page><AppPage><PageHeader title="Team" description="Manage the people on your platform team."/>
    {otherWorkspaces.length>0&&<section className="space-y-2" aria-label="Workspaces you belong to"><p>You're a member of {otherWorkspaces.length===1?'an agency workspace':'agency workspaces'}. Open one to work on its clients.</p>{switcher}</section>}
    {message&&<p ref={messageRef} role={failed?'alert':'status'} className={failed?'text-destructive':undefined}>{message}</p>}
    <p>Team management is included with Team and above. <a className="text-primary underline" href="/pricing">Compare plans</a>.</p>
    <PlanRequired module="agencyWorkspace" className="max-w-3xl"/>
  </AppPage></GoogleSurface>;
  // The Google Business group: Google's blue like its siblings (owner, 2026-10-07).
  const VIEW:Record<string,[string,string]>={clients:['Clients','Each business you look after, with its contact, folder, tags, notes and how many locations are assigned to it.'],team:['Team','The people who work in this workspace, what each may do, and which clients they can see.'],onboarding:['Onboarding','Email a client the steps to add your agency as a manager on their Google Business Profile, and watch each request until the listing is linked.'],jobs:['Jobs','Every queued Google action from Locations — one row per location — with its result or the reason it failed.'],settings:['Agency settings','Your agency name, the Google account the agency works through, and whether every location invitation is accepted.']};
  const head:[string,string]=inShell&&VIEW[tab]?VIEW[tab]:['Agency workspace',entitled?"Manage clients, locations and the people who look after them.":"Manage the people on your platform team."];
  const loaded=!!list,empty=loaded&&!list.items?.length,noData=empty&&!search&&!offset;
  const folders=[...new Set<string>((clients?.items??[]).map((c:any)=>c.folder).filter(Boolean))];
  const copyLink=(link:string)=>Promise.resolve().then(()=>navigator.clipboard.writeText(link)).then(()=>say('Link copied.'),()=>say('Select the link and copy it manually.',true));
  const clientRow=(c:any,sample=false)=><GoogleListRow key={c.id} size="md" title={c.name} testId={sample?undefined:`agency-client-${c.id}`}
    meta={[c.contact_email||'No contact email yet',c.folder?`Folder: ${c.folder}`:null,c.tags?.length?c.tags.join(', '):null]}
    line={<>{n(c.location_count)} location{c.location_count===1?'':'s'} assigned · {n(c.open_onboarding)} onboarding request{c.open_onboarding===1?'':'s'} open{c.notes?<> · {c.notes}</>:null}</>}
    actions={<>
      <GooglePill size="sm" icon={MapPin} label="Locations" href={sample?undefined:`/agency?clientId=${c.id}`}/>
      {write&&<GooglePill size="sm" icon={Mail} label="Email Google steps" href={sample?undefined:`/agency/onboarding?clientId=${c.id}`}/>}
      {write&&<GooglePill size="sm" icon={Pencil} label="Edit" onClick={sample?undefined:()=>{setEditId(c.id);setName(c.name);setEmail(c.contact_email||'');setNotes(c.notes);setTags(c.tags.join(', '));setFolder(c.folder||'');nameRef.current?.focus();}}/>}
    </>}/>;
  const memberRow=(m:any,sample=false)=><GoogleListRow key={m.member_id} size="md" title={m.display_name||m.email} testId={sample?undefined:`agency-member-${m.member_id}`}
    badges={<Chip>{m.role}</Chip>}
    meta={[m.display_name?m.email:null,m.all_clients?'All clients':m.client_names?.length?`Clients: ${m.client_names.join(', ')}`:'No clients yet — sees nothing until given one']}
    actions={owner?<>
      <GooglePill size="sm" icon={Pencil} label="Change" onClick={sample?undefined:()=>{setEmail(m.email);setRole(m.role);setAllClients(!!m.all_clients);setClientIds(m.client_ids??[]);memberRef.current?.focus();}}/>
      <GooglePill size="sm" variant="danger" icon={UserMinus} label="Remove" onClick={sample?undefined:()=>run('/team/'+m.member_id,undefined,'DELETE',`${m.email} removed from the workspace.`)}/>
    </>:undefined}/>;
  const onboardingRow=(r:any,sample=false)=>{const st=ONBOARDING_STATUS[r.status==='sent'&&!r.sent_at?'queued':r.status]??{label:r.status,tone:'neutral' as const};return <GoogleListRow key={r.id} size="md" title={r.business_name} testId={sample?undefined:`agency-onboarding-${r.id}`}
    badges={<Chip tone={st.tone}>{st.label}</Chip>}
    meta={[r.client_name,`${r.contact_email} → ${r.agency_email}`,r.sent_at?`Sent ${relativeTime(r.sent_at)}`:'Email queued — goes out within a minute',r.reminders?`${r.reminders} reminder${r.reminders===1?'':'s'}`:null]}
    line={r.error?<span role="alert" className="g-closed">{r.error}</span>:undefined}
    actions={<>
      {r.link?<>
        <GooglePill size="sm" icon={Copy} label="Copy link" onClick={sample?undefined:()=>copyLink(r.link)}/>
        <GooglePill size="sm" icon={ExternalLink} label="Open instructions" href={sample?undefined:r.link} external/>
      </>:<span className="g-text-2 text-[13px]">Instructions link unavailable (its key changed) — send a new request.</span>}
      {write&&['sent','opened'].includes(r.status)&&<GooglePill size="sm" icon={Send} label="Send reminder" onClick={sample?undefined:()=>run(`/onboarding/${r.id}/remind`,{},'POST','Reminder queued; it goes out on the worker’s next pass (one manual reminder a day).')}/>}
    </>}/>;};
  const jobRow=(j:any,sample=false)=><GoogleListRow key={j.id} size="md" title={j.business_name} testId={sample?undefined:`agency-job-${j.id}`}
    badges={<Chip tone={j.status==='done'?'good':j.status==='failed'?'bad':'neutral'}>{j.status}</Chip>}
    meta={[ACTION_LABELS[j.action]??j.action,j.client_name||'Unassigned',`Queued ${relativeTime(j.created_at)}`,j.finished_at?`Finished ${relativeTime(j.finished_at)}`:j.status==='queued'&&j.attempts>0?`Retry ${j.attempts} pending`:null]}
    line={j.error?<span role="alert" className={j.status==='failed'?'g-closed':undefined}>{j.error}</span>:undefined}
    actions={sample?undefined:<GooglePill size="sm" icon={MapPin} label="Open location" href={`/locations?location=${j.location_id}`}/>}/>;
  return <GoogleSurface page><AppPage><PageHeader title={head[0]} description={head[1]} helpKey={helpKey} actions={tab==='locations'?<Button asChild><a href="/locations?import=gbp">Add location</a></Button>:undefined}/>
    {switcher}
    {!inShell&&<Tabs value={tab} onValueChange={t=>{setTabParam(t==='locations'?null:t);setOffset(0);say('');}}><AppTabsList>{tabs.map(t=><TabsTrigger key={t} value={t}>{t[0].toUpperCase()+t.slice(1)}</TabsTrigger>)}</AppTabsList></Tabs>}
    {message&&<p ref={messageRef} role={failed?'alert':'status'} className={failed?'text-destructive':undefined} data-testid="agency-message">{message}</p>}
    {/* A list that could not load says so (never an empty page that looks like “nothing here”). */}
    {listError&&tab!=='locations'&&tab!=='settings'&&<p role="alert" className="text-destructive" data-testid="agency-list-error">Couldn’t load this list: {apiErrorMessage(listError)} <button type="button" className="underline" onClick={()=>void refetch()}>Try again</button></p>}
    {tab==='locations'?(entitled?<AgencyWorkspace/>:<p>Open <a className="underline" href="/locations">Locations</a> to work with your team.</p>):<Section title={inShell?undefined:tab[0].toUpperCase()+tab.slice(1)} contentClassName="space-y-4 text-sm">
      {/* Owner-only, and the saved values are only known once /api/agency/me answers (the form is seeded from them). */}
      {tab==='settings'&&owner&&<>
        <HowItWorks testId="agency-settings-how" steps={['Name your agency: the name shows in the workspace switcher for every member.','Connect the agency Google account: the one your clients invite as a manager, and the one that reads and writes their listings.','Choose how invitations are handled: by default only an invitation that matches one of your onboarding requests is accepted; Auto-accept takes every location invitation that account receives.']}/>
        <GoogleStatGrid cols={3}>
          <GoogleStat label="Agency name" value={me?.workspace?.name||'Not set'} hint="Shown to your team"/>
          <GoogleStat label="Google accounts connected" value={google?n(connectedGoogle.length):'—'} hint={google?.accounts?.length&&!connectedGoogle.length?'Needs reconnecting':connectedGoogle[0]?.email??'None yet'} tone={google&&!connectedGoogle.length?'bad':'default'}/>
          <GoogleStat label="Invitations" value={me?.workspace?.auto_accept_all?'Auto-accept all':'Matching requests only'} hint="What the worker accepts"/>
        </GoogleStatGrid>
        <fieldset disabled={busy} className="space-y-3"><legend className="font-medium">Agency settings</legend>
          <label className="block space-y-1"><span>Agency name</span><Input aria-label="Agency name" placeholder="Agency name" value={agencyName} onChange={e=>setAgencyName(e.target.value)}/></label>
          <label className="flex gap-2 items-start"><input type="checkbox" className="mt-1" checked={acceptAll} onChange={e=>setAcceptAll(e.target.checked)}/><span>Auto-accept every location invitation sent to a connected agency Google account.<br/><span className="g-text-2">Off: only an invitation that matches one of your onboarding requests is accepted. Either way an invitation with no matching request is never assigned to a guessed client; it waits under Locations as unassigned.</span></span></label>
          <div className="flex flex-wrap gap-2"><Button onClick={()=>{if(!agencyName.trim())return say('Enter the agency name.',true);run('/settings',{name:agencyName.trim(),autoAcceptAll:acceptAll},'PUT','Agency settings saved.');}}>Save agency settings</Button></div>
        </fieldset>
        <div className="space-y-2"><h3 className="font-medium">Agency Google account</h3>
          {google&&(google.accounts?.length?<GoogleList>{google.accounts.map((g:any)=><GoogleListRow key={g.subject} size="md" title={g.email} badges={<Chip tone={g.connected?'good':'bad'}>{g.connected?'Connected':'Needs reconnect'}</Chip>} meta={[g.connected?'Reads and writes the listings it manages':'Reconnect to resume syncing']}/>)}</GoogleList>:<p className="g-text-2">No agency Google account is connected yet. Clients invite this account as a manager, so connect it before sending onboarding emails.</p>)}
          <div className="flex flex-wrap gap-2">
            <GooglePill icon={Plus} label={connectedGoogle.length?'Connect another Google account':'Connect agency Google account'} href="/api/gbp/connect"/>
            <GooglePill icon={RefreshCw} label="Refresh Google listings" disabled={busy||(!!google&&!connectedGoogle.length)} title={google&&!connectedGoogle.length?'Connect a Google account first':undefined} onClick={()=>run('/google/refresh',{},'POST','Refresh queued. The connected accounts’ listings are re-read in the background over the next few minutes; “Link & sync” on Locations then finds them.')}/>
          </div>
        </div>
      </>}
      {tab!=='settings'&&<Input aria-label="Search agency records" placeholder={tab==='team'?'Search members by email…':tab==='clients'?'Search clients by name, email, folder or tag…':'Search by business name…'} value={search} onChange={e=>{setSearch(e.target.value);setOffset(0);}}/>}
      {tab==='clients'&&<>
        {list?.summary&&<GoogleStatGrid cols={3}>
          <GoogleStat label="Clients" value={n(list.summary.clients)} hint={me?.allClients?'In this workspace':'That you have access to'}/>
          <GoogleStat label="Locations assigned" value={n(list.summary.locationsAssigned)} hint="Open Locations" href="/agency"/>
          <GoogleStat label="Locations unassigned" value={n(list.summary.locationsUnassigned)} hint={list.summary.locationsUnassigned==null?'Needs all-client access':list.summary.locationsUnassigned?'Assign them on Locations':'All assigned'} href={list.summary.locationsUnassigned?'/agency':undefined} tone={list.summary.locationsUnassigned?'bad':'default'}/>
        </GoogleStatGrid>}
        {canAddClients?<fieldset disabled={busy} className="grid gap-3" data-testid="agency-client-form"><legend className="font-medium">{editId?'Edit client':'New client'}</legend>
          <Input ref={nameRef} aria-label="Client name" placeholder="Client name" value={name} onChange={e=>setName(e.target.value)}/>
          <Input aria-label="Contact email" placeholder="Contact email (onboarding instructions go here)" value={email} onChange={e=>setEmail(e.target.value)}/>
          <details open={!!editId}><summary className="cursor-pointer py-2">More client details</summary><div className="space-y-3">
            <Input aria-label="Client folder" placeholder="Folder (optional — pick one you use or type a new one)" list="agency-folders" value={folder} onChange={e=>setFolder(e.target.value)}/><datalist id="agency-folders">{folders.map(f=><option key={f} value={f}/>)}</datalist>
            <Input aria-label="Client tags" placeholder="Tags, comma separated" value={tags} onChange={e=>setTags(e.target.value)}/>
            <Textarea aria-label="Client notes" placeholder="Notes" value={notes} onChange={e=>setNotes(e.target.value)}/></div></details>
          <div className="flex flex-wrap gap-2"><Button onClick={saveClient}>{editId?'Save client':'Create client'}</Button>{editId&&<Button variant="ghost" onClick={resetClientForm}>Cancel</Button>}</div>
        </fieldset>
        :write&&editId?<fieldset disabled={busy} className="grid gap-3" data-testid="agency-client-form"><legend className="font-medium">Edit client</legend>
          <Input ref={nameRef} aria-label="Client name" placeholder="Client name" value={name} onChange={e=>setName(e.target.value)}/>
          <Input aria-label="Contact email" placeholder="Contact email" value={email} onChange={e=>setEmail(e.target.value)}/>
          <Input aria-label="Client folder" placeholder="Folder (optional)" list="agency-folders" value={folder} onChange={e=>setFolder(e.target.value)}/><datalist id="agency-folders">{folders.map(f=><option key={f} value={f}/>)}</datalist>
          <Input aria-label="Client tags" placeholder="Tags, comma separated" value={tags} onChange={e=>setTags(e.target.value)}/>
          <Textarea aria-label="Client notes" placeholder="Notes" value={notes} onChange={e=>setNotes(e.target.value)}/>
          <div className="flex flex-wrap gap-2"><Button onClick={saveClient}>Save client</Button><Button variant="ghost" onClick={resetClientForm}>Cancel</Button></div>
        </fieldset>
        :me&&<p className="g-text-2" data-testid="agency-clients-readonly">{write?'You can edit the clients you have access to. Adding a client is for the workspace owner or an admin with all-client access.':'You can see these clients but not change them (viewer role).'}</p>}
        {noData?<SamplePreview what="what Clients looks like once you add one" testId="agency-clients-sample" cta={canAddClients?<GooglePill size="sm" variant="solid" icon={Plus} label="Add your first client" onClick={()=>nameRef.current?.focus()}/>:undefined}><GoogleList>{SAMPLE_CLIENTS.map(c=>clientRow(c,true))}</GoogleList></SamplePreview>
          :empty?<p className="g-text-2">No clients match “{search}”.</p>
          :<GoogleList testId="agency-clients-list">{list?.items?.map((c:any)=>clientRow(c))}</GoogleList>}
      </>}
      {tab==='team'&&<>
        {list&&<GoogleStatGrid cols={3}>
          <GoogleStat label="Members" value={n(list.total)} hint="Besides you, the owner"/>
          <GoogleStat label="Seats in use" value={list.seats?(list.seats.limit===-1?n(list.seats.used):`${n(list.seats.used)} of ${n(list.seats.limit)}`):'—'} hint={list.seats?.limit===-1?'No seat limit on this plan':'Owner + members, on the plan'} tone={list.seats&&list.seats.limit!==-1&&list.seats.used>=list.seats.limit?'bad':'default'}/>
          <GoogleStat label="Clients" value={entitled?n(clients?.total):'—'} hint={entitled?'To give access to':'Client workspaces need the Agency module'} href={entitled?'/agency/clients':undefined}/>
        </GoogleStatGrid>}
        <div className="g-callout" data-testid="agency-roles"><h3>Roles</h3><ul className="list-disc">{Object.values(ROLE_WORDS).map(w=><li key={w}>{w}</li>)}</ul><p className="mt-2">Members sign in with their own ConstructHUB login; they need no plan of their own. A member given specific clients sees only those clients’ locations — unassigned locations need All clients.</p></div>
        {owner?<fieldset disabled={busy} className="space-y-3" data-testid="agency-member-form"><legend className="font-medium">Add or change a member</legend>
          <Input ref={memberRef} aria-label="Member email" placeholder="Email of a registered ConstructHUB user" value={email} onChange={e=>setEmail(e.target.value)}/>
          <label className="flex flex-wrap items-center gap-2">Role <select className={selectClass} aria-label="Member role" value={role} onChange={e=>setRole(e.target.value)}>{['admin','manager','viewer'].map(r=><option key={r}>{r}</option>)}</select><span className="g-text-2">{ROLE_WORDS[role]}</span></label>
          {entitled&&<div className="space-y-2"><label className="flex gap-2"><input type="checkbox" checked={allClients} onChange={e=>setAllClients(e.target.checked)}/>All clients (also the unassigned locations)</label>
            {!allClients&&<div className="space-y-2 rounded-lg border p-3"><Input aria-label="Find client" placeholder="Find client…" value={clientFind} onChange={e=>setClientFind(e.target.value)}/>
              {clients?.items?.length?<div className="grid gap-1 sm:grid-cols-2">{clients.items.map((c:any)=><label key={c.id} className="flex gap-2 items-center"><input type="checkbox" checked={clientIds.includes(c.id)} onChange={e=>setClientIds(e.target.checked?[...clientIds,c.id]:clientIds.filter(id=>id!==c.id))}/>{c.name}</label>)}</div>:<p className="g-text-2">{clientFind?'No client matches.':'No clients yet — add them under Clients, or tick All clients.'}</p>}
              {clientIds.length>0&&<p className="g-text-2">{clientIds.length} client{clientIds.length===1?'':'s'} ticked{clients?.items&&clientIds.some(id=>!clients.items.some((c:any)=>c.id===id))?' (some are outside this search)':''}.</p>}</div>}
          </div>}
          <Button onClick={saveMember}>Save member</Button>
        </fieldset>:me&&<p className="g-text-2">Only the workspace owner adds or changes members.</p>}
        {noData?<SamplePreview what="what Team looks like once you add a member" testId="agency-team-sample" cta={owner?<GooglePill size="sm" variant="solid" icon={Users} label="Add your first member" onClick={()=>memberRef.current?.focus()}/>:undefined}><GoogleList>{SAMPLE_MEMBERS.map(m=>memberRow(m,true))}</GoogleList></SamplePreview>
          :empty?<p className="g-text-2">No member matches “{search}”.</p>
          :<GoogleList testId="agency-team-list">{list?.items?.map((m:any)=>memberRow(m))}</GoogleList>}
      </>}
      {tab==='onboarding'&&<>
        <HowItWorks testId="agency-onboarding-how" steps={['Choose the client and your agency Google account, type the business name exactly as Google shows it, and send. The client gets an email with the steps and a link to them.','The client adds that Google account as a Manager on their Business Profile (they keep ownership and never sign in here). Reminders go out after 3 and 6 days; a request expires after 30.','ConstructHUB checks the account for the matching invitation, accepts it, links the listing to the client and queues its first sync. Each request below shows where it stands.']}/>
        {list?.counts&&<GoogleStatGrid cols={4}>
          <GoogleStat label="Waiting on client" value={n(list.counts.waiting)} hint="Email sent or opened"/>
          <GoogleStat label="Accepting on Google" value={n(list.counts.accepting)} hint="Invitation found"/>
          <GoogleStat label="Linked" value={n(list.counts.linked)} hint="Listing synced to the client"/>
          <GoogleStat label="Needs attention" value={n(list.counts.expired+list.counts.withError)} hint={list.counts.expired||list.counts.withError?'Expired or with an error':'Nothing stuck'} tone={list.counts.expired||list.counts.withError?'bad':'default'}/>
        </GoogleStatGrid>}
        {write&&<fieldset disabled={busy} className="space-y-3" data-testid="agency-onboarding-form"><legend className="font-medium">Email Google manager instructions</legend>
          <div className="flex flex-wrap gap-2">
            <select className={selectClass} aria-label="Onboarding client" value={client} onChange={e=>setClient(e.target.value)}><option value="">Choose client</option>{clients?.items?.map((c:any)=><option key={c.id} value={c.id}>{c.name}{c.contact_email?'':' (no contact email)'}</option>)}</select>
            <select className={selectClass} aria-label="Agency Google account" value={subject} onChange={e=>setSubject(e.target.value)}><option value="">{connectedGoogle.length?'Choose the agency Google account':'No agency Google account connected'}</option>{connectedGoogle.map((g:any)=><option key={g.subject} value={g.subject}>{g.email}</option>)}</select>
          </div>
          <Input aria-label="Onboarding business name" placeholder="Exact business name on Google" value={business} onChange={e=>setBusiness(e.target.value)}/>
          <Input aria-label="Onboarding address" placeholder="Full address (or a Place ID below)" value={address} onChange={e=>setAddress(e.target.value)}/>
          <Input aria-label="Onboarding Place ID" placeholder="Place ID (best match; optional with an address)" value={placeId} onChange={e=>setPlaceId(e.target.value)}/>
          {google&&!connectedGoogle.length&&<p role="note" className="g-closed" data-testid="agency-onboarding-no-google">No agency Google account is connected, so the instructions cannot name the manager email to invite. {owner?<a className="text-primary underline" href="/api/gbp/connect">Connect the agency Google account</a>:'Ask the workspace owner to connect the agency Google account under Settings.'}</p>}
          <Button disabled={!!google&&!connectedGoogle.length} onClick={sendOnboarding}>Email manager instructions</Button>
        </fieldset>}
        {noData?<SamplePreview what="what Onboarding looks like once you send a request" testId="agency-onboarding-sample"><GoogleList>{SAMPLE_ONBOARDING.map(r=>onboardingRow(r,true))}</GoogleList></SamplePreview>
          :empty?<p className="g-text-2">No request matches “{search}”.</p>
          :<GoogleList testId="agency-onboarding-list">{list?.items?.map((r:any)=>onboardingRow(r))}</GoogleList>}
      </>}
      {tab==='jobs'&&<>
        {list?.counts&&<GoogleStatGrid cols={4}>
          <GoogleStat label="Queued" value={n(list.counts.queued)} hint="Runs within seconds"/>
          <GoogleStat label="Running" value={n(list.counts.running)} hint="Right now"/>
          <GoogleStat label="Done" value={n(list.counts.done)} hint="Finished without error"/>
          <GoogleStat label="Failed" value={n(list.counts.failed)} hint={list.counts.failed?'Each row says why':'None'} tone={list.counts.failed?'bad':'default'}/>
        </GoogleStatGrid>}
        <p className="g-text-2">Work is queued from <a className="g-link" href="/agency">Locations</a> (tick locations → Apply to selected locations) and by the six-hourly Google sync. A failed Google call is retried up to five times, a quota limit an hour later; a failed row stays here with its reason. To run something again, queue it on Locations again.</p>
        {noData?<SamplePreview what="what Jobs looks like once work is queued" testId="agency-jobs-sample" cta={write?<GooglePill size="sm" variant="solid" icon={MapPin} label="Queue work on Locations" href="/agency"/>:undefined}><GoogleList>{SAMPLE_JOBS.map(j=>jobRow(j,true))}</GoogleList></SamplePreview>
          :empty?<p className="g-text-2">No job matches “{search}”.</p>
          :<GoogleList testId="agency-jobs-list">{list?.items?.map((j:any)=>jobRow(j))}</GoogleList>}
      </>}
      {tab!=='settings'&&!noData&&<Pager offset={offset} total={list?.total??(list?.items?.length===50?offset+51:offset+(list?.items?.length||0))} onChange={setOffset}/>}
    </Section>}
  </AppPage></GoogleSurface>;
}
