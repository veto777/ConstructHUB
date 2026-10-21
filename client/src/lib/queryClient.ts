import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { rememberPlanPrompt } from "@/lib/plan-errors";
import { inNativeApp } from "./app-shell";
import { withDivisionHeader } from "./division-workspace";
import { CHECKOUT_PAUSED_CODE } from "@shared/checkout-pause";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    // A gateway error page (Cloudflare's 502 while the app restarts, a proxy timeout) is HTML, not our JSON. Pages
    // print the error message as-is, so the whole HTML document landed on screen (owner, 2026-10-07). Give it the
    // same shape as our own answers instead.
    // Our own 5xx answers are JSON with a message (and sometimes a code, e.g. 503 social_misconfigured): keep them.
    let ownJson = false;
    try { const j = JSON.parse(text); ownJson = !!j && typeof j === "object" && typeof j.message === "string"; } catch { /* not JSON */ }
    if (!ownJson && ((res.status >= 502 && res.status <= 504) || (res.status >= 520 && res.status <= 530) || /^\s*<(!doctype|html)\b/i.test(text))) {
      throw new Error(`${res.status}: ${JSON.stringify({ message: "ConstructHUB is restarting or briefly unavailable. Try again in a minute." })}`);
    }
    throw new Error(`${res.status}: ${text}`);
  }
}

/**
 * A deploy closes the app's port for ~10-15 s; Cloudflare answers 502/503/52x (HTML) or the fetch fails outright.
 * The request never reached the app, so it is safe to send again: wait and retry for up to ~60 s instead of
 * showing "restarting" (owner, 2026-10-21: a Save during a deploy must never fail). A 504 (gateway timeout) may
 * have reached the app, so only reads are retried on it.
 */
const RESTART_WAITS_MS = [1000, 2000, 3000, 5000, 8000, 10000, 15000, 15000];
async function gatewayDown(res: Response, method: string): Promise<boolean> {
  const s = res.status;
  const gateway = s === 502 || s === 503 || (s >= 520 && s <= 530) || (s === 504 && method.toUpperCase() === "GET");
  if (!gateway) return false;
  const text = await res.clone().text().catch(() => "");
  try { const j = JSON.parse(text); if (j && typeof j === "object" && typeof j.message === "string") return false; } catch { /* not our JSON */ }
  return true;
}
async function sendThroughRestart(send: () => Promise<Response>, method: string): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const res = await send();
      if (i >= RESTART_WAITS_MS.length || !(await gatewayDown(res, method))) return res;
    } catch (err) {
      if (i >= RESTART_WAITS_MS.length) throw err;
    }
    await new Promise((r) => setTimeout(r, RESTART_WAITS_MS[i]));
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  /** Extra request headers — e.g. an Idempotency-Key on a payment write (server/crm/payment-guard.ts). */
  extra?: { headers?: Record<string, string> },
): Promise<Response> {
  // /api/crm/* carries the division workspace header (lib/division-workspace.ts).
  const send = () => fetch(url, withDivisionHeader(url, {
    method,
    headers: { ...(data ? { "Content-Type": "application/json" } : {}), ...(extra?.headers ?? {}) },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  }));
  let res = await sendThroughRestart(send, method);

  if (res.status === 403 && (await res.clone().json().catch(() => ({}))).reauth === true) {
    const { requestRecentAuth } = await import('@/components/recent-auth');
    await requestRecentAuth();
    res = await fetch(url, withDivisionHeader(url, { method, headers: data ? { "Content-Type": "application/json" } : {}, body: data ? JSON.stringify(data) : undefined, credentials: "include" }));
  }
  // A buy button while Stripe has charges off: open the "tell us what you'd like" form (the toast is silenced).
  if (res.status === 503) {
    const body = await res.clone().json().catch(() => null);
    if (body?.code === CHECKOUT_PAUSED_CODE) {
      const { openCheckoutPausedForm } = await import("@/components/checkout-paused-form");
      openCheckoutPausedForm(typeof body.item === "string" ? body.item : "");
    }
  }
  await throwIfResNotOk(res);
  if (method.toUpperCase() !== "GET" && /^\/api\/(auth|gbp)(?:\/|$)/.test(url)) {
    // Security panels otherwise retain their first response indefinitely.
    for (const key of ['/api/account-activity', '/api/auth/devices', '/api/notifications']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }
  return res;
}

/**
 * apiRequest errors carry "STATUS: <response body>" and the body is our own
 * JSON ({ message }) — unwrap it so a toast reads like a sentence ("This
 * client has no email address. Add one first."), never raw JSON. A plan answer
 * (plan_required, limit_reached, payment_failed) is remembered so the Toaster
 * can add its link (lib/plan-errors.ts).
 */
export function apiErrorMessage(err: any, fallback = "Something went wrong — please try again."): string {
  const raw: string = typeof err?.message === "string" ? err.message : String(err ?? "");
  const body = raw.replace(/^\d{3}:\s*/, "");
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.message === "string") {
      // Inside the iPhone apps a plan answer reads neutrally — the apps sell
      // nothing (owner, 2026-10-04): no plan names, prices, upgrade wording.
      if (inNativeApp()) {
        if (parsed.code === "plan_required" || parsed.code === "crm_plan_required" || parsed.code === "call_assistant_required") return "That isn't on this account.";
        if (parsed.code === "limit_reached") return "That limit is reached on this account.";
        if (parsed.code === "payment_failed") return "That payment didn't go through.";
      }
      rememberPlanPrompt(parsed);
      return parsed.message;
    }
  } catch { /* plain-text or empty body — show it as-is */ }
  return body || fallback;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/") as string;
    const res = await fetch(url, withDivisionHeader(url, {
      credentials: "include",
      // Never let the browser cache API responses: 404/410 are cacheable by
      // default (RFC 9111), so a stale "expired" would survive the fix — e.g.
      // an extended estimate kept showing the expired page.
      cache: "no-store",
    }));

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
