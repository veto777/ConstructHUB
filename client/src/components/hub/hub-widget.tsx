import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { X, Send, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import HubMascot, { type HubMascotState } from "./hub-mascot";
import { HubMarkdown } from "./hub-markdown";
import { pageKeyForPath } from "@shared/hub-links";
import { isClientPortal, isPortal } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * Gabe — the ConstructHUB corner assistant: a gator in a headset, always on the
 * radio for the crew (the Hub widget; artwork via HubMascot / GabeAvatar).
 *
 * Signed out: preset question chips only (answers come from the server's cache
 * or price-book templates; there is no text box). Signed in: the chips plus
 * free-text chat about how ConstructHUB works and how to set features up.
 *
 * The widget never reads page DOM or app state: the only thing it takes from
 * the page is the route -> pageKey mapping. The transcript and the server's
 * turn signatures live in React state only (gone on reload or sign-out);
 * localStorage holds only UI flags.
 */

export type HubSurface = "marketing" | "growth" | "portal";

type HubMeta = {
  presets: { id: string; label: string }[];
  primary: string[];
  welcome: string[];
  tier: "browse" | "builder";
  chat: boolean;
  maxChars: number;
};

type Msg = {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** Part of the signed chat history the server will accept back. */
  inHistory?: boolean;
  index?: number;
  sig?: string;
  tone?: "error" | "note";
};

const BUSY_TEXT = "My radio's crackling, so that took too long. Please try again in a minute. The quick questions below still work.";
const WELCOME_FLAG = "hub.welcomeSeen";
const HISTORY_MAX_MESSAGES = 10;
const HISTORY_MAX_CHARS = 3800;

// Homeowner-facing token pages, the auth flow and the admin console never show Gabe.
const TOKEN_PAGES = ["/e/", "/i/", "/co/", "/lead-form/", "/portal/", "/review/", "/contract/sign/", "/site-scan/report/"];
const NEVER = ["/admin", "/crm/admin", "/auth", "/crm/join", "/crm-terms", "/crm-privacy", "/privacy", "/terms", "/free-site-scan"];
// Signed-out visitors see Gabe on the marketing pages.
const MARKETING = ["/", "/landing", "/pricing", "/reinstatement", "/google-ad-fraud", "/lsa-guide", "/google-ads-guide",
  "/master-class", "/crm-app", "/google-business", "/databases", "/property"];
// Not /features: like /call-assistant, the feature pages keep the hero and CTAs clear of the launcher on phones.

export function hubVisible(location: string, surface: HubSurface): boolean {
  if (isClientPortal()) return false;
  if (TOKEN_PAGES.some((p) => location.startsWith(p))) return false;
  if (NEVER.some((p) => location === p || location.startsWith(`${p}/`))) return false;
  if (surface === "marketing") {
    return MARKETING.some((p) => location === p || (p !== "/" && location.startsWith(`${p}/`))) || /^\/[\w-]+-landing$/.test(location);
  }
  return true;
}

const readFlag = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };
const writeFlag = (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* private mode */ } };

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function HubWidget({ surface, signedIn }: { surface: HubSurface; signedIn: boolean }) {
  const [location] = useLocation();
  const visible = hubVisible(location, surface);
  const { data: meta, isError: metaFailed, refetch } = useQuery<HubMeta>({
    queryKey: ["/api/hub/presets", signedIn ? "in" : "out"],
    queryFn: async () => {
      const res = await fetch("/api/hub/presets", { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      // A server without the Hub routes answers with the SPA's index.html (the catch-all): not meta.
      if (!/\bapplication\/json\b/i.test(res.headers.get("content-type") ?? "")) throw new Error("not json");
      return res.json();
    },
    staleTime: 5 * 60_000,
    enabled: visible,
  });

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [talking, setTalking] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [bubble, setBubble] = useState(false);
  const [welcomePending, setWelcomePending] = useState(false);
  const nextId = useRef(1);
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const descId = useId();
  const panelId = useId();

  const builder = meta?.tier === "builder";
  const canChat = !!meta?.chat;
  const pageKey = pageKeyForPath(location, surface === "portal" || isPortal());
  const mascotState: HubMascotState = busy ? "thinking" : talking ? "talking" : "idle";

  // Sign-in or sign-out starts over: no transcript survives a change of person.
  useEffect(() => { setMessages([]); setConversationId(null); setInput(""); }, [signedIn]);

  // "Activated when someone signs up": the first time a signed-in account lands here, the
  // launcher carries a dot and (on wider screens, for 15 s) a welcome bubble. Neither is modal,
  // and the bubble never shows on phones, where it would sit on top of the page.
  useEffect(() => {
    if (visible && builder && !readFlag(WELCOME_FLAG)) { setWelcomePending(true); setBubble(true); }
  }, [visible, builder]);
  useEffect(() => {
    if (!bubble) return;
    const t = window.setTimeout(() => setBubble(false), 15_000);
    return () => window.clearTimeout(t);
  }, [bubble]);

  // A new answer scrolls to its first line (long answers read top-down); otherwise follow the bottom.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const last = messages[messages.length - 1];
    const el = last?.role === "assistant" && !busy ? list.querySelector<HTMLElement>(`[data-msg-id="${last.id}"]`) : null;
    list.scrollTo({ top: el ? Math.max(0, el.offsetTop - 8) : list.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!talking) return;
    const t = window.setTimeout(() => setTalking(false), 2400);
    return () => window.clearTimeout(t);
  }, [talking]);

  // Focus the first control when the panel opens.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const target = (canChat ? inputRef.current : null) ?? panelRef.current?.querySelector<HTMLElement>("[data-hub-chip]") ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }, 30);
    return () => window.clearTimeout(t);
  }, [open, canChat]);

  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => launcherRef.current?.focus(), 0);
  }, []);

  // Escape closes the panel wherever focus is (a button that just went away can leave focus on <body>).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // The dashboard's "Ask Gabe" nudge opens the panel with a question typed in; it never sends it.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const question = (e as CustomEvent<{ question?: string }>).detail?.question;
      setOpen(true);
      setBubble(false);
      if (typeof question === "string" && question.trim()) setInput(question.slice(0, 500));
    };
    window.addEventListener("constructhub:hub-open", onOpen);
    return () => window.removeEventListener("constructhub:hub-open", onOpen);
  }, []);

  /** Keep keyboard focus inside the dialog: the text box when chat is on, else the first quick question. */
  const focusComposer = () => {
    window.setTimeout(() => {
      const target = (canChat ? inputRef.current : null) ?? panelRef.current?.querySelector<HTMLElement>("[data-hub-chip]") ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }, 0);
  };

  const openPanel = (asWelcome: boolean) => {
    setOpen(true);
    setBubble(false);
    setWelcomePending(false);
    if (builder) writeFlag(WELCOME_FLAG, "1");
    setWelcome(asWelcome);
  };
  const dismissWelcome = () => { setBubble(false); setWelcomePending(false); writeFlag(WELCOME_FLAG, "1"); };

  const push = (msg: Omit<Msg, "id">) => {
    const id = nextId.current++;
    setMessages((prev) => [...prev, { ...msg, id }]);
    return id;
  };

  const askPreset = async (presetId: string, label: string) => {
    if (busy) return;
    push({ role: "user", content: label });
    setBusy(true);
    try {
      const res = await fetch("/api/hub/preset", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.reply === "string") {
        push({ role: "assistant", content: data.reply });
        setTalking(true);
      } else {
        push({ role: "assistant", content: typeof data.reply === "string" ? data.reply : BUSY_TEXT, tone: "error" });
      }
    } catch {
      push({ role: "assistant", content: BUSY_TEXT, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const resetChat = () => {
    setConversationId(null);
    setMessages((prev) => prev.map((m) => ({ ...m, inHistory: false })));
  };

  const sendChat = async () => {
    const text = input.trim();
    if (!text || busy || !canChat) return;
    const max = meta?.maxChars ?? 500;
    if (text.length > max) return;
    // Signed turns only, newest last, trimmed (a question with its answer) to what the server accepts.
    let history = messages.filter((m) => m.inHistory);
    while (history.length > HISTORY_MAX_MESSAGES || history.reduce((n, m) => n + m.content.length, 0) + text.length > HISTORY_MAX_CHARS) {
      history = history.slice(2);
    }
    const userMsgId = push({ role: "user", content: text });
    setInput("");
    setBusy(true);
    // The Send button goes inactive while Gabe answers; never leave focus on it.
    if (document.activeElement !== inputRef.current) inputRef.current?.focus();
    try {
      const res = await fetch("/api/hub/chat", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(conversationId && history.length ? { conversationId } : {}),
          messages: [
            ...history.map((m) => (m.role === "assistant" ? { role: "assistant", content: m.content, index: m.index, sig: m.sig } : { role: "user", content: m.content })),
            { role: "user", content: text },
          ],
          ...(pageKey ? { pageKey } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.reply === "string" && typeof data.sig === "string") {
        setConversationId(data.conversationId);
        setMessages((prev) => prev.map((m) => (m.id === userMsgId ? { ...m, inHistory: true } : m)));
        push({ role: "assistant", content: data.reply, inHistory: true, index: data.index, sig: data.sig, tone: data.kind === "answer" ? undefined : "note" });
        setTalking(true);
      } else if (res.status === 401 || (res.status === 403 && data.presetsOnly)) {
        push({ role: "assistant", content: data.reply ?? "Sign up or log in to ask your own questions.", tone: "note" });
        void refetch();
      } else if (data.code === "tampered" || data.reset) {
        push({ role: "assistant", content: data.reply ?? "Let's start a fresh chat. Ask me again!", tone: "note" });
        resetChat();
      } else {
        push({ role: "assistant", content: typeof data.reply === "string" ? data.reply : BUSY_TEXT, tone: "error" });
      }
    } catch {
      push({ role: "assistant", content: BUSY_TEXT, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  // Tab stays inside the panel (focus trap). Escape is handled at document level above.
  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const chips = useMemo(() => {
    if (!meta) return [];
    const byId = new Map(meta.presets.map((p) => [p.id, p]));
    const firstIds = welcome ? meta.welcome : meta.primary;
    const first = firstIds.map((id) => byId.get(id)).filter(Boolean) as HubMeta["presets"];
    const rest = meta.presets.filter((p) => !firstIds.includes(p.id));
    return showMore ? [...first, ...rest] : first;
  }, [meta, welcome, showMore]);

  // Nothing until the server has answered; when it can't (a server without /api/hub, or down), the
  // launcher still shows and the panel says so, rather than Gabe silently not existing.
  if (!visible || (!meta && !metaFailed)) return null;
  const offline = !meta;

  const portalMobile = surface === "portal";
  const greeting = offline
    ? "Hi, I'm Gabe! My radio's down right now, so I can't take questions. Please try again in a minute."
    : welcome
      ? "Welcome aboard! I'm Gabe. I can walk you through setting up ConstructHUB, one step at a time. Where do you want to start?"
      : builder
        ? "Hi, I'm Gabe! Ask me how any ConstructHUB feature works or how to set it up. I can't see your account or anyone's data, so I'll point you to the right page."
        : "Hi, I'm Gabe! I know ConstructHUB inside out: plans, features and how to set things up. Tap a question below.";

  return (
    <>
      {!open && bubble && (
        <div
          className={cn(
            "fixed right-4 z-40 hidden w-[260px] rounded-2xl border bg-card p-3 text-sm text-card-foreground shadow-xl sm:block",
            portalMobile ? "bottom-[calc(140px+env(safe-area-inset-bottom))] md:bottom-[92px]" : "bottom-[88px] sm:bottom-[92px]",
          )}
          role="status"
          data-testid="hub-welcome-bubble"
        >
          <button type="button" onClick={dismissWelcome}
            className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Dismiss Gabe's welcome">
            <X className="h-3.5 w-3.5" />
          </button>
          <p className="pr-5 font-semibold">Welcome aboard!</p>
          <p className="mt-1 text-muted-foreground">I'm Gabe. Want a hand setting things up?</p>
          <button type="button" onClick={() => openPanel(true)} className="mt-2 rounded-full bg-orange-500 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-600" data-testid="hub-welcome-open">
            Show me around
          </button>
        </div>
      )}

      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => openPanel(welcomePending)}
          aria-label="Ask Gabe, your ConstructHUB guide"
          aria-haspopup="dialog"
          aria-expanded={false}
          aria-controls={panelId}
          title="Ask Gabe"
          className={cn(
            "fixed right-4 z-40 h-14 w-14 rounded-full shadow-lg shadow-orange-900/25 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-400/60",
            portalMobile ? "bottom-[calc(68px+env(safe-area-inset-bottom))] md:bottom-5" : "bottom-4 sm:bottom-5",
          )}
          data-testid="hub-launcher"
        >
          <HubMascot size={56} decorative />
          {welcomePending && (
            <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-orange-500" data-testid="hub-welcome-dot" />
          )}
        </button>
      )}

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          onKeyDown={onPanelKeyDown}
          className={cn(
            "fixed z-[60] flex flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-2xl",
            "inset-x-2 sm:inset-x-auto sm:right-5 sm:w-[380px]",
            portalMobile
              ? "bottom-[calc(62px+env(safe-area-inset-bottom))] h-[min(620px,calc(100dvh-70px-env(safe-area-inset-bottom)))] md:bottom-5 md:h-[min(620px,calc(100dvh-2.5rem))]"
              : "bottom-2 h-[min(620px,calc(100dvh-1rem))] sm:bottom-5 sm:h-[min(620px,calc(100dvh-2.5rem))]",
          )}
          data-testid="hub-panel"
        >
          <div className="flex items-center gap-3 bg-gradient-to-r from-[#F97316] to-[#EA6A0C] px-3 py-2.5 text-white">
            <div className="shrink-0 rounded-full bg-white/10 p-0.5" data-testid="hub-header-mascot" data-state={mascotState}>
              <HubMascot size={48} state={mascotState} label={busy ? "Gabe is thinking" : "Gabe"} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[15px] font-bold leading-tight">Gabe — your ConstructHUB guide</h2>
              <p id={descId} className="text-xs text-white/85">
                {busy ? "Thinking it over…" : builder ? "Ask about any feature or setup step" : "Quick answers about ConstructHUB"}
              </p>
            </div>
            {builder && messages.length > 0 && (
              <button type="button" onClick={() => { setMessages([]); setConversationId(null); focusComposer(); }}
                className="rounded-md p-1.5 text-white/85 hover:bg-white/10 hover:text-white" aria-label="Start a new chat" data-testid="hub-new-chat">
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={close} className="rounded-md p-1.5 text-white/85 hover:bg-white/10 hover:text-white" aria-label="Close Gabe" data-testid="hub-close">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div ref={listRef} className="relative flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm leading-relaxed" role="log" aria-live="polite" aria-relevant="additions" data-testid="hub-messages">
            <div className="max-w-[92%] rounded-2xl rounded-tl-sm border bg-muted/50 px-3 py-2" data-testid="hub-greeting">{greeting}</div>

            {messages.map((m) => (
              <div key={m.id} data-msg-id={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    // A long unbroken string (a pasted URL) wraps instead of running out of the panel.
                    "min-w-0 max-w-[92%] break-words rounded-2xl px-3 py-2 [overflow-wrap:anywhere]",
                    m.role === "user"
                      ? "whitespace-pre-wrap rounded-tr-sm bg-orange-500 text-white"
                      : m.tone === "error"
                        ? "rounded-tl-sm border border-amber-500/40 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
                        : "rounded-tl-sm border bg-muted/50",
                  )}
                  data-testid={`hub-msg-${m.role}`}
                  data-tone={m.tone ?? "answer"}
                >
                  {m.role === "user" ? m.content : <HubMarkdown text={m.content} onNavigate={() => setOpen(false)} />}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex justify-start" data-testid="hub-thinking">
                <div className="rounded-2xl rounded-tl-sm border bg-muted/50 px-3 py-2 text-muted-foreground">
                  <span className="sr-only">Gabe is thinking</span>
                  <span aria-hidden="true" className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                  </span>
                </div>
              </div>
            )}

            {offline ? (
              <div className="pt-1" data-testid="hub-offline">
                <button type="button" onClick={() => void refetch()}
                  className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/40"
                  data-testid="hub-retry">
                  Try again
                </button>
              </div>
            ) : (
            <div className="pt-1" data-testid="hub-chips">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Quick questions</p>
              <div className="flex flex-wrap gap-1.5">
                {chips.map((p) => (
                  // aria-disabled, not disabled: a disabled button drops keyboard focus to <body> (askPreset ignores taps while busy).
                  <button key={p.id} type="button" data-hub-chip aria-disabled={busy || undefined} onClick={() => askPreset(p.id, p.label)}
                    className="rounded-full border bg-background px-3 py-1.5 text-left text-xs font-medium hover:border-orange-500 hover:bg-orange-50 aria-disabled:cursor-wait aria-disabled:opacity-50 dark:hover:bg-orange-950/40"
                    data-testid={`hub-chip-${p.id}`}>
                    {p.label}
                  </button>
                ))}
                <button type="button" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium text-orange-600 hover:underline dark:text-orange-300"
                  data-testid="hub-more">
                  {showMore ? <>Fewer <ChevronUp className="h-3 w-3" /></> : <>More questions <ChevronDown className="h-3 w-3" /></>}
                </button>
              </div>
            </div>
            )}
          </div>

          {!offline && (
          <div className="border-t bg-background/60 p-3">
            {canChat ? (
              <form onSubmit={(e) => { e.preventDefault(); void sendChat(); }} className="flex items-end gap-2">
                <label htmlFor={`${panelId}-input`} className="sr-only">Ask Gabe a question</label>
                <textarea
                  id={`${panelId}-input`}
                  ref={inputRef}
                  rows={1}
                  value={input}
                  maxLength={meta?.maxChars}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendChat(); } }}
                  placeholder="Ask how something works…"
                  className="max-h-28 min-h-[40px] flex-1 resize-none rounded-xl border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
                  data-testid="hub-input"
                />
                <button type="submit" disabled={busy || !input.trim()} aria-label="Send"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50"
                  data-testid="hub-send">
                  <Send className="h-4 w-4" />
                </button>
              </form>
            ) : builder ? (
              <p className="text-xs text-muted-foreground" data-testid="hub-chat-off">Chat with Gabe is off right now. The quick questions still work.</p>
            ) : (
              <div className="flex items-center justify-between gap-3" data-testid="hub-signup-cta">
                <p className="text-xs text-muted-foreground">Create a free account to ask Gabe anything.</p>
                <Link href="/auth" onClick={() => setOpen(false)}
                  className="shrink-0 rounded-full bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600"
                  data-testid="hub-signup-link">
                  Create account
                </Link>
              </div>
            )}
            {canChat && meta && input.length > (meta.maxChars - 100) && (
              <p className="mt-1 text-right text-[11px] text-muted-foreground" aria-live="polite">{input.length}/{meta.maxChars}</p>
            )}
          </div>
          )}
        </div>
      )}
    </>
  );
}
