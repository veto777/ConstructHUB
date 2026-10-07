/**
 * Social Media → YouTube: a customer connects their OWN YouTube channel through ConstructHUB's Google
 * project and publishes videos to it (server/youtube/customer-routes.ts). One channel per account.
 *
 * What the page can show comes only from /api/social/youtube/status and /videos — the channel's name and
 * picture, today's allowance, and each video's real state. Nothing here ever receives a token. "Connect"
 * asks the server for Google's consent URL and navigates there; Google sends the browser back to
 * /social-media?youtube=connected|failed.
 *
 * A video goes: this browser → ConstructHUB's storage (in 5 MB parts, straight to storage when the bucket
 * allows it, otherwise through our API) → queued → uploaded to the channel by the server → processed by
 * YouTube. Every one of those states is shown as it is; an error is the server's sentence, never a guess.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Loader2, Trash2, Unplug, Upload, Youtube } from "lucide-react";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Notice } from "@/components/app-ui";
import { GoogleAvatar, GoogleList, GoogleListRow, GooglePill, GoogleSectionHeader } from "@/components/google";
import { HelpButton } from "@/components/help-button";
import { useToast } from "@/hooks/use-toast";

type Status = {
  configured: boolean;
  connected: boolean;
  needsReconnect: boolean;
  channel: { id: string; title: string | null; thumbnail: string | null; url: string } | null;
  connectedAt: string | null;
  lastError: { code: string | null; message: string; at: string | null } | null;
  limits: { perDay: number; usedToday: number; sharedLimitReached: boolean; maxBytes: number; maxWaitingFiles: number; fileTypes: string[] };
};
type Video = {
  id: string; fileName: string; bytes: number; fileAvailable: boolean;
  state: "receiving" | "ready" | "queued" | "uploading" | "processing" | "published" | "failed";
  title: string | null; privacy: string | null; actualPrivacy: string | null; madeForKids: boolean | null; channelTitle: string | null;
  sentBytes: number; videoId: string | null; watchUrl: string | null; errorCode: string | null; error: string | null;
  createdAt: string | null; publishedAt: string | null;
};

const STATUS_KEY = "/api/social/youtube/status";
const VIDEOS_KEY = "/api/social/youtube/videos";
const getJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();
const selectClass = "h-10 w-full rounded-full border border-input bg-background px-4 text-sm";
const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v", mkv: "video/x-matroska",
  "3gp": "video/3gpp", mpg: "video/mpeg", mpeg: "video/mpeg", avi: "video/x-msvideo",
};
const size = (n: number) => (n >= 1024 ** 3 ? `${+(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const PRIVACY: Record<string, string> = { public: "Public", unlisted: "Unlisted", private: "Private" };

/** The legal sentence YouTube's API policy wants at the point of connecting — shown right at the Connect button. */
function ConnectTerms() {
  return (
    <p className="max-w-3xl text-xs g-text-2" data-testid="text-social-youtube-terms">
      By connecting, you agree to be bound by the{" "}
      <a className="g-link" href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" data-testid="link-social-youtube-tos">YouTube Terms of Service</a>.
      {" "}YouTube is a Google service; the{" "}
      <a className="g-link" href="http://www.google.com/policies/privacy" target="_blank" rel="noopener noreferrer" data-testid="link-social-youtube-google-privacy">Google Privacy Policy</a>{" "}
      applies. What ConstructHUB stores is in our <a className="g-link" href="/privacy" data-testid="link-social-youtube-privacy">Privacy Policy</a> (section 4.3).
    </p>
  );
}

/** What connecting does, what we can and cannot do, and how to stop — the same four points whether connected or not. */
function WhatConnectingDoes() {
  return (
    <ol className="max-w-3xl list-decimal space-y-1.5 pl-5 text-sm" data-testid="list-social-youtube-explainer">
      <li>Choose <strong>Connect YouTube</strong>. Google asks which account and channel to use and shows exactly what ConstructHUB is asking for.</li>
      <li><strong>What we can do:</strong> upload the videos you choose here to that channel, and see the channel’s name and picture so you can check it is the right one.</li>
      <li><strong>What we cannot do:</strong> anything else. No editing or deleting videos, no comments, no statistics, and nothing else in your Google account.</li>
      <li>
        <strong>To stop:</strong> choose <strong>Disconnect</strong> here. The sign-in is cancelled at Google and everything stored here for the channel is deleted. You can also remove ConstructHUB on{" "}
        <a className="g-link" href="https://security.google.com/settings/security/permissions" target="_blank" rel="noopener noreferrer">Google’s third-party access page</a>.
        Videos already on YouTube stay on your channel.
      </li>
    </ol>
  );
}

