/**
 * The media inbox pass (MEDIA_INBOX_ENABLED=true; every MEDIA_INBOX_INTERVAL_MIN, default 30):
 *   1. reads new email in media@ — machine senders are logged as automated, everything else waits for an answer;
 *   2. answers each waiting email (owner's law: none is ignored) — the model drafts, ./guard.ts checks; a refused draft,
 *      a model failure (after 3 tries) or a money / meeting / contract question gets a holding reply and waits for the owner;
 *   3. records the company and where the relationship stands; an agreement adds it to our lists (store.addAgreedPartner);
 *   4. follows up (owner, 2026-10-14): no answer 5 days after our last email → one follow-up in the thread; still nothing
 *      5 days later → another contact address from their site (up to 3 per company), else a note for the owner;
 *   5. first contact: vetted directories, article sites and news outlets that publish an email are queued (also loaded
 *      from research lists) and sent at dailyAllowance() a day (50, +25 a day, up to 400).
 *   2b. auto-replies are read for their next step, and 2c. that step is carried out (actOnNextSteps).
 * Anyone who asks us to stop is never emailed again (backlink_suppression).
 * One process at a time (a Postgres advisory lock).
 */
import { promises as dns } from "node:dns";
import { MEDIA_INBOX_PARAMETERS, STOP_LINE_RE, type MediaSettings, type MediaTemplateKind } from "@shared/media-inbox";
import { pool } from "../db";
import { recordFailure } from "../ops/issues";
import { classifySites, decide, extractNextStep, mediaAiConfigured, planForm } from "./ai";
import { closeBrowser, readPage, submitGoogleForm, submitHtmlForm } from "./browse";
import { asksIfAi, companyDomain, firstNameOf, formMessage, holdingReply, personWillReply, isOptOut, machineReason, replyProblem, replySubject } from "./guard";
import { pickEmail, siteName } from "../backlinks/outreach";
import { isSuppressed } from "../backlinks/store";
import { fetchSince, mailboxConfig, mailboxConfigured, sendMail } from "./mailbox";
import { checkMailbox } from "./verify";
import * as store from "./store";
import { workerInterval } from "../workers";

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
export const mediaWorkerConfig = (env: NodeJS.ProcessEnv = process.env) => ({
  enabled: env.MEDIA_INBOX_ENABLED === "true",
  intervalMin: num(env.MEDIA_INBOX_INTERVAL_MIN, MEDIA_INBOX_PARAMETERS.checkEveryMin),
});

export const MAX_ATTEMPTS = MEDIA_INBOX_PARAMETERS.aiAttemptsBeforeHolding;
export const MAX_REPLIES_PER_DAY = MEDIA_INBOX_PARAMETERS.maxRepliesPerSenderPerDay;
const ANSWER_BATCH = 25;

/**
 * Can the address's domain receive mail at all? Bounces hurt the new mailbox (2026-10-15: 9 of ~140 cold emails, ~6%;
 * Gmail flags senders past ~2%). A domain with no MX record (or a null MX) is skipped; a DNS timeout is not held against
 * it. The mailbox itself is then checked with its server (./verify.ts).
 */
export async function acceptsMail(domain: string): Promise<boolean> {
  try {
    const mx = await dns.resolveMx(domain);
    return mx.some((r) => r.exchange && r.exchange !== ".");
  } catch (e: any) {
    return !["ENOTFOUND", "ENODATA", "ESERVFAIL", "NXDOMAIN"].includes(e?.code);
  }
}
export const workerDeps = { fetchSince, sendMail, decide, extractNextStep, acceptsMail, checkMailbox };

/** Addresses that are never a cold contact even when a site lists them (2026-10-17: applicationsprogramming@ bounced). */
export const NOT_A_CONTACT = /^(applications?|programming|applicationsprogramming|eeo|hr|humanresources|recruit\w*|careers?|jobs?|employment|accounting|accountspayable|ap|ar|billing|invoices?|legal|compliance|privacy|webmaster|hostmaster|security|abuse|unsubscribe|subscriptions?|circulation|delivery)@/i;

