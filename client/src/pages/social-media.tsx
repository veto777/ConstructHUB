import { BusinessSelector, MappingEditor, Pager, refreshSocial } from "@/components/social-agency";
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AppPage, Notice, Toolbar } from "@/components/app-ui";
import { GoogleSectionHeader, GoogleList, GoogleListRow, GooglePill } from "@/components/google";
import { ExternalLink, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  autoSchema,
  publicMediaUrl,
  socialLimits,
  mixTypes,
  type AutoSettings,
  type Destination,
} from "@shared/social";
import { GuidesContent } from "@/pages/guides";
import { useUrlParam } from "@/hooks/use-url-param";
import { SocialYoutube } from "@/components/social-youtube";

// Google's rounded field shape for the native selects (the surface supplies the hairline colour).
const selectClass = "h-10 w-full rounded-full border border-input bg-background px-4 text-sm";

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
  const [business, setBusiness] = useUrlParam("business");
  const [tab, setTab] = useUrlParam("tab");
  const valid = business === "all" || (!!business && /^[1-9]\d*$/.test(business) && Number.isSafeInteger(Number(business)));
  return (
    <AppPage>
      {/* Google's format (owner, 2026-10-07): quiet titles with a hairline, pills, hairline rows. */}
      <GoogleSectionHeader
        as="h1"
        title="Social Media"
        description="Compose once, then review, schedule and track every account."
        flush
        actions={<GooglePill onClick={() => setTab("guides")} label="How it works" />}
      />
      <BusinessSelector value={business} onChange={v => setBusiness(v, true)} />
      {business && valid ? <SocialWorkbench key={business} businessId={business === "all" ? null : Number(business)} all={business === "all"} /> : <>
        {/* The guides don't depend on a business: /guides lands here. */}
        {tab === "guides" && <GuidesContent />}
        {!business && <p className="text-sm g-text-2">Choose a business above. Add or import businesses in <a className="g-link" href="/locations">Locations</a>.</p>}
      </>}
      {/* The YouTube channel belongs to the account, not to one business: it is shown with the business's other
          connection (inside the workbench) and here whenever no single business is open. */}
      {!(business && valid && business !== "all") && <SocialYoutube />}
    </AppPage>
  );
}

