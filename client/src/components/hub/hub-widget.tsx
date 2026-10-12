import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Send, RotateCcw, ChevronDown, ChevronUp, Lock } from "lucide-react";
import HubMascot, { type HubMascotState } from "./hub-mascot";
import { HubMarkdown } from "./hub-markdown";
import { pageKeyForPath } from "@shared/hub-links";
import { isClientPortal, isPortal } from "@/lib/site";
import { inNativeApp } from "@/lib/app-shell";
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
 *
 * Every state the server can put chat in has its own, clear panel state and
 * never a toast: the provider not configured / today's cap reached (chatOff),
 * the plan's monthly questions used up or a plan without any (allowance), a
 * request refused by the same-origin guard. A reply that arrives after the
 * chat was reset, or after the person signed out, is dropped (a conversation
 * generation guards every in-flight request).
 */

export type HubSurface = "marketing" | "growth" | "portal";

/** GET /api/hub/presets (server/hub/routes.ts). `chatOff`, `allowance` and `userId` arrive for a signed-in account. */
type HubMeta = {
  presets: { id: string; label: string }[];
  primary: string[];
  welcome: string[];
  tier: "browse" | "builder";
  chat: boolean;
  /** Why chat is off for a signed-in account: the model provider isn't configured, or today's token cap is reached. */
  chatOff?: "provider" | "capped" | null;
  /** The plan's monthly Gabe questions: -1 unlimited, 0 none; `remaining` null when unlimited. */
  allowance?: { monthly: number; used: number; remaining: number | null; resetsAt: string; daily: { limit: number; used: number } } | null;
  /** The signed-in account, for the per-account welcome flag. */
  userId?: number | null;
  maxChars: number;
};

/** The server's plan answer on POST /chat (server/growth-quotas.ts): a spent month or a plan without questions. */
type LimitBody = { code: "plan_required" | "limit_reached"; message?: string; reply?: string; resetsAt?: string; limit?: number; requiredPlan?: string };

type Msg = {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** Part of the signed chat history the server will accept back. */
  inHistory?: boolean;
  index?: number;
  sig?: string;
  tone?: "error" | "note";
  failed?: boolean;
  presetId?: string;
};

const BUSY_TEXT = "My radio's crackling, so that took too long. Please try again in a minute. The quick questions below still work.";
const FORBIDDEN_TEXT = "That didn't go through from this page. Reload the page and ask again; the quick questions below still work.";
const WELCOME_FLAG = "hub.welcomeSeen";
const HISTORY_MAX_MESSAGES = 10;
const HISTORY_MAX_CHARS = 3800;
/** In the iPhone apps Gabe offers no price / plan / checkout / sales-rep quick questions (keep in step
 * with APP_SALES_PRESETS in server/hub/app-guard.ts; the server answers them with the fixed line regardless). */
const APP_HIDDEN_CHIP_IDS = new Set(["pricing", "which-plan", "trial", "get-started", "agency", "done-for-you", "master-class", "call-assistant", "call-number"]);

// Homeowner-facing token pages, the auth flow and the admin console never show Gabe.
const TOKEN_PAGES = ["/e/", "/i/", "/co/", "/lead-form/", "/portal/", "/review/", "/contract/sign/", "/site-scan/report/"];
const NEVER = ["/admin", "/crm/admin", "/auth", "/crm/join", "/crm-terms", "/crm-privacy", "/privacy", "/terms", "/free-site-scan"];
// Signed-out visitors see Gabe on the marketing pages.
const MARKETING = ["/", "/landing", "/pricing", "/reinstatement", "/google-ad-fraud", "/lsa-guide", "/google-ads-guide",
  "/master-class", "/crm-app", "/google-business", "/databases", "/property"];
// Not /features: like /call-assistant, the feature pages keep the hero and CTAs clear of the launcher on phones.

