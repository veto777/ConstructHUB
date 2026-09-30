import { BusinessSelector, MappingEditor, Pager, refreshSocial } from "@/components/social-agency";
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  autoSchema,
  publicMediaUrl,
  socialLimits,
  mixTypes,
  type AutoSettings,
  type Destination,
} from "@shared/social";
import { CalendarDays, Send, Sparkles, Link2, BookOpen } from "lucide-react";
import { GuidesContent } from "@/pages/guides";
import { useUrlParam } from "@/hooks/use-url-param";
const selectClass = "rounded-md border bg-background px-3 py-2 text-sm w-full";
// Mirrors the server's curated messages so a bad field is named before saving.
const settingsMessages: Record<string, string> = {
  cadence: "Posts per period must be a whole number from 1 to 7.",
  blackoutStart: "Blackout start must be an hour from 0 to 23.",
  blackoutEnd: "Blackout end must be an hour from 0 to 23.",
  aiDailyBudget: "Daily AI budget must be a whole number from 0 to 20.",
  timezone: "Enter a valid timezone, for example America/New_York.",
  mix: "Choose at least one content type.",
  instructions: "Business instructions must be 4,000 characters or fewer.",
  examples: "Writing examples must be 4,000 characters or fewer.",
  destinations: "Choose valid accounts and pages (up to 20).",
};
function settingsProblem(settings: unknown): string {
  const r = autoSchema.safeParse(settings);
  if (r.success) return "";
  const issue = r.error.issues[0];
  return (
    settingsMessages[String(issue.path[0] ?? "")] ??
    (issue.message || "Check the auto mode settings.")
  );
}
// Number inputs keep "" while cleared instead of turning into 0.
const numberInput = (value: string) =>
  value === "" ? "" : Number(value);
