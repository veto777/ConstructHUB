/**
 * Client-portal messaging + contact:
 *   - PortalMessages: the two-way thread with the contractor, text-message
 *     style, with a "To" picker so the client can message a specific person
 *     on their job.
 *   - PortalContact: office contact + website + everyone assigned to the
 *     job with their email and direct line, each with a "Message now"
 *     shortcut into the thread.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  Loader2, MessageSquare, Send, Phone, Mail, Globe, Building2, HardHat,
} from "lucide-react";
import { SectionTitle, EmptyState, InitialAvatar } from "@/components/crm-ui";

type TeamMember = {
  memberId: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
};

type Office = { name: string | null; email: string | null; phone: string | null; website: string | null };

function relTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function useTeam(customerId?: string) {
  return useQuery<{ office: Office; team: TeamMember[] }>({
    queryKey: ["/api/client/team", customerId],
    queryFn: async () => {
      const r = await fetch(`/api/client/team?customerId=${customerId}`, { credentials: "same-origin" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!customerId,
  });
}

/* ── Messages ────────────────────────────────────────────────────────────── */

export function PortalMessages({ accounts, focusMemberId }: {
  accounts: any[];
  /** Preselect "To" — set when the client tapped "Message now" on a person. */
  focusMemberId?: string | null;
}) {
  const { toast } = useToast();
  const customerId = accounts?.[0]?.id;
  const [body, setBody] = useState("");
  const [toMemberId, setToMemberId] = useState<string>(focusMemberId ?? "office");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (focusMemberId) setToMemberId(focusMemberId);
  }, [focusMemberId]);

  const { data: team } = useTeam(customerId);

  const { data: thread, isLoading } = useQuery<{ messages: any[] }>({
    queryKey: ["/api/client/comments", customerId],
    queryFn: async () => {
      const r = await fetch(`/api/client/comments?customerId=${customerId}`, { credentials: "same-origin" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!customerId,
    refetchInterval: 20_000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages?.length]);

  const send = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/client/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          customerId,
          body,
          toMemberId: toMemberId !== "office" ? toMemberId : undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Could not send");
      return j;
    },
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["/api/client/comments", customerId] });
      toast({ title: "Message sent", description: "Your contractor was notified — replies land here and in your email." });
    },
    onError: (e: any) => toast({ title: "Could not send", description: String(e.message ?? e), variant: "destructive" }),
  });

  const messages = thread?.messages ?? [];

  return (
    <section className="space-y-3" data-testid="portal-messages">
      <SectionTitle icon={MessageSquare} title="Messages" />
      <Card>
        <CardContent className="p-0 flex flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-[220px] max-h-[46vh]">
            {isLoading && (
              <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            )}
            {!isLoading && !messages.length && (
              <EmptyState compact icon={MessageSquare} title="Start the conversation"
                description="Questions about your estimate, schedule or anything else — your team replies here and by email." />
            )}
            {messages.map((m: any) => (
              <div key={m.id} className={`flex ${m.fromMe ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
                  m.fromMe
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm"
                }`} data-testid={`portal-message-${m.id}`}>
                  {m.fromMe && m.toMemberName && (
                    <div className="text-[11px] mb-1 opacity-80">To {m.toMemberName}</div>
                  )}
                  {m.body}
                  <div className={`text-[10px] mt-1 ${m.fromMe ? "opacity-70" : "text-muted-foreground"}`}>
                    {relTime(m.createdAt)}{!m.fromMe ? ` · ${m.authorName}` : ""}
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="border-t p-3 space-y-2">
            {(team?.team?.length ?? 0) > 0 && (
              <Select value={toMemberId} onValueChange={setToMemberId}>
                <SelectTrigger className="h-8 text-xs w-full sm:w-64" data-testid="select-message-to">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="office">To: the office (whole team)</SelectItem>
                  {team!.team.map((m) => (
                    <SelectItem key={m.memberId} value={m.memberId}>
                      To: {m.name} ({m.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex gap-2">
              <Textarea
                rows={2}
                className="resize-none"
                placeholder="Write a message…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && body.trim()) {
                    e.preventDefault();
                    send.mutate();
                  }
                }}
                data-testid="input-portal-message"
              />
              <Button
                className="self-end"
                disabled={!body.trim() || send.isPending || !customerId}
                onClick={() => send.mutate()}
                data-testid="button-portal-message-send"
              >
                {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/* ── Contact us ──────────────────────────────────────────────────────────── */

export function PortalContact({ accounts, onMessageNow }: {
  accounts: any[];
  onMessageNow: (memberId: string | null) => void;
}) {
  const customerId = accounts?.[0]?.id;
  const { data, isLoading } = useTeam(customerId);
  const office = data?.office;
  const team = data?.team ?? [];

  return (
    <section className="space-y-3" data-testid="portal-contact">
      <SectionTitle icon={Phone} title="Contact us" />

      {isLoading && (
        <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      )}

      {office && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 font-medium">
              <Building2 className="h-4 w-4 text-muted-foreground" /> {office.name ?? "The office"}
            </div>
            <div className="space-y-1.5 text-sm">
              {office.phone && (
                <a href={`tel:${office.phone}`} className="flex items-center gap-2 text-primary hover:underline"
                  data-testid="contact-office-phone">
                  <Phone className="h-3.5 w-3.5" /> {office.phone}
                </a>
              )}
              {office.email && (
                <a href={`mailto:${office.email}`} className="flex items-center gap-2 text-primary hover:underline"
                  data-testid="contact-office-email">
                  <Mail className="h-3.5 w-3.5" /> {office.email}
                </a>
              )}
              {office.website && (
                <a href={office.website.startsWith("http") ? office.website : `https://${office.website}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-primary hover:underline"
                  data-testid="contact-office-website">
                  <Globe className="h-3.5 w-3.5" /> {office.website.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>
            <Button size="sm" variant="outline" className="mt-1"
              onClick={() => onMessageNow(null)} data-testid="button-message-office">
              <MessageSquare className="h-3.5 w-3.5 mr-1.5" /> Message now
            </Button>
          </CardContent>
        </Card>
      )}

      {team.length > 0 && (
        <>
          <div className="text-sm text-muted-foreground flex items-center gap-1.5">
            <HardHat className="h-3.5 w-3.5" /> Your team on this job
          </div>
          <Card>
            <CardContent className="p-0 divide-y">
              {team.map((m) => (
                <div key={m.memberId} className="flex items-center justify-between gap-3 p-4"
                  data-testid={`contact-member-${m.memberId}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <InitialAvatar name={m.name} />
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{m.name}
                        <span className="text-xs text-muted-foreground font-normal"> · {m.role}</span>
                      </div>
                      <div className="text-xs space-x-3">
                        {m.phone && (
                          <a href={`tel:${m.phone}`} className="text-primary hover:underline">{m.phone}</a>
                        )}
                        {m.email && (
                          <a href={`mailto:${m.email}`} className="text-primary hover:underline break-all">{m.email}</a>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0"
                    onClick={() => onMessageNow(m.memberId)}
                    data-testid={`button-message-member-${m.memberId}`}>
                    <MessageSquare className="h-3.5 w-3.5 mr-1.5" /> Message now
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}

/** The always-there footer: how to reach us + website. */
export function PortalContactFooter({ office }: { office: Office | null | undefined }) {
  if (!office || (!office.email && !office.phone && !office.website)) return null;
  return (
    <footer className="border-t mt-8 py-4 px-3 text-xs text-muted-foreground flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 max-w-full"
      data-testid="portal-contact-footer">
      <span className="font-medium">{office.name ?? "Contact us"}</span>
      {office.phone && (
        <a href={`tel:${office.phone}`} className="hover:text-foreground whitespace-nowrap">{office.phone}</a>
      )}
      {office.email && (
        <a href={`mailto:${office.email}`} className="hover:text-foreground break-all">{office.email}</a>
      )}
      {office.website && (
        <a href={office.website.startsWith("http") ? office.website : `https://${office.website}`}
          target="_blank" rel="noopener noreferrer" className="hover:text-foreground break-all">
          {office.website.replace(/^https?:\/\//, "")}
        </a>
      )}
    </footer>
  );
}