export function hubVisible(location: string, surface: HubSurface): boolean {
  // The iPhone apps sell nothing (owner, 2026-10-04 — App Store 3.1.3(f)):
  // Gabe's quick questions and answers are built from the plan/price knowledge
  // pack, so in app mode he stays off the air entirely rather than risk a
  // plan name, price or /pricing link reaching a reviewer.
  if (inNativeApp()) return false;
  if (isClientPortal()) return false;
  if (TOKEN_PAGES.some((p) => location.startsWith(p))) return false;
  if (NEVER.some((p) => location === p || location.startsWith(`${p}/`))) return false;
  if (surface === "marketing") {
    return MARKETING.some((p) => location === p || (p !== "/" && location.startsWith(`${p}/`))) || /^\/[\w-]+-landing$/.test(location);
  }
  return true;
}

/**
 * The one-time welcome is per ACCOUNT, not per browser: a second new account on the same
 * machine still gets its introduction. Older servers that send no userId fall back to the
 * browser-wide flag.
 */
export function welcomeFlagKey(userId: number | null | undefined): string {
  return typeof userId === "number" && Number.isFinite(userId) ? `${WELCOME_FLAG}:${userId}` : WELCOME_FLAG;
}

/** "Oct 1" — when the month's questions come back (the server's resetsAt is the 1st, UTC). */
function resetLabel(iso: string | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const readFlag = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };
const writeFlag = (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* private mode */ } };

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function HubWidget({ surface, signedIn }: { surface: HubSurface; signedIn: boolean }) {
  const { data: user } = useQuery<{ id: number } | null>({ queryKey: ["/api/auth/me"], enabled: signedIn });
  const userId = signedIn ? user?.id : null;
  // Remount all conversation state when the authenticated person changes, including A -> B.
  if (signedIn && userId == null) return null;
  return <HubConversation key={userId ?? "guest"} surface={surface} userId={userId ?? null} />;
}

