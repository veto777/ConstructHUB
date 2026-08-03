import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Inbox, Loader2, Eye, CheckCircle2, XCircle, CreditCard, AlertTriangle, Undo2,
  MessageSquare, Send, ArrowLeft, Clock,
} from "lucide-react";
import { CrmPage, CrmPageHeader, EmptyState, ErrorCard, InitialAvatar } from "@/components/crm-ui";

/* ── Shared bits ─────────────────────────────────────────────────────────── */

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

/** How long a client message has sat unanswered — hours matter here. */
function waitingFor(iso: string): { label: string; urgent: boolean } {
  const h = (Date.now() - new Date(iso).getTime()) / 3600_000;
  if (h < 1) return { label: `waiting ${Math.max(1, Math.floor(h * 60))}m`, urgent: false };
  if (h < 24) return { label: `waiting ${Math.floor(h)}h`, urgent: h >= 2 };
  return { label: `waiting ${Math.floor(h / 24)}d`, urgent: true };
}

/* ── Messages: thread list + conversation ───────────────────────────────── */

type Thread = {
  customerId: string;
  customerName: string;
  lastAt: string;
  unread: number;
  lastBody: string;
  lastAuthorMemberId: string | null;
  oldestUnreadAt: string | null;
};

type Message = {
  id: string;
  body: string;
  fromClient: boolean;
  authorName: string;
  toMemberName: string | null;
  estimateNumber: string | null;
  createdAt: string;
  readAt: string | null;
};

