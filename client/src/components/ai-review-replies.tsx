import { useState } from 'react';
import { useQuery,useMutation } from '@tanstack/react-query';
import { apiRequest,queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
export function AiReplySettings({locations}:{locations:any[]}) {
  const [id,setId]=useState('');
  return <section className="border rounded p-4 space-y-3"><h2 className="font-semibold">AI reply settings and drafts queue</h2>
    <label>Business location <select aria-label="AI reply location" value={id} onChange={e=>setId(e.target.value)} className="border rounded p-2 bg-background"><option value="">Select a location</option>{locations.filter(l=>l.gbpLocationName).map(l=><option key={l.id} value={l.id}>{l.businessName}</option>)}</select></label>
    {id&&<LocationReplies key={id} id={Number(id)}/>}</section>;
}
function LocationReplies({id}:{id:number}) {
  const url=`/api/gbp/locations/${id}/ai-replies`,{toast}=useToast();
  const {data,error}=useQuery<any>({queryKey:[url],refetchInterval:30000});
  const [local,setLocal]=useState<any>(null),[preview,setPreview]=useState<any>(null),[edits,setEdits]=useState<Record<number,string>>({});
  const mutate=useMutation({mutationFn:async({method,path,body}:{method:string;path:string;body?:any})=>(await apiRequest(method,path,body)).json(),onSuccess:()=>{void queryClient.invalidateQueries({queryKey:[url]});void queryClient.invalidateQueries({queryKey:['/api/google-profile-reviews']});},onError:(e:Error)=>toast({title:e.message,variant:'destructive'})});
  if(error)return <p role="alert">Could not load AI reply settings.</p>;
  if(!data)return <p>Loading settings…</p>;
  const s=local??data.settings,change=(key:string,value:any)=>{setLocal({...s,[key]:value});setPreview(null);};
  const act=(method:string,path:string,body?:any)=>mutate.mutateAsync({method,path,body});
  return <div className="space-y-3">
    <p className="text-sm">AI replies remain drafts unless you choose auto-publish or publish a draft. Verify every fact. New-review processing follows sync; up to 50 AI replies per account per day.</p>
    <label className="block">AI mode <select aria-label="AI mode" className="border p-2 bg-background" value={s.mode} onChange={e=>change('mode',e.target.value)}><option value="off">Off</option><option value="draft">Draft for approval</option><option value="auto">Auto-publish</option></select></label>
    <label className="block">Review scope <select aria-label="Review scope" className="border p-2 bg-background" value={s.scope} onChange={e=>change('scope',e.target.value)}><option value="future">Future reviews only</option><option value="existing">Also existing unanswered reviews</option></select></label>
    <label className="block"><input type="checkbox" checked={s.allowLowRatingAuto} onChange={e=>change('allowLowRatingAuto',e.target.checked)}/> Explicitly allow auto-publishing replies to 1–2 star reviews</label>
    <p className="text-xs">Low ratings default to drafts for approval, including in auto mode.</p>
    <label className="block">Tone<Input value={s.tone} maxLength={200} onChange={e=>change('tone',e.target.value)}/></label>
    <label className="block">Sign-off<Input value={s.signOff} maxLength={150} onChange={e=>change('signOff',e.target.value)}/></label>
    <label className="block">Maximum characters<Input type="number" min={100} max={2000} value={s.maxLength} onChange={e=>change('maxLength',Number(e.target.value))}/></label>
    <details><summary>Rules per star rating</summary>{[1,2,3,4,5].map(star=><label className="block" key={star}>{star} stars<Textarea maxLength={500} value={s.starRules[String(star)]} onChange={e=>change('starRules',{...s.starRules,[star]:e.target.value})}/></label>)}</details>
    <Button disabled={mutate.isPending} onClick={()=>act('PUT',url,s).then(()=>{setLocal(null);setPreview(null);toast({title:'AI settings saved'});}).catch(()=>{})}>Save AI reply settings</Button>
    {s.scope==='existing'&&<><p className="text-sm">Save settings, then preview and confirm up to 50 existing unanswered reviews. No backfill runs until confirmed.</p><Button variant="outline" disabled={mutate.isPending||!!local} onClick={()=>act('POST',url+'/preview').then(setPreview).catch(()=>{})}>Preview existing reviews</Button></>}
    {preview&&<div className="border p-3 space-y-2"><h3>Backfill preview — {preview.reviews.length} reviews</h3>{preview.reviews.map((r:any)=><p key={r.id}>{r.reviewer_name} · {r.rating} stars · {r.comment||'No text'} — {r.action}</p>)}<Button disabled={mutate.isPending||!preview.reviews.length} onClick={()=>act('POST',url+'/confirm',{token:preview.token}).then(()=>{setPreview(null);toast({title:'Backfill queued'});}).catch(()=>{})}>Confirm backfill</Button></div>}
    <h3 className="font-semibold">Drafts queue</h3>{!data.drafts.length&&<p>No drafts awaiting approval.</p>}
    {data.drafts.map((r:any)=><article className="border rounded p-3 space-y-2" key={r.id}><p>{r.reviewer_name} · {r.rating} stars · {r.ai_status?`AI reply: ${r.ai_status}`:'Saved draft'}</p>
      {(r.ai_error||r.reply_error)&&<p role="alert">{r.ai_error||r.reply_error}</p>}
      <Textarea aria-label={`Draft for ${r.reviewer_name}`} value={edits[r.id]??r.reply_draft??''} onChange={e=>setEdits({...edits,[r.id]:e.target.value})}/>
      <Button disabled={mutate.isPending||!(edits[r.id]??r.reply_draft)?.trim()} onClick={()=>act('PATCH',`/api/google-profile-reviews/${r.id}/reply`,{replyComment:edits[r.id]??r.reply_draft,action:'publish'}).catch(()=>{})}>Approve and publish to Google</Button>
    </article>)}
  </div>;
}
