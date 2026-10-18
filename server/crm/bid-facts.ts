/**
 * The facts behind a client's lead status and pipeline stage (shared/bid-status.ts), read in bulk for a set of
 * clients: a visit on the calendar (its own or its project's, not a cancelled one), a finished HOVER report, any
 * estimate, a sent one, an approved one, the newest live project, and the Dead-lead mark. Used by the Clients list
 * and the Leads list so both label a lead the same way. The five reads per chunk run in parallel.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { crmAppointments, crmCustomers, crmEstimates, crmMeasurements, crmProjects } from "@shared/schema";
import { stageOfProjectStatus } from "@shared/job-stage";
import { bidStateOf, bidNotSubmitted, clientStageOf, deadLeadOf, type BidFacts, type BidState } from "@shared/bid-status";

export type ClientBidRead = { facts: BidFacts; state: BidState; notSubmitted: boolean; stage: ReturnType<typeof clientStageOf>; deadLead: ReturnType<typeof deadLeadOf> };

export const EMPTY_FACTS = (): BidFacts => ({ dead: false, anyEstimate: false, sentEstimate: false, approvedEstimate: false, appointment: false, hover: false, projectStatus: null });

/** Both spellings exist in the wild; the schema's own value is "canceled". */
const notCancelled = (col: any) => sql`coalesce(${col}, '') not in ('canceled', 'cancelled')`;
/** A HOVER report the team can read: HOVER's own "ready", or the older "complete(d)". */
const hoverDone = sql`${crmMeasurements.provider} = 'hover' and coalesce(${crmMeasurements.status}, '') in ('ready', 'complete', 'completed')`;

/** Facts for every id (missing clients get the empty set), in chunks of 1,000. */
export async function bidFactsFor(orgId: string, customerIds: string[]): Promise<Map<string, BidFacts>> {
  const facts = new Map<string, BidFacts>();
  const of = (id: string) => { let f = facts.get(id); if (!f) { f = EMPTY_FACTS(); facts.set(id, f); } return f; };
  const ids = [...new Set(customerIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const [custs, agg, projects, visits, projectVisits, measured] = await Promise.all([
      db.select({ id: crmCustomers.id, customFields: crmCustomers.customFields }).from(crmCustomers)
        .where(and(eq(crmCustomers.orgId, orgId), inArray(crmCustomers.id, chunk))),
      db.select({
        customerId: crmEstimates.customerId,
        any: sql<number>`count(*)::int`,
        sent: sql<number>`count(*) filter (where ${crmEstimates.status} in ('sent','viewed','approved','declined','expired') or ${crmEstimates.sentAt} is not null)::int`,
        approved: sql<number>`count(*) filter (where ${crmEstimates.status} = 'approved' or ${crmEstimates.approvedAt} is not null)::int`,
      }).from(crmEstimates).where(and(eq(crmEstimates.orgId, orgId), inArray(crmEstimates.customerId, chunk))).groupBy(crmEstimates.customerId),
      db.select({ customerId: crmProjects.customerId, status: crmProjects.status }).from(crmProjects)
        .where(and(eq(crmProjects.orgId, orgId), inArray(crmProjects.customerId, chunk), isNull(crmProjects.archivedAt), notCancelled(crmProjects.status)))
        .orderBy(desc(crmProjects.createdAt)),
      db.select({ customerId: crmAppointments.customerId }).from(crmAppointments)
        .where(and(eq(crmAppointments.orgId, orgId), inArray(crmAppointments.customerId, chunk), notCancelled(crmAppointments.status)))
        .groupBy(crmAppointments.customerId),
      // A visit booked against the job only (no client on the row) still counts for that job's client.
      db.select({ customerId: crmProjects.customerId }).from(crmAppointments)
        .innerJoin(crmProjects, eq(crmProjects.id, crmAppointments.projectId))
        .where(and(eq(crmAppointments.orgId, orgId), isNull(crmAppointments.customerId), inArray(crmProjects.customerId, chunk), notCancelled(crmAppointments.status)))
        .groupBy(crmProjects.customerId),
      db.select({ customerId: crmMeasurements.customerId }).from(crmMeasurements)
        .where(and(eq(crmMeasurements.orgId, orgId), inArray(crmMeasurements.customerId, chunk), hoverDone)).groupBy(crmMeasurements.customerId),
    ]);
    for (const c of custs) of(c.id).dead = !!deadLeadOf(c.customFields);
    for (const a of agg) { const f = of(a.customerId); f.anyEstimate = a.any > 0; f.sentEstimate = a.sent > 0; f.approvedEstimate = a.approved > 0; }
    for (const p of projects) { const f = of(p.customerId); if (!f.projectStatus && stageOfProjectStatus(p.status)) f.projectStatus = p.status; }
    for (const v of [...visits, ...projectVisits]) if (v.customerId) of(v.customerId).appointment = true;
    for (const m of measured) if (m.customerId) of(m.customerId).hover = true;
  }
  for (const id of ids) of(id);
  return facts;
}

export function readBid(f: BidFacts): Omit<ClientBidRead, "deadLead"> {
  return { facts: f, state: bidStateOf(f), notSubmitted: bidNotSubmitted(f), stage: clientStageOf(f) };
}
