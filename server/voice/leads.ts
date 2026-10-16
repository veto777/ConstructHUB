/**
 * Lead delivery into the CRM (docs/call-assistant/SPEC.md § 10) — OWNER:
 * calls+crm lane.
 *
 * A non-spam call that collected a lead becomes, in this order: a client
 * (matched by phone in the org, else created with the "Call Assistant" lead
 * source and a "VIRTUAL FORM — filled out by <assistant>" note), a pipeline
 * project (stage lead) when the profile says so, an audit row, and the org's
 * own notifications (bell + sms per the channel matrix, the leadReceived
 * email, plus the profile's extra recipients). Each recipient/channel has its own durable task;
 * a failed notification retries independently without recreating the client or project.
 */
import { randomBytes } from "crypto";
import { db, pool } from "../db";
import {
  crmNotifications, crmActivityLog, crmCustomers, crmLeadSources, crmMembers, crmOrgs, crmProjects, crmNotificationChannel, voiceCalls,
  type VoiceCallRow,
} from "@shared/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { normalizePhone, sendSms } from "../crm/sms";
import type { CallTaskSpec } from "./call-tasks";
import { recordActivity } from "../crm/activity";
import { queueCrmEvent, customerEventPayload, projectEventPayload } from "../crm/integrations";
import { sendWithFallback } from "../email";
import { appForLink, pushSoon } from "../apns";
import type { OrgVoiceContext } from "./org-profile";
import type { VoiceProfile } from "@shared/voice-profile";

/**
 * The state for a call's client/project: the profile's default state, else the one state every service-area
 * county is in (a region shortcut like "Border to Tacoma" leaves defaultStateCode empty), else the CRM org's.
 */
export function leadState(profile: Pick<VoiceProfile, "serviceArea">, org: { state?: string | null }): string | null {
  const countyStates = [...new Set(profile.serviceArea.counties.map((c) => c.stateCode).filter(Boolean))];
  return profile.serviceArea.defaultStateCode || (countyStates.length === 1 ? countyStates[0] : null) || org.state || null;
}

export const CALL_ASSISTANT_LEAD_SOURCE = "Call Assistant";

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

