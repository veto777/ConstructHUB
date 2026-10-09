import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { rememberPlanPrompt } from "@/lib/plan-errors";
import { inNativeApp } from "./app-shell";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    // A gateway error page (Cloudflare's 502 while the app restarts, a proxy timeout) is HTML, not our JSON. Pages
    // print the error message as-is, so the whole HTML document landed on screen (owner, 2026-10-07). Give it the
    // same shape as our own answers instead.
    if ((res.status >= 502 && res.status <= 504) || (res.status >= 520 && res.status <= 530) || /^\s*<(!doctype|html)\b/i.test(text)) {
      throw new Error(`${res.status}: ${JSON.stringify({ message: "ConstructHUB is restarting or briefly unavailable. Try again in a minute." })}`);
    }
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  let res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  if (res.status === 403 && (await res.clone().json().catch(() => ({}))).reauth === true) {
    const { requestRecentAuth } = await import('@/components/recent-auth');
    await requestRecentAuth();
    res = await fetch(url, { method, headers: data ? { "Content-Type": "application/json" } : {}, body: data ? JSON.stringify(data) : undefined, credentials: "include" });
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
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      // Never let the browser cache API responses: 404/410 are cacheable by
      // default (RFC 9111), so a stale "expired" would survive the fix — e.g.
      // an extended estimate kept showing the expired page.
      cache: "no-store",
    });

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
