/**
 * Social Media → New post → the TikTok panel, built to TikTok's Content Sharing Guidelines (docs/social-apps/tiktok.md
 * §5.2), which TikTok's app review and Direct Post audit check one by one:
 *   - who is posting (nickname, @username, avatar), asked fresh from TikTok each time the panel opens — never cached;
 *     a creator who can't post right now is told so and posting stops;
 *   - "Who can view this post": only the creator's own options, NO default — posting waits for a choice;
 *   - Allow Comment / Duet / Stitch: unticked by default, greyed out when the creator switched them off; photo posts
 *     show only Allow Comment;
 *   - Disclose post content (off by default) → Your brand / Branded content, at least one when on, with TikTok's labels;
 *     branded content can't be "Only me";
 *   - a preview of the media, the creator's maximum video length enforced, and a note that TikTok takes a few minutes.
 * The music / branded-content declaration sits directly above the Post button (TikTokDeclaration, in the composer).
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import { Switch } from "@/components/ui/switch";
import { GooglePill } from "@/components/google";
import type { Destination } from "@shared/social";

const selectClass = "h-10 w-full rounded-full border border-input bg-background px-4 text-sm";

export const TIKTOK_PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};
const ALL_PRIVACY = Object.keys(TIKTOK_PRIVACY_LABEL);
export const BRANDED_PRIVATE = "Branded content visibility cannot be set to private.";
export const CANT_POST = "This TikTok account can't post right now. Try again later.";
const MUSIC_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
const BC_POLICY_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";

export type CreatorInfo = {
  nickname: string; username: string; avatarUrl: string | null; privacyLevelOptions: string[];
  commentDisabled: boolean; duetDisabled: boolean; stitchDisabled: boolean; maxVideoPostDurationSec: number | null;
  canPost: boolean; message?: string;
};

export const isVideoUrl = (u: string) => /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(u);

/**
 * Why this TikTok destination can't be posted yet, or "" when it can. Pure — the order is the order the customer fixes it.
 * `info` null = still loading; `durationSec` undefined = the video's length is still being read (null = unreadable).
 */
export function tiktokProblem(d: Pick<Destination, "tiktokPrivacy" | "isBrandedContent" | "isYourBrand">, o: {
  info: CreatorInfo | null; loadError?: string | null; disclose: boolean; media: string[]; durationSec?: number | null;
}): string {
  if (o.loadError) return `TikTok: couldn't load your account details (${o.loadError}). Try again.`;
  if (!o.info) return "TikTok: loading your account details…";
  if (!o.info.canPost) return o.info.message || CANT_POST;
  const videos = o.media.filter(isVideoUrl);
  if (!o.media.length) return "TikTok needs a video or photos.";
  if (videos.length && o.media.length > 1) return "TikTok takes one video, or photos without a video.";
  if (!videos.length && o.media.length > 35) return "TikTok photo posts take up to 35 photos.";
  if (!d.tiktokPrivacy) return "TikTok: choose who can view this post.";
  if (!o.info.privacyLevelOptions.includes(d.tiktokPrivacy)) return "TikTok: choose who can view this post again — your TikTok options changed.";
  if (d.isBrandedContent && d.tiktokPrivacy === "SELF_ONLY") return `TikTok: ${BRANDED_PRIVATE}`;
  if (o.disclose && !d.isBrandedContent && !d.isYourBrand) return "TikTok: you need to indicate if your content promotes yourself, a third party, or both.";
  if (videos.length) {
    const max = o.info.maxVideoPostDurationSec;
    if (max && o.durationSec === undefined) return "TikTok: checking the video's length…";
    if (max && o.durationSec && o.durationSec > max) return `TikTok: this video is ${Math.ceil(o.durationSec)} seconds long; this account can post videos up to ${max} seconds.`;
  }
  return "";
}

/** The label TikTok will put on the post, from the disclosure ticks. */
export function disclosureLabel(d: Pick<Destination, "isBrandedContent" | "isYourBrand">): string | null {
  if (d.isBrandedContent) return "Your photo/video will be labeled as 'Paid partnership'";
  if (d.isYourBrand) return "Your photo/video will be labeled as 'Promotional content'";
  return null;
}

/** "By posting, you agree to …" — directly above the Post button whenever a TikTok destination is chosen. */
export function TikTokDeclaration({ branded }: { branded: boolean }) {
  const link = (href: string, text: string) => <a className="g-link" href={href} target="_blank" rel="noopener noreferrer">{text}</a>;
  return (
    <p className="text-sm g-text-2" data-testid="tiktok-declaration">
      By posting, you agree to TikTok&rsquo;s{" "}
      {branded ? <>{link(BC_POLICY_URL, "Branded Content Policy")} and {link(MUSIC_URL, "Music Usage Confirmation")}</> : link(MUSIC_URL, "Music Usage Confirmation")}
    </p>
  );
}