type Account = {
  id: string;
  platform: Destination["platform"];
  name: string;
  pages?: { id: string; name: string }[];
  boards?: { id: string; name: string }[];
};
export default function SocialMediaPage() {
  const [business,setBusiness]=useUrlParam("business");
  const [tab,setTab]=useUrlParam("tab");
  const valid=business==='all'||(!!business&&/^[1-9]\d*$/.test(business)&&Number.isSafeInteger(Number(business)));
  return <div className="h-full overflow-y-auto"><div className="max-w-5xl mx-auto p-4 space-y-4">
    <h1 className="text-3xl font-bold">Social Media</h1>
    <BusinessSelector value={business} onChange={v=>setBusiness(v,true)}/>
    {business && valid ? <SocialWorkbench key={business} businessId={business==='all'?null:Number(business)} all={business==='all'}/> : <>
      <p>Choose a business above. Add or import businesses in <a className="underline" href="/locations">Locations</a>.</p>
      {/* The guides don't depend on a business: /guides lands here. */}
      {tab === "guides" ? <GuidesContent /> : <a className="text-primary underline" href="/social-media?tab=guides" onClick={(e) => { e.preventDefault(); setTab("guides"); }}>How it works</a>}
    </>}
  </div></div>;
}
function SocialWorkbench({businessId,all}:{businessId:number|null;all:boolean}) {
  const { toast } = useToast();
  const [selectedPosts,setSelectedPosts]=useState<string[]>([]);
  const [bulkErrors,setBulkErrors]=useState<string[]>([]);
  const [offset,setOffset]=useState(0),[postSearch,setPostSearch]=useState(''),[postState,setPostState]=useState(''),[postPlatform,setPostPlatform]=useState('');
  const [calendarDate,setCalendarDate]=useState(''),[connectionScope,setConnectionScope]=useState('business');
  const [sourceOffset,setSourceOffset]=useState(0),[sourceSearch,setSourceSearch]=useState('');
  const [mediaOffset,setMediaOffset]=useState(0),[mediaSearch,setMediaSearch]=useState('');
  const scope=businessId?`businessId=${businessId}`:'';
  const qs=new URLSearchParams({offset:String(offset),search:postSearch,state:postState,platform:postPlatform,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,...(businessId?{businessId:String(businessId)}:{}),...(calendarDate?{day:calendarDate}:{})});
  const {data,error,isLoading}=useQuery<any>({queryKey:['/api/social',businessId,all,qs.toString()],refetchInterval:15000,queryFn:async()=>(await apiRequest('GET',`/api/social${all?'/calendar':''}?${qs}`)).json()});
  const {data:media=[]}=useQuery<any[]>({queryKey:['/api/social','media',businessId,mediaOffset,mediaSearch],enabled:!all,queryFn:async()=>(await apiRequest('GET',`/api/social/media?${scope}&offset=${mediaOffset}&search=${encodeURIComponent(mediaSearch)}`)).json()});
  const {data:sources=[]}=useQuery<any[]>({queryKey:['/api/social','sources',businessId,sourceOffset,sourceSearch],enabled:!all,queryFn:async()=>(await apiRequest('GET',`/api/social/sources?${scope}&offset=${sourceOffset}&search=${encodeURIComponent(sourceSearch)}`)).json()});
  const [tabParam, setTabParam] = useUrlParam("tab");
  const tab = all ? "queue" : tabParam || "compose", setTab = (v: string) => setTabParam(v === "compose" ? null : v);
  const [apiKey, setKey] = useState(""),
    [text, setText] = useState(""),
    [tweaks, setTweaks] = useState<Record<string, string>>({});
  const [destinations, setDestinations] = useState<Destination[]>([]),
    [mediaText, setMediaText] = useState(""),
    [schedule, setSchedule] = useState("");
  const [settings, setSettings] = useState<AutoSettings | null>(null),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [sourceKind, setSourceKind] = useState("offers"),
    [sourceText, setSourceText] = useState("");
  const [uploading, setUploading] = useState(false);
  useEffect(()=>{setDestinations(data?.defaults||[]);},[JSON.stringify(data?.defaults)]);
  const mutation = useMutation({
    mutationFn: async ({
      path,
      body,
      method = "POST",
    }: {
      path: string;
      body?: unknown;
      method?: string;
      /** Toast title on success; false when the caller reports the outcome itself. */
      success?: string | false;
    }) => {
      const isConnection=['/connect','/disconnect'].includes(path);
      const activeScope=isConnection&&connectionScope==='agency'?'':scope;
      const url=path.includes('?')?`/api/social${path}`:`/api/social${path}?${activeScope}`;
      return (await apiRequest(method,url,body)).json();
    },
    onSuccess: (result, vars) => {
      let title = vars.success ?? "Saved";
      if(result.results){
        const failed=result.results.filter((r:any)=>!r.ok);
        setBulkErrors(failed.map((r:any)=>r.error));setSelectedPosts([]);
        if(failed.length)title=`${result.results.length-failed.length} of ${result.results.length} posts updated`;
      }
      refreshSocial();
      if (title !== false) toast({ title });
    },
    onError: (e: Error) =>
      toast({
        title: "Social Media",
        description: apiErrorMessage(e),
        variant: "destructive",
      }),
  });
  const accounts: Account[] = data?.accounts || [];
  const current: AutoSettings =
    settings || data?.settings || autoSchema.parse({});
  const update = (key: keyof AutoSettings, value: unknown) =>
    setSettings({ ...current, [key]: value });
  const urls = () =>
    mediaText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  const badMedia = urls().filter((u) => !publicMediaUrl.safeParse(u).success);
  const mediaProblem = badMedia.length
    ? `Media URLs must be public HTTPS links. Fix or remove: ${badMedia[0]}`
    : "";
  // Why Post now / Save draft are disabled, in the order the user can fix it.
  const postBlocker = !data?.connected
    ? "Connect Blotato above to post."
    : !destinations.length
      ? "Choose at least one account above."
      : !text.trim()
        ? "Write the post text."
        : uploading
          ? "Wait for the upload to finish."
          : mediaProblem;
  function choose(a: Account, checked: boolean) {
    setDestinations((ds) =>
      checked
        ? [
            ...ds,
            {
              accountId: a.id,
              platform: a.platform,
              privacy: "private",
              tiktokPublic: false,
              isBrandedContent: false,
              isYourBrand: false,
            },
          ]
        : ds.filter((d) => d.accountId !== a.id),
    );
  }
  function patchDestination(id: string, patch: Partial<Destination>) {
    setDestinations((ds) =>
      ds.map((d) => (d.accountId === id ? { ...d, ...patch } : d)),
    );
  }
  async function submit(draft: boolean) {
    try {
      await mutation.mutateAsync({
        path: "/posts",
        success: draft
          ? "Draft saved"
          : schedule
            ? "Post scheduled"
            : "Post queued for publishing",
        body: {
          requestId,
          text,
          tweaks,
          destinations,
          mediaUrls: urls(),
          ...(schedule
            ? { scheduledTime: new Date(schedule).toISOString() }
            : {}),
          draft,
        },
      });
      setRequestId(crypto.randomUUID());
      setText("");
      setTweaks({});
      setTab("queue");
    } catch {
      /* toast from mutation */
    }
  }
  async function upload(file: File) {
    if (file.size > 100 * 1024 * 1024) {
      toast({ title: "Choose a file under 100 MB", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const r = await mutation.mutateAsync({
        path: "/uploads",
        body: { filename: file.name },
        success: false,
      });
      const put = await fetch(r.presignedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!put.ok) throw new Error("Media upload failed");
      setMediaText((v) => [v, r.publicUrl].filter(Boolean).join("\n"));
      toast({ title: "Media uploaded and attached" });
    } catch {
      toast({ title: "Upload failed. Try again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }
  // Nothing loaded (e.g. a stale or foreign ?business=): say why instead of an empty workbench.
  if (error && !data) return (
    <div role="alert" className="rounded-md border border-destructive/40 p-4 space-y-1" data-testid="alert-social-load">
      <p className="font-medium">Could not load Social Media: {apiErrorMessage(error)}</p>
      <p className="text-sm text-muted-foreground">Choose another business above, or refresh the page.</p>
    </div>
  );
  return (
    <div className="h-full overflow-y-auto">

      <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6">
        <header className="flex justify-between gap-4 items-start">
          <div>
            <h2 className="text-2xl font-bold">{all?"All-clients calendar":data?.business?.business_name||"Business workspace"}</h2>
            <p className="text-muted-foreground mt-2">
              Compose once. Review, schedule, and follow every destination.
            </p>
          </div>
          <a className="text-primary underline" href="/social-media?tab=guides" onClick={(e) => { e.preventDefault(); setTab("guides"); }}>
            How it works
          </a>
        </header>
        {isLoading && <p>Loading Social Media…</p>}
        {error && (
          <p role="alert">Could not refresh Social Media: {apiErrorMessage(error)}</p>
        )}
        {!all && <Card>
          <CardHeader>
            <CardTitle className="flex gap-2 items-center">
              <Link2 className="w-5 h-5" />
              Blotato connection{" "}
              <Badge variant={data?.connected ? "default" : "secondary"}>
                {data?.connected ? "Connected" : "Not connected"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p>
              Blotato is a separate subscription you buy from Blotato. Creating
              an API key activates your paid Blotato subscription; ConstructHUB
              does not bill for it.{" "}
              <a
                href="https://www.blotato.com"
                target="_blank"
                rel="noreferrer"
                className="underline text-primary"
              >
                Visit Blotato
              </a>
              .
            </p>
            <p>Effective connection: {data?.connectionScope==='business'?'Business key':'Agency key (fallback)'}</p>
            <label>Key to manage <select aria-label="Connection key scope" className={selectClass} value={connectionScope} onChange={e=>setConnectionScope(e.target.value)}><option value="business">This business only (optional)</option><option value="agency">Agency shared key</option></select></label>
            <div className="flex flex-wrap gap-2">
              <Input
                aria-label="Blotato API key"
                type="password"
                autoComplete="off"
                className="max-w-sm"
                placeholder="Paste your Blotato API key"
                value={apiKey}
                onChange={(e) => setKey(e.target.value)}
              />
              <Button
                disabled={mutation.isPending || apiKey.length < 8}
                onClick={async () => {
                  try {
                    await mutation.mutateAsync({
                      path: "/connect",
                      body: { apiKey },
                      success: "Blotato key verified",
                    });
                    setKey("");
                  } catch {
                    setKey("");
                  }
                }}
              >
                {data?.connected ? "Verify / replace key" : "Connect Blotato"}
              </Button>
              {(connectionScope==='agency'?data?.agencyConnected:data?.businessConnected??data?.connected) && (
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ path: "/disconnect", success: "Blotato disconnected" })}
                >
                  Disconnect
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Your key is encrypted and never displayed again. Disconnect stops
              local queued posts and auto mode. Posts already accepted by
              Blotato must be managed there.
            </p>
            {data?.connected && (
              <p className="text-sm">
                {accounts.length
                  ? accounts.map((a) => `${a.name} (${a.platform})`).join(" · ")
                  : "No connected social accounts. Connect them in Blotato, then verify your key again."}
              </p>
            )}
          </CardContent>
        </Card>}
        {!all && businessId && <MappingEditor businessId={businessId} defaults={data?.defaults||[]}/>}
        {!all && <nav className="flex flex-wrap gap-2" aria-label="Social Media views">
          {[
            ["compose", "Compose", Send],
            ["queue", "Calendar & queue", CalendarDays],
            ["auto", "Auto mode", Sparkles],
            ["guides", "Guides", BookOpen],
          ].map(([key, label, Icon]: any) => (
            <Button
              key={key}
              variant={tab === key ? "default" : "outline"}
              onClick={() => setTab(key)}
            >
              <Icon className="w-4 h-4 mr-2" />
              {label}
            </Button>
          ))}
        </nav>}
        {tab === "compose" && (
          <Card>
            <CardHeader>
              <CardTitle>Compose a post</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <fieldset className="space-y-3">
                <legend className="font-medium mb-2">
                  Choose accounts and pages
                </legend>
                {!data?.connected ? (
                  <p className="text-sm text-muted-foreground">
                    Connect Blotato above to choose accounts.
                  </p>
                ) : (
                  !accounts.length && (
                    <p className="text-sm text-muted-foreground">
                      No social accounts are available for this business.
                      Connect accounts in Blotato, then add them under Map
                      accounts and pages to this business above.
                    </p>
                  )
                )}
                {accounts.map((a) => {
                  const d = destinations.find((d) => d.accountId === a.id);
                  return (
                    <div key={a.id} className="border rounded-md p-3 space-y-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!d}
                          onChange={(e) => choose(a, e.target.checked)}
                        />
                        {a.name} · {a.platform}
                      </label>
                      {d && (
                        <div className="space-y-2">
                          {["facebook", "linkedin", "pinterest"].includes(
                            a.platform,
                          ) && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={mutation.isPending}
                                onClick={() =>
                                  mutation.mutate({
                                    path: `/accounts/${a.id}/pages`,
                                    success: a.platform === "pinterest" ? "Boards refreshed" : "Pages refreshed",
                                  })
                                }
                              >
                                Refresh{" "}
                                {a.platform === "pinterest"
                                  ? "boards"
                                  : "pages"}{" "}
                                for {a.name}
                              </Button>
                              <select
                                aria-label={`${a.name} page or board`}
                                className={selectClass}
                                value={d.pageId || d.boardId || ""}
                                onChange={(e) =>
                                  patchDestination(
                                    a.id,
                                    a.platform === "pinterest"
                                      ? { boardId: e.target.value || undefined }
                                      : { pageId: e.target.value || undefined },
                                  )
                                }
                              >
                                <option value="">
                                  {a.platform === "linkedin"
                                    ? "Personal profile"
                                    : "Choose a destination"}
                                </option>
                                {(a.boards || a.pages || []).map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                            </>
                          )}
                          {["youtube", "pinterest"].includes(a.platform) && (
                            <Input
                              aria-label={`${a.platform} title`}
                              placeholder="Title"
                              value={d.title || ""}
                              onChange={(e) =>
                                patchDestination(a.id, {
                                  title: e.target.value,
                                })
                              }
                            />
                          )}
                          {a.platform === "youtube" && (
                            <label>
                              Video privacy
                              <select
                                className={selectClass}
                                value={d.privacy}
                                onChange={(e) =>
                                  patchDestination(a.id, {
                                    privacy: e.target.value as any,
                                  })
                                }
                              >
                                <option>private</option>
                                <option>public</option>
                                <option>unlisted</option>
                              </select>
                            </label>
                          )}
                          {a.platform === "tiktok" && (
                            <div className="flex flex-wrap gap-4">
                              {[
                                [
                                  "tiktokPublic",
                                  "Publish publicly (otherwise private)",
                                ],
                                ["isBrandedContent", "Paid brand partnership"],
                                ["isYourBrand", "Promotes my business"],
                              ].map(([key, label]) => (
                                <label key={key}>
                                  <input
                                    type="checkbox"
                                    checked={!!(d as any)[key]}
                                    onChange={(e) =>
                                      patchDestination(a.id, {
                                        [key]: e.target.checked,
                                      })
                                    }
                                  />{" "}
                                  {label}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </fieldset>
              <label className="block space-y-2">
                <span className="font-medium">Post text</span>
                <Textarea
                  aria-label="Post text"
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Share an update from your business…"
                />
              </label>
              {[...new Set(destinations.map((d) => d.platform))].map((p) => (
                <label className="block space-y-1" key={p}>
                  <span>
                    {p} text tweak · {[...(tweaks[p] ?? text)].length}/
                    {socialLimits[p]} characters
                  </span>
                  <Textarea
                    aria-label={`${p} text tweak`}
                    value={tweaks[p] ?? text}
                    onChange={(e) =>
                      setTweaks({ ...tweaks, [p]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label className="block space-y-2">
                <span>Public media URLs (one per line, up to 10)</span>
                <Textarea
                  aria-label="Public media URLs"
                  value={mediaText}
                  onChange={(e) => setMediaText(e.target.value)}
                  placeholder="https://your-public-media-host/photo.jpg"
                />
              </label>
              <Input aria-label="Search business photos" value={mediaSearch} onChange={e=>{setMediaSearch(e.target.value);setMediaOffset(0);}} placeholder="Search synced business photos"/>
              <Pager offset={mediaOffset} setOffset={setMediaOffset} more={media.length===25} label="photos"/>
              <div className="grid md:grid-cols-2 gap-3">
                <label>
                  Media Library
                  <select
                    aria-label="Media Library"
                    className={selectClass}
                    value=""
                    onChange={(e) => {
                      if (e.target.value)
                        setMediaText((v) =>
                          [v, e.target.value].filter(Boolean).join("\n"),
                        );
                    }}
                  >
                    <option value="">Attach a saved photo</option>
                    {media.map((p) => (
                      <option key={p.id} value={p.url}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Upload through Blotato (up to 100 MB)
                  <Input
                    aria-label="Upload media"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                    disabled={uploading || !data?.connected}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                Only attach media you have permission to publish. Instagram,
                TikTok, Pinterest and YouTube require media. YouTube requires
                video; provider format requirements still apply.
              </p>
              <label className="block space-y-2">
                Schedule time (your browser’s local time; blank means now)
                <Input
                  aria-label="Schedule time"
                  type="datetime-local"
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2 items-center">
                <Button
                  disabled={!!postBlocker || mutation.isPending}
                  onClick={() => void submit(false)}
                >
                  {schedule ? "Schedule post" : "Post now"}
                </Button>
                <Button
                  variant="outline"
                  disabled={!!postBlocker || mutation.isPending}
                  onClick={() => void submit(true)}
                >
                  Save draft
                </Button>
                {postBlocker && (
                  <span className="text-sm text-muted-foreground break-all">
                    {postBlocker}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}
        {tab === "queue" && (
          <Card>
            <CardHeader>
              <CardTitle>Calendar, approval queue & history</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Times are shown in your browser’s timezone. Status refreshes
                every 15 seconds. Published means Blotato confirmed publication;
                queued means it is still in ConstructHUB.
              </p>
              <label className="block max-w-xs">
                Calendar day (blank shows all)
                <Input
                  aria-label="Calendar day"
                  type="date"
                  value={calendarDate}
                  onChange={(e) => {setCalendarDate(e.target.value);setOffset(0);}}
                />
              </label>
              {!data?.posts?.length && (
                <p>
                  No posts yet. Compose your first update or generate an AI
                  draft.
                </p>
              )}
              <Input aria-label="Search calendar" placeholder="Search post text or business" value={postSearch} onChange={e=>{setPostSearch(e.target.value);setOffset(0);}}/>
              <div className="flex flex-wrap gap-2"><select aria-label="Post status filter" className={selectClass} value={postState} onChange={e=>{setPostState(e.target.value);setOffset(0);}}>{['','draft','queued','submitting','submitted','published','failed','uncertain','cancelled'].map(s=><option key={s} value={s}>{s||'All statuses'}</option>)}</select>
              <select aria-label="Post platform filter" className={selectClass} value={postPlatform} onChange={e=>{setPostPlatform(e.target.value);setOffset(0);}}>{['',...Object.keys(socialLimits)].map(p=><option key={p} value={p}>{p||'All platforms'}</option>)}</select></div>
              <p>{data?.total||0} matching posts</p>
              <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>setSelectedPosts((data?.posts||[]).filter((p:any)=>['draft','queued'].includes(p.state)).map((p:any)=>p.id))}>Select this page of posts</Button>
              {['approve','cancel'].map(action=><Button key={action} disabled={!selectedPosts.length||selectedPosts.length>100||mutation.isPending} onClick={()=>mutation.mutate({path:'/posts/bulk-action',body:{ids:selectedPosts,action},success:action==='approve'?'Selected drafts approved':'Selected posts cancelled'})}>{action==='approve'?'Approve selected drafts':'Cancel selected posts'}</Button>)}</div>
              <p className="text-xs">{selectedPosts.length} selected (up to 100 per action). Approve publishes each saved draft as written.</p>
              {bulkErrors.map((error,i)=><p role="alert" key={i}>{error}</p>)}
              <Pager offset={offset} setOffset={setOffset} more={offset+25<(data?.total||0)} label="posts"/>
              {(data?.posts || [])
                .map((p: any) => (
                  <PostRow
                    key={p.id}
                    post={p}
                    selected={selectedPosts.includes(p.id)}
                    onSelect={checked=>setSelectedPosts(old=>checked?[...old,p.id]:old.filter(id=>id!==p.id))}
                    pending={mutation.isPending}
                    action={(action, text) =>
                      mutation.mutate({
                        path: `/posts/${p.id}/action${p.business_id?`?businessId=${p.business_id}`:"?"}`,
                        success: action === "approve" ? "Draft approved and queued" : "Post cancelled",
                        body: { action, ...(text ? { text } : {}) },
                      })
                    }
                  />
                ))}
            </CardContent>
          </Card>
        )}
        {tab === "auto" && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Auto mode</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p>
                  AI output is labelled as a draft until approved. Fully
                  automatic mode is your explicit permission to publish
                  generated posts to the saved destinations.
                </p>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={current.enabled}
                    onChange={(e) => update("enabled", e.target.checked)}
                  />
                  Enable auto mode
                </label>
                <label className="block">
                  Publishing mode
                  <select
                    aria-label="Publishing mode"
                    className={selectClass}
                    value={current.mode}
                    onChange={(e) => update("mode", e.target.value)}
                  >
                    <option value="approval">
                      Approval queue (recommended)
                    </option>
                    <option value="automatic">
                      Fully automatic — publish without review
                    </option>
                  </select>
                </label>
                <p className="text-sm">
                  Saved destinations:{" "}
                  {current.destinations.length
                    ? current.destinations
                        .map(
                          (d) =>
                            `${accounts.find((a) => a.id === d.accountId)?.name || d.accountId} (${d.platform}${d.pageId ? `, page ${d.pageId}` : ""})`,
                        )
                        .join(" · ")
                    : "None"}
                </p>
                <Button
                  variant="outline"
                  disabled={!destinations.length}
                  onClick={() => update("destinations", destinations)}
                >
                  Use accounts selected in Compose
                </Button>
                <div className="grid sm:grid-cols-2 gap-4">
                  <label>
                    Posts per period
                    <Input
                      aria-label="Posts per period"
                      type="number"
                      min={1}
                      max={7}
                      value={current.cadence}
                      onChange={(e) =>
                        update("cadence", numberInput(e.target.value))
                      }
                    />
                  </label>
                  <label>
                    Cadence period
                    <select
                      aria-label="Cadence period"
                      className={selectClass}
                      value={current.period}
                      onChange={(e) => update("period", e.target.value)}
                    >
                      <option value="week">Week</option>
                      <option value="day">Day</option>
                    </select>
                  </label>
                </div>
                <fieldset>
                  <legend className="mb-2">Content mix (rotates evenly)</legend>
                  <div className="flex flex-wrap gap-4">
                    {mixTypes.map((k) => (
                      <label key={k}>
                        <input
                          type="checkbox"
                          checked={current.mix.includes(k)}
                          onChange={(e) =>
                            update(
                              "mix",
                              e.target.checked
                                ? [...current.mix, k]
                                : current.mix.filter((v) => v !== k),
                            )
                          }
                        />{" "}
                        {
                          {
                            project: "Project photos",
                            tips: "Tips",
                            reviews: "Review highlights",
                            offers: "Offers",
                            gbp: "Recent GBP updates",
                          }[k]
                        }
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="block">
                  Business instructions
                  <Textarea
                    aria-label="Business instructions"
                    value={current.instructions}
                    onChange={(e) => update("instructions", e.target.value)}
                    placeholder="Tone, topics and factual business context"
                  />
                </label>
                <label className="block">
                  Writing examples
                  <Textarea
                    aria-label="Writing examples"
                    value={current.examples}
                    onChange={(e) => update("examples", e.target.value)}
                  />
                </label>
                <div className="grid sm:grid-cols-3 gap-3">
                  <label>
                    Timezone
                    <Input
                      aria-label="Timezone"
                      value={current.timezone}
                      onChange={(e) => update("timezone", e.target.value)}
                    />
                  </label>
                  <label>
                    Blackout starts (hour 0–23)
                    <Input
                      aria-label="Blackout starts"
                      type="number"
                      min={0}
                      max={23}
                      value={current.blackoutStart}
                      onChange={(e) =>
                        update("blackoutStart", numberInput(e.target.value))
                      }
                    />
                  </label>
                  <label>
                    Blackout ends (hour 0–23)
                    <Input
                      aria-label="Blackout ends"
                      type="number"
                      min={0}
                      max={23}
                      value={current.blackoutEnd}
                      onChange={(e) =>
                        update("blackoutEnd", numberInput(e.target.value))
                      }
                    />
                  </label>
                </div>
                <label className="block">
                  Daily AI generation budget (0–20 requests, resets at UTC
                  midnight)
                  <Input
                    aria-label="Daily AI budget"
                    type="number"
                    min={0}
                    max={20}
                    value={current.aiDailyBudget}
                    onChange={(e) =>
                      update("aiDailyBudget", numberInput(e.target.value))
                    }
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  Cadence is evenly spaced, with no catch-up burst after
                  downtime. Equal blackout hours disable blackout. Missing media
                  or sources pause that generation with an error. Manual posts
                  follow their chosen time.
                </p>
                {data?.lastError && (
                  <p role="alert" className="text-destructive">
                    {data.lastError}
                  </p>
                )}
                {/* Only a connected, enabled auto mode has a real next run. */}
                {data?.connected && data?.settings?.enabled && data?.nextAt && (
                  <p>
                    Next generation:{" "}
                    {Date.parse(data.nextAt) <= Date.now()
                      ? "on the next scheduler run"
                      : new Date(data.nextAt).toLocaleString()}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={mutation.isPending}
                    onClick={async () => {
                      const problem = settingsProblem(current);
                      if (problem) {
                        toast({
                          title: "Check auto settings",
                          description: problem,
                          variant: "destructive",
                        });
                        return;
                      }
                      try {
                        await mutation.mutateAsync({
                          path: "/settings",
                          method: "PUT",
                          body: current,
                          success: "Auto settings saved",
                        });
                        setSettings(null);
                      } catch {}
                    }}
                  >
                    Save auto settings
                  </Button>
                  <Button
                    variant="outline"
                    disabled={mutation.isPending || !data?.connected}
                    onClick={() => mutation.mutate({ path: "/generate", body: {requestId:crypto.randomUUID()}, success: "Draft generation queued" })}
                  >
                    Generate draft from saved settings
                  </Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Content sources</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p>
                  Project photos come from Media Library; review highlights use
                  synced Google reviews. Enter real offer terms or copy a
                  recent, already-published GBP update here. Sync recent GBP
                  updates imports live standard updates from linked Google
                  locations (up to 20). Auto mode refreshes them before
                  generating a GBP cross-post.
                </p>
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ path: "/sources/sync-gbp", success: "GBP refresh queued" })}
                >
                  Sync recent GBP updates
                </Button>
                <select
                  aria-label="Source kind"
                  className={selectClass}
                  value={sourceKind}
                  onChange={(e) => setSourceKind(e.target.value)}
                >
                  <option value="offers">Offer</option>
                  <option value="gbp">Published GBP update</option>
                </select>
                <Textarea
                  aria-label="Source text"
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder="Factual source text; offers should include conditions and expiry"
                />
                <div className="text-sm space-y-1">
                  {urls().length ? (
                    <>
                      <p>Media attached to this source (from Compose):</p>
                      <ul className="list-disc pl-5 break-all">
                        {urls().map((u, i) => (
                          <li
                            key={i}
                            className={
                              publicMediaUrl.safeParse(u).success
                                ? ""
                                : "text-destructive"
                            }
                          >
                            {u}
                          </li>
                        ))}
                      </ul>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setMediaText("")}
                      >
                        Clear attached media (also clears Compose)
                      </Button>
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      No media attached. Media URLs entered in Compose are
                      attached to the next source you add.
                    </p>
                  )}
                  {mediaProblem && (
                    <p role="alert" className="text-destructive break-all">
                      {mediaProblem}
                    </p>
                  )}
                </div>
                <Button
                  disabled={
                    mutation.isPending || !sourceText.trim() || !!mediaProblem
                  }
                  onClick={async () => {
                    try {
                      await mutation.mutateAsync({
                        path: "/sources",
                        body: {
                          kind: sourceKind,
                          text: sourceText,
                          mediaUrls: urls(),
                        },
                        success: "Source added",
                      });
                      setSourceText("");
                    } catch {}
                  }}
                >
                  Add content source
                </Button>
                <p className="text-xs text-muted-foreground">
                  Sources expire from generation after 30 days; remove offers
                  when they end.
                </p>
                <p className="text-sm">GBP refresh: {data?.sourcesSync?.sync_requested?'Queued':data?.sourcesSync?.synced_at?new Date(data.sourcesSync.synced_at).toLocaleString():'Not yet requested'}{data?.sourcesSync?.sync_error?` — ${data.sourcesSync.sync_error}`:''}</p>
                <Input aria-label="Search content sources" value={sourceSearch} onChange={e=>{setSourceSearch(e.target.value);setSourceOffset(0);}} placeholder="Search sources"/>
                <Pager offset={sourceOffset} setOffset={setSourceOffset} more={sources.length===25} label="sources"/>
                {sources.map((s) => (
                  <div
                    key={s.id}
                    className="border rounded p-3 flex justify-between gap-3"
                  >
                    <p>
                      {s.kind}: {s.text}
                    </p>
                    <Button
                      variant="ghost"
                      disabled={mutation.isPending}
                      onClick={() =>
                        mutation.mutate({
                          path: `/sources/${s.id}`,
                          success: "Source removed",
                          method: "DELETE",
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
        {tab === "guides" && <GuidesContent />}
      </div>
    </div>
  );
}
function PostRow({
  post: p,
  selected,
  onSelect,
  pending,
  action,
}: {
  post: any;
  selected: boolean;
  onSelect: (checked:boolean)=>void;
  pending: boolean;
  action: (a: string, text?: string) => void;
}) {
  const [text, setText] = useState(p.payload.post.content.text);
  return (
    <article className="border rounded-lg p-4 space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        {["draft","queued"].includes(p.state)&&<input type="checkbox" aria-label={`Select post ${p.id}`} checked={selected} onChange={e=>onSelect(e.target.checked)}/>}
        <Badge>{p.state}</Badge>
        <strong>{p.business_name||"Legacy / unassigned"}</strong>
        <strong>{p.payload.post.content.platform}</strong>
        <span>
          {new Date(
            p.scheduled_at || p.created_at || p.due_at,
          ).toLocaleString()}
        </span>
        {p.ai_generated && (
          <Badge variant="outline">
            AI-generated{p.state === "draft" ? " draft" : ""}
          </Badge>
        )}
      </div>
      {p.state === "draft" ? (
        <Textarea
          aria-label="Edit draft"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <p className="whitespace-pre-wrap">{p.payload.post.content.text}</p>
      )}
      {p.source && (
        <p className="text-xs text-muted-foreground">Source: {p.source}</p>
      )}
      {p.error && (
        <p role="alert" className="text-destructive">
          {p.error}
        </p>
      )}
      <div className="flex flex-wrap gap-3 items-center">
        {p.state === "draft" && (
          <Button
            disabled={pending || !text.trim()}
            onClick={() => action("approve", text)}
          >
            Approve & queue
          </Button>
        )}
        {["draft", "queued"].includes(p.state) && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => action("cancel")}
          >
            Cancel
          </Button>
        )}
        {p.public_url && (
          <a
            className="underline text-primary"
            href={p.public_url}
            target="_blank"
            rel="noreferrer"
          >
            View published post
          </a>
        )}
        {["submitted", "published", "failed", "uncertain"].includes(
          p.state,
        ) && (
          <>
            <a
              className="underline text-primary"
              href={
                p.state === "failed"
                  ? "https://my.blotato.com/failed"
                  : "https://my.blotato.com"
              }
              target="_blank"
              rel="noreferrer"
            >
              Open Blotato status
            </a>
            {p.submission_id && (
              <span className="text-xs break-all">
                Submission: {p.submission_id}
              </span>
            )}
          </>
        )}
      </div>
    </article>
  );
}
