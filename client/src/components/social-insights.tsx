/**
 * Social Media → stats, comments and deleting for accounts connected through ConstructHUB's own apps
 * (server/social/insights.ts). Owner, 2026-10-12: Blotato "can't see followers, stats, likes, or delete videos".
 *
 *   SocialAccountStats   one tile per connected account: followers, and reach / views / engagement over 7 or 28 days
 *   SocialPostInsights   on a published post: likes, comments, shares, views; its comments (reply, hide, delete); delete the post
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import { GoogleSectionHeader, GooglePill } from "@/components/google";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

type AccountStats = {
  accountId: string; platform: string; name: string; days: number;
  followers: number | null; following: number | null; posts: number | null; likes: number | null;
  reach: number | null; views: number | null; engagement: number | null; error: string | null; note: string | null;
};
type PostStats = { likes: number | null; comments: number | null; shares: number | null; views: number | null; reach: number | null; saves: number | null; note: string | null; deleted: boolean };
type Comment = { id: string; text: string; author: string; at: string | null; likes: number | null; hidden: boolean; mine: boolean; canHide: boolean; canDelete: boolean; replies: Comment[] };

const NETWORK: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", threads: "Threads", tiktok: "TikTok" };
const fmt = (n: number | null) => (n === null ? "—" : n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K` : n.toLocaleString());
const scopeOf = (businessId: number | null | undefined) => (businessId ? `?businessId=${businessId}` : "");
const withScope = (path: string, businessId: number | null | undefined) => `${path}${businessId ? `${path.includes("?") ? "&" : "?"}businessId=${businessId}` : ""}`;

export function SocialAccountStats({ businessId }: { businessId: number | null }) {
  const [days, setDays] = useState<7 | 28>(28);
  const q = useQuery<{ accounts: AccountStats[] }>({
    queryKey: ["/api/social/native/stats", businessId, days],
    queryFn: async () => (await apiRequest("GET", withScope(`/api/social/native/stats?days=${days}`, businessId))).json(),
    staleTime: 10 * 60_000,
  });
  return (
    <section data-testid="social-account-stats">
      <GoogleSectionHeader
        title="Account stats"
        description="Followers and how your posts did, straight from each network."
        actions={
          <span className="flex gap-1">
            {([7, 28] as const).map((d) => (
              <GooglePill key={d} size="sm" variant={days === d ? "solid" : "outline"} selected={days === d} ariaPressed={days === d} label={`${d} days`} onClick={() => setDays(d)} testId={`button-stats-${d}`} />
            ))}
          </span>
        }
      />
      {q.isLoading && <p className="text-sm g-text-2">Reading your accounts…</p>}
      {q.isError && <p role="alert" className="text-sm g-closed">{apiErrorMessage(q.error)}</p>}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {q.data?.accounts.map((a) => {
          const tiles: [string, number | null][] = [
            ["Followers", a.followers], ...(a.following !== null ? [["Following", a.following] as [string, number | null]] : []),
            ...(a.posts !== null ? [["Posts", a.posts] as [string, number | null]] : []), ...(a.likes !== null ? [["Likes", a.likes] as [string, number | null]] : []),
            ...(a.platform !== "tiktok" ? [["Reach", a.reach], ["Views", a.views], ["Engagement", a.engagement]] as [string, number | null][] : []),
          ];
          return (
            <article key={a.accountId} className="space-y-2 rounded-lg border p-3" data-testid={`stats-account-${a.accountId}`}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-medium">{a.name}</p>
                <span className="text-xs g-text-2">{NETWORK[a.platform] ?? a.platform}</span>
              </div>
              {a.error ? (
                <p role="alert" className="text-xs g-closed">{a.error}</p>
              ) : (
                <dl className="grid grid-cols-3 gap-x-3 gap-y-1">
                  {tiles.map(([label, v]) => (
                    <div key={label}>
                      <dt className="text-xs g-text-2">{label}</dt>
                      <dd className="text-base font-semibold tabular-nums">{fmt(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {a.note && !a.error && <p className="text-xs g-text-2">{a.note}</p>}
              {!a.error && a.platform !== "tiktok" && <p className="text-xs g-text-2">Reach, views and engagement: last {a.days} days.</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** One published post: its numbers, its comments, and deleting it from the network. */
