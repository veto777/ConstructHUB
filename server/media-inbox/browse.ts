/**
 * Opens the page a company's auto-reply points to and submits its form (owner, 2026-10-14: "do everything
 * automatically"). Headless Chromium (playwright-core; CHROMIUM_PATH wins, as in script/prerender.ts) reads the page;
 * a Google Form is read from its published question list and posted to its formResponse endpoint.
 * Never solves a CAPTCHA, signs up or pays: such a page is reported as blocked.
 */
import type { Browser } from "playwright-core";
import type { FormField } from "./ai";

export type PageRead = {
  url: string; title: string; text: string; fields: FormField[];
  blocked: string | null;
  formIndex?: number;
  googleForm: { action: string; entries: Record<string, { type: number; options: string[] }> } | null;
};
export type Fill = Record<string, string | string[] | boolean>;
export type SubmitResult = { ok: boolean; detail: string };

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
// A challenge a person must answer (a checkbox or puzzle). Google's invisible reCAPTCHA is not one: a normal submit
// goes through or not, and the page's confirmation decides.
const CAPTCHA = 'iframe[src*="hcaptcha"],.h-captcha,.cf-turnstile,iframe[src*="turnstile"],iframe[src*="recaptcha/api2/anchor"],iframe[src*="recaptcha/enterprise/anchor"]';
const DONE = /thank|received|submitted|success|been recorded|we('ll| will) (be in touch|get back|contact)/i;

let browser: Browser | null = null;
async function getBrowser(): Promise<Browser> {
  if (!browser) {
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--disable-blink-features=AutomationControlled"] });
  }
  return browser;
}
export async function closeBrowser() {
  await browser?.close().catch(() => undefined);
  browser = null;
}

/** A Google Form's questions, from the FB_PUBLIC_LOAD_DATA_ it publishes. */
export function parseGoogleForm(html: string, url: string): Pick<PageRead, "title" | "text" | "fields" | "googleForm"> | null {
  const m = html.match(/FB_PUBLIC_LOAD_DATA_ = (.*?);<\/script>/s);
  if (!m) return null;
  const d = JSON.parse(m[1]);
  const fields: FormField[] = [];
  const entries: Record<string, { type: number; options: string[] }> = {};
  const text: string[] = [String(d?.[1]?.[8] ?? ""), String(d?.[1]?.[0] ?? "")];
  for (const q of d?.[1]?.[1] ?? []) {
    text.push([q[1], q[2]].filter(Boolean).join(" — "));
    for (const e of q[4] ?? []) {
      const key = `entry.${e[0]}`;
      const options = (e[1] ?? []).map((o: any[]) => String(o[0])).filter(Boolean);
      // 0 short text, 1 paragraph, 2 multiple choice, 3 dropdown, 4 checkboxes
      fields.push({ key, label: String(q[1] ?? ""), type: ({ 0: "text", 1: "textarea", 2: "radio", 3: "select", 4: "checkbox-group" } as Record<number, string>)[q[3]] ?? "text", required: e[2] === 1, ...(options.length ? { options } : {}) });
      entries[key] = { type: q[3], options };
    }
  }
  return { title: String(d?.[3] ?? d?.[1]?.[8] ?? "Google Form"), text: text.filter(Boolean).join("\n"), fields, googleForm: { action: url.replace(/\/viewform.*$/, "/formResponse"), entries } };
}

/** Open the page: its text, the form most likely meant for us (not a search box), and whether it is blocked. */
export async function readPage(url: string): Promise<PageRead> {
  const page = await (await getBrowser()).newPage({ userAgent: UA });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(4000);
      if (!/just a moment|security verification|attention required/i.test(`${await page.title()} ${(await page.innerText("body").catch(() => "")).slice(0, 400)}`)) break;
    }
    const finalUrl = page.url();
    if (/docs\.google\.com\/forms\//.test(finalUrl)) {
      const g = parseGoogleForm(await page.content(), finalUrl);
      if (g) return { url: finalUrl, ...g, blocked: null };
    }
    const r = await page.evaluate((captchaSel) => {
      const labelOf = (e: any) => (e.labels?.[0]?.innerText || e.getAttribute("aria-label") || e.placeholder || e.name || "").trim().slice(0, 120);
      const forms = [...document.forms].map((f) => {
        const els = [...f.elements].filter((e: any) => e.name && !["hidden", "submit", "button", "image", "reset", "file"].includes(e.type)) as any[];
        const seen = new Set<string>();
        const fields = els.filter((e) => (e.type === "radio" || e.type === "checkbox" ? !seen.has(e.name) && seen.add(e.name) : true)).map((e) => {
          const group = e.type === "radio" || e.type === "checkbox" ? els.filter((x) => x.name === e.name) : [];
          return {
            key: e.name, label: group.length > 1 ? (e.closest("fieldset")?.querySelector("legend")?.innerText ?? labelOf(e)).trim().slice(0, 120) : labelOf(e),
            type: e.tagName === "SELECT" ? "select" : e.tagName === "TEXTAREA" ? "textarea" : group.length > 1 ? (e.type === "radio" ? "radio" : "checkbox-group") : e.type,
            required: !!e.required || /\*/.test(labelOf(e)),
            options: e.tagName === "SELECT" ? [...e.options].map((o: any) => o.text.trim()).filter(Boolean) : group.length > 1 ? group.map((x: any) => labelOf(x)) : undefined,
          };
        });
        return { index: [...document.forms].indexOf(f), fields, password: els.some((e) => e.type === "password"), card: els.some((e) => /card|cvv|cvc|expir/i.test(`${e.name} ${e.autocomplete}`)) };
      });
      // The form meant for us: has a message box or an email field, and is not a site search.
      const best = forms.filter((f) => f.fields.some((x) => x.type === "textarea" || x.type === "email" || /email/i.test(x.label)) && !f.fields.every((x) => /search|^s$|term|location/i.test(x.key)))
        .sort((a, b) => b.fields.length - a.fields.length)[0] ?? null;
      return { title: document.title, text: document.body.innerText.slice(0, 12000), best, captcha: [...document.querySelectorAll(captchaSel)].some((e) => (e as HTMLElement).getBoundingClientRect().height > 30) };
    }, CAPTCHA);
    const blocked = !r.best ? null : r.best.card ? "The form asks for payment details" : r.best.password ? "The form needs an account (password)" : r.captcha ? "The form is behind a CAPTCHA" : null;
    return { url: finalUrl, title: r.title, text: r.text, fields: (r.best?.fields ?? []) as FormField[], blocked, googleForm: null, formIndex: r.best?.index };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Post a Google Form's answers to its formResponse endpoint. */
export async function submitGoogleForm(g: NonNullable<PageRead["googleForm"]>, fill: Fill): Promise<SubmitResult> {
  const body = new URLSearchParams();
  for (const [key, v] of Object.entries(fill)) {
    if (!g.entries[key]) continue;
    for (const x of Array.isArray(v) ? v : [String(v)]) if (x !== "false") body.append(key, x);
  }
  const res = await fetch(g.action, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, body, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  return res.ok && /response has been recorded|freebirdFormviewerViewResponseConfirmationMessage/i.test(text)
    ? { ok: true, detail: "Google Form response recorded" }
    : { ok: false, detail: `Google Form refused the answers (${res.status})` };
}

/** Fill and submit an HTML form; success when the page then says thanks / received. */
export async function submitHtmlForm(read: PageRead, fill: Fill): Promise<SubmitResult> {
  if (read.formIndex == null) return { ok: false, detail: "No form found" };
  const page = await (await getBrowser()).newPage({ userAgent: UA });
  try {
    await page.goto(read.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3000);
    const form = page.locator("form").nth(read.formIndex);
    for (const f of read.fields) {
      const v = fill[f.key];
      if (v == null || v === "") continue;
      const sel = `[name="${f.key.replace(/"/g, '\\"')}"]`;
      if (f.type === "select") await form.locator(sel).selectOption({ label: String(v) }).catch(() => form.locator(sel).selectOption(String(v)));
      else if (f.type === "checkbox" || f.type === "radio" || f.type === "checkbox-group") {
        const wanted = Array.isArray(v) ? v : typeof v === "string" ? [v] : v ? [true] : [];
        const boxes = form.locator(sel);
        for (let i = 0; i < (await boxes.count()); i++) {
          const b = boxes.nth(i);
          const label = await b.evaluate((e: any) => (e.labels?.[0]?.innerText || e.getAttribute("aria-label") || e.value || "").trim());
          if (wanted.some((w) => w === true || (typeof w === "string" && label.toLowerCase().includes(w.toLowerCase())))) await b.check({ force: true });
        }
      } else await form.locator(sel).first().fill(String(v));
    }
    const before = page.url();
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined),
      form.locator('[type="submit"], button:not([type="button"])').first().click({ timeout: 10_000 }),
    ]);
    await page.waitForTimeout(4000);
    const after = (await page.innerText("body").catch(() => "")).slice(0, 4000);
    return DONE.test(after) || page.url() !== before
      ? { ok: true, detail: `Submitted; the page said: ${(after.match(new RegExp(`[^.\\n]*${DONE.source}[^.\\n]*`, "i"))?.[0] ?? "(moved to a new page)").trim().slice(0, 200)}` }
      : { ok: false, detail: "Submitted, but the page did not confirm it" };
  } finally {
    await page.close().catch(() => undefined);
  }
}
