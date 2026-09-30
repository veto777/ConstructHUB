import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { GbpConnection } from '@/components/gbp-connection';

type Photo={id:number;name:string;url:string};
export default function GbpContentPage(){
  const {data:locations=[],error:locationsError}=useQuery<any[]>({queryKey:['/api/locations']});
  const [location,setLocation]=useState('');
  return <main className="p-6 max-w-6xl mx-auto space-y-5"><h1 className="text-3xl font-bold">Posts &amp; Photos</h1><p>Publish approved content to your Google Business Profile.</p>
    {locationsError&&<p role="alert">Unable to load locations. Please reload the page.</p>}
    <label className="block">Location<select className="block border rounded p-2 w-full bg-background" aria-label="Location" value={location} onChange={e=>setLocation(e.target.value)}><option value="">Choose a linked location</option>{locations.filter(l=>l.gbpLocationName).map(l=><option key={l.id} value={l.id}>{l.businessName}</option>)}</select></label>
    {!location?<GbpConnection/>:<Editor key={location} location={location}/>}</main>;
}
function Editor({location}:{location:string}){
  const base=`/api/gbp/content/${location}`;
  const {data,refetch,error:queueError}=useQuery<any>({queryKey:[base],refetchInterval:15000});
  const {data:photos=[],refetch:refreshPhotos,error:photosError}=useQuery<Photo[]>({queryKey:[base+'/photos']});
  const [selected,setSelected]=useState<number[]>([]),[captions,setCaptions]=useState<Record<number,string>>({});
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [pattern,setPattern]=useState('{business}-{city}-{n}'),[title,setTitle]=useState(''),[lat,setLat]=useState(''),[lon,setLon]=useState('');
  const [instructions,setInstructions]=useState(''),[examples,setExamples]=useState(''),[summary,setSummary]=useState(''),[style,setStyle]=useState<string|null>(null);
  const [category,setCategory]=useState('ADDITIONAL'),[topicType,setTopic]=useState('STANDARD'),[cta,setCta]=useState(''),[url,setUrl]=useState('');
  const [eventTitle,setEventTitle]=useState(''),[eventStart,setEventStart]=useState(''),[eventEnd,setEventEnd]=useState(''),[coupon,setCoupon]=useState('');
  const [start,setStart]=useState(''),[cadence,setCadence]=useState('day'),[count,setCount]=useState(1),[custom,setCustom]=useState(''),[hours,setHours]=useState(false);
  const [zone,setZone]=useState(Intl.DateTimeFormat().resolvedOptions().timeZone),[open,setOpen]=useState(9),[close,setClose]=useState(17),[days,setDays]=useState([1,2,3,4,5]);
  const [postBatch,setPostBatch]=useState<any[]>([]);
  const [view,setView]=useState('queue'),[requestKey,setRequestKey]=useState(crypto.randomUUID());
  const call=async(path:string,body:any,method='POST')=>(await apiRequest(method,base+path,body)).json();
  async function run(fn:()=>Promise<void>){setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Operation failed');}finally{setBusy(false);}}
  const metadata=()=>({pattern,title,...(lat!==''?{lat:Number(lat)}:{}),...(lon!==''?{lon:Number(lon)}:{})});
  const schedule=()=>({start:start?new Date(start).toISOString():new Date().toISOString(),everyMinutes:Math.max(1,Math.floor((cadence==='week'?10080:1440)/count)),...(cadence==='custom'?{custom:custom.split('\n').filter(Boolean).map(t=>new Date(t).toISOString())}:{}),businessHours:hours,timezone:zone,openHour:open,closeHour:close,weekdays:days});
  const currentPost=()=>({kind:'post',photoIds:selected.slice(0,10),summary,topicType,...(cta?{callToAction:{actionType:cta,...(url?{url}:{})}}:{}),...(topicType!=='STANDARD'?{event:{title:eventTitle,start:eventStart,end:eventEnd},...(topicType==='OFFER'?{offer:{couponCode:coupon}}:{})}:{})});
  const queue=async(kind:'photo'|'post')=>{const items=kind==='photo'?selected.map(id=>({kind,photoIds:[id],summary:captions[id]||'',category})):postBatch.length?postBatch:[currentPost()];
    await call('/queue',{requestKey,items,schedule:schedule()});setRequestKey(crypto.randomUUID());if(kind==='post')setPostBatch([]);setMessage('Approved content added to the queue.');await refetch();};
  const draft=async(kind:'photo'|'post')=>{
    if(kind==='photo'){
      for(let i=0;i<selected.length;i++){
        const r=await call('/draft',{kind,photoIds:[selected[i]],instructions,examples});
        setCaptions(old=>({...old,...Object.fromEntries(r.drafts.map((d:any)=>[d.photoId,d.text]))}));
        setMessage(`AI caption drafts: ${i+1}/${selected.length}. Completed drafts are retained if a later request fails.`);
      }
    }else{const r=await call('/draft',{kind,photoIds:selected.slice(0,10),instructions,examples});setSummary(r.drafts[0].text);}
    setMessage('AI draft ready. Review and edit before approving.');
  };
  const jobs=data?.jobs||[],ordered=[...jobs].sort((a,b)=>a.due_at.localeCompare(b.due_at));
  return <div className="space-y-6">
    {data&&!data.workerEnabled&&<p role="status" className="border rounded p-3">Publishing worker is disabled. Content can be queued, but will not publish until the owner enables it.</p>}
    {(queueError||photosError)&&<p role="alert">Unable to load the queue or media library. Please reload the page.</p>}
    {error&&<p role="alert" className="text-destructive">{error}</p>}{message&&<p role="status">{message}</p>}
    <fieldset disabled={busy} className="border rounded-lg p-4 space-y-3"><legend className="font-semibold">Photos and media library</legend>
      <p>Choose up to 100 photos. Google strips EXIF on upload; GPS geotags and titles are cosmetic and do not promise ranking benefits. Captions cannot be updated through Google after publishing; cover photos do not accept captions.</p>
      <label className="block">SEO filename pattern<Input aria-label="SEO filename pattern" value={pattern} onChange={e=>setPattern(e.target.value)}/></label><p className="text-sm">Placeholders: {'{business}, {city}, {n}'}. Metadata changes create a library copy.</p>
      <div className="grid sm:grid-cols-3 gap-3"><label>EXIF title<Input value={title} onChange={e=>setTitle(e.target.value)}/></label><label>GPS latitude (optional)<Input value={lat} onChange={e=>setLat(e.target.value)} type="number" min="-90" max="90" step="any"/></label><label>GPS longitude (optional)<Input value={lon} onChange={e=>setLon(e.target.value)} type="number" min="-180" max="180" step="any"/></label></div>
      <label className="block">Upload photos (up to 100, 15 MB each)<Input aria-label="Upload photos" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{const files=Array.from(e.target.files||[]);void run(async()=>{if(files.length>100)throw new Error('Choose at most 100 photos');const added:number[]=[];for(let i=0;i<files.length;i++){const form=new FormData();form.append('photo',files[i]);for(const [k,v]of Object.entries(metadata()))form.append(k,String(v));form.append('index',String(i));const response=await fetch(base+'/upload',{method:'POST',credentials:'include',body:form});const p=await response.json();if(!response.ok)throw new Error(p.message);added.push(p.id);setSelected(old=>[...old,p.id].slice(-100));}await refreshPhotos();setMessage(`${added.length} photos uploaded. Review captions before publishing.`);});}}/></label>
      <div className="grid sm:grid-cols-3 gap-3 max-h-96 overflow-auto">{photos.map(p=><div key={p.id} className="border rounded p-2 space-y-2"><label className="flex gap-2"><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,p.id].slice(-100):old.filter(i=>i!==p.id))}/><img src={p.url} alt="" className="w-12 h-12 object-cover"/><span>{p.name}</span></label>{selected.includes(p.id)&&<Textarea aria-label={`Caption for ${p.name}`} placeholder="Editable caption draft" maxLength={1500} value={captions[p.id]||''} onChange={e=>setCaptions({...captions,[p.id]:e.target.value})}/>}</div>)}</div>
      {!photos.length&&<p>Your media library is empty.</p>}<p>{selected.length} selected</p>
      <Button variant="outline" disabled={!selected.length} onClick={()=>void run(async()=>{const r=await call('/prepare',{...metadata(),photoIds:selected});setCaptions(old=>({...old,...Object.fromEntries(r.map((p:Photo,i:number)=>[p.id,old[selected[i]]||'']))}));setSelected(r.map((p:Photo)=>p.id));await refreshPhotos();setMessage('Renamed copies with metadata saved to your library.');})}>Apply filename and EXIF to selected copies</Button>
      <label className="block">Photo category<select aria-label="Photo category" className="border p-2 bg-background" value={category} onChange={e=>setCategory(e.target.value)}>{['ADDITIONAL','EXTERIOR','INTERIOR','PRODUCT','AT_WORK','FOOD_AND_DRINK','MENU','COMMON_AREA','ROOMS','TEAMS','COVER'].map(c=><option key={c}>{c}</option>)}</select></label>
    </fieldset>
    <fieldset disabled={busy} className="border rounded-lg p-4 space-y-3"><legend className="font-semibold">AI drafts and style</legend>
      <label className="block">Instructions<Textarea aria-label="Instructions" value={instructions} onChange={e=>setInstructions(e.target.value)} maxLength={4000}/></label>
      <label className="block">Example descriptions<Textarea value={examples} onChange={e=>setExamples(e.target.value)} maxLength={6000}/></label>
      <div className="flex flex-wrap gap-2"><Button disabled={!selected.length} onClick={()=>void run(()=>draft('photo'))}>Generate caption drafts</Button><Button onClick={()=>void run(()=>draft('post'))}>Generate post draft</Button><Button variant="outline" onClick={()=>void run(async()=>{const r=await call('/learn',{});setStyle(r.summary);setMessage(`AI style draft based on ${r.postCount} past updates. Edit and save to use it.`);})}>Learn from past updates</Button></div>
      <label className="block">Editable style guidance (AI draft until saved)<Textarea aria-label="Style guidance" value={style??data?.style?.summary??''} onChange={e=>setStyle(e.target.value)} maxLength={6000}/></label><Button variant="outline" onClick={()=>void run(async()=>{await call('/style',{summary:style??data?.style?.summary??''},'PATCH');await refetch();setMessage('Style guidance saved.');})}>Save style guidance</Button>
    </fieldset>
    <fieldset disabled={busy} className="border rounded-lg p-4 space-y-3"><legend className="font-semibold">Compose Google update — draft</legend>
      <label>Post type<select aria-label="Post type" className="border p-2 bg-background" value={topicType} onChange={e=>setTopic(e.target.value)}>{['STANDARD','EVENT','OFFER'].map(t=><option key={t}>{t}</option>)}</select></label>
      <Textarea aria-label="Post draft" value={summary} onChange={e=>setSummary(e.target.value)} maxLength={1500} placeholder="Write your update or generate a draft above"/><p>{summary.length}/1500 characters. The first 10 selected photos will be attached.</p>
      {topicType!=='OFFER'&&<div className="flex gap-3"><label>Call to action<select aria-label="Call to action" className="border p-2 bg-background" value={cta} onChange={e=>setCta(e.target.value)}><option value="">None</option>{['BOOK','ORDER','SHOP','LEARN_MORE','SIGN_UP','CALL'].map(t=><option key={t}>{t}</option>)}</select></label><Input aria-label="Action URL" placeholder="https://…" value={url} onChange={e=>setUrl(e.target.value)}/></div>}
      {topicType!=='STANDARD'&&<div className="grid gap-2"><Input aria-label="Event title" placeholder="Event / offer title" value={eventTitle} onChange={e=>setEventTitle(e.target.value)}/><p>Event and offer times use the Google location’s local time.</p><label>Starts<Input type="datetime-local" value={eventStart} onChange={e=>setEventStart(e.target.value)}/></label><label>Ends<Input type="datetime-local" value={eventEnd} onChange={e=>setEventEnd(e.target.value)}/></label>{topicType==='OFFER'&&<Input aria-label="Coupon code" placeholder="Coupon code (optional)" value={coupon} onChange={e=>setCoupon(e.target.value)}/>}</div>}
      <Button variant="outline" disabled={!summary.trim()||postBatch.length>=100} onClick={()=>void run(async()=>{setPostBatch(old=>[...old,currentPost()]);setSummary('');setMessage('Post added to draft batch. Compose the next update or approve the batch.');})}>Add post to draft batch</Button>
      {postBatch.map((p,i)=><div key={i} className="border rounded p-2"><label>Draft {i+1}<Textarea aria-label={`Batch post ${i+1}`} value={p.summary} maxLength={1500} onChange={e=>setPostBatch(old=>old.map((post,n)=>n===i?{...post,summary:e.target.value}:post))}/></label><Button variant="ghost" onClick={()=>setPostBatch(old=>old.filter((_,n)=>n!==i))}>Remove draft {i+1}</Button></div>)}
    </fieldset>
    <fieldset disabled={busy} className="border rounded-lg p-4 space-y-3"><legend className="font-semibold">Schedule and approval</legend>
      <label>First publish (blank = now)<Input aria-label="First publish" type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label>
      <div className="flex gap-3"><label>Items per period<Input aria-label="Items per period" type="number" min={1} max={100} value={count} onChange={e=>setCount(Number(e.target.value))}/></label><label>Cadence<select aria-label="Cadence" className="block border p-2 bg-background" value={cadence} onChange={e=>setCadence(e.target.value)}><option value="day">Per day</option><option value="week">Per week</option><option value="custom">Custom times</option></select></label></div>
      <p>Spacing applies to selected photos or distinct posts in your draft batch. Without a batch, only the current post is scheduled. Blank start publishes the first item now, then spaces the remaining items. Cadence sets elapsed spacing; closed hours can move items to later days.</p>
      {cadence==='custom'&&<Textarea aria-label="Custom times" placeholder="One ISO date/time per item, including timezone" value={custom} onChange={e=>setCustom(e.target.value)}/>}
      <label className="flex gap-2"><input type="checkbox" checked={hours} onChange={e=>setHours(e.target.checked)}/>Business hours only</label>
      {hours&&<div className="space-y-2"><p>Set the business's publishing hours explicitly; these are not inferred from Google.</p><Input aria-label="Timezone" value={zone} onChange={e=>setZone(e.target.value)}/><div className="flex gap-2"><label>Opening hour<Input type="number" value={open} onChange={e=>setOpen(Number(e.target.value))}/></label><label>Closing hour<Input type="number" value={close} onChange={e=>setClose(Number(e.target.value))}/></label></div>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,i)=><label key={d} className="inline-flex gap-1 mr-3"><input type="checkbox" checked={days.includes(i)} onChange={e=>setDays(e.target.checked?[...days,i]:days.filter(n=>n!==i))}/>{d}</label>)}</div>}
      <p>Approving authorizes Google publishing at the scheduled times. AI text remains a draft until you approve it. With a draft batch, approval queues only the posts in that batch. Unsaved drafts are lost on reload.</p><div className="flex gap-2"><Button disabled={!selected.length} onClick={()=>void run(()=>queue('photo'))}>Approve &amp; queue photos</Button><Button disabled={!summary.trim()&&!postBatch.length} onClick={()=>void run(()=>queue('post'))}>Approve &amp; queue post</Button></div>
    </fieldset>
    <section className="space-y-3"><h2 className="font-semibold text-xl">Calendar, queue &amp; history</h2><div className="flex gap-2"><Button variant="outline" onClick={()=>setView('queue')}>Queue</Button><Button variant="outline" onClick={()=>setView('calendar')}>Calendar</Button><Button variant="outline" disabled={busy} onClick={()=>void run(async()=>{await call('/refresh',{});await refetch();setMessage('Google statuses refreshed.');})}>Refresh Google status</Button></div>
      {!jobs.length&&<p>No scheduled content yet.</p>}{(view==='calendar'?ordered:jobs).map((j:any,i:number,all:any[])=><div key={j.id}>
        {view==='calendar'&&(i===0||new Date(all[i-1].due_at).toLocaleDateString()!==new Date(j.due_at).toLocaleDateString())&&<h3 className="font-semibold mt-4">{new Date(j.due_at).toLocaleDateString()}</h3>}
        <article className="border rounded p-3 space-y-2"><p>{j.kind} · {new Date(j.due_at).toLocaleString()} · <strong>{j.status}</strong>{j.google_status&&` · Google: ${j.google_status}`}</p><p>{j.payload.summary||j.payload.description||j.payload.locationAssociation?.category}</p>{j.google_name&&<p className="text-sm break-all">Google resource: {j.google_name}</p>}{j.error&&<p role="alert">{j.error}</p>}
          {['failed','uncertain'].includes(j.status)&&<Button disabled={busy} variant="outline" onClick={()=>{if(j.status==='uncertain'&&!window.confirm('Check Google first. Retrying may duplicate a successful publish. Have you verified it is missing?'))return;void run(async()=>{await call(`/jobs/${j.id}`,{action:'retry',checkedGoogle:j.status==='uncertain'},'PATCH');await refetch();});}}>Retry</Button>}
          {['queued','failed','uncertain'].includes(j.status)&&<Button disabled={busy} variant="outline" onClick={()=>void run(async()=>{await call(`/jobs/${j.id}`,{action:'cancel'},'PATCH');await refetch();})}>Cancel</Button>}
        </article></div>)}</section>
  </div>;
}
