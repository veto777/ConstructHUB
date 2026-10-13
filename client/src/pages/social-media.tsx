import { BusinessSelector, MappingEditor, Pager, refreshSocial } from "@/components/social-agency";
import { characterCount, latestPostsFirst, destinationLabel, loadComposerDraft, loadRowEdits, saveComposerDraft, saveRowEdits, type ComposerSubmission } from "@/components/social-drafts";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AppPage, Notice, Toolbar } from "@/components/app-ui";
import { PlanRequired, planRequiredFrom } from "@/components/plan-required";
import { GoogleSectionHeader, GoogleList, GoogleListRow, GooglePill } from "@/components/google";
import { AlertTriangle, ExternalLink, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  autoSchema,
  postSchema,
  publicMediaUrl,
  socialLimits,
  mixTypes,
  type AutoSettings,
  type Destination,
} from "@shared/social";
import { GuidesContent } from "@/pages/guides";
import { useUrlParam } from "@/hooks/use-url-param";
import { SocialYoutube } from "@/components/social-youtube";
import { SocialConnect } from "@/components/social-connect";
import { SocialAccountStats, SocialPostInsights } from "@/components/social-insights";
import { useLocation } from "wouter";
import { ToolBarSlot } from "@/components/tool/shell";
import { socialHref, socialViewOf, type SocialView } from "@/components/social-tool/nav";
import { NetworkIcon, SocialWeek } from "@/components/social-week";
import { TikTokDeclaration, TikTokPanel } from "@/components/social-tiktok";

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
/**
 * TikTok's old "Publish publicly" checkbox (tiktokPublic) is not carried into the composer: TikTok requires the
 * customer to choose who can view each post, with no default. Stored settings still honour it server-side.
 */