export function SocialPostInsights({ post }: { post: any }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const base = `/api/social/native/posts/${post.id}`;
  const scope = scopeOf(post.business_id);
  const platform: string = post.payload?.post?.content?.platform ?? "";
  const network = NETWORK[platform] ?? platform;
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const stats = useQuery<PostStats>({
    queryKey: [base, "stats"], staleTime: 10 * 60_000, retry: false,
    queryFn: async () => (await apiRequest("GET", `${base}/stats${scope}`)).json(),
  });
  const del = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `${base}${scope}`)).json() as Promise<{ network: string }>,
    onSuccess: (d) => { toast({ title: `Deleted from ${d.network}`, description: "ConstructHUB keeps the record of this post." }); void qc.invalidateQueries({ queryKey: ["/api/social"] }); void qc.invalidateQueries({ queryKey: [base] }); },
    onError: (e) => toast({ title: "Couldn't delete it", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const s = stats.data;
  const parts: [string, number | null][] = s ? [["likes", s.likes], ["comments", s.comments], ["shares", s.shares], ["views", s.views], ["reach", s.reach], ["saves", s.saves]] : [];
  const shown = parts.filter(([, v]) => v !== null);
  return (
    <div className="space-y-2" data-testid={`insights-post-${post.id}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {stats.isLoading && <span className="g-text-2">Reading stats…</span>}
        {stats.isError && <span className="g-closed">{apiErrorMessage(stats.error)}</span>}
        {s?.deleted && <span className="g-chip g-chip--sm g-closed">Deleted on {network}</span>}
        {!s?.deleted && shown.map(([label, v]) => (
          <span key={label} className="tabular-nums" data-testid={`stat-${label}-${post.id}`}><strong>{fmt(v)}</strong> <span className="g-text-2">{label}</span></span>
        ))}
        {s?.note && <span className="text-xs g-text-2">{s.note}</span>}
      </div>
      {!s?.deleted && (
        <div className="flex flex-wrap gap-2">
          {platform !== "tiktok" && <GooglePill size="sm" variant="outline" label={open ? "Hide comments" : "Comments"} onClick={() => setOpen((o) => !o)} testId={`button-comments-${post.id}`} />}
          {platform !== "tiktok" ? (
            <GooglePill size="sm" variant="quiet" label={`Delete from ${network}`} disabled={del.isPending} onClick={() => setConfirmDelete(true)} testId={`button-delete-published-${post.id}`} />
          ) : (
            <span className="text-xs g-text-2">TikTok doesn't let apps delete videos or read comments; use the TikTok app.</span>
          )}
        </div>
      )}
      {open && !s?.deleted && <PostComments base={base} scope={scope} postId={post.id} />}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent data-testid={`dialog-delete-published-${post.id}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this post from {network}?</AlertDialogTitle>
            <AlertDialogDescription>
              It's removed from {network}, with its likes and comments. This can't be undone. ConstructHUB keeps a record that it was posted and deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmDelete(false); del.mutate(); }} data-testid={`button-delete-published-confirm-${post.id}`}>Delete from {network}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PostComments({ base, scope, postId }: { base: string; scope: string; postId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const list = useQuery<{ comments: Comment[]; note: string | null }>({
    queryKey: [base, "comments"], retry: false,
    queryFn: async () => (await apiRequest("GET", `${base}/comments${scope}`)).json(),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: [base, "comments"] });
  const act = useMutation({
    mutationFn: async (a: { kind: "reply" | "hide" | "delete"; id: string; message?: string; hidden?: boolean }) => {
      const path = `${base}/comments/${encodeURIComponent(a.id)}`;
      if (a.kind === "reply") return (await apiRequest("POST", `${path}/reply${scope}`, { message: a.message })).json();
      if (a.kind === "hide") return (await apiRequest("POST", `${path}/hide${scope}`, { hidden: a.hidden })).json();
      return (await apiRequest("DELETE", `${path}${scope}`)).json();
    },
    onSuccess: (_d, a) => { refresh(); toast({ title: a.kind === "reply" ? "Reply posted" : a.kind === "hide" ? (a.hidden ? "Comment hidden" : "Comment shown") : "Comment deleted" }); },
    onError: (e) => toast({ title: "That didn't work", description: apiErrorMessage(e), variant: "destructive" }),
  });
  if (list.isLoading) return <p className="text-sm g-text-2">Loading comments…</p>;
  if (list.isError) return <p role="alert" className="text-sm g-closed">{apiErrorMessage(list.error)}</p>;
  const all = list.data?.comments ?? [];
  return (
    <div className="space-y-2 rounded-lg border p-3" data-testid={`comments-${postId}`}>
      {list.data?.note && <p className="text-sm g-text-2">{list.data.note}</p>}
      {!list.data?.note && all.length === 0 && <p className="text-sm g-text-2">No comments yet.</p>}
      {all.map((c) => <CommentRow key={c.id} c={c} busy={act.isPending} act={(a) => act.mutate(a)} />)}
    </div>
  );
}

function CommentRow({ c, busy, act, depth = 0 }: { c: Comment; busy: boolean; act: (a: { kind: "reply" | "hide" | "delete"; id: string; message?: string; hidden?: boolean }) => void; depth?: number }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [confirm, setConfirm] = useState(false);
  return (
    <div className={depth ? "ml-5 border-l pl-3" : ""} data-testid={`comment-${c.id}`}>
      <p className="text-sm">
        <strong>{c.author || "Someone"}</strong>{" "}
        {c.hidden && <span className="g-chip g-chip--sm">Hidden</span>}{" "}
        <span className="whitespace-pre-wrap">{c.text}</span>
      </p>
      <p className="text-xs g-text-2">
        {c.at ? new Date(c.at).toLocaleString() : ""}{c.likes !== null ? ` · ${c.likes} like${c.likes === 1 ? "" : "s"}` : ""}
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        {depth === 0 && <GooglePill size="sm" variant="quiet" label="Reply" disabled={busy} onClick={() => setReplying((r) => !r)} testId={`button-reply-${c.id}`} />}
        {c.canHide && !c.mine && <GooglePill size="sm" variant="quiet" label={c.hidden ? "Show" : "Hide"} disabled={busy} onClick={() => act({ kind: "hide", id: c.id, hidden: !c.hidden })} testId={`button-hide-${c.id}`} />}
        {c.canDelete && <GooglePill size="sm" variant="quiet" label="Delete" disabled={busy} onClick={() => setConfirm(true)} testId={`button-delete-comment-${c.id}`} />}
      </div>
      {replying && (
        <div className="mt-2 space-y-2">
          <Textarea aria-label={`Reply to ${c.author}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply as your business…" />
          <GooglePill size="sm" variant="solid" label="Post reply" disabled={busy || !text.trim()} onClick={() => { act({ kind: "reply", id: c.id, message: text }); setText(""); setReplying(false); }} testId={`button-send-reply-${c.id}`} />
        </div>
      )}
      {c.replies.map((r) => <CommentRow key={r.id} c={r} busy={busy} act={act} depth={depth + 1} />)}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
            <AlertDialogDescription>It's removed from the post for everyone. This can't be undone. Hiding it instead keeps it visible only to its author.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirm(false); act({ kind: "delete", id: c.id }); }}>Delete comment</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