/** "(813) 555-0100" for display; the raw E.164 stays in the phone column. */
export function prettyPhone(e164: string | null | undefined): string {
  const d = String(e164 ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : (e164 || "unknown");
}

/** What the call gave us, from the decision slots first, the engine's caller block second. */
export type LeadFacts = {
  phone: string | null;
  name: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  need: string | null;
  bestTime: string | null;
};

/** "55 Oak Lane, Bellingham, WA" with city Bellingham → "55 Oak Lane" (the CRM keeps the city in its own field). */
export function streetOnly(address: string | null, city: string | null): string | null {
  if (!address || !city) return address;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  const isCity = (p: string | undefined) => !!p && p.toLowerCase() === city.toLowerCase();
  // a trailing state/ZIP goes only when the city precedes it ("…, NE" alone may be part of the street)
  if (parts.length > 2 && /^[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/i.test(parts[parts.length - 1]) && isCity(parts[parts.length - 2])) parts.pop();
  if (parts.length > 1 && isCity(parts[parts.length - 1])) parts.pop();
  return parts.join(", ");
}

const STATE_ZIP = /^(?:[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?|\d{5}(?:-\d{4})?|[A-Za-z]+\s+\d{5}(?:-\d{4})?)$/;
const NOT_A_CITY = /\d|^(?:apt|apartment|unit|suite|ste|bldg|building|lot|space|po box|#)\b/i;

/**
 * The city inside a one-slot address ("55 Oak Lane, Bellingham" or "55 Oak Lane, Bellingham, WA 98225" →
 * "Bellingham"): the last comma-separated part once a trailing state/ZIP is dropped. The default intake
 * collects street and city in one `address` slot, and a mid-call lead has no caller city yet.
 */
export function cityFromAddress(address: string | null | undefined): string | null {
  const parts = String(address ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  while (parts.length > 2 && STATE_ZIP.test(parts[parts.length - 1])) parts.pop();
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1].replace(/\s+[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/, "").trim();
  return last && !NOT_A_CITY.test(last) && last.length <= 60 ? last : null;
}

export function leadFactsFrom(call: Pick<VoiceCallRow, "fromNumber" | "callerName" | "callerEmail" | "callerAddress" | "callerCity" | "serviceNeeded">, slots: Record<string, string> = {}): LeadFacts {
  const pick = (...keys: string[]) => {
    for (const k of keys) { const v = slots[k]; if (typeof v === "string" && v.trim()) return v.trim(); }
    return null;
  };
  const slotPhone = pick("phone", "callback", "callback_number");
  const phone = normalizePhone(slotPhone) ?? normalizePhone(call.fromNumber);
  const email = pick("email");
  const rawAddress = pick("address", "street_address") ?? (call.callerAddress?.trim() || null);
  const city = pick("city") ?? (call.callerCity?.trim() || null) ?? cityFromAddress(rawAddress);
  return {
    phone,
    name: pick("first_name", "name", "full_name") ?? (call.callerName?.trim() || null),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : (call.callerEmail?.trim() || null),
    address: streetOnly(rawAddress, city),
    city,
    need: pick("need", "service", "project") ?? (call.serviceNeeded?.trim() || null),
    bestTime: pick("best_time", "callback_time"),
  };
}

/** The per-org "Call Assistant" lead source, created on first use (like "Website"). */
export async function callAssistantLeadSourceId(orgId: string): Promise<string> {
  const [existing] = await db.select().from(crmLeadSources)
    .where(and(eq(crmLeadSources.orgId, orgId), sql`lower(${crmLeadSources.name}) = ${CALL_ASSISTANT_LEAD_SOURCE.toLowerCase()}`))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await db.insert(crmLeadSources).values({ orgId, name: CALL_ASSISTANT_LEAD_SOURCE }).returning();
  return row.id;
}

/** The org's client with this phone (phone or alt_phone, last 10 digits), newest active first. */
export async function findCustomerByPhone(orgId: string, phone: string | null | undefined) {
  const digits = String(phone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length < 7) return null;
  const like = `%${digits}`;
  const [row] = await db.select().from(crmCustomers)
    .where(and(
      eq(crmCustomers.orgId, orgId),
      isNull(crmCustomers.archivedAt),
      sql`(regexp_replace(coalesce(${crmCustomers.phone}, ''), '[^0-9]', '', 'g') like ${like}
           or regexp_replace(coalesce(${crmCustomers.altPhone}, ''), '[^0-9]', '', 'g') like ${like})`,
    ))
    .orderBy(sql`${crmCustomers.createdAt} desc`).limit(1);
  return row ?? null;
}

export function virtualFormNote(ctx: Pick<OrgVoiceContext, "assistantName" | "companyName">, numberLabel: string | null, facts: LeadFacts, summary: string | null): string {
  const lines = [
    `VIRTUAL FORM — filled out by ${ctx.assistantName}, ${ctx.companyName}'s virtual assistant, on a phone call${numberLabel ? ` to the ${numberLabel} line` : ""}.`,
  ];
  if (facts.need) lines.push(`Need: ${facts.need}`);
  if (facts.address) lines.push(`Address: ${facts.address}${facts.city && !facts.address.toLowerCase().includes(facts.city.toLowerCase()) ? `, ${facts.city}` : ""}`);
  if (facts.bestTime) lines.push(`Best time to call: ${facts.bestTime}`);
  if (summary) lines.push(summary.trim());
  return lines.join("\n");
}

async function orgOwnerMember(org: typeof crmOrgs.$inferSelect) {
  const members = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.orgId, org.id), eq(crmMembers.status, "active")));
  return members.find((m) => m.userId === org.ownerUserId) ?? members.find((m) => m.role === "owner") ?? null;
}

export type LeadDelivery = {
  customerId: string; projectId: string | null; created: boolean;
  /** The call already delivered its lead (mid-call event, then the end report): fields were topped up, nobody was pinged again. */
  alreadyDelivered: boolean;
  notified: { bell: boolean; email: number; sms: number };
};

/**
 * Deliver one lead. `numberLabel` is the voice number's label ("Main office").
 * Safe to call again for the same call: an existing customer is updated, not
 * duplicated, and a second project is not created when the call already has one.
 */
export async function deliverLead(args: {
  ctx: OrgVoiceContext;
  call: VoiceCallRow;
  slots?: Record<string, string> | null;
  numberLabel?: string | null;
}): Promise<LeadDelivery> {
  // Serialize mid-call and end-report deliveries, including callers holding a stale row.
  const lock = await pool.connect();
  try {
    const { rows } = await lock.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS claimed", [args.call.id]);
    if (!rows[0].claimed) throw new Error("Lead delivery is already running; retry shortly");
    const [fresh] = await db.select().from(voiceCalls).where(eq(voiceCalls.id, args.call.id));
    return await deliverLeadLocked({ ...args, call: fresh ?? args.call });
  } finally {
    try { await lock.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [args.call.id]); }
    finally { lock.release(); }
  }
}

async function deliverLeadLocked(args: Parameters<typeof deliverLead>[0]): Promise<LeadDelivery> {
  const { ctx, call } = args;
  const { org, profile } = ctx;
  const slots = args.slots ?? call.slots ?? {};
  const facts = leadFactsFrom(call, slots);
  const state = leadState(profile, org);
  const rawAddress = (["address", "street_address"].map((k) => slots[k]).find((v) => typeof v === "string" && v.trim()) ?? "").trim();
  const note = virtualFormNote(ctx, args.numberLabel ?? null, facts, call.summary);
  const tags = profile.leadDelivery.crm.tags.length ? profile.leadDelivery.crm.tags : ["call-assistant"];

  // 1. Client: match by phone in the org (the call row's customer first), else create.
  let customer = call.customerId
    ? (await db.select().from(crmCustomers).where(and(eq(crmCustomers.orgId, org.id), eq(crmCustomers.id, call.customerId))).limit(1))[0] ?? null
    : null;
  if (!customer) customer = await findCustomerByPhone(org.id, facts.phone);
  let created = false;
  if (customer) {
    const patch: Partial<typeof crmCustomers.$inferInsert> = { updatedAt: new Date() };
    if (!customer.email && facts.email) patch.email = facts.email;
    if (!customer.addressLine1 && facts.address) patch.addressLine1 = facts.address;
    // a mid-call delivery stored the raw one-slot address ("55 Oak Lane, Bellingham"): the street alone now
    else if (facts.address && rawAddress && customer.addressLine1 === rawAddress && rawAddress !== facts.address) patch.addressLine1 = facts.address;
    if (!customer.city && facts.city) patch.city = facts.city;
    if (!customer.state && state) patch.state = state;
    if (!customer.firstName && facts.name) patch.firstName = facts.name;
    if (!customer.phone && facts.phone) patch.phone = facts.phone;
    const existingTags = customer.tags ?? [];
    const addTags = tags.filter((t) => !existingTags.includes(t));
    if (addTags.length) patch.tags = [...existingTags, ...addTags];
    // The note is appended once per call (the call sid marks it — a retried delivery finds its own mark).
    const mark = `[call ${call.callSid}]`;
    if (!call.leadDeliveredAt && !(customer.notes ?? "").includes(mark)) patch.notes = [customer.notes?.trim(), `${note}\n${mark}`].filter(Boolean).join("\n\n");
    await db.update(crmCustomers).set(patch).where(eq(crmCustomers.id, customer.id));
    customer = { ...customer, ...patch } as typeof customer;
  } else {
    const owner = await orgOwnerMember(org);
    const leadSourceId = await callAssistantLeadSourceId(org.id);
    // The client and the call's link to it commit together: a retry after any later failure (the project, a
    // crash) finds the client through call.customerId and never files a second one — even without a phone number.
    customer = await db.transaction(async (tx) => {
      const [row] = await tx.insert(crmCustomers).values({
        orgId: org.id,
        displayName: facts.name || `Caller ${prettyPhone(facts.phone)}`,
        firstName: facts.name,
        phone: facts.phone,
        email: facts.email,
        addressLine1: facts.address,
        city: facts.city,
        state,
        leadSourceId,
        ownerMemberId: owner?.id ?? null,
        tags,
        notes: `${note}\n[call ${call.callSid}]`,
        portalToken: randomBytes(24).toString("hex"),
      }).returning();
      await tx.update(voiceCalls).set({ customerId: row.id }).where(eq(voiceCalls.id, call.id));
      return row;
    });
    created = true;
    queueCrmEvent(org.id, "customer.created", { ...customerEventPayload(customer), source: "call_assistant" });
  }
  call.customerId = customer.id;

  // 2. Project (pipeline stage "lead") — once per call; committed together with the call's link to it (as above).
  let projectId: string | null = call.projectId ?? null;
  const projectName = [facts.need || "Phone lead", facts.city].filter(Boolean).join(" — ").slice(0, 200);
  if (!projectId && profile.leadDelivery.crm.createProject) {
    const customerId = customer.id;
    const project = await db.transaction(async (tx) => {
      const [row] = await tx.insert(crmProjects).values({
        orgId: org.id, customerId, name: projectName, status: "lead",
        addressLine1: facts.address, city: facts.city, state,
        description: call.summary ?? null,
      }).returning();
      await tx.update(voiceCalls).set({ projectId: row.id }).where(eq(voiceCalls.id, call.id));
      return row;
    });
    queueCrmEvent(org.id, "project.created", { ...projectEventPayload(project), source: "call_assistant" });
    projectId = project.id;
    call.projectId = projectId;
  }

  const alreadyDelivered = !!call.leadDeliveredAt;

  // The end report for a lead delivered mid-call (before the city, summary and duration existed): fill in this
  // call's own project and the audit row. Only empty fields, the raw slot address and the generated name change.
  if (alreadyDelivered && projectId) {
    const [project] = await db.select().from(crmProjects).where(and(eq(crmProjects.orgId, org.id), eq(crmProjects.id, projectId))).limit(1);
    if (project) {
      const pp: Partial<typeof crmProjects.$inferInsert> = {};
      if (!project.city && facts.city) pp.city = facts.city;
      if (!project.state && state) pp.state = state;
      if (facts.address && (!project.addressLine1 || (rawAddress && project.addressLine1 === rawAddress && rawAddress !== facts.address))) pp.addressLine1 = facts.address;
      if (!project.description && call.summary) pp.description = call.summary;
      const generated = (facts.need || "Phone lead").slice(0, 200);
      if (project.name === generated && projectName !== generated) pp.name = projectName;
      if (Object.keys(pp).length) await db.update(crmProjects).set({ ...pp, updatedAt: new Date() }).where(eq(crmProjects.id, project.id));
    }
  }
  if (alreadyDelivered && (call.summary || call.durationSeconds != null || call.outcome)) {
    await db.update(crmActivityLog)
      .set({ meta: sql`coalesce(${crmActivityLog.meta}, '{}'::jsonb) || ${JSON.stringify({ outcome: call.outcome, durationSeconds: call.durationSeconds, summary: call.summary, recording: !!call.recordingKey })}::jsonb` })
      .where(and(eq(crmActivityLog.orgId, org.id), eq(crmActivityLog.action, "call.lead"), eq(crmActivityLog.entityType, "voice_call"), eq(crmActivityLog.entityId, call.id)))
      .catch((e: any) => console.error("[voice] lead activity update failed:", e?.message || e));
  }

  // 3. Audit row — once per call.
  if (!alreadyDelivered) recordActivity({
    orgId: org.id,
    actorLabel: `${ctx.assistantName} (Call Assistant)`,
    action: "call.lead",
    entityType: "voice_call",
    entityId: call.id,
    customerId: customer.id,
    meta: { outcome: call.outcome, durationSeconds: call.durationSeconds, summary: call.summary, recording: !!call.recordingKey, created, need: facts.need },
  });

  // Persist the notification plan and delivery latch together. No network work belongs to CRM creation.
  const notified = { bell: false, email: 0, sms: 0 };
  if (!alreadyDelivered) {
    const title = `New phone lead — ${facts.name || prettyPhone(facts.phone)}`;
    const body = [facts.name, facts.need, facts.address, facts.city, facts.phone, facts.email, facts.bestTime, call.summary].filter(Boolean).join(" · ");
    const members = await db.select().from(crmMembers).where(and(eq(crmMembers.orgId, org.id), eq(crmMembers.status, "active")));
    const owners = members.filter(m => m.role === "owner");
    const recipients = new Map<string, { channel: string; recipient: string }>();
    const add = (channel: string, recipient: string) => {
      const to = channel === "sms" ? normalizePhone(recipient) : channel === "email" ? recipient.trim().toLowerCase() : recipient;
      if (to) recipients.set(`${channel}:${to}`, { channel, recipient: to });
    };
    if (crmNotificationChannel(org.customFields, "leadReceived", "inApp")) for (const m of owners) add("inApp", m.id);
    if (profile.leadDelivery.email.enabled) {
      if (crmNotificationChannel(org.customFields, "leadReceived", "email")) for (const m of owners) if (m.email) add("email", m.email);
      for (const to of profile.leadDelivery.email.extraRecipients) add("email", to);
    }
    if (crmNotificationChannel(org.customFields, "leadReceived", "sms")) {
      const phones = owners.map(m => normalizePhone(m.phone)).filter(Boolean);
      for (const to of phones.length ? phones : [org.phone]) if (to) add("sms", to);
    }
    if (profile.leadDelivery.sms.enabled) for (const to of profile.leadDelivery.sms.recipients) add("sms", to);
    await db.transaction(async tx => {
      const claimed = await tx.update(voiceCalls).set({ leadDeliveredAt: new Date(), customerId: customer.id, projectId })
        .where(and(eq(voiceCalls.id, call.id), isNull(voiceCalls.leadDeliveredAt))).returning({ id: voiceCalls.id });
      if (!claimed.length) return;
      for (const [key, recipient] of recipients) {
        const payload = { ...recipient, userId: recipient.channel === "inApp" ? owners.find(m => m.id === recipient.recipient)?.userId : null, title, body, link: `/crm/clients/${customer.id}` };
        await tx.execute(sql`INSERT INTO voice_call_tasks (call_id, org_id, kind, task_key, payload, give_up_at)
          VALUES (${call.id}, ${org.id}, 'notification', ${'notification:' + key}, ${JSON.stringify(payload)}::jsonb, now() + interval '3 days')
          ON CONFLICT (call_id, task_key) DO NOTHING`);
      }
    });
  }

  return { customerId: customer.id, projectId, created, alreadyDelivered, notified };
}

/** notifyOnEveryCall: a one-line summary for non-lead outcomes (info, declined, out_of_area). */
export async function callSummaryTaskSpecs(ctx: OrgVoiceContext, call: VoiceCallRow): Promise<CallTaskSpec[]> {
  const members = await db.select().from(crmMembers).where(and(eq(crmMembers.orgId, ctx.org.id), eq(crmMembers.status, "active")));
  const owners = members.filter(m => m.role === "owner");
  const recipients = new Map<string, { channel: string; recipient: string; userId?: number | null }>();
  if (crmNotificationChannel(ctx.org.customFields, "leadReceived", "inApp")) {
    for (const m of owners) recipients.set(`inApp:${m.id}`, { channel: "inApp", recipient: m.id, userId: m.userId });
  }
  if (crmNotificationChannel(ctx.org.customFields, "leadReceived", "sms")) {
    const phones = owners.map(m => normalizePhone(m.phone)).filter(Boolean);
    for (const phone of phones.length ? phones : [normalizePhone(ctx.org.phone)]) {
      if (phone) recipients.set(`sms:${phone}`, { channel: "sms", recipient: phone });
    }
  }
  const title = `Call ${String(call.outcome ?? "ended").replace(/_/g, " ")} — ${call.callerName || prettyPhone(call.fromNumber)}`;
  return [...recipients].map(([key, recipient]) => ({ key: `summary:${key}`, kind: "notification", payload: {
    ...recipient, type: "call.summary", title, body: call.summary ?? "", link: `/call-assistant/calls?call=${call.id}`,
  } }));
}

/** A single durable recipient/channel effect. Throws so the task records the reason and retries. */
export async function deliverLeadNotification(ctx: OrgVoiceContext, callId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { channel, recipient, title, body, link } = payload;
  if (channel === "email") {
    await sendWithFallback({ to: String(recipient), subject: String(title), html: `<p>${esc(String(body))}</p>` }, false, { failover: "definite" });
  } else if (channel === "sms") {
    const result = await sendSms(String(recipient), `${ctx.org.name}: ${title} — ${body}`.slice(0, 320), ctx.org.customFields, ctx.org.id);
    if (result.provider === "log") throw Object.assign(new Error("Not sent: texting isn't set up."), { notConfigured: true });
    if (!result.ok) throw Object.assign(new Error(result.error || "SMS delivery failed"), { ambiguous: result.ambiguous });
    if (result.provider !== "signalwire" || !result.sid) throw Object.assign(new Error("Carrier acceptance could not be confirmed."), { ambiguous: true });
    return { provider: result.provider, sid: result.sid, accepted: true };
  } else if (channel === "inApp") {
    const inserted = await db.insert(crmNotifications).values({ id: `voice:${callId}:${recipient}`, orgId: ctx.org.id, memberId: String(recipient), type: payload.type === "call.summary" ? "call.summary" : "call.lead", title: String(title).slice(0, 300), body: String(body).slice(0, 1000), link: String(link) }).onConflictDoNothing().returning({ id: crmNotifications.id });
    if (inserted.length && typeof payload.userId === "number") pushSoon(payload.userId, appForLink(String(link)), { title: `${ctx.org.name}: ${title}`, body: String(body), link: String(link) });
  } else throw new Error("Unknown lead notification channel");
  return { accepted: true };
}
