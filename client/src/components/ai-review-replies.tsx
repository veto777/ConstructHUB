import { useState } from 'react';
import { useQuery,useMutation } from '@tanstack/react-query';
import { apiRequest,queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { GoogleAiOverview } from '@/components/google';
import { Section, Notice } from '@/components/app-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';

const selectClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

/**
 * AI reply settings + backfill + drafts queue for one GBP location.
 * Mounted from the Google Reviews page (Profile reviews tab). Every control
 * keeps its aria-label — e2e (profile-guard) drives it by label.
 */
export function AiReplySettings({locations}:{locations:any[]}) {
  const [id,setId]=useState('');
  return <Section title="AI review replies" description="Drafts stay drafts unless you publish them. New reviews are processed after each sync.">
    <div className="space-y-4">
      <div className="space-y-1.5 max-w-sm">
        <Label htmlFor="ai-reply-location">Business location</Label>
        <select id="ai-reply-location" aria-label="AI reply location" value={id} onChange={e=>setId(e.target.value)} className={selectClass}>
          <option value="">Select a location</option>
          {locations.filter(l=>l.gbpLocationName).map(l=><option key={l.id} value={l.id}>{l.businessName}</option>)}
        </select>
      </div>
      {id&&<LocationReplies key={id} id={Number(id)}/>}
    </div>
  </Section>;
}

function LocationReplies({id}:{id:number}) {
  const url=`/api/gbp/locations/${id}/ai-replies`,{toast}=useToast();
  const {data,error}=useQuery<any>({queryKey:[url],refetchInterval:30000});
  const [local,setLocal]=useState<any>(null),[preview,setPreview]=useState<any>(null),[edits,setEdits]=useState<Record<number,string>>({});
  const mutate=useMutation({mutationFn:async({method,path,body}:{method:string;path:string;body?:any})=>(await apiRequest(method,path,body)).json(),onSuccess:()=>{void queryClient.invalidateQueries({queryKey:[url]});void queryClient.invalidateQueries({queryKey:['/api/google-profile-reviews']});},onError:(e:Error)=>toast({title:e.message,variant:'destructive'})});
  if(error)return <Notice tone="danger">Could not load AI reply settings.</Notice>;
  if(!data)return <p className="text-sm text-muted-foreground">Loading settings…</p>;
  const s=local??data.settings,change=(key:string,value:any)=>{setLocal({...s,[key]:value});setPreview(null);};
  const act=(method:string,path:string,body?:any)=>mutate.mutateAsync({method,path,body});
  return <div className="space-y-4 border-t pt-4">
    <Notice tone="info">Up to 50 AI replies per account per day. Verify every fact before publishing.</Notice>
    <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
      <div className="space-y-1.5">
        <Label htmlFor="ai-mode">AI mode</Label>
        <select id="ai-mode" aria-label="AI mode" className={selectClass} value={s.mode} onChange={e=>change('mode',e.target.value)}>
          <option value="off">Off</option><option value="draft">Draft for approval</option><option value="auto">Auto-publish</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ai-scope">Review scope</Label>
        <select id="ai-scope" aria-label="Review scope" className={selectClass} value={s.scope} onChange={e=>change('scope',e.target.value)}>
          <option value="future">Future reviews only</option><option value="existing">Also existing unanswered reviews</option>
        </select>
      </div>
      <div className="space-y-1.5"><Label htmlFor="ai-tone">Tone</Label><Input id="ai-tone" value={s.tone} maxLength={200} onChange={e=>change('tone',e.target.value)}/></div>
      <div className="space-y-1.5"><Label htmlFor="ai-signoff">Sign-off</Label><Input id="ai-signoff" value={s.signOff} maxLength={150} onChange={e=>change('signOff',e.target.value)}/></div>
      <div className="space-y-1.5 sm:col-span-2 sm:max-w-xs"><Label htmlFor="ai-maxlen">Maximum characters</Label><Input id="ai-maxlen" type="number" min={100} max={2000} value={s.maxLength} onChange={e=>change('maxLength',Number(e.target.value))}/></div>
    </div>
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5" checked={s.allowLowRatingAuto} onChange={e=>change('allowLowRatingAuto',e.target.checked)}/>
      <span>Explicitly allow auto-publishing replies to 1–2 star reviews <span className="block text-xs text-muted-foreground">Low ratings default to drafts for approval, including in auto mode.</span></span>
    </label>
    <Collapsible>
      <CollapsibleTrigger className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ChevronDown className="h-4 w-4" /> Rules per star rating
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 grid gap-3 sm:grid-cols-2 max-w-3xl">
        {[1,2,3,4,5].map(star=><div key={star} className="space-y-1"><Label>{star} stars</Label><Textarea maxLength={500} value={s.starRules[String(star)]} onChange={e=>change('starRules',{...s.starRules,[star]:e.target.value})}/></div>)}
      </CollapsibleContent>
    </Collapsible>
    <div className="flex flex-wrap gap-2">
      <Button disabled={mutate.isPending} onClick={()=>act('PUT',url,s).then(()=>{setLocal(null);setPreview(null);toast({title:'AI settings saved'});}).catch(()=>{})}>Save AI reply settings</Button>
      {s.scope==='existing'&&<Button variant="outline" disabled={mutate.isPending||!!local} onClick={()=>act('POST',url+'/preview').then(setPreview).catch(()=>{})}>Preview existing reviews</Button>}
    </div>
    {s.scope==='existing'&&!preview&&<p className="text-xs text-muted-foreground">Save settings, then preview and confirm up to 50 existing unanswered reviews. No backfill runs until confirmed.</p>}
    {preview&&<div className="rounded-xl border p-4 space-y-3">
      <p className="text-sm font-medium">Backfill preview — {preview.reviews.length} reviews</p>
      {preview.reviews.map((r:any)=><p key={r.id} className="text-sm text-muted-foreground">{r.reviewer_name} · {r.rating} stars · {r.comment||'No text'} — {r.action}</p>)}
      <Button variant="outline" disabled={mutate.isPending||!preview.reviews.length} onClick={()=>act('POST',url+'/confirm',{token:preview.token}).then(()=>{setPreview(null);toast({title:'Backfill queued'});}).catch(()=>{})}>Confirm backfill</Button>
    </div>}
    <GoogleAiOverview label="AI reply suggestions" testId="ai-reply-drafts" footnote="Every draft stays in ConstructHUB until you approve it. Verify facts before publishing.">
      {!data.drafts.length&&<p className="text-sm text-muted-foreground">No drafts awaiting approval.</p>}
      <div className="space-y-3 text-sm">
      {data.drafts.map((r:any)=><article className="rounded-xl border p-4 space-y-3" key={r.id}>
        <p className="text-sm">{r.reviewer_name} · {r.rating} stars · {r.ai_status?`AI reply: ${r.ai_status}`:'Saved draft'}</p>
        {(r.ai_error||r.reply_error)&&<p role="alert" className="text-sm text-destructive">{r.ai_error||r.reply_error}</p>}
        <Textarea aria-label={`Draft for ${r.reviewer_name}`} value={edits[r.id]??r.reply_draft??''} onChange={e=>setEdits({...edits,[r.id]:e.target.value})}/>
        <Button disabled={mutate.isPending||!(edits[r.id]??r.reply_draft)?.trim()} onClick={()=>act('PATCH',`/api/google-profile-reviews/${r.id}/reply`,{replyComment:edits[r.id]??r.reply_draft,action:'publish'}).catch(()=>{})}>Approve and publish to Google</Button>
      </article>)}
      </div>
    </GoogleAiOverview>
  </div>;
}
