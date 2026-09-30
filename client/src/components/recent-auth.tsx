import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, apiErrorMessage } from '@/lib/queryClient';
let pending: Promise<void> | null = null;
export function requestRecentAuth(): Promise<void> {
  if (!pending) pending = new Promise<void>((resolve,reject) => {
    window.dispatchEvent(new CustomEvent('reauth-required',{detail:{resolve,reject}}));
  }).finally(()=>{pending=null;});
  return pending;
}
/** Reusable for Profile Guard and other sensitive actions. apiRequest also retries 403 reauth. */
export function useRecentAuth() { return { verify:requestRecentAuth, request:apiRequest }; }
/** Google connect preflight: apiRequest asks for verification on the 403 reauth answer, then we go to Google's consent page. */
export function startGbpConnect(onError: (message: string) => void) {
  return apiRequest('GET','/api/gbp/connect?format=json').then(r=>r.json()).then(d=>window.location.assign(d.url)).catch(e=>onError(apiErrorMessage(e)));
}
export function RecentAuthModal() {
  const { toast } = useToast();
  const [challenge,setChallenge]=useState<{resolve:()=>void;reject:(e:Error)=>void}|null>(null);
  const [method,setMethod]=useState(''),[value,setValue]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[sent,setSent]=useState(false),[sentTo,setSentTo]=useState('');
  useEffect(()=>{
    const listen=(event:Event)=>{
      setChallenge((event as CustomEvent).detail);setValue('');setError('');setSent(false);setSentTo('');setMethod('');
      apiRequest('GET','/api/auth/reauth').then(r=>r.json()).then(d=>setMethod(d.method)).catch(e=>setError(apiErrorMessage(e)));
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
  const close=()=>{challenge?.reject(new Error('Verification cancelled'));setChallenge(null);};
  // Email verification has no code until one is sent, so the code field waits for it.
  const needsCode=method==='email'&&!sent;
  const sendCode=async()=>{
    setBusy(true);setError('');
    try{const r=await apiRequest('POST','/api/auth/reauth/email');const d=await r.json().catch(()=>({}));setSentTo(typeof d?.sentTo==='string'?d.sentTo:'');setSent(true);setValue('');}
    catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}
  };
  return <Dialog open={!!challenge} onOpenChange={open=>{if(!open)close();}}><DialogContent><DialogHeader><DialogTitle>Verify your identity</DialogTitle><DialogDescription>Verification lasts 12 hours for sensitive account changes.</DialogDescription></DialogHeader>
    {method && <form className="space-y-4" onSubmit={async e=>{e.preventDefault();if(needsCode)return;setBusy(true);setError('');try{await apiRequest('POST','/api/auth/reauth',{value});challenge?.resolve();setChallenge(null);}catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}}}>
      {method==='email' && <div className="space-y-2">
        <p className="text-sm" data-testid="text-reauth-email-status">{sent?`We emailed a 6-digit code to ${sentTo||'your account email'}. It expires in 10 minutes.`:'We will email a 6-digit code to your account email address.'}</p>
        <Button type="button" variant="outline" disabled={busy} onClick={sendCode} data-testid="button-reauth-send-code">{sent?'Code sent — resend':'Email a verification code'}</Button>
      </div>}
      <label className="block">{method==='password'?'Current password':method==='totp'?'Authenticator code':'Email code'}<Input autoFocus={!needsCode} disabled={needsCode} aria-label="Verification" type={method==='password'?'password':'text'} inputMode={method==='password'?undefined:'numeric'} autoComplete={method==='password'?'current-password':'one-time-code'} placeholder={needsCode?'Send the code first':undefined} value={value} onChange={e=>setValue(e.target.value)} maxLength={256}/></label>
      <Button disabled={busy||!value||needsCode}>Verify and continue</Button><Button type="button" variant="ghost" onClick={close}>Cancel</Button>
    </form>}{error && <p role="alert">{error}</p>}
  </DialogContent></Dialog>;
}
