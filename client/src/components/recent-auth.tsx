import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, apiErrorMessage } from '@/lib/queryClient';
import { AppleMark, appleBridge, requestAppleReauth } from '@/components/apple-sign-in';
let pending: Promise<void> | null = null;
/** The person closed the verification dialog themselves (Escape, Cancel, outside click). */
export class VerificationCancelled extends Error {}
export function requestRecentAuth(): Promise<void> {
  if (!pending) pending = new Promise<void>((resolve,reject) => {
    window.dispatchEvent(new CustomEvent('reauth-required',{detail:{resolve,reject}}));
  }).finally(()=>{pending=null;});
  return pending;
}
/** Reusable for Profile Watch and other sensitive actions. apiRequest also retries 403 reauth. */
export function useRecentAuth() { return { verify:requestRecentAuth, request:apiRequest }; }
/** Set while a Google connect waits for verification: a Google step-up leaves the page, so it returns here to restart the connect. */
let gbpConnectPending=false;
/** Google connect preflight: apiRequest asks for verification on the 403 reauth answer, then we go to Google's consent page. */
export function startGbpConnect(onError: (message: string) => void) {
  gbpConnectPending=true;
  // A cancel the person chose needs no error toast (it would also swallow their next Escape).
  return apiRequest('GET','/api/gbp/connect?format=json').then(r=>r.json()).then(d=>window.location.assign(d.url)).catch(e=>{if(!(e instanceof VerificationCancelled))onError(apiErrorMessage(e));}).finally(()=>{gbpConnectPending=false;});
}
/** The server's Google step-up (/api/auth/google?reauth=1) returns to `next`, adding reauth=google-failed when Google couldn't confirm the account. */
function continueWithGoogle() {
  const next=gbpConnectPending?'/locations?gbp=reauth':window.location.pathname+window.location.search;
  window.location.assign(`/api/auth/google?reauth=1&next=${encodeURIComponent(next)}`);
}
export function RecentAuthModal() {
  const { toast } = useToast();
  const [challenge,setChallenge]=useState<{resolve:()=>void;reject:(e:Error)=>void}|null>(null);
  const [method,setMethod]=useState(''),[value,setValue]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[sent,setSent]=useState(false),[sentTo,setSentTo]=useState('');
  const [google,setGoogle]=useState(false),[apple,setApple]=useState(false),[accountEmail,setAccountEmail]=useState(''),[forGbp,setForGbp]=useState(false);
  // Opened from code, not a trigger: remember what had focus so closing returns it there (e.g. into an open dialog).
  const returnFocus=useRef<HTMLElement|null>(null);
  // Back from a Google step-up that failed: say so once and drop the flag from the URL.
  useEffect(()=>{
    const url=new URL(window.location.href);
    if(url.searchParams.get('reauth')!=='google-failed')return;
    url.searchParams.delete('reauth');
    window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
    toast({title:"Google couldn't confirm it's you",description:'Use the emailed code instead.',variant:'destructive'});
  },[toast]);
  useEffect(()=>{
    const listen=(event:Event)=>{
      returnFocus.current=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body?document.activeElement:null;
      setChallenge((event as CustomEvent).detail);setValue('');setError('');setSent(false);setSentTo('');setMethod('');setGoogle(false);setApple(false);setAccountEmail('');setForGbp(gbpConnectPending);
      apiRequest('GET','/api/auth/reauth').then(r=>r.json()).then(d=>{setMethod(d.method);setGoogle(d.google===true);setApple(d.apple===true&&!!appleBridge());setAccountEmail(typeof d.email==='string'?d.email:'');}).catch(e=>setError(apiErrorMessage(e)));
    };
    // All existing Google connect anchors share the same preflight and retry behavior.
    const connect=(event:MouseEvent)=>{
      const anchor=(event.target as Element).closest?.('a[href="/api/gbp/connect"]');
      if(!anchor)return;
      event.preventDefault();
      void startGbpConnect(message=>toast({title:'Google connection',description:message,variant:'destructive'}));
    };
    window.addEventListener('reauth-required',listen);document.addEventListener('click',connect,true);
    return ()=>{window.removeEventListener('reauth-required',listen);document.removeEventListener('click',connect,true);};
  },[toast]);
  const close=()=>{challenge?.reject(new VerificationCancelled('Verification cancelled'));setChallenge(null);};
  // Email verification has no code until one is sent, so the code field waits for it.
  const needsCode=method==='email'&&!sent;
  const sendCode=async()=>{
    setBusy(true);setError('');
    try{const r=await apiRequest('POST','/api/auth/reauth/email');const d=await r.json().catch(()=>({}));setSentTo(typeof d?.sentTo==='string'?d.sentTo:'');setSent(true);setValue('');}
    catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}
  };
  // One screen, one job (owner, 2026-10-13: "make it sleeker"): the quickest way to confirm first, the emailed code
  // as a single row underneath, and the code box only once a code exists.
  const stepUp = method==='email' && (google || apple);
  const inputLabel = method==='password'?'Current password':method==='totp'?'Authenticator code':'Email code';
  return <Dialog open={!!challenge} onOpenChange={open=>{if(!open)close();}}>
    <DialogContent className="sm:max-w-md gap-5 p-6" onCloseAutoFocus={e=>{const el=returnFocus.current;returnFocus.current=null;if(el?.isConnected){e.preventDefault();el.focus();}}}>
      <DialogHeader className="space-y-1.5 text-left">
        <DialogTitle className="text-lg">Verify your identity</DialogTitle>
        <DialogDescription className="text-sm leading-5" data-testid="text-reauth-reason">{forGbp
          ?"Confirm it's you, then Google's sign-in opens."
          :"A quick check that it's you. Your action continues right after."}</DialogDescription>
      </DialogHeader>
      {method && <form className="space-y-4" onSubmit={async e=>{e.preventDefault();if(needsCode)return;setBusy(true);setError('');try{await apiRequest('POST','/api/auth/reauth',{value});challenge?.resolve();setChallenge(null);}catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}}}>
        {stepUp && <div className="space-y-3">
          {apple && (
            /* Inside the iPhone app: the Apple ID linked to this account confirms it (server/apple-auth.ts, purpose reauth). */
            <Button type="button" className="h-11 w-full rounded-full bg-black text-white hover:bg-black/90" disabled={busy} onClick={()=>{setBusy(true);setError('');requestAppleReauth().then(()=>{challenge?.resolve();setChallenge(null);}).catch(e=>setError(e.message)).finally(()=>setBusy(false));}} data-testid="button-reauth-apple"><AppleMark className="h-4 w-4"/>Continue with Apple</Button>
          )}
          {google && <Button type="button" className="h-11 w-full rounded-full" disabled={busy} onClick={continueWithGoogle} data-testid="button-reauth-google">Continue with Google</Button>}
          <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true"><span className="h-px flex-1 bg-border"/>or use an emailed code<span className="h-px flex-1 bg-border"/></div>
        </div>}
        {method==='email' && <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground" data-testid="text-reauth-email-status">{sent
            ?<>Code sent to <span className="text-foreground">{sentTo||accountEmail||'your email'}</span> · expires in 10 minutes.</>
            :<>We'll email a 6-digit code to <span className="text-foreground">{accountEmail||'your email'}</span>.</>}</p>
          <Button type="button" variant={sent?'ghost':'outline'} size="sm" className="rounded-full" disabled={busy} onClick={sendCode} data-testid="button-reauth-send-code">{sent?'Resend code':'Email a verification code'}</Button>
        </div>}
        {!needsCode && <label className="block space-y-1.5 text-sm font-medium">{inputLabel}
          <Input autoFocus aria-label="Verification" type={method==='password'?'password':'text'} inputMode={method==='password'?undefined:'numeric'} autoComplete={method==='password'?'current-password':'one-time-code'}
            className={method==='password'?'h-11':'h-12 text-center text-xl tracking-[0.45em] font-medium'} value={value} onChange={e=>setValue(e.target.value)} maxLength={method==='password'?256:method==='totp'?8:6} placeholder={method==='password'?undefined:'••••••'}/>
        </label>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center justify-between gap-3 pt-1">
          <Button type="button" variant="ghost" className="rounded-full px-3" onClick={close}>Cancel</Button>
          {!needsCode && <Button className="h-11 min-w-[11rem] rounded-full" disabled={busy||!value}>Verify and continue</Button>}
        </div>
      </form>}
      {!method && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent></Dialog>;
}
