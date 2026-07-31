import { useQuery } from "@tanstack/react-query";
import {
  Inbox, Loader2, Eye, CheckCircle2, XCircle, CreditCard, AlertTriangle, Undo2,
} from "lucide-react";
import { CrmPage, CrmPageHeader, EmptyState, ErrorCard } from "@/components/crm-ui";

interface ActivityItem {
  id: string;
  kind: "estimate" | "payment";
  type: string; // estimate: viewed|approved|declined · payment: succeeded|failed|refunded
  at: string;
  customerName: string | null;
  estimateNumber?: string | null;
  estimateTitle?: string | null;
  amountCents?: number;
  method?: string | null;
  purpose?: string;
  note?: string | null;
}

const money = (c: number) =>
  `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

function relTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** One icon + verb line per event, so the feed reads like a sentence. */
function present(item: ActivityItem): { icon: any; tint: string; text: string } {
  const who = item.customerName || "A client";
  if (item.kind === "estimate") {
    const doc = item.estimateNumber
      ? `estimate ${item.estimateNumber}`
      : `an estimate${item.estimateTitle ? ` (${item.estimateTitle})` : ""}`;
    switch (item.type) {
      case "viewed":
        return { icon: Eye, tint: "text-blue-600 dark:text-blue-400 bg-blue-500/10", text: `${who} viewed ${doc}` };
      case "approved":
        return { icon: CheckCircle2, tint: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10", text: `${who} approved ${doc}` };
      case "declined":
        return { icon: XCircle, tint: "text-red-600 dark:text-red-400 bg-red-500/10", text: `${who} declined ${doc}` };
      default:
        return { icon: Eye, tint: "text-muted-foreground bg-muted", text: `${who} ${item.type} ${doc}` };
    }
  }
  const amount = item.amountCents != null ? money(item.amountCents) : "a payment";
  const detail = [item.method, item.purpose].filter(Boolean).join(" · ");
  switch (item.type) {
    case "succeeded":
      return { icon: CreditCard, tint: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
        text: `${who} paid ${amount}${detail ? ` (${detail})` : ""}` };
    case "failed":
      return { icon: AlertTriangle, tint: "text-red-600 dark:text-red-400 bg-red-500/10",
        text: `${who}'s ${amount} payment failed` };
    case "refunded":
      return { icon: Undo2, tint: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
        text: `${who} was refunded ${amount}` };
    default:
      return { icon: CreditCard, tint: "text-muted-foreground bg-muted", text: `${who} · ${amount}` };
  }
}

/** The client-activity feed: estimate views/approvals/declines and payments. */
export default function CrmInboxPage() {
  const { data, isLoading, isError } = useQuery<{ activity: ActivityItem[] }>({
    queryKey: ["/api/crm/activity"],
  });

  const items = data?.activity ?? [];

  return (
    <CrmPage>
      <CrmPageHeader
        icon={Inbox}
        title="Inbox"
        subtitle="What your clients are doing, as it happens."
      />

      {isLoading ? (
        <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : isError || !data ? (
        <ErrorCard title="Couldn't load the inbox" description="Check your connection and refresh the page." />
      ) : items.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={Inbox}
            title="No activity yet"
            description="When a client opens, approves or declines an estimate — or pays you — it lands here."
          />
        </div>
      ) : (
        <div className="rounded-xl border bg-card divide-y" data-testid="activity-feed">
          {items.map((item) => {
            const p = present(item);
            return (
              <div key={item.id} className="flex items-center gap-3 px-3.5 sm:px-4 py-3" data-testid={`activity-${item.id}`}>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${p.tint}`}>
                  <p.icon className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm leading-snug">{p.text}</div>
                  {item.note && <div className="text-xs text-muted-foreground mt-0.5 truncate">{item.note}</div>}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">{relTime(item.at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </CrmPage>
  );
}
