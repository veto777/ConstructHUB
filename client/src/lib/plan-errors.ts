/**
 * The server's plan answers (server/entitlements.ts, server/stripe.ts):
 *   402 { code: "plan_required", requiredPlan, message }     — the plan doesn't include this
 *   403 { code: "limit_reached", upgradePlan, addon, message } — this month's allowance is used
 *   402 { code: "payment_failed", message }                   — the card couldn't be charged
 *
 * apiErrorMessage() (lib/queryClient.ts) remembers the way forward for each such
 * message it unwraps, and the Toaster adds that link to whichever toast shows the
 * message. So every page that toasts apiErrorMessage(err) gets "See Pro" or
 * "Add competitor scan pack" next to the server's sentence without building the
 * link itself. Pure (no React) so the server test suite can check it.
 * In the iPhone apps none of this fires: the apps sell nothing (owner, 2026-10-04),
 * so plan answers read as neutral sentences and carry no link.
 */
import { ADDONS, PLANS, isAddonKey, isPlanKey } from "@shared/plans";
import { inNativeApp } from "@/lib/app-shell";

export type PlanPrompt = { label: string; href: string };

/** Where Settings → Billing lives (add-ons, card, invoices). */
export const BILLING_SETTINGS_HREF = "/settings?tab=billing";

/** The link a plan answer points to, or null for any other body. */
export function planPromptFromBody(body: unknown): PlanPrompt | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.code === "plan_required") {
    return { label: isPlanKey(b.requiredPlan) ? `See ${PLANS[b.requiredPlan].name}` : "See plans", href: "/pricing" };
  }
  if (b.code === "limit_reached") {
    // An add-on raises the limit without changing plan; it is bought on the subscription in Settings → Billing.
    if (isAddonKey(b.addon)) return { label: `Add ${ADDONS[b.addon].name.toLowerCase()}`, href: BILLING_SETTINGS_HREF };
    if (isPlanKey(b.upgradePlan)) return { label: `See ${PLANS[b.upgradePlan].name}`, href: "/pricing" };
    // Nothing to buy (e.g. Agency above self-serve): the message itself says to talk to a sales rep.
    return null;
  }
  if (b.code === "payment_failed") return { label: "Manage billing", href: BILLING_SETTINGS_HREF };
  return null;
}

/** Message → prompt for the plan answers seen recently (bounded; newest wins). */
const remembered = new Map<string, PlanPrompt>();
const REMEMBER_MAX = 50;

/** Record the way forward for a parsed error body whose `message` a toast is about to show. */
export function rememberPlanPrompt(body: unknown): void {
  // The iPhone apps sell nothing (owner, 2026-10-04): no "See Pro" / "Add extra
  // seat" / "Manage billing" toast actions inside them.
  if (inNativeApp()) return;
  const prompt = planPromptFromBody(body);
  const message = (body as { message?: unknown } | null)?.message;
  if (!prompt || typeof message !== "string" || !message) return;
  remembered.delete(message);
  remembered.set(message, prompt);
  while (remembered.size > REMEMBER_MAX) remembered.delete(remembered.keys().next().value!);
}

/** The prompt for a toast description, when it is (exactly) a remembered plan answer. */
export function planPromptFor(description: unknown): PlanPrompt | null {
  return typeof description === "string" ? remembered.get(description) ?? null : null;
}

/**
 * An apiRequest / default-queryFn error ("402: {json}") as status + parsed body.
 * Anything that isn't one of those errors gives null.
 */
export function apiErrorInfo(err: unknown): { status: number; body: Record<string, any> | null } | null {
  const raw = typeof (err as any)?.message === "string" ? (err as any).message as string : "";
  const match = /^(\d{3}):\s*([\s\S]*)$/.exec(raw);
  if (!match) return null;
  let body: Record<string, any> | null = null;
  try {
    const parsed = JSON.parse(match[2]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
  } catch { /* plain-text body */ }
  return { status: Number(match[1]), body };
}

/** The `code` of an apiRequest error's JSON body ("talk_to_sales", "has_subscription", …), or null. */
export function apiErrorCode(err: unknown): string | null {
  const code = apiErrorInfo(err)?.body?.code;
  return typeof code === "string" ? code : null;
}
