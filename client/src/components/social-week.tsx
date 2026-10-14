/**
 * A week of posts, day by day (owner, 2026-10-12): each day shows its posts`
 * networks and count; `full` lists every post of the day by time. One request per day through the page`s own
 * GET /api/social?day= filter (the browser`s timezone), so the days agree with the Posts list.
 */
import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { IconType } from "react-icons";
import { FaBluesky, FaFacebook, FaGoogle, FaInstagram, FaLinkedin, FaMastodon, FaPinterest, FaReddit, FaThreads, FaTiktok, FaTumblr, FaXTwitter, FaYoutube } from "react-icons/fa6";
import { apiRequest } from "@/lib/queryClient";
import { GooglePill } from "@/components/google";
import { socialHref } from "@/components/social-tool/nav";

export const NETWORK_ICON: Record<string, { icon: IconType; color: string; name: string }> = {
  facebook: { icon: FaFacebook, color: "#1877F2", name: "Facebook" }, instagram: { icon: FaInstagram, color: "#E4405F", name: "Instagram" },
  threads: { icon: FaThreads, color: "currentColor", name: "Threads" }, tiktok: { icon: FaTiktok, color: "currentColor", name: "TikTok" },
  x: { icon: FaXTwitter, color: "currentColor", name: "X" },
  twitter: { icon: FaXTwitter, color: "currentColor", name: "X" }, linkedin: { icon: FaLinkedin, color: "#0A66C2", name: "LinkedIn" },
  youtube: { icon: FaYoutube, color: "#FF0000", name: "YouTube" }, pinterest: { icon: FaPinterest, color: "#BD081C", name: "Pinterest" },
  bluesky: { icon: FaBluesky, color: "#1185FE", name: "Bluesky" }, gbp: { icon: FaGoogle, color: "#4285F4", name: "Google" },
  instagram_direct: { icon: FaInstagram, color: "#E4405F", name: "Instagram" }, mastodon: { icon: FaMastodon, color: "#6364FF", name: "Mastodon" },
  tumblr: { icon: FaTumblr, color: "#36465D", name: "Tumblr" }, reddit: { icon: FaReddit, color: "#FF4500", name: "Reddit" },
};
/** The network's proper name ("tumblr" → "Tumblr"); unknown ids come back as they are. */
export const networkName = (platform: string) => NETWORK_ICON[platform]?.name ?? platform;
export function NetworkIcon({ platform, className = "h-4 w-4" }: { platform: string; className?: string }) {
  const n = NETWORK_ICON[platform];
  if (!n) return <span className="text-xs g-text-2">{platform}</span>;
  return <n.icon className={`${className} shrink-0`} style={{ color: n.color }} aria-label={n.name} role="img" />;
}
/** Logo + name, wherever a network is named (owner, 2026-10-13: "anywhere there are brands they better have brands"). */
export function NetworkBadge({ platform, label, className = "", iconClassName = "h-4 w-4" }: { platform: string; label?: string; className?: string; iconClassName?: string }) {
  return <span className={`inline-flex items-center gap-1.5 ${className}`}><NetworkIcon platform={platform} className={iconClassName} /><span>{label ?? networkName(platform)}</span></span>;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const startOfWeek = (d: Date) => { const s = new Date(d.getFullYear(), d.getMonth(), d.getDate()); s.setDate(s.getDate() - s.getDay()); return s; };
const platformOf = (p: any): string => p?.payload?.post?.content?.platform ?? p?.payload?.post?.target?.targetType ?? "";
const stateTone: Record<string, string> = { published: "g-open", failed: "text-destructive", draft: "g-text-2", cancelled: "g-text-2" };

export function SocialWeek({ businessId, all, business, full = false }: { businessId: number | null; all: boolean; business: string | null; full?: boolean }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const results = useQueries({ queries: days.map((d) => {
    const qs = new URLSearchParams({ day: ymd(d), timezone, offset: "0", ...(businessId ? { businessId: String(businessId) } : {}) });
    return { queryKey: ["/api/social", "week", businessId, all, ymd(d)], refetchInterval: 60_000, queryFn: async () => (await apiRequest("GET", `/api/social${all ? "/calendar" : ""}?${qs}`)).json() };
  }) });
  const today = ymd(new Date());
  const last = days[6];
  const range = `${days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${last.toLocaleDateString(undefined, { month: days[0].getMonth() === last.getMonth() ? undefined : "short", day: "numeric" })}`;
  const total = results.reduce((n, r) => n + ((r.data as any)?.total ?? 0), 0);
  const shift = (weeks: number) => setWeekStart((w) => { const n = new Date(w); n.setDate(n.getDate() + 7 * weeks); return n; });
  return (
    <section className="space-y-3" data-testid="social-week">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">{full ? range : "This week"}</h2>
        {!full && <span className="text-sm g-text-2">{range}</span>}
        <span className="text-sm g-text-2">· {total} post{total === 1 ? "" : "s"}</span>
        <span className="ml-auto flex items-center gap-1">
          {full && <>
            <GooglePill size="sm" variant="quiet" icon={ChevronLeft} label="Previous week" onClick={() => shift(-1)} testId="button-week-prev" />
            <GooglePill size="sm" variant="quiet" label="Today" onClick={() => setWeekStart(startOfWeek(new Date()))} testId="button-week-today" />
            <GooglePill size="sm" variant="quiet" icon={ChevronRight} label="Next week" onClick={() => shift(1)} testId="button-week-next" />
          </>}
          {!full && <Link className="g-link text-sm" href={socialHref("calendar", business)}>Open calendar</Link>}
          {full && !all && <GooglePill size="sm" variant="solid" href={socialHref("compose", business)} label="New post" testId="button-week-new-post" />}
        </span>
      </div>
      <div className={full ? "grid gap-2 md:grid-cols-7" : "grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"}>
        {days.map((d, i) => {
          const r = results[i], data = r.data as any, posts: any[] = data?.posts ?? [];
          const nets = Array.from(new Set(posts.map(platformOf).filter(Boolean)));
          const isToday = ymd(d) === today;
          return (
            <div key={ymd(d)} className={`rounded-xl border p-3 ${isToday ? "border-primary bg-primary/5" : "border-border"} ${full ? "min-h-40" : "text-center"}`} data-testid={`week-day-${ymd(d)}`}>
              <div className={`text-xs uppercase tracking-wide ${isToday ? "text-primary" : "g-text-2"}`}>{d.toLocaleDateString(undefined, { weekday: "short" })}{isToday && full ? " · Today" : ""}</div>
              <div className={`font-medium ${full ? "text-base" : "text-xl"}`}>{full ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : d.getDate()}</div>
              {r.isLoading ? <div className="text-xs g-text-2">…</div> : r.isError ? <div className="text-xs text-destructive">Not loaded</div> : !full ? (
                <>
                  <div className="mt-1 flex min-h-5 flex-wrap justify-center gap-1">{nets.map((n) => <NetworkIcon key={n} platform={n} />)}</div>
                  <div className="text-xs g-text-2">{data?.total ? `${data.total} post${data.total === 1 ? "" : "s"}` : "–"}</div>
                </>
              ) : posts.length === 0 ? <div className="mt-2 text-xs g-text-2">Nothing scheduled</div> : (
                <ul className="mt-2 space-y-2">
                  {posts.slice().sort((a, b) => +new Date(a.scheduled_at || a.created_at) - +new Date(b.scheduled_at || b.created_at)).map((p) => (
                    <li key={p.id} className="rounded-lg border border-border p-2 text-xs">
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <NetworkIcon platform={platformOf(p)} className="h-3.5 w-3.5 shrink-0" />
                        <span className="tabular-nums">{new Date(p.scheduled_at || p.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                      </div>
                      <div className={stateTone[p.state] ?? ""}>{p.state === "queued" ? "Scheduled" : p.state.charAt(0).toUpperCase() + p.state.slice(1)}</div>
                      <p className="mt-1 line-clamp-3 break-words">{p.payload?.post?.content?.text}</p>
                      {all && p.business_name && <p className="mt-1 g-text-2 truncate">{p.business_name}</p>}
                    </li>
                  ))}
                  {data.total > posts.length && <li><Link className="g-link" href={socialHref("posts", business)}>+{data.total - posts.length} more</Link></li>}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
