/**
 * The facts behind a client's lead status and pipeline stage (shared/bid-status.ts), read in bulk for a set of
 * clients: a visit on the calendar, a HOVER report, any estimate, a sent one, the newest live project, and the
 * Dead-lead mark. Used by the Clients list and the Leads list so both label a lead the same way.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { crmAppointments, crmCustomers, crmEstimates, crmMeasurements, crmProjects } from "@shared/schema";
import { stageOfProjectStatus } from "@shared/job-stage";
import { bidStateOf, bidNotSubmitted, clientStageOf, deadLeadOf, type BidFacts, type BidState } from "@shared/bid-status";

export type ClientBidRead = { facts: BidFacts; state: BidState; notSubmitted: boolean; stage: ReturnType<typeof clientStageOf>; deadLead: ReturnType<typeof deadLeadOf> };

const EMPTY = (): BidFacts => ({ dead: false, anyEstimate: false, sentEstimate: false, appointment: false, hover: false, projectStatus: null });

/** Facts for every id (missing clients get the empty set), in chunks of 1,000. */
export async function bidFactsFor(orgId: string, customerIds: string[]): Promise<Map<string, BidFacts>> {
  const facts = new Map<string, BidFacts>();
  const of = (id: string) => { let f = facts.get(id); if (!f) { f = EMPTY(); facts.set(id, f); } return f; };
  const ids = [...new Set(customerIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const custs = await db.select({ id: crmCustomers.id, customFields: crmCustomers.customFields }).from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, orgId), inArray(crmCustomers.id, chunk)));
    for (const c of custs) of(c.id).dead = !!deadLeadOf(c.customFields);
    const agg = await db.select({
      customerId: crmEstimates.customerId,
      any: sql<number>`count(*)::int`,
      sent: sql<number>`count(*) filter (where ${crmEstimates.status} in ('sent','viewed','approved','declined') or ${crmEstimates.sentAt} is not null)::int`,
    }).from(crmEstimates).where(and(eq(crmEstimates.orgId, orgId), inArray(crmEstimates.customerId, chunk))).groupBy(crmEstimates.customerId);
    for (const a of agg) { const f = of(a.customerId); f.anyEstimate = a.any > 0; f.sentEstimate = a.sent > 0; }
    const projects = await db.select({ customerId: crmProjects.customerId, status: crmProjects.status }).from(crmProjects)
      .where(and(eq(crmProjects.orgId, orgId), inArray(crmProjects.customerId, chunk), isNull(crmProjects.archivedAt), sql`${crmProjects.status} <> 'cancelled'`))
      .orderBy(desc(crmProjects.createdAt));
    for (const p of projects) { const f = of(p.customerId); if (!f.projectStatus && stageOfProjectStatus(p.status)) f.projectStatus = p.status; }
    const visits = await db.select({ customerId: crmAppointments.customerId }).from(crmAppointments)
      .where(and(eq(crmAppointments.orgId, orgId), inArray(crmAppointments.customerId, chunk), sql`coalesce(${crmAppointments.status}, '') <> 'cancelled'`))
      .groupBy(crmAppointments.customerId);
    for (const v of visits) if (v.customerId) of(v.customerId).appointment = true;
    const measured = await db.select({ customerId: crmMeasurements.customerId }).from(crmMeasurements)
      .where(and(eq(crmMeasurements.orgId, orgId), inArray(crmMeasurements.customerId, chunk))).groupBy(crmMeasurements.customerId);
    for (const m of measured) if (m.customerId) of(m.customerId).hover = true;
  }
  for (const id of ids) of(id);
  return facts;
}

export function readBid(f: BidFacts): Omit<ClientBidRead, "deadLead"> {
  return { facts: f, state: bidStateOf(f), notSubmitted: bidNotSubmitted(f), stage: clientStageOf(f) };
}