/** The recipient's server refused this mailbox (verify.ts). An unknown answer is not held against it. */
async function mailboxRefused(email: string): Promise<string | null> {
  const c = await workerDeps.checkMailbox(email, mailboxConfig().user).catch(() => null);
  return c?.verdict === "no" ? `Mailbox does not exist (${c.reply})` : null;
}

/**
 * Step 2b: an auto-reply from a company we contacted is never answered, but it is read (owner, 2026-10-14: "do not
 * ignore any emails"): its next step — a form to fill, another address, a portal — goes on the company's record.
 */
export async function readAutoReplies(): Promise<{ read: number }> {
  let read = 0;
  for (const m of await store.unreadAutoReplies()) {
    try {
      await store.saveNextStep(m.id, m.partner_id, await workerDeps.extractNextStep(await store.thread(m.thread_key, m.id)));
      read++;
    } catch { await store.markAutoReplyTried(m.id); }
  }
  return { read };
}

export const actDeps = { readPage, planForm, submitGoogleForm, submitHtmlForm, closeBrowser };
const ROUTES_TO_WRITE = new Set(["partnerships", "editorial", "other"]);
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Step 2c: carry out the next step an auto-reply gave (owner, 2026-10-14: "do everything automatically"):
 *  - another address for partnerships or editorial → our first email goes there (never advertising, billing or support);
 *  - a page → read it; a price for a partner or API plan goes on the company's cost terms and the owner's list (we never
 *    buy); its form is filled from the approved facts and submitted unless it needs a CAPTCHA, an account or payment.
 */