function withoutLegacyTikTok(ds: Destination[]): Destination[] {
  return ds.map(({ tiktokPublic, ...d }) => ({ ...d, tiktokPrivacy: d.tiktokPrivacy ?? "", allowComment: !!d.allowComment, allowDuet: !!d.allowDuet, allowStitch: !!d.allowStitch }) as Destination);
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

/** Each view's title and line (the views: components/social-tool/nav.ts). */
const VIEW_HEAD: Record<SocialView, [string, string]> = {
  overview: ["Overview", "This week, what is coming up, and how your accounts are doing."],
  calendar: ["Calendar", "Every post by day. Times are in your browser's timezone."],
  compose: ["New post", "Write once — every chosen account gets its own version."],
  posts: ["Posts", "Drafts, scheduled, published and failed posts, newest first."],
  analytics: ["Analytics", "Followers, reach and engagement for each connected account, and your published posts."],
  inbox: ["Inbox", "Comments on your published posts. Open Comments on a post to reply, hide or delete."],
  accounts: ["Accounts", "Connect Facebook, Instagram, Threads, TikTok and YouTube, and choose where posts go."],
  auto: ["Auto mode", "Let ConstructHUB write posts for you on a schedule, as drafts or straight to your accounts."],
  guides: ["Guides", "Step-by-step help for Social Media."],
};

export default function SocialMediaPage() {
  const [business, setBusiness] = useUrlParam("business");
  const [tab] = useUrlParam("tab");
  const [, setPick] = useUrlParam("pick");
  const [path, navigate] = useLocation();
  const view = socialViewOf(path, tab);
  // The old one-page links (?tab=queue from notifications, ?tab=guides) open their own view now.
  const signInResult = path === "/social-media" && view === "accounts";
  useEffect(() => {
    if (!tab && !signInResult) return;
    const rest = new URLSearchParams(window.location.search);
    rest.delete("tab");
    const b = rest.get("business"); rest.delete("business");
    navigate(socialHref(view, b, Object.fromEntries(rest)), { replace: true });
  }, [tab, signInResult]); // eslint-disable-line react-hooks/exhaustive-deps
  // Drafts are scoped to the signed-in account (the router resolves /api/auth/me before any page
  // renders, so the id is available synchronously here).
  const me = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const accountId = me.data?.id ?? null;
  // Edited draft text keyed by post id, hoisted above the workbench: a row's textarea state used to
  // die with the row (filter/tab round trip, paging, switching businesses), silently discarding the
  // edit. Keyed here it survives every unmount and remount until it is saved, discarded or approved,
  // and it is persisted per account so leaving the page (How it works, browser Back) keeps it too.
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>(() => loadRowEdits(accountId));
  const [editsFor, setEditsFor] = useState(accountId);
  // Late auth (or an account switch in this tab): load that account's edits before persisting, so
  // one account's drafts never bleed into another's stash.
  useEffect(() => {
    if (accountId === null || editsFor === accountId) return;
    setDraftEdits(loadRowEdits(accountId));
    setEditsFor(accountId);
  }, [accountId, editsFor]);
  useEffect(() => {
    if (accountId === null || editsFor !== accountId) return;
    saveRowEdits(accountId, draftEdits);
  }, [accountId, editsFor, draftEdits]);
  const editDraft = (id: string, value: string | undefined) =>
    setDraftEdits((old) => {
      if (value === undefined) {
        if (!(id in old)) return old;
        const next = { ...old };
        delete next[id];
        return next;
      }
      return { ...old, [id]: value };
    });
  const valid = business === "all" || (!!business && /^[1-9]\d*$/.test(business) && Number.isSafeInteger(Number(business)));
  // The same query (same key, same fetch) BusinessSelector starts with, so this costs no extra request:
  // it tells the page whether the account has the tool at all (every /api/social route is the
  // socialPublishing module — a 402 here means the plan lacks it) and whether there is any business yet.
  const businesses = useQuery<any>({
    queryKey: ["/api/social", "businesses", "", 0, "all"],
    queryFn: async () => (await apiRequest("GET", `/api/social/businesses?${new URLSearchParams({ search: "", offset: "0", linked: "all" })}`)).json(),
  });
  const planRequired = planRequiredFrom(businesses.error);
  const noBusinesses = !businesses.isError && !!businesses.data && (businesses.data.total ?? 0) === 0 && !(businesses.data.items ?? []).length;
  const chosen = business && valid;
  return (
    <AppPage>
      {!planRequired && <ToolBarSlot><BusinessSwitch business={chosen ? business : null} items={businesses.data?.items ?? []} total={businesses.data?.total ?? 0} onChange={(v) => { if (v) { setBusiness(v, true); return; } const p = new URLSearchParams(window.location.search); p.delete("business"); p.set("pick", "1"); navigate(`${path}?${p}`); }} /></ToolBarSlot>}
      {/* Google's format (owner, 2026-10-07): quiet titles with a hairline, pills, hairline rows. */}
      <GoogleSectionHeader
        as="h1"
        title={VIEW_HEAD[view][0]}
        description={VIEW_HEAD[view][1]}
        flush
        actions={<GooglePill href="/guides?topic=social" label="How it works" testId="link-how-it-works" />}
      />
      {planRequired ? (
        // The plan doesn't include social publishing: the standard plan card, in the page, instead of
        // a "could not load" notice (the sidebar and ToolRouteGate already send most such accounts to the landing).
        <>
          <PlanRequired module="socialPublishing" error={businesses.error} />
          {view === "guides" && <GuidesContent />}
        </>
      ) : (
        <>
          {/* No business open yet: the full list to pick from (one business opens by itself). */}
          {!chosen && view !== "guides" && <BusinessSelector value={business} onChange={v => { setPick(null); setBusiness(v, true); }} accountTotal={!businesses.isError && businesses.data ? (businesses.data.total ?? 0) : null} />}
          {chosen ? <SocialWorkbench key={JSON.stringify([accountId, business])} view={view} accountId={accountId} businessId={business === "all" ? null : Number(business)} all={business === "all"} draftEdits={editsFor === accountId ? draftEdits : {}} onEditDraft={editDraft} /> : <>
            {/* The guides don't depend on a business: /guides lands here. */}
            {view === "guides" && <GuidesContent />}
            {!business && !noBusinesses && view !== "guides" && <p className="text-sm g-text-2">Click Open on a business above. Add or import businesses in <a className="g-link" href="/locations">Locations</a>.</p>}
          </>}
        </>
      )}
      {/* The YouTube channel belongs to the account, not to one business: it is shown with the business's other
          connection (inside the workbench) and here whenever no single business is open. */}
      {view === "accounts" && !(chosen && business !== "all") && <SocialYoutube />}
    </AppPage>
  );
}

function SocialWorkbench({ view, accountId, businessId, all, draftEdits, onEditDraft }: { view: SocialView; accountId: number | string | null; businessId: number | null; all: boolean; draftEdits: Record<string, string>; onEditDraft: (id: string, value: string | undefined) => void }) {
  const { toast } = useToast();
  // Selected post ids keyed to their business names (for the bulk-cancel dialog), so the names
  // survive paging and refetches even when the selected row is not on the current page.
  const [selected, setSelected] = useState<Record<string, string>>({});
  // Ids the latest bulk action failed on: kept selected (and exempt from the stale-selection prune)
  // so the user sees exactly what went wrong and can retry or uncheck them — no re-selecting 100 rows.
  const [bulkFailed, setBulkFailed] = useState<string[]>([]);
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [confirmBulkCancel, setConfirmBulkCancel] = useState(false);
  const [latestPosts, setLatestPosts] = useState<any[]>([]);
  const [offset, setOffset] = useState(0), [postSearch, setPostSearch] = useState(""), [postState, setPostState] = useState(""), [postPlatform, setPostPlatform] = useState("");
  const [calendarDate, setCalendarDate] = useState("");
  const [sourceOffset, setSourceOffset] = useState(0), [sourceSearch, setSourceSearch] = useState("");
  const [mediaOffset, setMediaOffset] = useState(0), [mediaSearch, setMediaSearch] = useState("");
  const scope = businessId ? `businessId=${businessId}` : "";
  const qs = new URLSearchParams({ offset: String(offset), search: postSearch, state: postState, platform: postPlatform, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(businessId ? { businessId: String(businessId) } : {}), ...(calendarDate ? { day: calendarDate } : {}) });
  const { data, error, isLoading, dataUpdatedAt, refetch } = useQuery<any>({ queryKey: ["/api/social", accountId, businessId, all, qs.toString()], refetchInterval: 15000, queryFn: async () => (await apiRequest("GET", `/api/social${all ? "/calendar" : ""}?${qs}`)).json() });
  // Prune the bulk selection against post state on every refetch (mirrors the draftEdits release
  // effect on the row): once a post leaves draft/queued its checkbox vanishes, so keeping it selected
  // overcounts, names a business for an uncancellable post in the dialog, and confirming spams 409s.
  // Ids the latest bulk just failed on are exempt — they are the visible "what went wrong" set.
  const posts: any[] = data?.posts || [];
  useEffect(() => {
    if (!posts.length) return;
    const stateById = new Map(posts.map((p: any) => [p.id, p.state]));
    setSelected((old) => {
      const next = Object.fromEntries(
        Object.entries(old).filter(([id]) => {
          const state = stateById.get(id);
          return state === undefined || ["draft", "queued"].includes(state) || bulkFailed.includes(id);
        }),
      );
      return Object.keys(next).length === Object.keys(old).length ? old : next;
    });
  }, [posts, bulkFailed]);
  // Synced business photos and the saved content sources: each keeps its loading and error state, so a
  // failed request reads as a failure with a retry, never as "no photos" / "no sources".
  const mediaQuery = useQuery<any[]>({ queryKey: ["/api/social", "media", businessId, mediaOffset, mediaSearch], enabled: !all, queryFn: async () => (await apiRequest("GET", `/api/social/media?${scope}&offset=${mediaOffset}&search=${encodeURIComponent(mediaSearch)}`)).json() });
  const sourcesQuery = useQuery<any[]>({ queryKey: ["/api/social", "sources", businessId, sourceOffset, sourceSearch], enabled: !all, queryFn: async () => (await apiRequest("GET", `/api/social/sources?${scope}&offset=${sourceOffset}&search=${encodeURIComponent(sourceSearch)}`)).json() });
  const media: any[] = mediaQuery.data ?? [];
  const sources: any[] = sourcesQuery.data ?? [];
  // Drafts with an edit still not saved or discarded, keyed by post id at the page level: bulk
  // approval would publish the saved version, so it waits until they are saved or discarded. An edit
  // made on another page/filter still counts — the map outlives the row.
  const selectedPosts = Object.keys(selected);
  const selectedDirty = selectedPosts.filter((id) => draftEdits[id] !== undefined).length;
  // The unsaved-edit gate names the affected businesses (same pattern as businessSummary below),
  // so the user can find the edits — and offers one escape hatch instead of row-by-row discards.
  const dirtyCounts = new Map<string, number>();
  for (const id of selectedPosts) {
    if (draftEdits[id] === undefined) continue;
    const name = selected[id];
    dirtyCounts.set(name, (dirtyCounts.get(name) ?? 0) + 1);
  }
  const dirtySummary = [...dirtyCounts.entries()].map(([name, n]) => `${name} (${n})`).join(", ");
  const discardAllEdits = () => {
    for (const id of selectedPosts) if (draftEdits[id] !== undefined) onEditDraft(id, undefined);
  };
  // For the bulk-cancel confirmation: how many posts per business, names included.
  const businessCounts = new Map<string, number>();
  for (const name of Object.values(selected)) businessCounts.set(name, (businessCounts.get(name) ?? 0) + 1);
  const businessSummary = [...businessCounts.entries()].map(([name, n]) => `${name} (${n})`).join(", ");
  // Which section the view shows; the all-clients view has only the calendar and the posts.
  const [, navigate] = useLocation();
  const VIEW_TAB: Record<SocialView, string> = { overview: "overview", calendar: "calendar", compose: "compose", posts: "queue", analytics: "queue", inbox: "queue", accounts: "accounts", auto: "auto", guides: "guides" };
  // All clients: the calendar, posts, inbox and analytics lists and the guides cover every business; the rest need one.
  const tab = all ? (view === "calendar" ? "calendar" : view === "guides" ? "guides" : ["posts", "inbox", "analytics"].includes(view) ? "queue" : "one-business") : VIEW_TAB[view];
  const setTab = (v: string) => navigate(socialHref(v === "queue" ? "posts" : (v as SocialView), all ? "all" : String(businessId)));
  // Posts: the menu's All / Drafts / Scheduled / Published / Failed is ?state=; Inbox and Analytics list published posts.
  const [stateParam] = useUrlParam("state");
  useEffect(() => {
    const want = view === "inbox" || view === "analytics" ? "published" : view === "posts" ? (stateParam ?? "") : null;
    if (want !== null) { setPostState(want); setOffset(0); }
  }, [view, stateParam]);
  const queueTop = useRef<HTMLElement>(null);
  const queuePosts = latestPostsFirst(data?.posts || [], offset === 0 && !postSearch && !postState && !postPlatform && !calendarDate ? latestPosts : []);
  useEffect(() => {
    if (tab === "queue") queueTop.current?.scrollIntoView({ block: "start" });
  }, [tab, isLoading]);
  // The composition is a per-business, per-account draft: it survives leaving the page (How it
  // works, browser Back) and switching businesses, so unsaved work never silently disappears.
  // Loaded once per mount, keyed by account AND business, before any defaults land.
  const businessKey = businessId === null ? "all" : String(businessId);
  const [initialDraft] = useState(() => loadComposerDraft(accountId, businessKey));
  const [text, setText] = useState(initialDraft?.text ?? ""),
    [tweaks, setTweaks] = useState<Record<string, string>>(initialDraft?.tweaks ?? {});
  const [destinations, setDestinations] = useState<Destination[]>(() => withoutLegacyTikTok(initialDraft?.destinations ?? [])),
    [mediaText, setMediaText] = useState(initialDraft?.mediaText ?? ""),
    [schedule, setSchedule] = useState(initialDraft?.schedule ?? "");
  // Set when a stored draft (or a user pick) is in play: the saved mapping must not clobber it.
  const restoredRef = useRef(!!initialDraft);
  const [submission, setSubmission] = useState<ComposerSubmission | undefined>(initialDraft?.submission);
  const submittingRef = useRef(false);
  // Save on every change — business switch, tab round trip and page leave all remount this
  // component. Posting clears the fields, which clears the stored draft for a clean next visit.
  useEffect(() => {
    saveComposerDraft(accountId, businessKey, { text, tweaks, destinations, mediaText, schedule, submission });
  }, [accountId, businessKey, text, tweaks, destinations, mediaText, schedule, submission]);
  const [settings, setSettings] = useState<AutoSettings | null>(null);
  const [sourceKind, setSourceKind] = useState("offers"),
    [sourceText, setSourceText] = useState("");
  const [uploading, setUploading] = useState(false);
  useEffect(() => { if (restoredRef.current) return; setDestinations(withoutLegacyTikTok(data?.defaults || [])); }, [JSON.stringify(data?.defaults)]);
  // What each TikTok panel says still stops posting (components/social-tiktok.tsx), by account id.
  const [tiktokProblems, setTiktokProblems] = useState<Record<string, string>>({});
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
      const url = path.includes("?") ? `/api/social${path}` : `/api/social${path}?${scope}`;
      return (await apiRequest(method, url, body)).json();
    },
    onSuccess: (result, vars) => {
      let title = vars.success ?? "Saved";
      if (result.results) {
        const failed = result.results.filter((r: any) => !r.ok);
        setBulkErrors(failed.map((r: any) => r.error));
        // A partial failure keeps the failed posts selected (names preserved from the current
        // selection) so one glance shows what went wrong and a retry takes one click — instead of
        // re-selecting up to 100 rows to find the failures again.
        setSelected((old) => Object.fromEntries(failed.map((r: any) => [r.id, old[r.id] ?? ""])));
        setBulkFailed(failed.map((r: any) => r.id));
        setConfirmBulkCancel(false);
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
  // A saved pick for an account that is no longer connected (e.g. after a reconnect gave it a new id) is never sent.
  const liveDestinations = destinations.filter((d) => accounts.some((x) => x.id === d.accountId));
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
  const setupProblem = data?.setupProblem as string | null | undefined;
  const draftBlocker = error ? "Refresh Social Media to check whether posting is available." : setupProblem || (!data?.connected
    ? "Connect your social accounts above to post."
    : !liveDestinations.length
      ? "Choose at least one account above."
      : !text.trim()
        ? "Write the post text."
        : uploading
          ? "Wait for the upload to finish."
          : mediaProblem);
  // TikTok's own rules (who can view, disclosure, the creator's limits) stop Post / Schedule; a draft can wait for them.
  const tiktokShown = destinations.filter((d) => d.platform === "tiktok" && accounts.some((a) => a.id === d.accountId));
  const tiktokBlocker = tiktokShown.map((d) => tiktokProblems[d.accountId] ?? "TikTok: loading your account details…").find(Boolean) ?? "";
  const postBlocker = draftBlocker || tiktokBlocker;
  function choose(a: Account, checked: boolean) {
    restoredRef.current = true;
    setDestinations((ds) =>
      checked
        ? [
            ...ds,
            {
              accountId: a.id,
              platform: a.platform,
              ...(a.pages?.length === 1 ? { pageId: a.pages[0].id } : {}),
              privacy: "private",
              // TikTok: nothing pre-chosen (Content Sharing Guidelines) — the panel asks for each.
              tiktokPrivacy: "",
              allowComment: false,
              allowDuet: false,
              allowStitch: false,
              isBrandedContent: false,
              isYourBrand: false,
            },
          ]
        : ds.filter((d) => d.accountId !== a.id),
    );
  }
  function patchDestination(id: string, patch: Partial<Destination>) {
    restoredRef.current = true;
    setDestinations((ds) =>
      ds.map((d) => (d.accountId === id ? { ...d, ...patch } : d)),
    );
  }
  async function submit(draft: boolean) {
    if (submittingRef.current || accountId === null || setupProblem || error) return;
    submittingRef.current = true;
    let dispatched = false;
    try {
      const body: ComposerSubmission = submission ?? postSchema.parse({
        requestId: crypto.randomUUID(), text, tweaks, destinations: liveDestinations, mediaUrls: urls(),
        ...(schedule ? { scheduledTime: new Date(schedule).toISOString() } : {}), draft,
      });
      // Persist synchronously BEFORE dispatch: even an immediate navigation must restore
      // the exact request, including its action, time and per-destination payload.
      restoredRef.current = true;
      saveComposerDraft(accountId, businessKey, { text, tweaks, destinations, mediaText, schedule, submission: body });
      setSubmission(body);
      dispatched = true;
      const result = await mutation.mutateAsync({
        path: "/posts",
        success: false,
        body,
      });
      // The composer starts the next post clean: text, tweaks, media and the schedule time all go.
      // Only the destinations stay, and they return to the business's saved mapping (not the last post's picks).
      saveComposerDraft(accountId, businessKey, { text: "", tweaks: {}, mediaText: "", schedule: "", destinations: [] });
      setSubmission(undefined);
      restoredRef.current = false;
      setText("");
      setTweaks({});
      setMediaText("");
      setSchedule("");
      setDestinations(withoutLegacyTikTok(data?.defaults || []));
      const count = body.destinations.length;
      const when = body.scheduledTime ? new Date(body.scheduledTime) : null;
      toast({
        title: body.draft ? "Draft saved" : when ? "Post scheduled" : "Post queued for publishing",
        description: `${count} destination${count === 1 ? "" : "s"}${when ? ` · ${when.toLocaleString()}` : ""}${body.mediaUrls.length ? ` · ${body.mediaUrls.length} media` : ""}. The composer is clear for the next post.`,
      });
      setLatestPosts(result.posts || []);
      setOffset(0);
      setPostSearch("");
      setPostState("");
      setPostPlatform("");
      setCalendarDate("");
      setTab("queue");
    } catch (error) {
      if (!dispatched) toast({ title: "Check your post", description: "Check the post text, destinations, media links and schedule time before submitting.", variant: "destructive" });
      // createPosts returns an existing request before destination/platform validation;
      // an explicit validation rejection means this payload was not accepted.
      if (error instanceof Error && /^(400|422):/.test(error.message)) {
        setSubmission(undefined);
        saveComposerDraft(accountId, businessKey, { text, tweaks, destinations, mediaText, schedule });
      }
    } finally {
      submittingRef.current = false;
    }
  }
  async function attachLibraryPhoto(url: string) {
    setUploading(true);
    try {
      const blob = await (await fetch(url)).blob();
      await upload(new File([blob], "library-photo." + blob.type.split("/")[1], { type: blob.type }));
    } catch {
      toast({ title: "Could not read this library photo. Try again.", variant: "destructive" });
    } finally {
      setUploading(false);
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
        headers: { "Content-Type": r.contentType || file.type || "application/octet-stream" },
      });
      if (!put.ok) throw new Error("Media upload failed");
      const publicUrl = r.publicUrl ?? (r.uploadId ? (await mutation.mutateAsync({ path: `/uploads/${encodeURIComponent(r.uploadId)}/confirm`, success: false })).publicUrl : null);
      if (!publicUrl) throw new Error("Media upload failed");
      setMediaText((v) => [v, publicUrl].filter(Boolean).join("\n"));
      toast({ title: "Media uploaded and attached" });
    } catch {
      toast({ title: "Upload failed. Try again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }
  // The plan doesn't include social publishing: the standard plan card, never a generic "could not load".
  if (error && !data && planRequiredFrom(error)) return <PlanRequired module="socialPublishing" error={error} />;
  // Nothing loaded (e.g. a stale or foreign ?business=): say why instead of an empty workbench.
  if (error && !data) return (
    <Notice tone="danger" testId="alert-social-load" action={<GooglePill size="sm" label="Retry" onClick={() => void refreshSocial()} />}>
      Could not load Social Media: {apiErrorMessage(error)}. Choose another business above, or refresh the page.
    </Notice>
  );
  if (isLoading && !data) return (
    <div className="space-y-4" aria-busy="true" data-testid="social-loading">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-10 w-80" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
  return (
    <div className="space-y-5 sm:space-y-6">
      {!all && (
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="g-header__title">{data?.business?.business_name || "Business workspace"}</h2>
          {isLoading && <span className="text-sm g-text-2">Loading…</span>}
        </div>
      )}
      {/* A failed background refresh keeps the last-good data underneath: flag it with a timestamp
          and a Retry above the calendar — in both the single-business and all-clients views. */}
      {error && data && (
        <div
          role="status"
          data-testid="strip-social-saved-data"
          className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-950 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-100"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1 opacity-90">
            Refresh failed — showing saved data from{" "}
            {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleString() : "an earlier visit"}.{" "}
            {apiErrorMessage(error)}
          </div>
          <GooglePill size="sm" label="Retry" onClick={() => void refetch()} />
        </div>
      )}

      {!all && tab === "overview" && <SocialOverview business={String(businessId)} businessId={businessId} accounts={accounts} />}
      {!all && tab === "overview" && <SocialWeek businessId={businessId} all={false} business={String(businessId)} />}
      {tab === "one-business" && (
        <Notice tone="info" title="Choose one business" testId="notice-social-one-business">
          {view === "compose" ? "Posts are written for one business at a time." : view === "auto" ? "Auto mode is set for each business." : view === "accounts" ? "Accounts are connected for each business." : "This view is for one business at a time."} Pick it in the Business menu above.
        </Notice>
      )}
      {tab === "calendar" && <SocialWeek full businessId={businessId} all={all} business={all ? "all" : String(businessId)} />}
      {!all && tab === "accounts" && data?.native && (
        <SocialConnect via="native" businessId={businessId} networks={data.native.networks} accounts={data?.provider === "native" ? accounts : []} connected={data?.provider === "native" && !!data?.connected} />
      )}
      {!all && (tab === "overview" || view === "analytics") && data?.native && data?.provider === "native" && accounts.length > 0 && <SocialAccountStats businessId={businessId} />}
      {!all && tab === "accounts" && !data?.native && data?.outstand && (
        <SocialConnect businessId={businessId} networks={data.outstand.networks} accounts={data?.provider === "outstand" ? accounts : []} connected={data?.provider === "outstand" && !!data?.connected} />
      )}

      {!all && tab === "accounts" && data && !data.outstand && !data.native && (
        <Notice tone="info" title="Social accounts" testId="notice-social-unavailable">
          Connecting social accounts through ConstructHUB isn&rsquo;t switched on for this account yet.
        </Notice>
      )}

      {!all && tab === "accounts" && <SocialYoutube businessId={businessId} />}

      {!all && tab === "accounts" && businessId && <MappingEditor businessId={businessId} defaults={data?.defaults || []} />}


      {tab === "compose" && (
        <section>
          {setupProblem && <Notice tone="danger" testId="alert-social-setup"><span id="social-setup-reason">{setupProblem} Posting and saving drafts are unavailable until this is fixed.</span></Notice>}
          <GoogleSectionHeader title="Compose" description={all ? undefined : "Write once — every chosen account gets its own version."} />
          {submission && <div role="status" className="mb-4 space-y-2 rounded-lg border p-3 text-sm">
            <p>Submission awaiting confirmation. Your original post is saved. Retry it to confirm the result without creating duplicate posts.</p>
            <GooglePill className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" label="Retry saved submission" disabled={mutation.isPending || !!setupProblem || !!error} onClick={() => void submit(submission.draft)} />
          </div>}
          <fieldset disabled={!!submission || mutation.isPending} className="min-w-0 space-y-5">
            <legend className="sr-only">Compose post</legend>
            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-medium">Post to</legend>
              {!data?.connected ? (
                <p className="text-sm text-muted-foreground">
                  Connect your social accounts above to choose accounts.
                </p>
              ) : (
                !accounts.length && (
                  <p className="text-sm text-muted-foreground">
                    No social accounts are available for this business.
                    Connect accounts through ConstructHUB above, then add them
                    under Map accounts and pages to this business.
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
                          <TikTokPanel
                            accountId={a.id}
                            accountName={a.name}
                            d={d}
                            media={badMedia.length ? [] : urls()}
                            native={data?.provider === "native"}
                            businessId={businessId}
                            onChange={(patch) => patchDestination(a.id, patch)}
                            onProblem={(problem) => setTiktokProblems((old) => (old[a.id] === problem ? old : { ...old, [a.id]: problem }))}
                          />
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
                  {p} text tweak · {characterCount(p, tweaks[p] ?? text)}
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
            {mediaQuery.isError && (
              <Notice tone="danger" testId="alert-social-media" action={<GooglePill size="sm" label="Retry" onClick={() => void mediaQuery.refetch()} />}>
                Could not load your synced business photos: {apiErrorMessage(mediaQuery.error)}
              </Notice>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Media library</span>
                {mediaQuery.isLoading ? (
                  <Skeleton className="h-10 w-full rounded-full" aria-label="Loading synced photos" />
                ) : (
                  <select
                    aria-label="Media Library"
                    className={selectClass}
                    value=""
                    disabled={mediaQuery.isError || uploading}
                    onChange={(e) => {
                      const photo = media.find(p => p.url === e.target.value);
                      if (photo?.requiresUpload) {
                        void attachLibraryPhoto(photo.url);
                      } else if (e.target.value)
                        setMediaText((v) =>
                          [v, e.target.value].filter(Boolean).join("\n"),
                        );
                    }}
                  >
                    <option value="">
                      {mediaQuery.isError ? "Photos unavailable" : media.length ? "Attach a saved photo" : mediaSearch ? "No synced photo matches" : "No synced business photos yet"}
                    </option>
                    {media.map((p) => (
                      <option key={p.id} value={p.url}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
                {!mediaQuery.isLoading && !mediaQuery.isError && !media.length && !mediaSearch && (
                  <span className="block text-xs text-muted-foreground">Photos sync from the business's linked Google profile; upload below or paste a public link instead.</span>
                )}
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Upload a photo or video (up to 100 MB)</span>
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
            {tiktokShown.length > 0 && <TikTokDeclaration branded={tiktokShown.some((d) => d.isBrandedContent)} />}
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Save or publish post" aria-describedby={setupProblem ? "social-setup-reason" : undefined}>
              <GooglePill
                variant="solid"
                testId="button-post-now"
                disabled={!!postBlocker || mutation.isPending}
                title={postBlocker || undefined}
                onClick={() => void submit(false)}
                label={schedule ? "Schedule post" : "Post now"}
              />
              <GooglePill
                disabled={!!draftBlocker || mutation.isPending}
                title={draftBlocker || undefined}
                onClick={() => void submit(true)}
                label="Save draft"
              />
              {postBlocker && !setupProblem && (
                <span className="text-sm g-text-2 break-all">
                  {postBlocker}
                </span>
              )}
            </div>
          </fieldset>
        </section>
      )}

      {tab === "queue" && (
        <section ref={queueTop} className="scroll-mt-4">
          <GoogleSectionHeader
            title={all ? "All clients" : view === "inbox" ? "Published posts" : view === "analytics" ? "Published posts" : ({ draft: "Drafts", queued: "Scheduled", published: "Published", failed: "Failed" } as Record<string, string>)[postState] ?? "All posts"}
            count={error ? undefined : data?.total}
            description="Times are shown in your browser&rsquo;s timezone. Status refreshes every 15 seconds — published means the network confirmed publication; queued means it is still in ConstructHUB."
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
            {!error && !queuePosts.length && (
              <p className="text-sm text-muted-foreground" data-testid="text-social-posts-empty">
                {postSearch || postState || postPlatform || calendarDate
                  ? "No posts match your search or filters."
                  : "No posts yet. Compose your first update or generate an AI draft."}
              </p>
            )}
            <p className="text-sm text-muted-foreground">{error ? "Post count unavailable" : `${data?.total ?? 0} matching posts`}</p>
            <div className="flex flex-wrap gap-2">
              <GooglePill size="sm" onClick={() => setSelected((old) => ({ ...old, ...Object.fromEntries(queuePosts.filter((p: any) => ["draft", "queued"].includes(p.state)).map((p: any) => [p.id, p.business_name || "Legacy / unassigned"])) }))} label="Select this page of posts" />
              <GooglePill size="sm" disabled={!selectedPosts.length} onClick={() => { setSelected({}); setBulkFailed([]); }} label="Clear selection" testId="button-clear-selection" />
              <GooglePill size="sm" disabled={!selectedPosts.length || selectedPosts.length > 100 || mutation.isPending || selectedDirty > 0} onClick={() => mutation.mutate({ path: "/posts/bulk-action", body: { ids: selectedPosts, action: "approve" }, success: "Selected drafts approved" })} label="Approve selected drafts" />
              <GooglePill size="sm" disabled={!selectedPosts.length || selectedPosts.length > 100 || mutation.isPending} onClick={() => setConfirmBulkCancel(true)} label="Cancel selected posts" />
            </div>
            <p className="text-xs text-muted-foreground">{selectedPosts.length} selected (up to 100 per action). Approve publishes each saved draft as written.</p>
            {selectedDirty > 0 && (
              <div className="flex flex-wrap items-center gap-2" role="status" data-testid="text-social-unsaved-edits">
                <p className="text-sm g-text-2">
                  {selectedDirty} selected draft{selectedDirty === 1 ? " has" : "s have"} unsaved edits ({dirtySummary}). Save or discard them first, so approval publishes what you see.
                </p>
                <GooglePill size="sm" variant="quiet" label="Discard all edits" testId="button-discard-all-edits" onClick={discardAllEdits} />
              </div>
            )}
            {bulkErrors.map((error, i) => <p role="alert" key={i} className="text-sm text-destructive">{error}</p>)}
            <Pager offset={offset} setOffset={setOffset} more={offset + 25 < (data?.total || 0)} label="posts" />
            {queuePosts.length > 0 && <GoogleList testId="list-social-posts">
            {queuePosts
              .map((p: any) => (
                <PostRow
                  key={p.id}
                  post={p}
                  selected={selectedPosts.includes(p.id)}
                  onSelect={checked => setSelected((old) => { const next = { ...old }; if (checked) next[p.id] = p.business_name || "Legacy / unassigned"; else delete next[p.id]; return next; })}
                  pending={mutation.isPending}
                  draft={draftEdits[p.id]}
                  onEdit={(value) => onEditDraft(p.id, value)}
                  action={(action, text) =>
                    mutation.mutate({
                      path: `/posts/${p.id}/action${p.business_id ? `?businessId=${p.business_id}` : "?"}`,
                      success: action === "approve" ? "Draft approved and queued" : action === "save" ? "Draft saved" : "Post cancelled",
                      body: { action, ...(text ? { text } : {}) },
                    })
                  }
                />
              ))}
            </GoogleList>}
            <AlertDialog open={confirmBulkCancel} onOpenChange={setConfirmBulkCancel}>
              <AlertDialogContent data-testid="dialog-bulk-cancel-posts">
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel {selectedPosts.length} selected posts?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This cancels drafts and queued posts across {businessCounts.size} {businessCounts.size === 1 ? "business" : "businesses"}: {businessSummary}.
                    Queued posts won&rsquo;t be published and drafts leave the queue. Anything already submitted to a platform can&rsquo;t be cancelled and stays as it is, with its error shown below. This can&rsquo;t be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep them</AlertDialogCancel>
                  <AlertDialogAction onClick={() => mutation.mutate({ path: "/posts/bulk-action", body: { ids: selectedPosts, action: "cancel" }, success: "Selected posts cancelled" })} data-testid="button-bulk-cancel-confirm">Cancel posts</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
                          destinationLabel(d, accounts),
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
              {sourcesQuery.isLoading && (
                <div className="space-y-2" aria-busy="true" data-testid="social-sources-loading"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
              )}
              {sourcesQuery.isError && (
                <Notice tone="danger" testId="alert-social-sources" action={<GooglePill size="sm" label="Retry" onClick={() => void sourcesQuery.refetch()} />}>
                  Could not load your content sources: {apiErrorMessage(sourcesQuery.error)}
                </Notice>
              )}
              {!sourcesQuery.isLoading && !sourcesQuery.isError && !sources.length && (
                <p className="text-sm text-muted-foreground" data-testid="text-social-sources-empty">
                  {sourceSearch ? "No source matches that search." : "No content sources yet. Add an offer above, or sync recent GBP updates, and auto mode will draw on them."}
                </p>
              )}
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
  draft,
  onEdit,
}: {
  post: any;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  pending: boolean;
  action: (a: "approve" | "cancel" | "save", text?: string) => void;
  /** The draft's text edited but not saved yet, hoisted above the row so it survives unmounting. */
  draft?: string;
  onEdit: (value: string | undefined) => void;
}) {
  const saved: string = p.payload.post.content.text;
  // Derived, not local state: with no local edit the textarea follows the saved text (including a
  // save's refetch, from this device or another); a local edit wins until it is saved or discarded.
  const text = draft ?? saved;
  const dirty = p.state === "draft" && text !== saved;
  // Release the hoisted edit once it is moot: the post left draft (approved/cancelled) or the saved
  // text caught up with the edit (the save landed, here or elsewhere). A failed save keeps the edit.
  useEffect(() => {
    if (draft !== undefined && (p.state !== "draft" || draft === saved)) onEdit(undefined);
  }, [draft, saved, p.state, onEdit]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const when = new Date(p.scheduled_at || p.created_at || p.due_at);
  return (
    <article className="g-card space-y-2" data-testid={`card-post-${p.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        {["draft", "queued"].includes(p.state) && <input type="checkbox" aria-label={`Select post ${p.id}`} checked={selected} onChange={e => onSelect(e.target.checked)} />}
        <span className={`g-chip g-chip--sm ${p.state === "failed" ? "g-closed" : p.state === "published" ? "g-open" : ""}`}>{p.state}</span>
        <span className="g-card__title g-card__title--md">{p.business_name || "Legacy / unassigned"}</span>
        <span className="text-sm g-text-2">{p.payload.post.content.platform}</span>
        <span className="text-sm g-text-2">
          · {when.toLocaleString()}
        </span>
        {p.ai_generated && (
          <span className="g-chip g-chip--sm">
            AI-generated{p.state === "draft" ? " draft" : ""}
          </span>
        )}
        {dirty && <span className="g-chip g-chip--sm" data-testid={`chip-post-unsaved-${p.id}`}>Unsaved edit</span>}
      </div>
      {p.state === "draft" ? (
        <Textarea
          aria-label={`Edit draft for ${p.business_name || "Legacy / unassigned"} · ${p.payload.post.content.platform}`}
          value={text}
          onChange={(e) => onEdit(e.target.value)}
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm">{p.payload.post.content.text}</p>
      )}
      {p.source && (
        <p className="g-card__meta">Source: {p.source}</p>
      )}
      {/* Published through ConstructHUB's own connection: likes, comments, views, and the post's comments. */}
      {p.state === "published" && typeof p.submission_id === "string" && p.submission_id.startsWith("nat_") && (
        <SocialPostInsights post={p} />
      )}
      {p.error && (
        <p role="alert" className="text-sm g-closed">
          {p.error}
        </p>
      )}
      <div className="g-card__actions items-center">
        {p.state === "draft" && (
          <>
            <GooglePill
              variant="solid"
              disabled={pending || !text.trim()}
              onClick={() => action("approve", dirty ? text : undefined)}
              label="Approve & queue"
            />
            {/* Save keeps the edit without queueing anything; Discard returns to the saved text. */}
            <GooglePill
              disabled={pending || !dirty || !text.trim()}
              onClick={() => action("save", text)}
              label="Save edit"
              testId={`button-post-save-${p.id}`}
            />
            {dirty && (
              <GooglePill
                variant="quiet"
                disabled={pending}
                onClick={() => onEdit(undefined)}
                label="Discard edit"
                testId={`button-post-discard-${p.id}`}
              />
            )}
          </>
        )}
        {["draft", "queued"].includes(p.state) && (
          <GooglePill
            variant="quiet"
            disabled={pending}
            onClick={() => setConfirmCancel(true)}
            label="Cancel post"
            testId={`button-post-cancel-${p.id}`}
          />
        )}
        {p.public_url && (
          <GooglePill icon={ExternalLink} href={p.public_url} external label="View published post" />
        )}
        {/* The submission reference only matters while a submission is still open (pending, uncertain or
            failed) and there is no live link: it is what support looks up. A published post shows its
            link, or nothing, never a raw id. */}
        {["submitted", "failed", "uncertain"].includes(p.state) && p.submission_id && !p.public_url && (
          <span className="break-all text-xs g-text-2" data-testid={`text-post-submission-${p.id}`}>
            Reference {p.submission_id}
          </span>
        )}
      </div>
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent data-testid={`dialog-cancel-post-${p.id}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this {p.state === "draft" ? "draft" : "post"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {p.state === "queued"
                ? `It is queued for ${when.toLocaleString()} on ${p.payload.post.content.platform} and won't be published.`
                : `The draft for ${p.payload.post.content.platform} is removed from the queue.`}{" "}
              This can't be undone; compose a new post if you change your mind.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmCancel(false); action("cancel"); }} data-testid={`button-post-cancel-confirm-${p.id}`}>Cancel post</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

/** The tool bar's business switcher: which business every view is about (owner, 2026-10-12). */
function BusinessSwitch({ business, items, total, onChange }: { business: string | null; items: any[]; total: number; onChange: (v: string) => void }) {
  if (!total) return null;
  const listed = items.some((b) => String(b.id) === business) || business === "all" || !business;
  return (
    <label className="flex min-w-0 items-center gap-2 text-sm" data-testid="social-business-switch">
      <span className="g-text-2 shrink-0">Business</span>
      <select aria-label="Business" className={`${selectClass} max-w-[22rem]`} value={business ?? ""} onChange={(e) => onChange(e.target.value === "__pick" ? "" : e.target.value)}>
        {!business && <option value="">Choose a business…</option>}
        {!listed && <option value={business!}>This business</option>}
        {items.map((b) => <option key={b.id} value={String(b.id)}>{b.business_name}{b.city ? ` · ${b.city}` : ""}</option>)}
        {total > 1 && <option value="all">All clients (calendar and posts)</option>}
        <option value="__pick">{total > 1 ? `All ${total} businesses and bulk actions…` : "Business list…"}</option>
      </select>
    </label>
  );
}

/** Overview: the connected accounts at a glance and what is coming up next. */
function SocialOverview({ business, businessId, accounts }: { business: string; businessId: number | null; accounts: Account[] }) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const next = useQuery<any>({
    queryKey: ["/api/social", "upcoming", businessId],
    refetchInterval: 60_000,
    queryFn: async () => (await apiRequest("GET", `/api/social?${new URLSearchParams({ state: "queued", order: "asc", offset: "0", timezone, ...(businessId ? { businessId: String(businessId) } : {}) })}`)).json(),
  });
  const failed = useQuery<any>({
    queryKey: ["/api/social", "failed-count", businessId],
    refetchInterval: 60_000,
    queryFn: async () => (await apiRequest("GET", `/api/social?${new URLSearchParams({ state: "failed", offset: "0", timezone, ...(businessId ? { businessId: String(businessId) } : {}) })}`)).json(),
  });
  const upcoming: any[] = (next.data?.posts ?? []).slice().sort((a: any, b: any) => +new Date(a.scheduled_at || a.created_at) - +new Date(b.scheduled_at || b.created_at)).slice(0, 5);
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="social-overview">
      <section className="rounded-xl border border-border p-4">
        <div className="mb-2 flex items-center gap-2"><h2 className="text-lg font-medium">Accounts</h2><a className="g-link ml-auto text-sm" href={socialHref("accounts", business)}>{accounts.length ? "Manage" : "Connect"}</a></div>
        {accounts.length ? (
          <ul className="space-y-1.5">{accounts.map((a) => <li key={a.id} className="flex items-center gap-2 text-sm"><NetworkIcon platform={a.platform} /><span className="truncate">{a.name}</span></li>)}</ul>
        ) : <p className="text-sm g-text-2">No accounts connected yet. <a className="g-link" href={socialHref("accounts", business)}>Connect Facebook, Instagram and more</a> to start posting.</p>}
        {(failed.data?.total ?? 0) > 0 && <p className="mt-3 text-sm text-destructive"><a className="underline" href={socialHref("posts", business, { state: "failed" })}>{failed.data.total} failed post{failed.data.total === 1 ? "" : "s"}</a> {failed.data.total === 1 ? "needs" : "need"} a look.</p>}
      </section>
      <section className="rounded-xl border border-border p-4">
        <div className="mb-2 flex items-center gap-2"><h2 className="text-lg font-medium">Upcoming posts</h2><a className="g-link ml-auto text-sm" href={socialHref("calendar", business)}>Calendar</a></div>
        {next.isLoading ? <p className="text-sm g-text-2">Loading…</p> : upcoming.length ? (
          <ul className="space-y-2">{upcoming.map((p) => (
            <li key={p.id} className="flex items-start gap-2 text-sm">
              <NetworkIcon platform={p.payload?.post?.content?.platform ?? ""} className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="shrink-0 tabular-nums g-text-2">{new Date(p.scheduled_at || p.created_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
              <span className="line-clamp-1 break-words">{p.payload?.post?.content?.text}</span>
            </li>))}
          </ul>
        ) : <p className="text-sm g-text-2">Nothing scheduled. <a className="g-link" href={socialHref("compose", business)}>Write a post</a>.</p>}
      </section>
    </div>
  );
}
