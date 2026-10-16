/**
 * /admin/partnerships — the media@ relationships inbox (platform admins only, requirePlatformAdmin):
 *
 *   GET  /api/admin/media-inbox/summary                         counts, last pass, configuration
 *   GET  /api/admin/media-inbox/partners?status                 companies: talking / agreed (to finalize) / finalized / declined
 *   GET  /api/admin/media-inbox/messages?status&direction&partnerId&partnerStatus&limit&offset   every email in and out
 *   POST /api/admin/media-inbox/partners/:id {status?, kind?, toFinalize?, ownerQuestion?, domain?}
 *   POST /api/admin/media-inbox/partners/:id/draft {instructions?}   an AI-written reply for the admin to edit (not sent)
 *   POST /api/admin/media-inbox/partners/:id/reply {to, subject, body}  the admin's reply, threaded under the company's last email
 *   POST /api/admin/media-inbox/messages/:id/handled            an owner-decision email answered by hand
 *   POST /api/admin/media-inbox/send {to, subject, body, company, domain?, kind}   first-contact email from media@
 *   POST /api/admin/media-inbox/run                             a pass now
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { MEDIA_MESSAGE_STATUSES, MEDIA_PARTNER_KINDS, MEDIA_PARTNER_STATUSES } from "@shared/media-inbox";
import { requirePlatformAdmin } from "../crm/admin";
import { draftReply, mediaAiConfigured } from "./ai";
import { companyDomain, replySubject } from "./guard";
import { mailboxConfig, mailboxConfigured, sendMail } from "./mailbox";
import * as store from "./store";
import { dailyAllowance, mediaWorkerConfig, runMediaPass } from "./worker";

type GetUser = (req: any, res: any) => any;
const idParam = z.coerce.number().int().positive().max(2_147_483_647);
const messagesQuery = z.object({
  status: z.enum(MEDIA_MESSAGE_STATUSES).optional(),
  direction: z.enum(["in", "out"]).optional(),
  partnerId: z.coerce.number().int().positive().optional(),
  partnerStatus: z.enum(MEDIA_PARTNER_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const domainRe = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const partnerBody = z.object({
  status: z.enum(MEDIA_PARTNER_STATUSES).optional(),
  kind: z.enum(MEDIA_PARTNER_KINDS).optional(),
  toFinalize: z.string().trim().max(1000).nullable().optional(),
  ownerQuestion: z.string().trim().max(1000).nullable().optional(),
  domain: z.string().trim().toLowerCase().regex(domainRe).max(200).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
}).strict();
const draftBody = z.object({ instructions: z.string().trim().max(2000).optional() }).strict();
const replyBody = z.object({
  to: z.string().trim().email().max(200),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
}).strict();
const sendBody = z.object({
  to: z.string().trim().email().max(200),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
  company: z.string().trim().min(1).max(120),
  domain: z.string().trim().toLowerCase().regex(domainRe).max(200).optional(),
  kind: z.enum(MEDIA_PARTNER_KINDS),
}).strict();

const failed = (res: Response, what: string, e: unknown) => {
  console.error(`[media-inbox] ${what} failed:`, (e as Error)?.message ?? e);
  if (!res.headersSent) res.status(500).json({ message: `Could not ${what}. Try again.` });
};

export function registerMediaInboxRoutes(app: Express, getDevUser: GetUser): void {
  const admin = (req: Request, res: Response) => requirePlatformAdmin(req, res, getDevUser);

  app.get("/api/admin/media-inbox/summary", async (req, res) => {
    if (!(await admin(req, res))) return;
    res.setHeader("Cache-Control", "no-store");
    const cfg = mediaWorkerConfig();
    try {
      const s = await store.summary(mailboxConfig().user);
      // Today's allowance on the ramp (it grows each day the queue has been sending), not the first day's.
      res.json({ ...s, queue: { ...s.queue, perDay: dailyAllowance(await store.daysSending()) }, mailbox: mailboxConfig().user || null, configured: mailboxConfigured() && mediaAiConfigured(), enabled: cfg.enabled, intervalMin: cfg.intervalMin });
    } catch (e) { failed(res, "load the summary", e); }
  });

  app.get("/api/admin/media-inbox/partners", async (req, res) => {
    if (!(await admin(req, res))) return;
    res.setHeader("Cache-Control", "no-store");
    const status = z.enum(MEDIA_PARTNER_STATUSES).optional().safeParse(req.query.status);
    if (!status.success) return res.status(400).json({ message: "Unknown status" });
    try { res.json(await store.listPartners(status.data)); } catch (e) { failed(res, "list the companies", e); }
  });

  app.get("/api/admin/media-inbox/messages", async (req, res) => {
    if (!(await admin(req, res))) return;
    res.setHeader("Cache-Control", "no-store");
    const q = messagesQuery.safeParse(req.query);
    if (!q.success) return res.status(400).json({ message: "Unknown filter" });
    try { res.json(await store.listMessages(q.data)); } catch (e) { failed(res, "list the emails", e); }
  });

  app.post("/api/admin/media-inbox/partners/:id", async (req, res) => {
    if (!(await admin(req, res))) return;
    const id = idParam.safeParse(req.params.id);
    const body = partnerBody.safeParse(req.body);
    if (!id.success || !body.success) return res.status(400).json({ message: "Check the fields and try again" });
    try {
      if (!(await store.getPartner(id.data))) return res.status(404).json({ message: "Not found" });
      await store.updatePartner(id.data, body.data);
      const p = await store.getPartner(id.data);
      const added = p && (p.status === "agreed" || p.status === "finalized") ? await store.addAgreedPartner(p) : null;
      res.json({ ok: true, addedTo: added?.addedTo ?? p?.addedTo ?? null, note: added?.note ?? null });
    } catch (e) { failed(res, "update the company", e); }
  });

  app.post("/api/admin/media-inbox/partners/:id/draft", async (req, res) => {
    if (!(await admin(req, res))) return;
    const id = idParam.safeParse(req.params.id);
    const body = draftBody.safeParse(req.body ?? {});
    if (!id.success || !body.success) return res.status(400).json({ message: "Check the fields and try again" });
    if (!mediaAiConfigured()) return res.status(409).json({ message: "No AI key is configured" });
    try {
      const partner = (await store.listPartners()).find((p) => p.id === id.data);
      if (!partner) return res.status(404).json({ message: "Not found" });
      const target = await store.replyTarget(id.data);
      const d = await draftReply(await store.partnerThread(id.data), { notes: partner.notes, instructions: body.data.instructions });
      res.json({ body: d.reply, provider: d.provider, to: target?.to ?? partner.contactEmail ?? "", subject: target ? replySubject(target.subject) : "" });
    } catch (e) { failed(res, "write a draft", e); }
  });

  app.post("/api/admin/media-inbox/partners/:id/reply", async (req, res) => {
    if (!(await admin(req, res))) return;
    const id = idParam.safeParse(req.params.id);
    const b = replyBody.safeParse(req.body);
    if (!id.success || !b.success) return res.status(400).json({ message: "Check the fields and try again" });
    if (!mailboxConfigured()) return res.status(409).json({ message: "The media@ mailbox is not configured" });
    try {
      if (!(await store.getPartner(id.data))) return res.status(404).json({ message: "Not found" });
      const t = await store.replyTarget(id.data);
      // Threaded under the company's last email when there is one, so it lands in the same conversation.
      const messageId = await sendMail({ to: b.data.to, subject: b.data.subject, body: b.data.body, ...(t ? { inReplyTo: t.messageId, references: t.references } : {}) });
      const replyId = await store.saveOutbound(mailboxConfig().user, { messageId, threadKey: t?.threadKey ?? null, to: b.data.to, subject: b.data.subject, body: b.data.body, partnerId: id.data, purpose: t ? "reply" : "outreach" });
      if (replyId) await store.markPartnerAnswered(id.data, replyId);
      res.json({ ok: true, messageId });
    } catch (e) { failed(res, "send the reply", e); }
  });

  app.post("/api/admin/media-inbox/messages/:id/handled", async (req, res) => {
    if (!(await admin(req, res))) return;
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Bad id" });
    try { await store.markHandled(id.data); res.json({ ok: true }); } catch (e) { failed(res, "mark the email handled", e); }
  });

  app.post("/api/admin/media-inbox/send", async (req, res) => {
    if (!(await admin(req, res))) return;
    const b = sendBody.safeParse(req.body);
    if (!b.success) return res.status(400).json({ message: "Check the fields and try again" });
    if (!mailboxConfigured()) return res.status(409).json({ message: "The media@ mailbox is not configured" });
    try {
      const domain = b.data.domain ?? companyDomain(b.data.to);
      const partnerId = await store.partnerForOutreach(b.data.company, domain, b.data.kind, b.data.to);
      const messageId = await sendMail({ to: b.data.to, subject: b.data.subject, body: b.data.body });
      await store.saveOutbound(mailboxConfig().user, { messageId, threadKey: null, to: b.data.to, subject: b.data.subject, body: b.data.body, partnerId, purpose: "outreach" });
      res.json({ ok: true, messageId, partnerId });
    } catch (e) { failed(res, "send the email", e); }
  });

  app.post("/api/admin/media-inbox/run", async (req, res) => {
    if (!(await admin(req, res))) return;
    try { res.json(await runMediaPass()); } catch (e) { failed(res, "run the inbox", e); }
  });
}
