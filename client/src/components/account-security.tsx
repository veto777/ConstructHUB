import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, apiErrorMessage, queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Bell } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function NotificationBell() {
  const {data,error,isLoading}=useQuery<any>({queryKey:['/api/notifications'],refetchInterval:30000});
  const read=useMutation({mutationFn:async(ids?:number[])=>apiRequest('POST','/api/notifications/read',ids?{ids}:{}),onSuccess:()=>{queryClient.invalidateQueries({queryKey:['/api/notifications']});}});
  return <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm" aria-label={`Notifications (${data?.unread??0} unread)`}><Bell className="w-4 h-4"/>{!!data?.unread && <span>{data.unread}</span>}</Button></PopoverTrigger><PopoverContent className="w-96 max-h-[70vh] overflow-auto" align="end"><h2 className="font-semibold">Notifications</h2><Button variant="ghost" disabled={read.isPending} onClick={()=>read.mutate(undefined)}>Mark all read</Button>
    {read.isError && <p role="alert">{apiErrorMessage(read.error)}</p>}
    {isLoading && <p>Loading notifications…</p>}{error && <p role="alert">Unable to load notifications.</p>}
    {data?.notifications?.length===0 && <p>No notifications yet.</p>}
    {data?.notifications.map((n:any)=><div key={n.id} className={`border-t py-3 ${!n.read_at?'font-medium':''}`}><a href={n.link || '/settings?tab=security'} onClick={()=>read.mutate([Number(n.id)])}>{n.title}</a><p className="text-xs whitespace-pre-line">{n.body}</p><time className="text-xs">{new Date(n.created_at).toLocaleString()}</time>{!n.read_at && <Button variant="ghost" size="sm" onClick={()=>read.mutate([Number(n.id)])}>Mark read</Button>}</div>)}
  </PopoverContent></Popover>;
}
export function NotificationPreferences() {
  const {data,error}=useQuery<any>({queryKey:['/api/notification-prefs']});
  const save=useMutation({mutationFn:async(p:any)=>apiRequest('PUT','/api/notification-prefs',{prefs:[p]}),onSuccess:()=>{queryClient.invalidateQueries({queryKey:['/api/notification-prefs']});}});
  return <Card><CardHeader><CardTitle>Notifications</CardTitle></CardHeader><CardContent className="space-y-4"><p>Security emails are always on. Changes save immediately.</p>{(error||save.error) && <p role="alert">{apiErrorMessage(error||save.error)}</p>}{data?.prefs.map((p:any)=><div className="border-t py-3 flex flex-wrap gap-4 items-center" key={p.kind}><span className="flex-1">{p.label}</span><label className="flex gap-2 items-center">In app <Switch aria-label={`${p.label}: In app`} checked={p.inApp} disabled={save.isPending} onCheckedChange={v=>save.mutate({...p,inApp:v})}/></label><label className="flex gap-2 items-center">{p.security?'Email (always on)':'Email'} <Switch aria-label={`${p.label}: Email`} checked={p.security||p.email} disabled={p.security||save.isPending} onCheckedChange={v=>save.mutate({...p,email:v})}/></label></div>)}</CardContent></Card>;
}
export function SecurityActivity() {
  const [filter,setFilter]=useState(''),[since,setSince]=useState(''),[message,setMessage]=useState('');
  const {data,error}=useQuery<any>({queryKey:['/api/account-activity']});
  const devices=useQuery<any>({queryKey:['/api/auth/devices']});
  const accounts=useQuery<any>({queryKey:['/api/gbp/status']});
  const subject=new URLSearchParams(window.location.search).get('google');
  const revoke=useMutation({mutationFn:async(id:string)=>apiRequest('DELETE',`/api/auth/devices/${id}`),onSuccess:()=>{queryClient.invalidateQueries({queryKey:['/api/auth/devices']});}});
  const secure=useMutation({mutationFn:async()=>{
    if(subject) await apiRequest('POST','/api/gbp/disconnect',{subject});
    queryClient.invalidateQueries({queryKey:['/api/gbp/status']});
    setMessage('Account disconnected. Reset your ConstructHUB password below. If you sign in only with Google, also secure your Google account and change its password.');
  }});
  const account=accounts.data?.accounts?.find((a:any)=>a.subject===subject);
  return <div className="space-y-6">
    {subject && <Card><CardHeader><CardTitle>Wasn't you?</CardTitle></CardHeader><CardContent className="space-y-3"><p>Disconnect {account?.email || 'this Google account'} and reset your password to secure your account.</p><Button disabled={secure.isPending} onClick={()=>secure.mutate()}>Disconnect account and secure sign-in</Button>{secure.error && <p role="alert">{apiErrorMessage(secure.error)}</p>}{message && <p role="status">{message}</p>}<p><a className="underline" href="/auth?mode=forgot-password">Reset password</a></p></CardContent></Card>}
    <Card><CardHeader><CardTitle>Remembered devices</CardTitle></CardHeader><CardContent>{devices.error && <p role="alert">{apiErrorMessage(devices.error)}</p>}{revoke.error && <p role="alert">{apiErrorMessage(revoke.error)}</p>}{devices.isLoading && <p>Loading devices…</p>}{devices.data?.devices.length===0 && <p>No remembered devices.</p>}{devices.data?.devices.map((d:any)=><div key={d.id} className="border-t py-3"><p className="break-all">{d.device||'Unknown device'}</p><p>Expires {new Date(d.expires_at).toLocaleString()}</p><Button variant="outline" disabled={revoke.isPending} onClick={()=>revoke.mutate(d.id)}>Revoke device</Button></div>)}</CardContent></Card>
    <Card><CardHeader><CardTitle>Account activity</CardTitle></CardHeader><CardContent className="space-y-3"><label>Activity type <select aria-label="Activity type" value={filter} onChange={e=>setFilter(e.target.value)} className="border p-2 rounded bg-background"><option value="">All activity</option>{[...new Set<string>(data?.activity.map((a:any)=>a.kind)||[])].map(k=><option key={k}>{k}</option>)}</select></label> <label>Since <input aria-label="Since" type="date" value={since} onChange={e=>setSince(e.target.value)} className="border p-2 rounded bg-background"/></label>{error && <p role="alert">{apiErrorMessage(error)}</p>}
    <p className="text-sm text-muted-foreground">Most recent 200 events. IP and device describe the request, and may reflect a proxy.</p>
    {data?.activity.filter((a:any)=>(!filter||a.kind===filter)&&(!since||a.created_at>=since)).map((a:any)=><div className="border-t py-3 break-words" key={a.id}><strong>{a.kind}</strong><p>{new Date(a.created_at).toLocaleString()}</p><p>IP: {a.ip||'Unavailable'} · Device: {a.user_agent||'Unavailable'}</p>{a.detail?.email && <p>{a.detail.email}</p>}</div>)}
    {data?.activity.length===0 && <p>No activity recorded yet.</p>}</CardContent></Card>
  </div>;
}