export async function actOnNextSteps(): Promise<{ acted: number; emailed: number; submitted: number; blocked: number }> {
  const mailbox = mailboxConfig().user;
  const out = { acted: 0, emailed: 0, submitted: 0, blocked: 0 };
  try {
    for (const a of await store.pendingActions()) {
      const done: string[] = [];
      let toFinalize: string | null = null, costTerms: string | null = null, ownerQuestion: string | null = null;
      try {
        if (a.contact && ROUTES_TO_WRITE.has(a.contactRole ?? "other")) {
          const tried = new Set(a.triedEmails.map((e) => e.toLowerCase()));
          if (tried.has(a.contact)) done.push(`Already wrote to ${a.contact}`);
          else if (await isSuppressed(a.contact)) done.push(`${a.contact} asked not to be emailed`);
          else if (tried.size >= MEDIA_INBOX_PARAMETERS.maxContactsPerCompany) done.push(`Not writing to ${a.contact}: ${tried.size} addresses already tried`);
          else {
            const first = await store.firstOutbound(a.partnerId);
            const subject = first?.subject ?? `Partnership: ${a.company} and ConstructHUB`;
            const body = newContactBody(a.company, first?.body ?? firstContactBody(a.company));
            const messageId = await workerDeps.sendMail({ to: a.contact, subject, body });
            await store.saveOutbound(mailbox, { messageId, threadKey: null, to: a.contact, subject, body, partnerId: a.partnerId, purpose: "outreach" });
            done.push(`Emailed ${a.contact} (their ${a.contactRole} address) on ${today()}`);
            toFinalize = `Waiting for ${a.contact} to answer (emailed ${today()}).`;
            out.emailed++;
          }
        } else if (a.contact) done.push(`Did not write to ${a.contact}: it is their ${a.contactRole} address, not partnerships`);

        if (a.link) {
          const page = await actDeps.readPage(/^https?:\/\//i.test(a.link) ? a.link : `https://${a.link}`);
          const first = await store.firstOutbound(a.partnerId);
          const plan = await actDeps.planForm(page, formMessage(first?.body ?? firstContactBody(a.company)));
          if (plan.pricing) {
            costTerms = `${plan.pricing} (${page.url})`;
            ownerQuestion = `${a.company} lists a paid plan: ${plan.pricing}. Nothing was bought; buy it only once customer purchases cover it.`;
            done.push(`Price on their page: ${plan.pricing}`);
          }
          if (plan.api) done.push(`API: ${plan.api}`);
          const problem = Object.values(plan.fill).flat().map((v) => (typeof v === "string" && v.trim() ? replyProblem(v) : null)).find(Boolean);
          if (page.blocked) {
            done.push(`${page.blocked} (${page.url}); it cannot be sent automatically`);
            toFinalize ??= `${page.blocked}: a person has to submit ${page.url}`;
            out.blocked++;
          } else if (!plan.submit) {
            done.push(`Read ${page.url}; nothing to submit (${plan.why || "no partnership form"})`);
            toFinalize ??= plan.pricing ? `Partner plan priced on ${page.url}; join once customer purchases cover it.` : `Nothing to submit on ${page.url}; waiting for ${a.company}.`;
          } else if (problem) {
            done.push(`Did not submit ${page.url}: the answers broke a law (${problem})`);
            toFinalize ??= `The form at ${page.url} was not sent (${problem}).`;
          } else {
            const r = page.googleForm ? await actDeps.submitGoogleForm(page.googleForm, plan.fill) : await actDeps.submitHtmlForm(page, plan.fill);
            done.push(r.ok ? `Submitted the form at ${page.url} on ${today()}: ${r.detail}` : `Could not submit ${page.url}: ${r.detail}`);
            if (r.ok) out.submitted++;
            toFinalize ??= r.ok ? `Form submitted ${today()}; waiting for ${a.company} to answer.` : `The form at ${page.url} did not go through (${r.detail}).`;
          }
        }
      } catch (e: any) {
        done.push(`Failed: ${String(e?.message ?? e).slice(0, 200)}`);
        console.error(`[media-inbox] next step for ${a.company} failed: ${e?.message ?? e}`);
      }
      await store.recordAction(a.id, a.partnerId, { result: done.join(" · ") || "Nothing to do", toFinalize: toFinalize ?? done.at(-1) ?? null, costTerms, ownerQuestion });
      out.acted++;
    }
  } finally {
    await actDeps.closeBrowser();
  }
  return out;
}

/** Step 1: store every new email. */
export async function readInbox(): Promise<{ read: number; automated: number }> {
  const mailbox = mailboxConfig().user;
  const state = await store.getState(mailbox);
  const { uidValidity, messages } = await workerDeps.fetchSince(state.lastUid, state.uidValidity);
  let read = 0, automated = 0, top = state.uidValidity === uidValidity ? state.lastUid : 0;
  for (const m of messages) {
    const reason = machineReason(m);
    if (await store.saveInbound(mailbox, m, reason)) { read++; if (reason) automated++; }
    top = Math.max(top, m.uid);
  }
  if (uidValidity) await store.saveState(mailbox, uidValidity, top);
  return { read, automated };
}

/** Step 2 + 3: answer every waiting email. */
export async function answerPending(): Promise<{ replied: number; held: number; failed: number; optedOut: number }> {
  const mailbox = mailboxConfig().user;
  const out = { replied: 0, held: 0, failed: 0, optedOut: 0 };
  for (const m of await store.pending(ANSWER_BATCH)) {
    const first = firstNameOf(m.fromName);
    let body: string, status: "replied" | "needs_owner" | "failed", reason: string | null = null, partnerId: number | null = null;
    let newlyAgreed: Awaited<ReturnType<typeof store.upsertPartner>> | null = null;
    try {
      if (isOptOut(m.body)) {
        await store.optOut(m.id, m.fromEmail, m.partnerId ?? (await store.partnerIdForEmail(m.fromEmail, companyDomain(m.fromEmail))));
        out.optedOut++;
        continue;
      }
      if ((await store.repliesToday(m.fromEmail)) >= MAX_REPLIES_PER_DAY) {
        await store.finishMessage(m.id, "needs_owner", `Reply limit for this sender reached (${MAX_REPLIES_PER_DAY} in 24 hours) — loop protection`, null, null);
        out.held++;
        continue;
      }
      const d = await workerDeps.decide(await store.thread(m.threadKey, m.id));
      if (d.relevant) {
        newlyAgreed = await store.upsertPartner({ domain: companyDomain(m.fromEmail), contactEmail: m.fromEmail, contactName: m.fromName, d });
        partnerId = newlyAgreed.partner.id;
      }
      // "Thanks / sounds good": nothing to answer (2026-10-15: Homes&Exterior's thank-you hit the loop limit).
      if (d.noReplyNeeded && !asksIfAi(m.body)) {
        await store.finishMessage(m.id, "replied", `No reply needed: ${d.summary || "they closed the loop"} — read by ${d.provider}`, null, partnerId);
        out.replied++;
        continue;
      }
      const problem = replyProblem(d.reply);
      if (asksIfAi(m.body)) { body = personWillReply(first); status = "needs_owner"; reason = "They asked whether we are an AI or a person — a person on the team answers this one"; }
      else if (problem) { body = holdingReply(first); status = "needs_owner"; reason = [problem, d.ownerQuestion, `Drafted by ${d.provider}`].filter(Boolean).join(" — "); }
      else { body = d.reply; status = d.needsOwner ? "needs_owner" : "replied"; reason = [d.needsOwner ? d.ownerQuestion ?? "Owner decision needed" : null, `Answered by ${d.provider}`].filter(Boolean).join(" — "); }
    } catch (e: any) {
      if (m.attempts + 1 < MAX_ATTEMPTS) { await store.bumpAttempt(m.id, e?.message ?? String(e)); continue; }
      body = holdingReply(first); status = "failed"; reason = `Could not draft an answer: ${String(e?.message ?? e).slice(0, 300)}`;
    }
    const subject = replySubject(m.subject);
    const messageId = await workerDeps.sendMail({ to: m.fromEmail, cc: m.cc, subject, body, inReplyTo: m.messageId, references: m.references });
    const replyId = await store.saveOutbound(mailbox, { messageId, threadKey: m.threadKey, to: m.fromEmail, cc: m.cc, subject, body, partnerId, purpose: "reply" });
    await store.finishMessage(m.id, status, reason, replyId || null, partnerId);
    if (newlyAgreed?.newlyAgreed) await store.addAgreedPartner(newlyAgreed.partner);
    if (status === "replied") out.replied++; else if (status === "needs_owner") out.held++; else out.failed++;
  }
  return out;
}

/** The follow-up in the same thread (no model: fixed, law-safe wording). */
export function followUpBody(firstName: string | null, company: string, firstBody: string): string {
  const hi = firstName ? `Hi ${firstName},` : "Hi,";
  return `${hi}\n\nWe wanted to follow up on our email below about working together with ${company}. If you're not the right person, could you point us to whoever handles partnerships or listings?\n\nBest regards,\n\n--- Our earlier email ---\n${firstBody.trim()}`;
}

/** First contact to another address at the same company, after the first one went quiet. */
export function newContactBody(company: string, firstBody: string): string {
  const body = firstBody.trim().replace(/^(hi|hello|dear)[^\n]*\n+/i, "");
  return `Hi,\n\nWe tried to reach ${company} at another address and may have had the wrong contact. ${body}`;
}

export const followDeps = {
  readEmails: async (domain: string): Promise<string[]> => {
    const { readSite } = await import("../backlinks/vet");
    const s = await readSite(`https://${domain}/contact`, domain).catch(() => null);
    return s?.emails ?? [];
  },
};

/** Step 4: nobody answered → follow up once; still nothing → a new address at the company (owner, 2026-10-14). */
export async function followUpSilent(): Promise<{ followedUp: number; newContacts: number; exhausted: number }> {
  const mailbox = mailboxConfig().user;
  const out = { followedUp: 0, newContacts: 0, exhausted: 0 };
  for (const t of await store.silentThreads(MEDIA_INBOX_PARAMETERS.followUpAfterDays)) {
    if (await isSuppressed(t.to)) { await store.markFollowedUp(t.lastId); continue; }
    if (t.followups === 0) {
      const body = followUpBody(t.to.toLowerCase() === (t.triedEmails[0] ?? "") ? firstNameOf(t.contactName) : null, t.company, t.firstBody);
      const subject = replySubject(t.firstSubject);
      const messageId = await workerDeps.sendMail({ to: t.to, cc: t.cc, subject, body, inReplyTo: t.lastMessageId, references: t.references });
      await store.saveOutbound(mailbox, { messageId, threadKey: t.threadKey, to: t.to, cc: t.cc, subject, body, partnerId: t.partnerId, purpose: "followup" });
      await store.markFollowedUp(t.lastId);
      out.followedUp++;
      continue;
    }
    await store.markFollowedUp(t.lastId);
    const tried = new Set(t.triedEmails.map((e) => e.toLowerCase()));
    let next: string | null = null;
    if (t.domain && tried.size < MEDIA_INBOX_PARAMETERS.maxContactsPerCompany) {
      const found = [...(await store.knownEmails(t.domain)), ...(await followDeps.readEmails(t.domain))]
        .map((e) => e.toLowerCase()).filter((e) => !tried.has(e) && !machineReason({ fromEmail: e, subject: "" }));
      const fresh: string[] = [];
      for (const e of new Set(found)) if (!(await isSuppressed(e))) fresh.push(e);
      // Best address first; one the recipient's server refuses is dropped for the next best.
      let left = fresh.filter((e) => !NOT_A_CONTACT.test(e));
      for (let pick = pickEmail(left); pick; pick = pickEmail(left)) {
        if (!(await mailboxRefused(pick))) { next = pick; break; }
        left = left.filter((e) => e !== pick);
      }
    }
    if (!next) {
      await store.noteOnPartner(t.partnerId, `No reply from ${[...tried].join(", ")} after a follow-up, and no other contact address found on ${t.domain ?? "their site"}.`);
      out.exhausted++;
      continue;
    }
    const body = newContactBody(t.company, t.firstBody);
    const messageId = await workerDeps.sendMail({ to: next, subject: t.firstSubject, body });
    await store.saveOutbound(mailbox, { messageId, threadKey: null, to: next, subject: t.firstSubject, body, partnerId: t.partnerId, purpose: "outreach" });
    out.newContacts++;
  }
  return out;
}

/** First contact for a directory from the queue (fixed wording; every one carries the stop line). */
export function firstContactBody(company: string): string {
  return `Hi ${company} team,

ConstructHUB is software for US contractors (roofers, HVAC, plumbers, remodelers). We're launching Directory Sync, which keeps our customers' business listings accurate across the directories that matter, and ${company} is one of the directories we'd like to work with directly.

Could you tell us:
1. How we can add and update listings for many businesses (an API, bulk upload or partner program) and what approval involves.
2. Your pricing per listing, plus any setup fee or minimum.
3. Whether you accept service-area businesses that hide their street address (common for contractors).
4. What happens to a listing if a customer cancels.

We expect to start with 50–200 contractor locations and grow from there.

If this isn't something you handle, reply "stop" and we won't email you again.

Best regards,`;
}
export const FIRST_CONTACT_SUBJECT = "Listings partnership: ConstructHUB (software for US contractors)";
const STOP_LINE = `If this isn't something you handle, reply "stop" and we won't email you again.`;

/** First contact for an article or guest-post site (owner-approved wording, 2026-10-14, with the API question). */
export function articleContactBody(company: string): string {
  return `Hi ${company} team,

ConstructHUB is software for US contractors (roofers, HVAC, plumbers, remodelers). We work with contractors every day on permits, estimates, Google Business Profiles and getting found online, and we'd like to build an ongoing content partnership with ${company}.

We can offer practical, original articles written for your readers: real how-tos from the contractor side, never promotional fluff. Could you tell us:
1. Whether you have an API, feed or contributor portal for submitting articles, and how we get access.
2. Your editorial guidelines and the topics you're looking for.
3. Whether you accept regular contributors or a recurring column.
4. How links and author bios are handled.

${STOP_LINE}

Best regards,`;
}

/** First contact for a news outlet (owner-approved wording, 2026-10-14, with the API question). */
export function newsContactBody(company: string): string {
  return `Hi ${company} team,

ConstructHUB is software for US contractors. Many of our customers are local roofers, HVAC and plumbing companies with real news: new hires, expansions, community projects and storm-season advice. We'd like to build a relationship with ${company} for local contractor stories.

Could you tell us:
1. Whether you have an API, feed or newsroom portal for submitting press releases, and how we get access.
2. How you prefer to receive press releases and story pitches, and any guidelines.
3. Whether you offer a partner or sponsored-content program for local businesses.

${STOP_LINE}

Best regards,`;
}

/** First contact for a trade association or chamber of commerce: their members are our customers (2026-10-15). */
export function associationContactBody(company: string): string {
  return `Hi ${company} team,

ConstructHUB is software for US contractors (roofers, HVAC, plumbers, remodelers). It helps them find permits, keep their Google Business Profile and directory listings accurate, and win more local work. Many of your members are the kind of businesses we serve, so we'd like to build a relationship with ${company}.

Could you tell us:
1. Whether you list tools or services for members (a member-benefits page, resource directory or allied membership) and how a company like ours qualifies.
2. Whether you accept articles or tips for your newsletter or blog, for example on permits, licensing or getting found online.
3. Whether you have an API, feed or portal for submitting them.
4. Who the right person is for partnerships, if that isn't you.

${STOP_LINE}

Best regards,`;
}

export const QUEUE_TEMPLATES: Record<string, { subject: string; body: (company: string) => string; kind: "directory" | "article" | "news" | "other" }> = {
  association: { subject: "Member resource partnership: ConstructHUB (software for US contractors)", body: associationContactBody, kind: "other" },
  directory: { subject: FIRST_CONTACT_SUBJECT, body: firstContactBody, kind: "directory" },
  article: { subject: "Content partnership: ConstructHUB (software for US contractors)", body: articleContactBody, kind: "article" },
  news: { subject: "Local contractor news: partnership with ConstructHUB", body: newsContactBody, kind: "news" },
};

/**
 * First-contact emails a day. MEDIA_OUTREACH_PER_DAY fixes it (0 pauses first contact; replies and follow-ups carry
 * on). Unset, it ramps so a new Gmail mailbox is not flagged: 50 on the first sending day, +25 a day after, up to
 * MEDIA_OUTREACH_MAX_PER_DAY (default 400). `daysSending` = days since the first first-contact email.
 */
export function dailyAllowance(daysSending: number, env: NodeJS.ProcessEnv = process.env): number {
  const fixed = Number(env.MEDIA_OUTREACH_PER_DAY);
  if (env.MEDIA_OUTREACH_PER_DAY?.trim() && Number.isFinite(fixed) && fixed >= 0) return Math.floor(fixed);
  const max = num(env.MEDIA_OUTREACH_MAX_PER_DAY, 400);
  return Math.min(max, MEDIA_INBOX_PARAMETERS.newContactsPerDay + 25 * Math.max(0, Math.floor(daysSending)));
}
const perDay = (env: NodeJS.ProcessEnv = process.env) => dailyAllowance(0, env);
export const outreachPerDay = perDay;

/** The admin's settings over the env defaults (MEDIA_OUTREACH_PER_DAY: unset = ramp, 0 = paused, n = fixed). */
export function resolveSettings(saved: Partial<MediaSettings>, env: NodeJS.ProcessEnv = process.env): MediaSettings {
  const fixed = Number(env.MEDIA_OUTREACH_PER_DAY);
  const envFixed = env.MEDIA_OUTREACH_PER_DAY?.trim() && Number.isFinite(fixed) && fixed >= 0 ? Math.floor(fixed) : null;
  return {
    outreach: saved.outreach ?? (envFixed === null ? "ramp" : envFixed === 0 ? "paused" : "fixed"),
    rampStart: saved.rampStart ?? MEDIA_INBOX_PARAMETERS.newContactsPerDay,
    rampStep: saved.rampStep ?? 25,
    maxPerDay: saved.maxPerDay ?? num(env.MEDIA_OUTREACH_MAX_PER_DAY, 400),
    fixedPerDay: saved.fixedPerDay ?? envFixed ?? MEDIA_INBOX_PARAMETERS.newContactsPerDay,
    autoReplies: saved.autoReplies ?? true,
    followUps: saved.followUps ?? true,
    templates: saved.templates ?? {},
  };
}

/** Today's first-contact allowance under these settings. */
export function allowanceFor(s: MediaSettings, daysSending: number): number {
  if (s.outreach === "paused") return 0;
  if (s.outreach === "fixed") return Math.max(0, Math.floor(s.fixedPerDay));
  return Math.max(0, Math.min(s.maxPerDay, s.rampStart + s.rampStep * Math.max(0, Math.floor(daysSending))));
}

export const currentSettings = async () => resolveSettings(await store.getSettings());

/** The first-contact email for a queue row: the admin's edited template when there is one, else the built-in one. */
export function queueEmail(kind: string, company: string, s: Pick<MediaSettings, "templates">) {
  const t = QUEUE_TEMPLATES[kind] ?? QUEUE_TEMPLATES.directory;
  const custom = s.templates[(QUEUE_TEMPLATES[kind] ? kind : "directory") as MediaTemplateKind];
  if (custom && custom.subject.trim() && custom.body.trim() && STOP_LINE_RE.test(custom.body)) {
    const fill = (v: string) => v.replace(/\{company\}/g, company);
    return { subject: fill(custom.subject.trim()), body: fill(custom.body.trim()), kind: t.kind };
  }
  return { subject: t.subject, body: t.body(company), kind: t.kind };
}

export type QueueItem = { id: number; domain: string; company: string; kind: string; to_email: string };

/** Send one queued email after the safety checks. Returns why it was skipped, or null when sent. */
export async function sendOne(q: QueueItem, s: MediaSettings): Promise<string | null> {
  const skip = async (why: string) => { await store.finishQueued(q.id, "skipped", why); return why; };
  if (!/^[^\s@<>:/,;{}()]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(q.to_email)) return skip("Not a valid email address");
  if (await isSuppressed(q.to_email) || machineReason({ fromEmail: q.to_email, subject: "" })) return skip("Suppressed or not a person's address");
  if (await store.partnerIdForEmail(q.to_email, q.domain)) return skip("Already in contact");
  if (await store.hasBounced(q.to_email)) return skip("This address bounced before");
  const mailDomain = q.to_email.split("@")[1] ?? "";
  if (!(await workerDeps.acceptsMail(mailDomain))) return skip(`${mailDomain} has no mail server (no MX record)`);
  if (NOT_A_CONTACT.test(q.to_email)) return skip("Not a contact address (jobs, billing, programming and the like)");
  const refused = await mailboxRefused(q.to_email);
  if (refused) return skip(refused);
  const e = queueEmail(q.kind, q.company, s);
  const messageId = await workerDeps.sendMail({ to: q.to_email, subject: e.subject, body: e.body });
  const partnerId = await store.partnerForOutreach(q.company, q.domain, e.kind, q.to_email);
  await store.saveOutbound(mailboxConfig().user, { messageId, threadKey: null, to: q.to_email, subject: e.subject, body: e.body, partnerId, purpose: "outreach" });
  await store.finishQueued(q.id, "sent", null);
  return null;
}

export const CLASSIFY_BATCH = 25, CLASSIFY_BATCHES_PER_PASS = 8;
/** Sort vetted directories into listing directories, trade associations, chambers and the rest (ai.ts classifySites). */
export async function classifyDirectories(): Promise<number> {
  let n = 0;
  for (let i = 0; i < CLASSIFY_BATCHES_PER_PASS; i++) {
    const sites = await store.needingClass(CLASSIFY_BATCH);
    if (!sites.length) break;
    const { classes, names } = await classifySites(sites);
    // A domain the answer left out is never emailed: it counts as "other" rather than being asked about again and again.
    for (const s of sites) if (!classes.has(s.domain)) classes.set(s.domain, "other");
    await store.saveClasses(classes, names);
    n += classes.size;
  }
  return n;
}

/** Step 5: queue new vetted directories, then send today's share of first-contact emails (MEDIA_OUTREACH_PER_DAY). */
export async function sendQueued(): Promise<{ queued: number; sent: number; skipped: number }> {
  const mailbox = mailboxConfig().user;
  // Directories come only from reviewed research lists (store.queueList): the crawler's directory picks were licence
  // lookups, chambers and listed businesses' own Gmail addresses (2026-10-14). Publishers need real readers (below).
  await classifyDirectories().catch((e) => console.error(`[media-inbox] classifying directories failed: ${e?.message ?? e}`));
  const queued = await store.queueVettedPublishers(pickEmail, siteName) + await store.queueClassified(pickEmail, siteName);
  const s = await currentSettings();
  const allowance = allowanceFor(s, await store.daysSending());
  if (!allowance) return { queued, sent: 0, skipped: 0 };
  const room = Math.max(0, allowance - (await store.outreachSentToday()));
  let sent = 0, skipped = 0;
  // Spread through the day: at most a quarter of the daily share per pass.
  for (const q of await store.nextQueued(Math.min(room, Math.max(1, Math.ceil(allowance / 4))))) {
    if (await sendOne(q, s)) skipped++; else sent++;
  }
  return { queued, sent, skipped };
}

const LOCK_KEY = 0x6d656469; // "medi"
let running = false;

export async function runMediaPass(): Promise<{ ok: boolean; skipped?: string; read?: number; replied?: number; held?: number; failed?: number; followedUp?: number; newContacts?: number; exhausted?: number; optedOut?: number; newlyQueued?: number; outreachSent?: number; autoRepliesRead?: number; nextSteps?: Awaited<ReturnType<typeof actOnNextSteps>> }> {
  if (!mailboxConfigured()) return { ok: false, skipped: "The media@ mailbox is not configured (MEDIA_EMAIL / MEDIA_APP_PASSWORD)" };
  if (!mediaAiConfigured()) return { ok: false, skipped: "No AI key configured for the media inbox" };
  if (running) return { ok: false, skipped: "A pass is already running" };
  running = true;
  const client = await pool.connect();
  try {
    if (!(await client.query(`SELECT pg_try_advisory_lock($1) ok`, [LOCK_KEY])).rows[0]?.ok) return { ok: false, skipped: "A pass is already running" };
    try {
      const settings = await currentSettings();
      const r = await readInbox();
      // Automatic replies off: new emails wait for the admin (answered from the company page).
      const a = settings.autoReplies ? await answerPending() : { replied: 0, held: await store.holdNew(), failed: 0, optedOut: 0 };
      const ar = await readAutoReplies();
      const act = await actOnNextSteps();
      const f = settings.followUps ? await followUpSilent() : { followedUp: 0, newContacts: 0, exhausted: 0 };
      const q = await sendQueued();
      await store.markPass(mailboxConfig().user, null);
      return { ok: true, read: r.read, ...a, autoRepliesRead: ar.read, nextSteps: act, ...f, newlyQueued: q.queued, outreachSent: q.sent };
    } catch (e: any) {
      await store.markPass(mailboxConfig().user, String(e?.message ?? e).slice(0, 500)).catch(() => undefined);
      throw e;
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]);
    }
  } catch (e: any) {
    void recordFailure("job", "Media inbox pass", e);
    console.error(`[media-inbox] pass failed: ${e?.message ?? e}`);
    return { ok: false, skipped: String(e?.message ?? e) };
  } finally {
    client.release();
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;
export function startMediaInboxWorker(env: NodeJS.ProcessEnv = process.env) {
  const cfg = mediaWorkerConfig(env);
  if (!cfg.enabled || timer) return;
  timer = workerInterval("media inbox", () => runMediaPass(), cfg.intervalMin * 60_000, { firstAfterMs: 60_000 }).timer;
}