function SocialWorkbench({ businessId, all }: { businessId: number | null; all: boolean }) {
  const { toast } = useToast();
  const [selectedPosts, setSelectedPosts] = useState<string[]>([]);
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [offset, setOffset] = useState(0), [postSearch, setPostSearch] = useState(""), [postState, setPostState] = useState(""), [postPlatform, setPostPlatform] = useState("");
  const [calendarDate, setCalendarDate] = useState(""), [connectionScope, setConnectionScope] = useState("business");
  const [sourceOffset, setSourceOffset] = useState(0), [sourceSearch, setSourceSearch] = useState("");
  const [mediaOffset, setMediaOffset] = useState(0), [mediaSearch, setMediaSearch] = useState("");
  const scope = businessId ? `businessId=${businessId}` : "";
  const qs = new URLSearchParams({ offset: String(offset), search: postSearch, state: postState, platform: postPlatform, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(businessId ? { businessId: String(businessId) } : {}), ...(calendarDate ? { day: calendarDate } : {}) });
  const { data, error, isLoading } = useQuery<any>({ queryKey: ["/api/social", businessId, all, qs.toString()], refetchInterval: 15000, queryFn: async () => (await apiRequest("GET", `/api/social${all ? "/calendar" : ""}?${qs}`)).json() });
  const { data: media = [] } = useQuery<any[]>({ queryKey: ["/api/social", "media", businessId, mediaOffset, mediaSearch], enabled: !all, queryFn: async () => (await apiRequest("GET", `/api/social/media?${scope}&offset=${mediaOffset}&search=${encodeURIComponent(mediaSearch)}`)).json() });
  const { data: sources = [] } = useQuery<any[]>({ queryKey: ["/api/social", "sources", businessId, sourceOffset, sourceSearch], enabled: !all, queryFn: async () => (await apiRequest("GET", `/api/social/sources?${scope}&offset=${sourceOffset}&search=${encodeURIComponent(sourceSearch)}`)).json() });
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
  useEffect(() => { setDestinations(data?.defaults || []); }, [JSON.stringify(data?.defaults)]);
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
      const isConnection = ["/connect", "/disconnect"].includes(path);
      const activeScope = isConnection && connectionScope === "agency" ? "" : scope;
      const url = path.includes("?") ? `/api/social${path}` : `/api/social${path}?${activeScope}`;
      return (await apiRequest(method, url, body)).json();
    },
    onSuccess: (result, vars) => {
      let title = vars.success ?? "Saved";
      if (result.results) {
        const failed = result.results.filter((r: any) => !r.ok);
        setBulkErrors(failed.map((r: any) => r.error)); setSelectedPosts([]);
        if (failed.length) title = `${result.results.length - failed.length} of ${result.results.length} posts updated`;
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
    <Notice tone="danger" testId="alert-social-load">
      Could not load Social Media: {apiErrorMessage(error)}. Choose another business above, or refresh the page.
    </Notice>
  );
  return (
    <div className="space-y-5 sm:space-y-6">
      {!all && (
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="g-header__title">{data?.business?.business_name || "Business workspace"}</h2>
          {isLoading && <span className="text-sm g-text-2">Loading…</span>}
          {error && <span role="alert" className="text-sm g-closed">Could not refresh Social Media: {apiErrorMessage(error)}</span>}
        </div>
      )}

      {!all && (
        <section>
          <GoogleSectionHeader
            title="Blotato connection"
            description="Blotato is a separate subscription you buy from Blotato. Creating a key there activates your paid Blotato subscription; ConstructHUB does not bill for it."
            actions={<span className={data?.connected ? "g-open text-sm" : "g-text-2 text-sm"}>{data?.connected ? "Connected" : "Not connected"}</span>}
          />
          <div className="space-y-4">
            <p className="text-sm">
              <a href="https://www.blotato.com" target="_blank" rel="noreferrer" className="g-link">Visit Blotato</a> to create an API key.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 sm:max-w-2xl">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Key to manage</span>
                <select aria-label="Connection key scope" className={selectClass} value={connectionScope} onChange={e => setConnectionScope(e.target.value)}>
                  <option value="business">This business only (optional)</option>
                  <option value="agency">Agency shared key</option>
                </select>
              </label>
              <p className="self-end text-sm text-muted-foreground">Effective connection: {data?.connectionScope === "business" ? "Business key" : "Agency key (fallback)"}</p>
            </div>
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
              <GooglePill
                variant={data?.connected ? "outline" : "solid"}
                label={data?.connected ? "Verify / replace key" : "Connect Blotato"}
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
              />
              {(connectionScope === "agency" ? data?.agencyConnected : data?.businessConnected ?? data?.connected) && (
                <GooglePill
                  variant="quiet"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ path: "/disconnect", success: "Blotato disconnected" })}
                  label="Disconnect"
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Your key is encrypted and never displayed again. Disconnect stops local queued posts and auto mode. Posts already accepted by Blotato must be managed there.
            </p>
            {data?.connected && (
              <p className="text-sm">
                {accounts.length
                  ? accounts.map((a) => `${a.name} (${a.platform})`).join(" · ")
                  : "No connected social accounts. Connect them in Blotato, then verify your key again."}
              </p>
            )}
          </div>
        </section>
      )}

      {!all && <SocialYoutube businessId={businessId} />}

      {!all && businessId && <MappingEditor businessId={businessId} defaults={data?.defaults || []} />}

      {!all && (
        <nav className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" aria-label="Social Media views">
          {[
            ["compose", "Compose"],
            ["queue", "Calendar & queue"],
            ["auto", "Auto mode"],
            ["guides", "Guides"],
          ].map(([key, label]) => (
            <GooglePill
              key={key}
              selected={tab === key}
              ariaPressed={tab === key}
              onClick={() => setTab(key)}
              label={label}
            />
          ))}
        </nav>
      )}

      {tab === "compose" && (
        <section>
          <GoogleSectionHeader title="Compose" description={all ? undefined : "Write once — every chosen account gets its own version."} />
          <div className="space-y-5">
            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-medium">Post to</legend>
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
                  <div key={a.id} className="space-y-3 rounded-lg border p-3">
                    <label className="flex items-center gap-2 text-sm">
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
                            <GooglePill
                              size="sm"
                              disabled={mutation.isPending}
                              onClick={() =>
                                mutation.mutate({
                                  path: `/accounts/${a.id}/pages`,
                                  success: a.platform === "pinterest" ? "Boards refreshed" : "Pages refreshed",
                                })
                              }
                              label={`Refresh ${a.platform === "pinterest" ? "boards" : "pages"} for ${a.name}`}
                            />
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
                          <label className="block space-y-1.5">
                            <span className="text-sm font-medium">Video privacy</span>
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
                              <label key={key} className="flex items-center gap-1.5 text-sm">
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
              <span className="text-sm font-medium">Post text</span>
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
                <span className="text-sm">
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
              <span className="text-sm font-medium">Public media URLs (one per line, up to 10)</span>
              <Textarea
                aria-label="Public media URLs"
                value={mediaText}
                onChange={(e) => setMediaText(e.target.value)}
                placeholder="https://your-public-media-host/photo.jpg"
              />
            </label>
            <div className="g-search sm:max-w-md" role="search">
              <Search aria-hidden="true" />
              <input type="search" aria-label="Search business photos" value={mediaSearch} onChange={e => { setMediaSearch(e.target.value); setMediaOffset(0); }} placeholder="Search synced business photos" />
            </div>
            <Pager offset={mediaOffset} setOffset={setMediaOffset} more={media.length === 25} label="photos" />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Media library</span>
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
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Upload through Blotato (up to 100 MB)</span>
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
              <span className="text-sm font-medium">Schedule time (your browser&rsquo;s local time; blank means now)</span>
              <Input
                aria-label="Schedule time"
                type="datetime-local"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <GooglePill
                variant="solid"
                disabled={!!postBlocker || mutation.isPending}
                onClick={() => void submit(false)}
                label={schedule ? "Schedule post" : "Post now"}
              />
              <GooglePill
                disabled={!!postBlocker || mutation.isPending}
                onClick={() => void submit(true)}
                label="Save draft"
              />
              {postBlocker && (
                <span className="text-sm g-text-2 break-all">
                  {postBlocker}
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {tab === "queue" && (
        <section>
          <GoogleSectionHeader
            title={all ? "All-clients calendar" : "Calendar & queue"}
            count={data?.total || 0}
            description="Times are shown in your browser&rsquo;s timezone. Status refreshes every 15 seconds — published means Blotato confirmed publication; queued means it is still in ConstructHUB."
          />
          <div className="space-y-4">
            <Toolbar
              search={{ value: postSearch, onChange: v => { setPostSearch(v); setOffset(0); }, placeholder: "Search calendar" }}
              filters={<>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Calendar day (blank shows all)</span>
                  <Input
                    aria-label="Calendar day"
                    type="date"
                    value={calendarDate}
                    onChange={(e) => { setCalendarDate(e.target.value); setOffset(0); }}
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Status</span>
                  <select aria-label="Post status filter" className={selectClass} value={postState} onChange={e => { setPostState(e.target.value); setOffset(0); }}>{["", "draft", "queued", "submitting", "submitted", "published", "failed", "uncertain", "cancelled"].map(s => <option key={s} value={s}>{s || "All statuses"}</option>)}</select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Platform</span>
                  <select aria-label="Post platform filter" className={selectClass} value={postPlatform} onChange={e => { setPostPlatform(e.target.value); setOffset(0); }}>{["", ...Object.keys(socialLimits)].map(p => <option key={p} value={p}>{p || "All platforms"}</option>)}</select>
                </label>
              </>}
            />
            {!data?.posts?.length && (
              <p className="text-sm text-muted-foreground">
                No posts yet. Compose your first update or generate an AI draft.
              </p>
            )}
            <p className="text-sm text-muted-foreground">{data?.total || 0} matching posts</p>
            <div className="flex flex-wrap gap-2">
              <GooglePill size="sm" onClick={() => setSelectedPosts((data?.posts || []).filter((p: any) => ["draft", "queued"].includes(p.state)).map((p: any) => p.id))} label="Select this page of posts" />
              {["approve", "cancel"].map(action => <GooglePill key={action} size="sm" disabled={!selectedPosts.length || selectedPosts.length > 100 || mutation.isPending} onClick={() => mutation.mutate({ path: "/posts/bulk-action", body: { ids: selectedPosts, action }, success: action === "approve" ? "Selected drafts approved" : "Selected posts cancelled" })} label={action === "approve" ? "Approve selected drafts" : "Cancel selected posts"} />)}
            </div>
            <p className="text-xs text-muted-foreground">{selectedPosts.length} selected (up to 100 per action). Approve publishes each saved draft as written.</p>
            {bulkErrors.map((error, i) => <p role="alert" key={i} className="text-sm text-destructive">{error}</p>)}
            <Pager offset={offset} setOffset={setOffset} more={offset + 25 < (data?.total || 0)} label="posts" />
            {(data?.posts || []).length > 0 && <GoogleList testId="list-social-posts">
            {(data?.posts || [])
              .map((p: any) => (
                <PostRow
                  key={p.id}
                  post={p}
                  selected={selectedPosts.includes(p.id)}
                  onSelect={checked => setSelectedPosts(old => checked ? [...old, p.id] : old.filter(id => id !== p.id))}
                  pending={mutation.isPending}
                  action={(action, text) =>
                    mutation.mutate({
                      path: `/posts/${p.id}/action${p.business_id ? `?businessId=${p.business_id}` : "?"}`,
                      success: action === "approve" ? "Draft approved and queued" : "Post cancelled",
                      body: { action, ...(text ? { text } : {}) },
                    })
                  }
                />
              ))}
            </GoogleList>}
          </div>
        </section>
      )}

      {tab === "auto" && (
        <>
          <section>
            <GoogleSectionHeader
              title="Auto mode"
              description="AI output is labelled as a draft until approved. Fully automatic mode is your explicit permission to publish generated posts to the saved destinations."
            />
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={current.enabled}
                  onChange={(e) => update("enabled", e.target.checked)}
                />
                Enable auto mode
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Publishing mode</span>
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
              <GooglePill
                disabled={!destinations.length}
                onClick={() => update("destinations", destinations)}
                label="Use accounts selected in Compose"
              />
              <div className="grid gap-4 sm:grid-cols-2 sm:max-w-2xl">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Posts per period</span>
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
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Cadence period</span>
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
                <legend className="mb-2 text-sm font-medium">Content mix (rotates evenly)</legend>
                <div className="flex flex-wrap gap-4">
                  {mixTypes.map((k) => (
                    <label key={k} className="flex items-center gap-1.5 text-sm">
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
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Business instructions</span>
                <Textarea
                  aria-label="Business instructions"
                  value={current.instructions}
                  onChange={(e) => update("instructions", e.target.value)}
                  placeholder="Tone, topics and factual business context"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Writing examples</span>
                <Textarea
                  aria-label="Writing examples"
                  value={current.examples}
                  onChange={(e) => update("examples", e.target.value)}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-3 sm:max-w-3xl">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Timezone</span>
                  <Input
                    aria-label="Timezone"
                    value={current.timezone}
                    onChange={(e) => update("timezone", e.target.value)}
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Blackout starts (hour 0–23)</span>
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
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Blackout ends (hour 0–23)</span>
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
              <label className="block space-y-1.5 sm:max-w-xs">
                <span className="text-sm font-medium">Daily AI generation budget (0–20 requests, resets at UTC midnight)</span>
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
                <p role="alert" className="text-sm text-destructive">
                  {data.lastError}
                </p>
              )}
              {/* Only a connected, enabled auto mode has a real next run. */}
              {data?.connected && data?.settings?.enabled && data?.nextAt && (
                <p className="text-sm">
                  Next generation:{" "}
                  {Date.parse(data.nextAt) <= Date.now()
                    ? "on the next scheduler run"
                    : new Date(data.nextAt).toLocaleString()}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <GooglePill
                  variant="solid"
                  label="Save auto settings"
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
                />
                <GooglePill
                  disabled={mutation.isPending || !data?.connected}
                  onClick={() => mutation.mutate({ path: "/generate", body: { requestId: crypto.randomUUID() }, success: "Draft generation queued" })}
                  label="Generate draft from saved settings"
                />
              </div>
            </div>
          </section>
          <section>
            <GoogleSectionHeader
              title="Content sources"
              description="Project photos come from Media Library; review highlights use synced Google reviews. Auto mode refreshes GBP updates before generating a cross-post."
            />
            <div className="space-y-3">
              <GooglePill
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ path: "/sources/sync-gbp", success: "GBP refresh queued" })}
                label="Sync recent GBP updates"
              />
              <label className="block space-y-1.5 sm:max-w-xs">
                <span className="text-sm font-medium">Source kind</span>
                <select
                  aria-label="Source kind"
                  className={selectClass}
                  value={sourceKind}
                  onChange={(e) => setSourceKind(e.target.value)}
                >
                  <option value="offers">Offer</option>
                  <option value="gbp">Published GBP update</option>
                </select>
              </label>
              <Textarea
                aria-label="Source text"
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                placeholder="Factual source text; offers should include conditions and expiry"
              />
              <div className="space-y-1 text-sm">
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
                    <GooglePill
                      size="sm"
                      onClick={() => setMediaText("")}
                      label="Clear attached media (also clears Compose)"
                    />
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    No media attached. Media URLs entered in Compose are
                    attached to the next source you add.
                  </p>
                )}
                {mediaProblem && (
                  <p role="alert" className="break-all text-destructive">
                    {mediaProblem}
                  </p>
                )}
              </div>
              <GooglePill
                label="Add content source"
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
              />
              <p className="text-xs text-muted-foreground">
                Sources expire from generation after 30 days; remove offers
                when they end.
              </p>
              <p className="text-sm">GBP refresh: {data?.sourcesSync?.sync_requested ? "Queued" : data?.sourcesSync?.synced_at ? new Date(data.sourcesSync.synced_at).toLocaleString() : "Not yet requested"}{data?.sourcesSync?.sync_error ? ` — ${data.sourcesSync.sync_error}` : ""}</p>
              <div className="g-search sm:max-w-md" role="search">
                <Search aria-hidden="true" />
                <input type="search" aria-label="Search content sources" value={sourceSearch} onChange={e => { setSourceSearch(e.target.value); setSourceOffset(0); }} placeholder="Search sources" />
              </div>
              <Pager offset={sourceOffset} setOffset={setSourceOffset} more={sources.length === 25} label="sources" />
              {sources.length > 0 && (
                <GoogleList testId="list-social-sources">
                  {sources.map((s) => (
                    <GoogleListRow
                      key={s.id}
                      size="md"
                      title={<span className="capitalize">{s.kind}</span>}
                      meta={s.text}
                      trailing={
                        <GooglePill
                          variant="quiet"
                          size="sm"
                          disabled={mutation.isPending}
                          onClick={() =>
                            mutation.mutate({
                              path: `/sources/${s.id}`,
                              success: "Source removed",
                              method: "DELETE",
                            })
                          }
                          label="Remove"
                        />
                      }
                    />
                  ))}
                </GoogleList>
              )}
            </div>
          </section>
        </>
      )}

      {tab === "guides" && <GuidesContent />}
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
  onSelect: (checked: boolean) => void;
  pending: boolean;
  action: (a: string, text?: string) => void;
}) {
  const [text, setText] = useState(p.payload.post.content.text);
  return (
    <article className="g-card space-y-2" data-testid={`card-post-${p.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        {["draft", "queued"].includes(p.state) && <input type="checkbox" aria-label={`Select post ${p.id}`} checked={selected} onChange={e => onSelect(e.target.checked)} />}
        <span className={`g-chip g-chip--sm ${p.state === "failed" ? "g-closed" : p.state === "published" ? "g-open" : ""}`}>{p.state}</span>
        <span className="g-card__title g-card__title--md">{p.business_name || "Legacy / unassigned"}</span>
        <span className="text-sm g-text-2">{p.payload.post.content.platform}</span>
        <span className="text-sm g-text-2">
          · {new Date(
            p.scheduled_at || p.created_at || p.due_at,
          ).toLocaleString()}
        </span>
        {p.ai_generated && (
          <span className="g-chip g-chip--sm">
            AI-generated{p.state === "draft" ? " draft" : ""}
          </span>
        )}
      </div>
      {p.state === "draft" ? (
        <Textarea
          aria-label="Edit draft"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm">{p.payload.post.content.text}</p>
      )}
      {p.source && (
        <p className="g-card__meta">Source: {p.source}</p>
      )}
      {p.error && (
        <p role="alert" className="text-sm g-closed">
          {p.error}
        </p>
      )}
      <div className="g-card__actions items-center">
        {p.state === "draft" && (
          <GooglePill
            variant="solid"
            disabled={pending || !text.trim()}
            onClick={() => action("approve", text)}
            label="Approve & queue"
          />
        )}
        {["draft", "queued"].includes(p.state) && (
          <GooglePill
            disabled={pending}
            onClick={() => action("cancel")}
            label="Cancel"
          />
        )}
        {p.public_url && (
          <GooglePill icon={ExternalLink} href={p.public_url} external label="View published post" />
        )}
        {["submitted", "published", "failed", "uncertain"].includes(
          p.state,
        ) && (
          <>
            <GooglePill
              icon={ExternalLink}
              variant="quiet"
              href={
                p.state === "failed"
                  ? "https://my.blotato.com/failed"
                  : "https://my.blotato.com"
              }
              external
              label="Open Blotato status"
            />
            {p.submission_id && (
              <span className="break-all text-xs g-text-2">
                Submission: {p.submission_id}
              </span>
            )}
          </>
        )}
      </div>
    </article>
  );
}