function HubConversation({ surface, userId }: { surface: HubSurface; userId: number | null }) {
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const visible = hubVisible(location, surface);
  const { data: meta, isError: metaFailed, isFetching: metaFetching, dataUpdatedAt, refetch } = useQuery<HubMeta>({
    queryKey: ["/api/hub/presets", userId],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/hub/presets", { credentials: "include", signal, cache: "no-store" });
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
  // The server's plan answer to the last typed question (a spent month, a plan without questions),
  // shown as its own card until the meta says otherwise.
  const [limitBody, setLimitBody] = useState<LimitBody | null>(null);
  const nextId = useRef(1);
  // Conversation generation: bumped on every reset (new chat, sign-in/out, unmount). A request
  // started under an older generation is aborted and its reply, if it still arrives, is dropped.
  const generation = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const descId = useId();
  const panelId = useId();

  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 112)}px`;
  }, [input, open]);

  useEffect(() => {
    if (visible || !open) return;
    setOpen(false);
    setBubble(false);
    // The launcher is hidden on this route. Move focus to its page landmark.
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>("main, [role=main], h1, a[href]");
      if (!target) return;
      const previous = target.getAttribute("tabindex");
      if (previous === null) target.setAttribute("tabindex", "-1");
      target.focus();
      if (previous === null) target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
    }, 0);
  }, [visible, open]);

  const builder = meta?.tier === "builder";
  const allowance = meta?.allowance ?? null;
  // No typed questions this month: the plan has none (0), or they are all used.
  const noPlanQuestions = !!allowance && allowance.monthly === 0;
  const spent = !!limitBody || (!!allowance && allowance.monthly > 0 && allowance.remaining === 0);
  const canChat = !metaFailed && !!meta?.chat && !spent && !noPlanQuestions;
  const pageKey = pageKeyForPath(location, surface === "portal" || isPortal());
  const mascotState: HubMascotState = busy ? "thinking" : talking ? "talking" : "idle";
  const welcomeKey = welcomeFlagKey(meta?.userId);

  /** Drop every in-flight request and start a fresh conversation (no transcript, no signatures). */
  const startOver = useCallback(() => {
    generation.current += 1;
    inFlight.current?.abort();
    inFlight.current = null;
    setBusy(false);
    setConversationId(null);
    setMessages([]);
  }, []);

  // Identity changes remount this component: abort requests and reject late replies.
  useEffect(() => () => { generation.current += 1; inFlight.current?.abort(); }, []);
  // A fresh meta decides the quota state; the last plan answer only bridges until it arrives.
  useEffect(() => { if (meta && !metaFailed) setLimitBody(null); }, [dataUpdatedAt, meta, metaFailed]);

  useEffect(() => { if (open) void refetch(); }, [open, refetch]);
  useEffect(() => queryClient.getQueryCache().subscribe((event) => {
    if (visible && userId !== null && event.type === "updated" &&
        event.query.queryKey[0] === "/api/entitlements" &&
        (event.action.type === "success" || event.action.type === "invalidate")) void refetch();
  }), [queryClient, refetch, userId, visible]);

  // Refresh at monthly reset and UTC midnight (daily allowance), even while closed.
  // Cap long timers to avoid the browser's signed 32-bit timeout overflow.
  useEffect(() => {
    if (!visible || userId === null || !meta) return;
    let timer: ReturnType<typeof setTimeout>;
    const now = Date.now();
    const month = Date.parse(meta.allowance?.resetsAt ?? "");
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    const boundary = Number.isFinite(month) && month > now ? Math.min(month, +midnight) : +midnight;
    const schedule = () => {
      const remaining = boundary - Date.now();
      if (remaining <= 0) { void refetch(); return; }
      timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [meta, dataUpdatedAt, visible, userId, refetch]);

  // "Activated when someone signs up": the first time a signed-in ACCOUNT lands here, the
  // launcher carries a dot and (on wider screens, for 15 s) a welcome bubble. Neither is modal,
  // and the bubble never shows on phones, where it would sit on top of the page.
  useEffect(() => {
    // Shown once: seen counts as dismissed (owner, 2026-10-12: it popped up "all the time none stop").
    if (visible && builder && !readFlag(welcomeKey)) { setWelcomePending(true); setBubble(true); writeFlag(welcomeKey, "1"); }
  }, [visible, builder, welcomeKey]);
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

  /** Return focus after resetting: the text box when chat is on, else the first quick question. */
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
    if (builder) writeFlag(welcomeKey, "1");
    setWelcome(asWelcome);
  };
  const dismissWelcome = () => { setBubble(false); setWelcomePending(false); writeFlag(welcomeKey, "1"); };

  const push = (msg: Omit<Msg, "id">) => {
    const id = nextId.current++;
    setMessages((prev) => [...prev, { ...msg, id }]);
    return id;
  };

  /** One request under the current generation: the controller to send, and whether its reply still belongs here. */
  const begin = () => {
    const gen = generation.current;
    const controller = new AbortController();
    inFlight.current = controller;
    return { controller, live: () => gen === generation.current && inFlight.current === controller };
  };

  const markFailed = (id: number, failed: boolean) => setMessages((prev) => prev.map((m) => m.id === id ? { ...m, failed } : m));
  const retryTurn = (id: number) => setMessages((prev) => {
    const turn = prev.find((m) => m.id === id);
    return turn ? [...prev.filter((m) => m.id !== id), { ...turn, failed: false }] : prev;
  });

  const askPreset = async (presetId: string, label: string, retryId?: number) => {
    if (busy) return;
    const userMsgId = retryId ?? push({ role: "user", content: label, presetId });
    if (retryId) retryTurn(retryId);
    setBusy(true);
    const { controller, live } = begin();
    try {
      const res = await fetch("/api/hub/preset", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!live()) return;
      if (res.ok && typeof data.reply === "string") {
        push({ role: "assistant", content: data.reply });
        setTalking(true);
      } else if ((res.status === 429 && ["slowdown", "limit"].includes(data.code)) || (res.status === 503 && data.code === "busy")) {
        push({ role: "assistant", content: typeof data.reply === "string" ? data.reply : BUSY_TEXT, tone: "note" });
      } else {
        markFailed(userMsgId, true);
        push({ role: "assistant", content: typeof data.reply === "string" ? data.reply : BUSY_TEXT, tone: "error" });
      }
    } catch {
      if (live()) { markFailed(userMsgId, true); push({ role: "assistant", content: BUSY_TEXT, tone: "error" }); }
    } finally {
      if (live()) { inFlight.current = null; setBusy(false); }
    }
  };

  /** The server asked for a fresh conversation: keep the transcript on screen, drop the signatures. */
  const resetConversation = () => {
    setConversationId(null);
    setMessages((prev) => prev.map((m) => ({ ...m, inHistory: false })));
  };

  const sendChat = async (retry?: Msg) => {
    const text = (retry?.content ?? input).trim();
    if (!text || busy || !canChat) return;
    const max = meta?.maxChars ?? 500;
    if (text.length > max) return;
    // Signed turns only, newest last, trimmed (a question with its answer) to what the server accepts.
    let history = messages.filter((m) => m.inHistory);
    while (history.length > HISTORY_MAX_MESSAGES || history.reduce((n, m) => n + m.content.length, 0) + text.length > HISTORY_MAX_CHARS) {
      history = history.slice(2);
    }
    const userMsgId = retry?.id ?? push({ role: "user", content: text });
    if (retry) retryTurn(retry.id);
    else setInput("");
    setBusy(true);
    // The Send button goes inactive while Gabe answers; never leave focus on it.
    if (document.activeElement !== inputRef.current) inputRef.current?.focus();
    const { controller, live } = begin();
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
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      // The chat was reset or the person changed while this was in flight: the reply is not for this conversation.
      if (!live()) return;
      const neutral = (res.status === 429 && ["slowdown", "limit"].includes(data.code)) || (res.status === 503 && data.code === "busy");
      markFailed(userMsgId, !neutral && !(res.ok && typeof data.reply === "string" && typeof data.sig === "string"));
      if (res.ok && typeof data.reply === "string" && typeof data.sig === "string") {
        setConversationId(data.conversationId);
        setMessages((prev) => prev.map((m) => (m.id === userMsgId ? { ...m, inHistory: true } : m)));
        push({ role: "assistant", content: data.reply, inHistory: true, index: data.index, sig: data.sig, tone: data.kind === "answer" ? undefined : "note" });
        setTalking(true);
        // An answered question is one off the month: refresh the header's count.
        if (data.kind === "answer") void refetch();
      } else if (neutral) {
        push({ role: "assistant", content: typeof data.reply === "string" ? data.reply : BUSY_TEXT, tone: "note" });
      } else if (res.status === 401 || (res.status === 403 && data.presetsOnly)) {
        push({ role: "assistant", content: data.reply ?? "Sign up or log in to ask your own questions.", tone: "note" });
        void refetch();
      } else if (data.code === "plan_required" || data.code === "limit_reached") {
        // The plan's monthly questions: its own card below, never a toast; the meta confirms it.
        setLimitBody(data as LimitBody);
        push({ role: "assistant", content: typeof data.reply === "string" ? data.reply : typeof data.message === "string" ? data.message : "You've used this month's questions. The quick questions below still work.", tone: "note" });
        void refetch();
      } else if (data.code === "tampered" || data.reset) {
        push({ role: "assistant", content: data.reply ?? "Let's start a fresh chat. Ask me again!", tone: "note" });
        resetConversation();
      } else if (data.code === "offline") {
        // The provider went off (or today's cap was reached) since the panel opened: the composer
        // turns into the clear chat-off state once the meta is refreshed.
        push({ role: "assistant", content: typeof data.reply === "string" ? data.reply : "Gabe is off site right now. The quick questions below still work.", tone: "note" });
        void refetch();
      } else if (res.status === 403) {
        // The same-origin guard refused the request (a stale tab, a proxy that dropped Origin): say so plainly.
        push({ role: "assistant", content: FORBIDDEN_TEXT, tone: "note" });
      } else {
        push({ role: "assistant", content: typeof data.reply === "string" ? data.reply : BUSY_TEXT, tone: "error" });
      }
    } catch {
      if (live()) { markFailed(userMsgId, true); push({ role: "assistant", content: BUSY_TEXT, tone: "error" }); }
    } finally {
      if (live()) { inFlight.current = null; setBusy(false); void refetch(); }
    }
  };

  const chips = useMemo(() => {
    if (!meta) return [];
    // The iPhone apps sell nothing (App Store 3.1.3(f)): chips about prices, plans, checkout or a
    // sales rep stay hidden (the server answers them with the fixed line anyway — this spares the tap).
    const appHide = inNativeApp() ? APP_HIDDEN_CHIP_IDS : null;
    const list = appHide ? meta.presets.filter((p) => !appHide.has(p.id)) : meta.presets;
    const byId = new Map(list.map((p) => [p.id, p]));
    const firstIds = welcome ? meta.welcome : meta.primary;
    const first = firstIds.map((id) => byId.get(id)).filter(Boolean) as HubMeta["presets"];
    const rest = list.filter((p) => !firstIds.includes(p.id));
    return showMore ? [...first, ...rest] : first;
  }, [meta, welcome, showMore]);

  // Nothing until the server has answered; when it can't (a server without /api/hub, or down), the
  // launcher still shows and the panel says so, rather than Gabe silently not existing.
  if (!visible || (!meta && !metaFailed)) return null;
  const offline = !meta || metaFailed;

  // On phones the CRM ribbon and the platform tab bar (AppTabBar) sit at the bottom: the launcher and panel rise above them.
  const portalMobile = surface === "portal" || surface === "growth";
  const greeting = offline
    ? "Hi, I'm Gabe! My radio's down right now, so I can't take questions. Please try again in a minute."
    : welcome
      ? "Welcome aboard! I'm Gabe. I can walk you through setting up ConstructHUB, one step at a time. Where do you want to start?"
      : builder
        ? "Hi, I'm Gabe! Ask me how any ConstructHUB feature works or how to set it up. I can't see your account or anyone's data, so I'll point you to the right page."
        : "Hi, I'm Gabe! I know ConstructHUB inside out: plans, features and how to set things up. Tap a question below.";

  // The header's second line: the month's standing for a signed-in account, in the words the pricing page uses.
  const headerLine = metaFailed ? "Allowance unavailable — please try again" : busy
    ? "Thinking it over…"
    : !builder
      ? "Quick answers about ConstructHUB"
      : allowance
        ? allowance.monthly === -1
          ? "Unlimited questions (fair use)"
          : allowance.monthly === 0
            ? "Quick questions only on this account"
            : allowance.remaining === null ? "Monthly allowance unavailable" : `${Math.max(0, allowance.remaining).toLocaleString("en-US")} of ${allowance.monthly.toLocaleString("en-US")} questions left this month`
        : "Ask about any feature or setup step";

  const resetOn = resetLabel(limitBody?.resetsAt ?? allowance?.resetsAt);

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
          aria-expanded={open}
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
          aria-labelledby={titleId}
          aria-describedby={descId}
          className={cn(
            "fixed z-[60] flex flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-2xl [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_a:focus-visible]:outline [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-2",
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
              <p id={descId} className="text-xs text-white/85" data-testid="hub-allowance">
                {headerLine}
              </p>
              {!metaFailed && allowance && <p className="text-xs text-white/85" data-testid="hub-daily">Today: {allowance.daily.used.toLocaleString("en-US")} of {allowance.daily.limit.toLocaleString("en-US")} attempts used. Daily attempts include failures; monthly allowance counts answers.</p>}
            </div>
            {builder && messages.length > 0 && (
              <button type="button" onClick={() => { startOver(); focusComposer(); }}
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
                  {m.failed && <div className="mt-2 flex gap-3 text-xs">
                    <button type="button" className="rounded underline disabled:opacity-50" disabled={busy || (!m.presetId && !canChat)} onClick={() => m.presetId ? void askPreset(m.presetId, m.content, m.id) : void sendChat(m)}>Retry</button>
                    {userId !== null && <button type="button" className="rounded underline" onClick={() => { setInput(m.content); window.setTimeout(() => inputRef.current?.focus(), 0); }}>Edit</button>}
                  </div>}
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

          {(!offline || input.length > 0) && (
          <div className="space-y-3 border-t bg-background/60 p-3">
            {(canChat || input.length > 0) && (
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
                <button type="submit" disabled={!canChat || busy || !input.trim()} aria-label="Send"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50"
                  data-testid="hub-send">
                  <Send className="h-4 w-4" />
                </button>
              </form>
            )}
            {!offline && !canChat && (builder && (spent || noPlanQuestions) ? (
              // The plan's monthly questions: a plan-gate card in the panel (the quick questions above still work).
              <div className="rounded-xl border bg-muted/40 p-3 text-xs" role="status" data-testid="hub-quota" data-reason={noPlanQuestions && !limitBody ? "no_plan" : "spent"}>
                <button type="button" onClick={() => void refetch()} disabled={metaFetching} className="mb-2 rounded-full border bg-background px-3 py-1.5 font-medium disabled:opacity-50" data-testid="hub-check-allowance">{metaFetching ? "Checking allowance…" : "Check allowance"}</button>
                <p className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  {noPlanQuestions && !limitBody ? "Typed questions need a plan" : "This month's questions are used up"}
                </p>
                <p className="mt-1 text-muted-foreground" data-testid="hub-quota-message">
                  {limitBody?.message
                    ? limitBody.message
                    : noPlanQuestions
                      ? "Every ConstructHUB plan includes a monthly allowance of Gabe questions; this account has none. The quick questions above still work."
                      : `You've used all ${allowance?.monthly.toLocaleString("en-US") ?? ""} questions your plan includes this month${resetOn ? `; they come back on ${resetOn} (UTC)` : ""}. The quick questions above still work.`}
                </p>
                {!inNativeApp() && (
                  <Link href="/pricing" onClick={() => setOpen(false)}
                    className="mt-2 inline-flex rounded-full bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600"
                    data-testid="hub-quota-plans">
                    See plans
                  </Link>
                )}
              </div>
            ) : builder ? (
              // Chat is off on the server: say why, and never through a toast. The quick questions above still work.
              <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground" role="status" data-testid="hub-chat-off" data-reason={meta?.chatOff ?? "off"}>
                <p>
                  {meta?.chatOff === "provider"
                    ? "Typed questions aren't set up on this server yet, so I can only answer the quick questions above."
                    : meta?.chatOff === "capped"
                      ? "I've answered all the typed questions I can today. The quick questions above still work, and chat is back tomorrow."
                      : "Chat with Gabe is off right now. The quick questions above still work."}
                </p>
                <button type="button" onClick={() => void refetch()}
                  className="shrink-0 rounded-full border bg-background px-3 py-1.5 text-xs font-medium hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/40"
                  data-testid="hub-chat-off-retry">
                  Check again
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3" data-testid="hub-signup-cta">
                <p className="text-xs text-muted-foreground">Quick questions are free, with or without an account. Typed questions need a verified account and a plan allowance.</p>
                <Link href="/auth" onClick={() => setOpen(false)}
                  className="shrink-0 rounded-full bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600"
                  data-testid="hub-signup-link">
                  Create account
                </Link>
              </div>
            ))}
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
