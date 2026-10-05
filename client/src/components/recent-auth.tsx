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
/** Reusable for Profile Guard and other sensitive actions. apiRequest also retries 403 reauth. */
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
  return <Dialog open={!!challenge} onOpenChange={open=>{if(!open)close();}}><DialogContent onCloseAutoFocus={e=>{const el=returnFocus.current;returnFocus.current=null;if(el?.isConnected){e.preventDefault();el.focus();}}}><DialogHeader><DialogTitle>Verify your identity</DialogTitle><DialogDescription data-testid="text-reauth-reason">{forGbp
      ?"To connect Google Business Profile, confirm it's you first. Google's sign-in opens next."
      :"A quick security check on your own account, so nobody else can act as you. Nothing is sent to anyone else, and your action continues as soon as you confirm."}</DialogDescription></DialogHeader>
    {method && <form className="space-y-4" onSubmit={async e=>{e.preventDefault();if(needsCode)return;setBusy(true);setError('');try{await apiRequest('POST','/api/auth/reauth',{value});challenge?.resolve();setChallenge(null);}catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}}}>
      {method==='email' && apple && <div className="space-y-2">
        {/* Inside the iPhone app: the Apple ID linked to this account confirms it (server/apple-auth.ts, purpose reauth). */}
        <Button type="button" className="w-full bg-black text-white hover:bg-black/90" disabled={busy} onClick={()=>{setBusy(true);setError('');requestAppleReauth().then(()=>{challenge?.resolve();setChallenge(null);}).catch(e=>setError(e.message)).finally(()=>setBusy(false));}} data-testid="button-reauth-apple"><AppleMark className="h-4 w-4"/>Continue with Apple</Button>
        {!google && <p className="text-xs text-muted-foreground text-center">or use an emailed code</p>}
      </div>}
      {method==='email' && google && <div className="space-y-2">
        <Button type="button" className="w-full" disabled={busy} onClick={continueWithGoogle} data-testid="button-reauth-google">Continue with Google</Button>
        <p className="text-xs text-muted-foreground text-center">or use an emailed code</p>
      </div>}
      {method==='email' && <div className="space-y-2">
        <p className="text-sm" data-testid="text-reauth-email-status">{sent?`We emailed a 6-digit code to your own email, ${sentTo||accountEmail||'the one on your account'}. It expires in 10 minutes.`:`We will email a 6-digit code to your own email, ${accountEmail||'the one on your account'}.`}</p>
        <Button type="button" variant="outline" disabled={busy} onClick={sendCode} data-testid="button-reauth-send-code">{sent?'Code sent — resend':'Email a verification code'}</Button>
      </div>}
      <label className="block">{method==='password'?'Current password':method==='totp'?'Authenticator code':'Email code'}<Input autoFocus={!needsCode} disabled={needsCode} aria-label="Verification" type={method==='password'?'password':'text'} inputMode={method==='password'?undefined:'numeric'} autoComplete={method==='password'?'current-password':'one-time-code'} placeholder={needsCode?'Send the code first':undefined} value={value} onChange={e=>setValue(e.target.value)} maxLength={256}/></label>
      <Button disabled={busy||!value||needsCode}>Verify and continue</Button><Button type="button" variant="ghost" onClick={close}>Cancel</Button>
    </form>}{error && <p role="alert">{error}</p>}
  </DialogContent></Dialog>;
}