function MessagesPane({ selected }: { selected: string | null }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [reply, setReply] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const { data: inbox, isLoading } = useQuery<{ unreadTotal: number; threads: Thread[] }>({
    queryKey: ["/api/crm/inbox"],
    refetchInterval: 20_000,
  });

  const { data: thread } = useQuery<{ customer: any; messages: Message[] }>({
    queryKey: ["/api/crm/inbox", selected],
    queryFn: async () => {
      const r = await fetch(`/api/crm/inbox/${selected}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!selected,
    refetchInterval: 15_000,
  });

  // Opening a thread reads it — like a text conversation.
  const markRead = useMutation({
    mutationFn: (customerId: string) =>
      apiRequest("POST", `/api/crm/inbox/${customerId}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/inbox"] });
    },
  });
  const readOnce = useRef<string | null>(null);
  useEffect(() => {
    if (selected && thread && readOnce.current !== selected) {
      readOnce.current = selected;
      const hasUnread = thread.messages.some((m) => m.fromClient && !m.readAt);
      if (hasUnread) markRead.mutate(selected);
    }
  }, [selected, thread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages?.length]);

  const sendReply = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/inbox/${selected}/reply`, { body: reply })).json(),
    onSuccess: () => {
      setReply("");
      queryClient.invalidateQueries({ queryKey: ["/api/crm/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/inbox", selected] });
      toast({ title: "Reply sent", description: "It's in their portal and their email inbox." });
    },
    onError: (e: any) => toast({ title: "Could not send", description: String(e.message ?? e), variant: "destructive" }),
  });

  const threads = inbox?.threads ?? [];

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!threads.length) {
    return (
      <Card>
        <EmptyState
          icon={MessageSquare}
          title="No messages yet"
          description="When a client sends a message from their portal or asks a question on an estimate, the conversation starts here."
        />
      </Card>
    );
  }

  const list = (
    <div className={`flex-col gap-1 w-full md:w-80 md:shrink-0 ${selected ? "hidden md:flex" : "flex"}`}
      data-testid="inbox-thread-list">
      {threads.map((t) => {
        const wait = t.unread > 0 && t.oldestUnreadAt ? waitingFor(t.oldestUnreadAt) : null;
        return (
          <button
            key={t.customerId}
            className={`text-left rounded-lg border px-3 py-2.5 transition-colors hover:bg-accent ${
              selected === t.customerId ? "border-primary/60 bg-primary/5" : ""
            } ${t.unread > 0 ? "border-primary/40" : ""}`}
            onClick={() => navigate(`/crm/inbox?c=${t.customerId}`)}
            data-testid={`thread-${t.customerId}`}
          >
            <div className="flex items-center gap-2.5">
              <InitialAvatar name={t.customerName} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm ${t.unread > 0 ? "font-semibold" : "font-medium"}`}>
                    {t.customerName}
                  </span>
                  <span className="text-[11px] text-muted-foreground shrink-0">{relTime(t.lastAt)}</span>
                </div>
                <div className={`text-xs truncate ${t.unread > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                  {t.lastAuthorMemberId ? "You: " : ""}{t.lastBody}
                </div>
                {wait && (
                  <div className={`text-[11px] mt-0.5 flex items-center gap-1 ${wait.urgent ? "text-red-600 dark:text-red-400 font-medium" : "text-amber-600 dark:text-amber-400"}`}>
                    <Clock className="h-3 w-3" /> {wait.label} for a reply
                  </div>
                )}
              </div>
              {t.unread > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs leading-5 text-center font-semibold shrink-0"
                  data-testid={`thread-unread-${t.customerId}`}>
                  {t.unread}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );

  const conversation = selected ? (
    <Card className="flex-1 min-w-0 flex flex-col" data-testid="inbox-conversation">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <button className="md:hidden text-muted-foreground" onClick={() => navigate("/crm/inbox")}
          data-testid="button-back-to-threads">
          <ArrowLeft className="h-4 w-4" />
        </button>
        {thread?.customer && (
          <>
            <InitialAvatar name={thread.customer.displayName} />
            <div className="min-w-0">
              <a href={`/crm/clients/${thread.customer.id}`}
                className="font-medium text-sm hover:underline">{thread.customer.displayName}</a>
              {thread.customer.email && (
                <div className="text-xs text-muted-foreground truncate">{thread.customer.email}</div>
              )}
            </div>
          </>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-[280px] max-h-[52vh]">
        {(thread?.messages ?? []).map((m) => (
          <div key={m.id} className={`flex ${m.fromClient ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
              m.fromClient
                ? "bg-muted text-foreground rounded-bl-sm"
                : "bg-primary text-primary-foreground rounded-br-sm"
            }`} data-testid={`message-${m.id}`}>
              {(m.estimateNumber || (m.fromClient && m.toMemberName)) && (
                <div className={`text-[11px] mb-1 ${m.fromClient ? "text-muted-foreground" : "opacity-80"}`}>
                  {[m.estimateNumber ? `About estimate ${m.estimateNumber}` : null,
                    m.fromClient && m.toMemberName ? `To ${m.toMemberName}` : null]
                    .filter(Boolean).join(" · ")}
                </div>
              )}
              {m.body}
              <div className={`text-[10px] mt-1 ${m.fromClient ? "text-muted-foreground" : "opacity-70"}`}>
                {relTime(m.createdAt)}{!m.fromClient ? ` · ${m.authorName}` : ""}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="border-t p-3 flex gap-2">
        <Textarea
          rows={2}
          className="resize-none"
          placeholder="Reply — it lands in their portal and their email…"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && reply.trim()) {
              e.preventDefault();
              sendReply.mutate();
            }
          }}
          data-testid="input-inbox-reply"
        />
        <Button
          className="self-end"
          disabled={!reply.trim() || sendReply.isPending}
          onClick={() => sendReply.mutate()}
          data-testid="button-inbox-send"
        >
          {sendReply.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </Card>
  ) : (
    <Card className="flex-1 min-w-0 hidden md:flex items-center justify-center text-sm text-muted-foreground min-h-[320px]">
      Pick a conversation — a fast reply wins the job.
    </Card>
  );

  return (
    <div className="flex gap-4 items-start">
      {list}
      {conversation}
    </div>
  );
}

/* ── Client activity feed (the original inbox) ──────────────────────────── */

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

function ActivityPane() {
  const { data, isLoading, isError } = useQuery<{ activity: ActivityItem[] }>({
    queryKey: ["/api/crm/activity"],
  });
  const items = data?.activity ?? [];

  if (isLoading) {
    return <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (isError || !data) {
    return <ErrorCard title="Couldn't load the activity feed" description="Check your connection and refresh the page." />;
  }
  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card">
        <EmptyState
          icon={Inbox}
          title="No activity yet"
          description="When a client opens, approves or declines an estimate — or pays you — it lands here."
        />
      </div>
    );
  }
  return (
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
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function CrmInboxPage() {
  // wouter's useLocation strips the query string — read ?c= directly, and
  // let location changes retrigger the read.
  const [location] = useLocation();
  void location;
  const selected = new URLSearchParams(window.location.search).get("c");

  const { data: inbox } = useQuery<{ unreadTotal: number }>({ queryKey: ["/api/crm/inbox"] });
  const unread = inbox?.unreadTotal ?? 0;

  return (
    <CrmPage>
      <CrmPageHeader
        icon={MessageSquare}
        title="Messages"
        infoKey="inbox"
        subtitle="Every client message in one place — reply fast; a client left waiting is a client shopping elsewhere."
      />
      <Tabs defaultValue="messages">
        <TabsList>
          <TabsTrigger value="messages" data-testid="tab-inbox-messages">
            Messages{unread > 0 ? ` (${unread})` : ""}
          </TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-inbox-activity">Client activity</TabsTrigger>
        </TabsList>
        <TabsContent value="messages" className="mt-4">
          <MessagesPane selected={selected} />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <ActivityPane />
        </TabsContent>
      </Tabs>
    </CrmPage>
  );
}
