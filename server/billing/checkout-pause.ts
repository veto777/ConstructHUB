/**
 * Checkout paused (owner, 2026-10-21): while Stripe has charges switched off on the ConstructHUB account, every buy
 * button opens a short "tell us what you want" form instead of a checkout that would fail. Each request is saved
 * (checkout_interest) and posted to the owner's ConstructHUB Alerts Telegram group so the team can follow up.
 *
 * The switch is automatic: the platform account's charges_enabled, re-read at most every few minutes, so checkout
 * comes back by itself the moment Stripe lifts the pause. CHECKOUT_PAUSED=1 / =0 in .env forces it either way.
 * A failed lookup never pauses checkout (the old behaviour stands).
 */
import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pool } from "../db";
import { stripe, stripeConfigured } from "./client";
import { rateLimit } from "../growth-limits";
import { logError } from "../ops/log";

import { CHECKOUT_PAUSED_CODE, CHECKOUT_PAUSED_MESSAGE } from "@shared/checkout-pause";

/** Every route that starts a Stripe checkout for ConstructHUB itself (not a contractor's own client payments). */
export const PAUSABLE_CHECKOUT_ROUTES = [
  "/api/stripe/create-checkout",
  "/api/stripe/create-cart-checkout",
  "/api/stripe/create-course-checkout",
  "/api/seo/credits/checkout",
  "/api/alacarte/checkout",
  "/api/crm/billing/checkout",
  "/api/call-assistant/billing/checkout",
  "/api/contracts/:token/checkout",
  "/api/research-reports/orders/:id/checkout",
  "/api/press/orders",
] as const;

const CACHE_MS = 3 * 60_000;
let cached: { at: number; paused: boolean } | null = null;

