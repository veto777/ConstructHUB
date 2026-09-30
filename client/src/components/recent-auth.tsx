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
export function RecentAuthModal() {
  const { toast } = useToast();
  const [challenge,setChallenge]=useState<{resolve:()=>void;reject:(e:Error)=>void}|null>(null);
  const [method,setMethod]=useState(''),[value,setValue]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[sent,setSent]=useState(false);
  useEffect(()=>{
    const listen=(event:Event)=>{
      setChallenge((event as CustomEvent).detail);setValue('');setError('');setSent(false);setMethod('');
      apiRequest('GET','/api/auth/reauth').then(r=>r.json()).then(d=>setMethod(d.method)).catch(e=>setError(apiErrorMessage(e)));
    };
    // All existing Google connect anchors share the same preflight and retry behavior.
    const connect=(event:MouseEvent)=>{
      const anchor=(event.target as Element).closest?.('a[href="/api/gbp/connect"]');
      if(!anchor)return;
      event.preventDefault();
      apiRequest('GET','/api/gbp/connect?format=json').then(r=>r.json()).then(d=>window.location.assign(d.url)).catch(e=>toast({title:'Google connection',description:apiErrorMessage(e),variant:'destructive'}));
    };
    window.addEventListener('reauth-required',listen);document.addEventListener('click',connect,true);
    return ()=>{window.removeEventListener('reauth-required',listen);document.removeEventListener('click',connect,true);};
  },[toast]);
  const close=()=>{challenge?.reject(new Error('Verification cancelled'));setChallenge(null);};
  return <Dialog open={!!challenge} onOpenChange={open=>{if(!open)close();}}><DialogContent><DialogHeader><DialogTitle>Verify your identity</DialogTitle><DialogDescription>Verification lasts 12 hours for sensitive account changes.</DialogDescription></DialogHeader>
    {method && <form className="space-y-4" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await apiRequest('POST','/api/auth/reauth',{value});challenge?.resolve();setChallenge(null);}catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}}}>
      {method==='email' && <Button type="button" variant="outline" disabled={busy||sent} onClick={async()=>{setBusy(true);try{await apiRequest('POST','/api/auth/reauth/email');setSent(true);}catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}}}>{sent?'Code sent':'Email a verification code'}</Button>}
      <label className="block">{method==='password'?'Current password':method==='totp'?'Authenticator code':'Email code'}<Input autoFocus aria-label="Verification" type={method==='password'?'password':'text'} autoComplete={method==='password'?'current-password':'one-time-code'} value={value} onChange={e=>setValue(e.target.value)} maxLength={256}/></label>
      <Button disabled={busy||!value}>Verify and continue</Button><Button type="button" variant="ghost" onClick={close}>Cancel</Button>
    </form>}{error && <p role="alert">{error}</p>}
  </DialogContent></Dialog>;
}