export function TikTokPanel({ accountId, accountName, d, media, native, businessId, onChange, onProblem }: {
  accountId: string; accountName: string; d: Destination; media: string[];
  /** Connected through ConstructHUB's own TikTok app: creator info comes from TikTok. Otherwise TikTok's four levels. */
  native: boolean; businessId: number | null;
  onChange: (patch: Partial<Destination>) => void; onProblem: (problem: string) => void;
}) {
  const scope = new URLSearchParams({ accountId, ...(businessId ? { businessId: String(businessId) } : {}) });
  // Fresh on every render of the panel (TikTok's rule): no cache, refetched on mount and focus.
  const creator = useQuery<CreatorInfo>({
    queryKey: ["/api/social/native/tiktok/creator-info", accountId, businessId],
    enabled: native,
    staleTime: 0, gcTime: 0, retry: false, refetchOnMount: "always", refetchOnWindowFocus: "always",
    queryFn: async () => (await apiRequest("GET", `/api/social/native/tiktok/creator-info?${scope}`)).json(),
  });
  const info: CreatorInfo | null = native
    ? creator.data ?? null
    : { nickname: "", username: "", avatarUrl: null, privacyLevelOptions: ALL_PRIVACY, commentDisabled: false, duetDisabled: false, stitchDisabled: false, maxVideoPostDurationSec: null, canPost: true };
  const loadError = native && creator.isError ? apiErrorMessage(creator.error) : null;

  const [disclose, setDisclose] = useState(() => !!(d.isBrandedContent || d.isYourBrand));
  const videos = media.filter(isVideoUrl);
  const isPhoto = media.length > 0 && !videos.length;
  const video = videos.length === 1 && media.length === 1 ? videos[0] : null;
  // The video's length, read from a hidden <video>'s metadata (undefined while reading, null when unreadable).
  const [duration, setDuration] = useState<{ url: string; sec: number | null } | null>(null);
  const durationSec = video ? (duration?.url === video ? duration.sec : undefined) : null;

  // The creator's settings win over a restored choice: an option they no longer offer is cleared, never swapped.
  const opts = info?.privacyLevelOptions ?? [];
  useEffect(() => {
    if (!info) return;
    const patch: Partial<Destination> = {};
    if (d.tiktokPrivacy && !opts.includes(d.tiktokPrivacy)) patch.tiktokPrivacy = "";
    if (d.isBrandedContent && d.tiktokPrivacy === "SELF_ONLY") patch.tiktokPrivacy = "";
    if (info.commentDisabled && d.allowComment) patch.allowComment = false;
    if ((info.duetDisabled || isPhoto) && d.allowDuet) patch.allowDuet = false;
    if ((info.stitchDisabled || isPhoto) && d.allowStitch) patch.allowStitch = false;
    if (Object.keys(patch).length) onChange(patch);
  }, [info, d.tiktokPrivacy, d.isBrandedContent, d.allowComment, d.allowDuet, d.allowStitch, isPhoto]); // eslint-disable-line react-hooks/exhaustive-deps

  const problem = tiktokProblem(d, { info, loadError, disclose, media, durationSec });
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (reported.current === problem) return;
    reported.current = problem;
    onProblem(problem);
  }, [problem]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = disclosureLabel(d);
  const check = (key: "allowComment" | "allowDuet" | "allowStitch", text: string, off: boolean) => (
    <label className={`flex items-center gap-1.5 text-sm ${off ? "cursor-not-allowed opacity-50" : ""}`} title={off ? "Turned off in this account's TikTok settings" : undefined}>
      <input type="checkbox" data-testid={`tiktok-${key}`} checked={!!d[key] && !off} disabled={off} onChange={(e) => onChange({ [key]: e.target.checked })} />
      {text}
    </label>
  );

  return (
    <div className="space-y-4 rounded-lg border p-3" data-testid="tiktok-panel">
      {/* Who is posting */}
      {native && creator.isLoading ? (
        <p className="text-sm g-text-2" role="status" data-testid="tiktok-creator-loading">Loading your TikTok account…</p>
      ) : loadError ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="alert" data-testid="tiktok-creator-error">
          <span>Couldn&rsquo;t load your TikTok account details: {loadError}</span>
          <GooglePill size="sm" label="Try again" onClick={() => void creator.refetch()} />
        </div>
      ) : (
        <div className="flex items-center gap-3" data-testid="tiktok-creator">
          {info?.avatarUrl && <img src={info.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" referrerPolicy="no-referrer" />}
          <p className="text-sm">
            Posting to <span className="font-medium">{info?.username ? `@${info.username}` : accountName}</span>
            {info?.nickname ? <> · {info.nickname}</> : null}
          </p>
        </div>
      )}
      {info && !info.canPost && <p className="text-sm font-medium" role="alert" data-testid="tiktok-cant-post">{info.message || CANT_POST}</p>}

      {info?.canPost && (
        <>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Who can view this post</span>
            <select
              aria-label="Who can view this TikTok post"
              data-testid="tiktok-privacy"
              className={selectClass}
              value={d.tiktokPrivacy && opts.includes(d.tiktokPrivacy) ? d.tiktokPrivacy : ""}
              onChange={(e) => onChange({ tiktokPrivacy: e.target.value as Destination["tiktokPrivacy"] })}
            >
              <option value="" disabled>Choose who can view</option>
              {opts.map((o) => {
                const blocked = o === "SELF_ONLY" && !!d.isBrandedContent;
                return <option key={o} value={o} disabled={blocked} title={blocked ? BRANDED_PRIVATE : undefined}>{TIKTOK_PRIVACY_LABEL[o] ?? o}</option>;
              })}
            </select>
            {d.isBrandedContent && opts.includes("SELF_ONLY") && <span className="block text-xs text-muted-foreground">{BRANDED_PRIVATE}</span>}
          </label>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Allow users to</legend>
            <div className="flex flex-wrap gap-4">
              {check("allowComment", "Allow Comment", info.commentDisabled)}
              {!isPhoto && check("allowDuet", "Allow Duet", info.duetDisabled)}
              {!isPhoto && check("allowStitch", "Allow Stitch", info.stitchDisabled)}
            </div>
          </fieldset>

          <div className="space-y-2">
            <label className="flex items-center justify-between gap-3">
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">Disclose post content</span>
                <span className="block text-xs text-muted-foreground">Turn on to disclose that this post promotes goods or services in exchange for something of value. Your post could promote yourself, a third party, or both.</span>
              </span>
              <Switch
                data-testid="tiktok-disclose"
                aria-label="Disclose post content"
                checked={disclose}
                onCheckedChange={(on) => { setDisclose(on); if (!on) onChange({ isBrandedContent: false, isYourBrand: false }); }}
              />
            </label>
            {disclose && (
              <div className="space-y-2 pl-1">
                <label className="flex items-start gap-1.5 text-sm">
                  <input type="checkbox" className="mt-1" data-testid="tiktok-your-brand" checked={!!d.isYourBrand} onChange={(e) => onChange({ isYourBrand: e.target.checked })} />
                  <span><span className="font-medium">Your brand</span><span className="block text-xs text-muted-foreground">You are promoting yourself or your own business.</span></span>
                </label>
                <label className="flex items-start gap-1.5 text-sm">
                  <input type="checkbox" className="mt-1" data-testid="tiktok-branded-content" checked={!!d.isBrandedContent}
                    onChange={(e) => onChange(e.target.checked && d.tiktokPrivacy === "SELF_ONLY" ? { isBrandedContent: true, tiktokPrivacy: "" } : { isBrandedContent: e.target.checked })} />
                  <span><span className="font-medium">Branded content</span><span className="block text-xs text-muted-foreground">You are promoting another brand or a third party.</span></span>
                </label>
                {label ? <p className="text-sm" data-testid="tiktok-disclosure-label">{label}</p>
                  : <p className="text-sm" role="alert" data-testid="tiktok-disclosure-needed">You need to indicate if your content promotes yourself, a third party, or both.</p>}
              </div>
            )}
          </div>
        </>
      )}

      {/* What will be posted, as chosen — no watermark or branding is added. */}
      {media.length > 0 && (
        <div className="space-y-1.5" data-testid="tiktok-preview">
          <span className="text-sm font-medium">Preview</span>
          {video ? (
            <video src={video} controls playsInline preload="metadata" className="max-h-80 w-full max-w-xs rounded-lg bg-black" />
          ) : (
            <div className="flex flex-wrap gap-2">
              {media.filter((u) => !isVideoUrl(u)).map((u) => <img key={u} src={u} alt="" className="h-24 w-24 rounded-lg object-cover" />)}
            </div>
          )}
        </div>
      )}
      {video && (
        <video key={video} src={video} preload="metadata" muted className="hidden" aria-hidden="true"
          onLoadedMetadata={(e) => { const s = e.currentTarget.duration; setDuration({ url: video, sec: Number.isFinite(s) ? s : null }); }}
          onError={() => setDuration({ url: video, sec: null })} />
      )}
      {problem && !problem.endsWith("…") && <p className="text-sm g-text-2" data-testid="tiktok-problem">{problem}</p>}
      <p className="text-xs text-muted-foreground">After you post, it can take a few minutes for it to appear on your TikTok profile.</p>
    </div>
  );
}
