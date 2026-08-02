import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Eye, CalendarPlus, Loader2 } from "lucide-react";
import { InfoTip } from "@/components/info-tip";

/** Compact duration: 45s → "<1m", 720s → "12m", 3900s → "1h 5m". */
function fmtDuration(secs: number): string {
  if (secs < 60) return secs > 0 ? "<1m" : "0m";
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** Compact relative time: "just now", "20m ago", "2h ago", "3d ago". */
function relTime(d?: string | null): string | null {
  if (!d) return null;
  const secs = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  if (secs < 90) return "just now";
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : null);

interface Props {
  estimate: any;
  canManage: boolean;
  onChanged: () => void;
}

/**
 * Per-estimate client engagement + expiry, self-contained for the estimate
 * rows on the client page. Shows "3 visits · 12m total · last 2h ago" with a
 * per-visit breakdown, the expiry date, and a one-click Extend (+7 days)
 * while the estimate is still unanswered. Contractor-side only — this never
 * renders on the public pages.
 */
export function EstimateEngagement({ estimate: e, canManage, onChanged }: Props) {
  const { toast } = useToast();
  const { data: eng } = useQuery<any>({
    queryKey: [`/api/crm/estimates/${e.id}/engagement`],
    enabled: !!e.sentAt,
  });

  const extend = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/estimates/${e.id}/extend`, { days: 7 })).json(),
    onSuccess: () => {
      onChanged();
      toast({ title: "Expiry extended", description: "The client has 7 more days from today." });
    },
    onError: (err: any) =>
      toast({ title: "Could not extend", description: String(err.message ?? err), variant: "destructive" }),
  });

  const settled = !!(e.approvedAt || e.declinedAt);
  const expired = e.expiresAt && new Date(e.expiresAt).getTime() < Date.now();
  const visits: any[] = eng?.sessions ?? [];

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground"
      data-testid={`engagement-${e.id}`}>
      {e.sentAt && (
        <InfoTip k="engagement" className="h-6 w-6 my-0 mx-0 [&>svg]:h-3 [&>svg]:w-3" />
      )}
      {eng && eng.visits > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1 hover:text-foreground">
            <Eye className="h-3 w-3" />
            {eng.visits} {eng.visits === 1 ? "visit" : "visits"} · {fmtDuration(eng.totalSecs)} total
            {eng.lastVisitAt ? ` · last ${relTime(eng.lastVisitAt)}` : ""}
          </summary>
          <ul className="mt-1 space-y-0.5 border-l pl-3" data-testid={`engagement-visits-${e.id}`}>
            {visits.map((s: any, i: number) => (
              <li key={i}>
                {new Date(s.startedAt).toLocaleString()} · {fmtDuration(s.durationSecs)}
                {s.ip ? ` · ${s.ip}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      {e.expiresAt && !settled && (
        <span className={expired ? "text-destructive font-medium" : ""}>
          {expired ? `Expired ${day(e.expiresAt)}` : `Expires ${day(e.expiresAt)}`}
          <InfoTip k="estimate-expiry" className="h-6 w-6 my-0 mx-0 ml-1 [&>svg]:h-3 [&>svg]:w-3" />
        </span>
      )}
      {canManage && !settled && e.sentAt && (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50"
          onClick={() => extend.mutate()}
          disabled={extend.isPending}
          data-testid={`button-extend-${e.id}`}
        >
          {extend.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CalendarPlus className="h-3 w-3" />}
          Extend 7 days
        </button>
      )}
    </div>
  );
}