/** CHECKOUT_PAUSED from the environment: true/false when set, null to follow Stripe. */
export function checkoutPauseOverride(env: NodeJS.ProcessEnv = process.env): boolean | null {
  const v = (env.CHECKOUT_PAUSED ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return null;
}

export async function checkoutPaused(): Promise<boolean> {
  const forced = checkoutPauseOverride();
  if (forced !== null) return forced;
  if (!stripeConfigured()) return false;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.paused;
  try {
    const account = await stripe.accounts.retrieve();
    cached = { at: Date.now(), paused: account.charges_enabled === false };
  } catch (err) {
    logError("checkout pause: Stripe account lookup", err);
    cached = { at: Date.now(), paused: false };
  }
  return cached.paused;
}

const AREA: [RegExp, string][] = [
  [/^\/api\/stripe\/create-checkout/, "Plan"],
  [/^\/api\/stripe\/create-cart-checkout/, "Cart"],
  [/^\/api\/stripe\/create-course-checkout/, "Master Class"],
  [/^\/api\/seo\/credits/, "SEO credits"],
  [/^\/api\/alacarte/, "Single tool"],
  [/^\/api\/crm\/billing/, "CRM plan"],
  [/^\/api\/call-assistant\/billing/, "Call Assistant"],
  [/^\/api\/contracts\//, "SEO contract payment"],
  [/^\/api\/research-reports\//, "Research report"],
  [/^\/api\/press\//, "Press release"],
];

/** What the visitor was buying, in words, from the route and its body (prefills the form; they can edit it). */
export function describeCheckout(path: string, body: unknown): string {
  const area = AREA.find(([re]) => re.test(path))?.[1] ?? "Purchase";
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const word = (v: unknown) => (typeof v === "string" || typeof v === "number") && String(v).trim() ? String(v).trim().slice(0, 60) : null;
  const parts: string[] = [];
  for (const k of ["plan", "key", "tier", "packageKey", "moduleId"]) { const w = word(b[k]); if (w) parts.push(w); }
  if (b.bundle === true) parts.push("full bundle");
  const interval = word(b.interval);
  if (interval) parts.push(interval);
  if (typeof b.quantity === "number" && b.quantity > 1) parts.push(`x${b.quantity}`);
  if (typeof b.cents === "number") parts.push(`$${(b.cents / 100).toFixed(0)}`);
  if (Array.isArray(b.items)) {
    const names = b.items.map((i: any) => word(i?.name) ?? word(i?.key) ?? word(i?.id)).filter(Boolean).slice(0, 8);
    if (names.length) parts.push(names.join(", "));
  }
  return parts.length ? `${area}: ${parts.join(" · ")}` : area;
}

const interestInput = z.object({
  name: z.string().trim().min(1, "Your name, please.").max(120),
  email: z.string().trim().email("A valid email, please.").max(200),
  phone: z.string().trim().max(40).optional().default(""),
  item: z.string().trim().max(300).optional().default(""),
  note: z.string().trim().max(1000).optional().default(""),
  page: z.string().trim().max(300).optional().default(""),
});

export async function ensureCheckoutInterestSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS checkout_interest (
      id bigserial PRIMARY KEY, user_id integer, name text NOT NULL, email text NOT NULL, phone text,
      item text, note text, page text, ip text, alerted boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The owner's ConstructHUB Alerts group (TELEGRAM_ALERT_*; never TELEGRAM_BOT_TOKEN, the customers' LSA bot). */
async function alertOwner(html: string): Promise<boolean> {
  const token = process.env.TELEGRAM_ALERT_BOT_TOKEN, chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch (err) {
    logError("checkout interest: Telegram alert", err);
    return false;
  }
}

/** Before the checkout routes: answers 503 checkout_paused while the pause is on, else passes through. */
async function pauseGuard(req: Request, res: Response, next: NextFunction) {
  try {
    if (!(await checkoutPaused())) return next();
  } catch { return next(); }
  res.status(503).json({ code: CHECKOUT_PAUSED_CODE, message: CHECKOUT_PAUSED_MESSAGE, item: describeCheckout(req.path, req.body) });
}

export function registerCheckoutPauseRoutes(app: Express): void {
  // Registered before every checkout route (server/routes.ts), so this runs first.
  app.post([...PAUSABLE_CHECKOUT_ROUTES], pauseGuard);

  app.get("/api/billing/checkout-paused", async (_req, res) => {
    res.json({ paused: await checkoutPaused().catch(() => false) });
  });

  app.post("/api/billing/checkout-paused/request", rateLimit("checkout-interest", 5, 10), async (req: any, res) => {
    const parsed = interestInput.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Check the form and try again." });
    const f = parsed.data;
    try {
      const user = req.user as { id: number; email?: string } | undefined;
      const { rows } = await pool.query(
        `INSERT INTO checkout_interest (user_id, name, email, phone, item, note, page, ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [user?.id ?? null, f.name, f.email, f.phone || null, f.item || null, f.note || null, f.page || null, String(req.ip ?? "").slice(0, 64)],
      );
      const lines = [
        "🛒 <b>Wants to buy</b> (checkout paused)",
        `<b>${esc(f.name)}</b>`,
        `✉️ ${esc(f.email)}`,
        f.phone ? `📞 ${esc(f.phone)}` : null,
        f.item ? `🧾 ${esc(f.item)}` : null,
        f.note ? `💬 ${esc(f.note)}` : null,
        user ? `👤 Signed in as account #${user.id}${user.email && user.email.toLowerCase() !== f.email.toLowerCase() ? ` (${esc(user.email)})` : ""}` : "👤 Not signed in",
        f.page ? `📄 ${esc(f.page)}` : null,
      ].filter(Boolean).join("\n");
      const alerted = await alertOwner(lines);
      if (alerted) await pool.query("UPDATE checkout_interest SET alerted = true WHERE id = $1", [rows[0].id]);
      res.json({ ok: true });
    } catch (err) {
      logError("checkout interest", err);
      res.status(500).json({ message: "Could not send your request. Please try again." });
    }
  });
}