/** PUT one part: straight to storage when a direct URL was given and it answers with an ETag, otherwise through our API. */
async function putPart(videoId: string, n: number, blob: Blob): Promise<void> {
  const target = await getJson<{ url: string; proxyUrl: string }>(`${VIDEOS_KEY}/${videoId}/parts/${n}`);
  if (target.url !== target.proxyUrl) {
    try {
      const direct = await fetch(target.url, { method: "PUT", body: blob });
      const etag = direct.ok ? direct.headers.get("ETag") : null;
      if (etag) { await apiRequest("POST", target.proxyUrl, { etag }); return; }
    } catch { /* blocked (bucket CORS): fall through to the API */ }
  }
  const r = await fetch(target.proxyUrl, { method: "PUT", body: blob, credentials: "include", headers: { "Content-Type": "application/octet-stream" } });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
}

export function SocialYoutube({ businessId = null }: { businessId?: number | null }) {
  const { toast } = useToast();
  const root = useRef<HTMLElement>(null);
  const cancelled = useRef(false);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState<{ name: string; done: number; total: number } | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [title, setTitle] = useState(""), [description, setDescription] = useState(""), [tags, setTags] = useState("");
  const [privacy, setPrivacy] = useState("private"), [kids, setKids] = useState<boolean | null>(null), [certify, setCertify] = useState(false);

  const { data: status, isLoading, error } = useQuery<Status>({ queryKey: [STATUS_KEY], queryFn: () => getJson<Status>(STATUS_KEY), retry: false });
  const { data: list } = useQuery<{ videos: Video[] }>({
    queryKey: [VIDEOS_KEY], queryFn: () => getJson(VIDEOS_KEY), enabled: !!status?.connected,
    // Follow a video while the server or YouTube is still working on it; otherwise leave the list alone.
    refetchInterval: (q) => ((q.state.data?.videos ?? []).some((v) => ["queued", "uploading", "processing"].includes(v.state)) ? 5000 : false),
  });
  const videos = list?.videos ?? [];
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: [STATUS_KEY] }); void queryClient.invalidateQueries({ queryKey: [VIDEOS_KEY] }); };

  // Back from Google: say what happened once, then drop ?youtube= so a refresh does not repeat it.
  useEffect(() => {
    const url = new URL(window.location.href), result = url.searchParams.get("youtube");
    if (result || url.hash === "#youtube") root.current?.scrollIntoView({ block: "start" });
    if (!result) return;
    url.searchParams.delete("youtube");
    window.history.replaceState(window.history.state, "", url.toString());
    if (result === "connected") toast({ title: "YouTube channel connected", description: "Check the channel name below is the one you meant." });
    else toast({ title: "YouTube was not connected", description: "The reason is shown in the YouTube section.", variant: "destructive" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useMutation({
    mutationFn: async () => getJson<{ url: string }>(`/api/social/youtube/connect?format=json${businessId ? `&business=${businessId}` : ""}`),
    onSuccess: (r) => { window.location.assign(r.url); },
    onError: (e) => toast({ title: "Couldn't start the connection", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const disconnect = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/social/youtube/disconnect")).json() as Promise<{ revokedAtGoogle: boolean }>,
    onSuccess: (r) => {
      setOpen(false); setVideoId(null); refresh();
      toast({
        title: "YouTube channel disconnected",
        description: r.revokedAtGoogle
          ? "The sign-in was cancelled at Google and everything stored here was deleted."
          : "Everything stored here was deleted. Google did not confirm cancelling the sign-in — you can also remove ConstructHUB on Google's third-party access page.",
      });
    },
    onError: (e) => toast({ title: "Couldn't disconnect", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `${VIDEOS_KEY}/${id}`)).json(),
    onSuccess: (_r, id) => { if (id === videoId) setVideoId(null); refresh(); },
    onError: (e) => toast({ title: "Couldn't remove the video", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const publish = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${VIDEOS_KEY}/${videoId}/publish`, {
      title: title.trim(), description, privacy, madeForKids: kids, certify,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    })).json(),
    onSuccess: () => {
      setVideoId(null); setTitle(""); setDescription(""); setTags(""); setKids(null); setCertify(false); setOpen(false); refresh();
      toast({ title: "Video queued for YouTube", description: "Its progress is shown in the list below." });
    },
    onError: (e) => { refresh(); toast({ title: "Not sent to YouTube", description: apiErrorMessage(e), variant: "destructive" }); },
  });

  async function sendFile(file: File) {
    if (!status) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const mime = file.type || MIME_BY_EXT[ext] || "";
    if (file.size > status.limits.maxBytes) return void toast({ title: `Choose a video under ${size(status.limits.maxBytes)}`, variant: "destructive" });
    cancelled.current = false;
    setSending({ name: file.name, done: 0, total: file.size });
    let id: string | null = null;
    try {
      const opened = await (await apiRequest("POST", VIDEOS_KEY, { fileName: file.name, mime, bytes: file.size })).json() as { video: Video; partSize: number; partsTotal: number };
      id = opened.video.id;
      for (let n = 1; n <= opened.partsTotal; n++) {
        const blob = file.slice((n - 1) * opened.partSize, n * opened.partSize);
        for (let attempt = 1; ; attempt++) {
          if (cancelled.current) throw new Error("cancelled");
          try { await putPart(id, n, blob); break; }
          catch (e) { if (attempt >= 3) throw e; await new Promise((ok) => setTimeout(ok, 1500 * attempt)); }
        }
        setSending({ name: file.name, done: Math.min(n * opened.partSize, file.size), total: file.size });
      }
      await apiRequest("POST", `${VIDEOS_KEY}/${id}/complete`);
      setVideoId(id);
      if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, "").replace(/[<>]/g, "").slice(0, 100));
    } catch (e) {
      if (id) await apiRequest("DELETE", `${VIDEOS_KEY}/${id}`).catch(() => undefined);
      if (!cancelled.current) toast({ title: "The file was not received", description: apiErrorMessage(e, "Check your connection and choose the file again."), variant: "destructive" });
    } finally {
      setSending(null); refresh();
    }
  }

  const chosen = useMemo(() => videos.find((v) => v.id === videoId) ?? null, [videos, videoId]);
  const usable = !!status?.connected && !status.needsReconnect;
  const limitReached = !!status && (status.limits.usedToday >= status.limits.perDay || status.limits.sharedLimitReached);
  // Why "Publish to YouTube" is disabled, in the order the person can fix it.
  const blocker = !usable ? "Reconnect your channel first."
    : limitReached ? "" // said in its own notice
      : sending ? "Wait for the file to finish arriving."
        : !videoId ? "Choose a video file."
          : !title.trim() ? "Enter a title."
            : /[<>]/.test(title + description) ? "The title and description cannot contain < or >."
              : kids === null ? "Answer whether the video is made for kids."
                : !certify ? "Tick the box confirming the Community Guidelines and your rights to the video."
                  : "";

  const header = (actions?: React.ReactNode) => (
    <GoogleSectionHeader
      title="YouTube"
      titleAfter={<HelpButton k="social-youtube" />}
      description="Connect your own YouTube channel and publish videos to it from here."
      actions={actions}
    />
  );

  if (isLoading && !status) {
    return <section ref={root} id="youtube" data-testid="card-social-youtube">{header()}<div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin g-text-2" aria-label="Loading" /></div></section>;
  }
  if (!status) {
    return (
      <section ref={root} id="youtube" data-testid="card-social-youtube">
        {header()}
        <Notice tone="danger" testId="notice-social-youtube-load">Could not load the YouTube connection{error ? `: ${apiErrorMessage(error)}` : "."} Refresh the page to try again.</Notice>
      </section>
    );
  }

  const connectLabel = status.needsReconnect ? "Reconnect YouTube" : status.connected ? "Connect a different channel" : "Connect YouTube";
  const connectPill = status.configured && (
    <GooglePill variant={usable ? "outline" : "solid"} icon={Youtube} label={connect.isPending ? "Opening Google…" : connectLabel}
      disabled={connect.isPending} onClick={() => connect.mutate()} testId="button-social-youtube-connect" />
  );
  const waiting = videos.filter((v) => v.fileAvailable && (v.state === "ready" || (v.state === "failed" && !v.videoId)));

  return (
    <section ref={root} id="youtube" className="scroll-mt-20 space-y-4" data-testid="card-social-youtube" data-connected={usable ? "true" : "false"}>
      {header(<span className={usable ? "g-open text-sm" : "g-text-2 text-sm"} data-testid="text-social-youtube-state">{usable ? "Connected" : status.needsReconnect ? "Needs reconnect" : "Not connected"}</span>)}

      {!status.configured && (
        <Notice tone="warning" title="YouTube publishing is not set up on this server" testId="notice-social-youtube-not-configured">
          Google sign-in is not configured here, so a channel cannot be connected yet.
        </Notice>
      )}
      {status.lastError && (
        <Notice tone="danger" title={status.needsReconnect ? "Your YouTube sign-in needs renewing" : status.connected ? "The last attempt to connect again did not work" : "The last attempt did not connect"} testId="notice-social-youtube-last-error">
          <span data-testid="text-social-youtube-last-error">{status.lastError.message}</span>
        </Notice>
      )}

      {!status.connected ? (
        <div className="space-y-4">
          <WhatConnectingDoes />
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">{connectPill}</div>
            <ConnectTerms />
          </div>
        </div>
      ) : (
        <>
          <GoogleList testId="list-social-youtube-channel">
            <GoogleListRow
              size="md"
              testId="row-social-youtube-channel"
              titleTestId="text-social-youtube-channel"
              leading={<GoogleAvatar small src={status.channel?.thumbnail} initial={(status.channel?.title || "Y").slice(0, 1)} alt="" />}
              title={status.channel?.title || "Your channel"}
              href={status.channel?.url}
              external
              badges={usable ? <span className="g-chip g-chip--sm !normal-case !text-[var(--g-green)]"><CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden="true" />Connected</span>
                : <span className="g-chip g-chip--sm !normal-case !text-[var(--g-red)]">Needs reconnect</span>}
              meta={[
                <span key="what">Videos you publish here go to this channel</span>,
                status.connectedAt ? <span key="at">Connected {when(status.connectedAt)}</span> : null,
              ]}
              line={<>Not the channel you meant? Choose <strong>Connect a different channel</strong> and pick the right one when Google asks.</>}
              actions={<>
                {usable && <GooglePill variant="solid" icon={Upload} label={open ? "Close" : "Publish a video"} onClick={() => setOpen((v) => !v)} testId="button-social-youtube-open" ariaPressed={open} />}
                {connectPill}
                <GooglePill variant="danger" icon={Unplug} label={disconnect.isPending ? "Disconnecting…" : "Disconnect"} disabled={disconnect.isPending} testId="button-social-youtube-disconnect"
                  onClick={() => { if (window.confirm("Disconnect this YouTube channel? The sign-in is cancelled at Google and everything stored here for it is deleted, including the list of videos you sent. Videos already on YouTube stay there. If you connected other Google tools here with the same Google account, Google may ask you to connect those again.")) disconnect.mutate(); }} />
              </>}
            />
          </GoogleList>
          <ConnectTerms />
          <details className="text-sm" data-testid="details-social-youtube-explainer">
            <summary className="cursor-pointer g-link">What connecting allows, and how to disconnect</summary>
            <div className="mt-2"><WhatConnectingDoes /></div>
          </details>
        </>
      )}

      {usable && open && (
        <form className="space-y-4 rounded-xl border p-4" data-testid="form-social-youtube-publish" onSubmit={(e) => { e.preventDefault(); if (!blocker && !limitReached) publish.mutate(); }}>
          <h3 className="text-base font-medium">Publish a video to {status.channel?.title || "your channel"}</h3>
          {limitReached && (
            <Notice tone="warning" title="Daily limit reached — try again tomorrow" testId="notice-social-youtube-limit">
              {status.limits.sharedLimitReached && status.limits.usedToday < status.limits.perDay
                ? "ConstructHUB’s shared YouTube allowance for today is used up. It resets at midnight Pacific time."
                : `Each account can send ${status.limits.perDay} videos a day. The day resets at midnight Pacific time.`}
            </Notice>
          )}

          <div className="space-y-1.5">
            <span className="text-sm font-medium">Video file</span>
            {sending ? (
              <div className="space-y-1.5" data-testid="progress-social-youtube-file">
                <p className="text-sm">Receiving {sending.name} — {Math.round((sending.done / Math.max(1, sending.total)) * 100)}%</p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((sending.done / Math.max(1, sending.total)) * 100)}>
                  <div className="h-full bg-[var(--g-accent)]" style={{ width: `${(sending.done / Math.max(1, sending.total)) * 100}%` }} />
                </div>
                <GooglePill size="sm" variant="quiet" label="Cancel" onClick={() => { cancelled.current = true; }} />
              </div>
            ) : chosen ? (
              <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="text-social-youtube-file">
                <span>{chosen.fileName} · {size(chosen.bytes)}</span>
                <GooglePill size="sm" variant="quiet" icon={Trash2} label="Remove file" disabled={remove.isPending} onClick={() => remove.mutate(chosen.id)} />
              </p>
            ) : (
              <>
                <Input type="file" aria-label="Video file" className="max-w-md" data-testid="input-social-youtube-file"
                  accept={["video/*", ...status.limits.fileTypes.map((t) => `.${t}`)].join(",")}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void sendFile(f); }} />
                {waiting.length > 0 && (
                  <label className="block max-w-md space-y-1 text-sm">
                    <span className="g-text-2">or use a file you already sent</span>
                    <select className={selectClass} aria-label="A file already sent" value="" onChange={(e) => { const v = waiting.find((w) => w.id === e.target.value); if (v) { setVideoId(v.id); if (v.title && !title) setTitle(v.title); } }}>
                      <option value="">Choose…</option>
                      {waiting.map((v) => <option key={v.id} value={v.id}>{v.fileName} · {size(v.bytes)}</option>)}
                    </select>
                  </label>
                )}
              </>
            )}
            <p className="text-xs g-text-2">Up to {size(status.limits.maxBytes)}. The file is held by ConstructHUB only until YouTube has it, and for at most 24 hours.</p>
          </div>

          <label className="block space-y-1.5">
            <span className="flex justify-between text-sm font-medium"><span>Title</span><span className="font-normal g-text-2">{title.length}/100</span></span>
            <Input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="What the video is about" data-testid="input-social-youtube-title" />
          </label>
          <label className="block space-y-1.5">
            <span className="flex justify-between text-sm font-medium"><span>Description</span><span className="font-normal g-text-2">{description.length.toLocaleString()}/5,000</span></span>
            <Textarea value={description} maxLength={5000} rows={4} onChange={(e) => setDescription(e.target.value)} data-testid="input-social-youtube-description" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Tags <span className="font-normal g-text-2">(optional, separated by commas)</span></span>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="roofing, tampa, metal roof" data-testid="input-social-youtube-tags" />
          </label>
          <label className="block max-w-xs space-y-1.5">
            <span className="text-sm font-medium">Who can see it</span>
            <select className={selectClass} value={privacy} onChange={(e) => setPrivacy(e.target.value)} data-testid="select-social-youtube-privacy">
              <option value="private">Private — only you</option>
              <option value="unlisted">Unlisted — anyone with the link</option>
              <option value="public">Public — everyone</option>
            </select>
          </label>
          <p className="text-xs g-text-2" data-testid="text-social-youtube-privacy-note">
            YouTube decides the final setting. Until Google has reviewed ConstructHUB’s YouTube access, it may keep a video sent from here Private whatever you choose; the list below shows what YouTube actually set, and you can change it in YouTube Studio.
          </p>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Is this video made for kids? <span className="font-normal g-text-2">(YouTube requires an answer)</span></legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="yt-kids" checked={kids === false} onChange={() => setKids(false)} data-testid="radio-social-youtube-kids-no" /> No, it is not made for kids</label>
              <label className="flex items-center gap-2"><input type="radio" name="yt-kids" checked={kids === true} onChange={() => setKids(true)} data-testid="radio-social-youtube-kids-yes" /> Yes, it is made for kids</label>
            </div>
          </fieldset>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={certify} onChange={(e) => setCertify(e.target.checked)} data-testid="checkbox-social-youtube-certify" />
            <span>
              I confirm this video complies with{" "}
              <a className="g-link" href="https://www.youtube.com/howyoutubeworks/policies/community-guidelines/" target="_blank" rel="noopener noreferrer">YouTube’s Community Guidelines</a>{" "}
              and that I own the rights to it, or have permission to publish everything in it. <span className="g-text-2">(Required)</span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <GooglePill type="submit" variant="solid" icon={Youtube} label={publish.isPending ? "Sending…" : "Publish to YouTube"} disabled={publish.isPending || !!blocker || limitReached} testId="button-social-youtube-publish" />
            <span className="text-sm g-text-2" data-testid="text-social-youtube-allowance">{status.limits.usedToday} of {status.limits.perDay} videos sent today</span>
          </div>
          {blocker && <p className="text-sm g-text-2" role="status" data-testid="text-social-youtube-blocker">{blocker}</p>}
        </form>
      )}

      {status.connected && videos.filter((v) => v.state !== "receiving" && v.state !== "ready").length > 0 && (
        <GoogleList testId="list-social-youtube-videos">
          {videos.filter((v) => v.state !== "receiving" && v.state !== "ready").map((v) => (
            <GoogleListRow
              key={v.id}
              size="md"
              testId={`row-social-youtube-video-${v.id}`}
              title={v.title || v.fileName}
              href={v.watchUrl && v.state !== "failed" ? v.watchUrl : undefined}
              external
              badges={<span className={`g-chip g-chip--sm !normal-case ${v.state === "published" ? "!text-[var(--g-green)]" : v.state === "failed" ? "!text-[var(--g-red)]" : ""}`} data-testid={`badge-social-youtube-video-${v.id}`}>
                {v.state === "queued" ? "Queued"
                  : v.state === "uploading" ? `Uploading ${Math.round((v.sentBytes / Math.max(1, v.bytes)) * 100)}%`
                    : v.state === "processing" ? "On YouTube — processing"
                      : v.state === "published" ? "Published" : "Failed"}
              </span>}
              meta={[
                v.channelTitle ? <span key="ch">{v.channelTitle}</span> : null,
                v.actualPrivacy ? <span key="p">{PRIVACY[v.actualPrivacy] ?? v.actualPrivacy} on YouTube{v.privacy && v.privacy !== v.actualPrivacy ? ` (you chose ${PRIVACY[v.privacy] ?? v.privacy})` : ""}</span>
                  : v.privacy ? <span key="p">{PRIVACY[v.privacy] ?? v.privacy}</span> : null,
                <span key="t">{when(v.publishedAt ?? v.createdAt)}</span>,
              ]}
              line={v.state === "failed" ? <span className="!text-[var(--g-red)]" role="alert" data-testid={`text-social-youtube-error-${v.id}`}>{v.error}</span>
                : v.state === "processing" ? "YouTube has the video and is preparing it. The link works once YouTube finishes."
                  : v.state === "queued" ? "Waiting its turn to be sent to YouTube." : undefined}
              actions={<>
                {v.watchUrl && v.state !== "failed" && <GooglePill size="sm" icon={ExternalLink} href={v.watchUrl} external label="Watch on YouTube" testId={`link-social-youtube-watch-${v.id}`} />}
                {v.state === "failed" && v.errorCode === "needs_reconnect" && connectPill}
                {v.state === "failed" && v.fileAvailable && !v.videoId && usable && (
                  <GooglePill size="sm" label="Try again" onClick={() => { setVideoId(v.id); setTitle(v.title ?? ""); setOpen(true); root.current?.scrollIntoView({ block: "start" }); }} />
                )}
                {v.state !== "uploading" && <GooglePill size="sm" variant="quiet" icon={Trash2} label="Remove from this list" disabled={remove.isPending} onClick={() => remove.mutate(v.id)} />}
              </>}
            />
          ))}
        </GoogleList>
      )}
    </section>
  );
}
