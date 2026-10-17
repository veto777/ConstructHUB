/**
 * Actor directory — resolves the ids stored on log rows (member ids, the
 * crm_activity_log actor, crm_estimate_events.actor, attachment uploaders)
 * into named actors (shared/crm-actor.ts). One query per request: every
 * member of the org, ANY status — a disabled seat still shows its name.
 * A member row that was removed falls back to the name snapshot the log row
 * carries (crm_activity_log.actor_label); never a raw id.
 */
import { db } from "../db";
import { crmMembers, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  memberActor, logLabelActor, clientActor, systemActor, UNRECORDED_ACTOR, type CrmActor,
} from "@shared/crm-actor";

export interface ActorDirectory {
  /** The member by id, or null (unknown / removed). */
  member(id: string | null | undefined): CrmActor | null;
  /** A crm_activity_log row's actor: the live member, else the row's own snapshot. */
  logActor(row: { actorMemberId: string | null; actorLabel: string }, clientName?: string | null): CrmActor;
}

export type DirectoryMember = {
  id: string; role: string | null; displayName: string | null; email: string | null; userDisplayName?: string | null;
};

/** Pure — the directory over an already-loaded member list (unit-tested). */
export function actorDirectoryOf(members: DirectoryMember[]): ActorDirectory {
  const byId = new Map(members.map((m) => [m.id, memberActor(m)]));
  return {
    member: (id) => (id ? byId.get(id) ?? null : null),
    logActor(row, clientName) {
      const live = row.actorMemberId ? byId.get(row.actorMemberId) : null;
      if (live) return live;
      if (row.actorMemberId) {
        // A removed member: the name snapshot taken at write time.
        const snap = String(row.actorLabel ?? "").trim();
        const name = snap.includes("@") ? snap.split("@")[0] : snap;
        return { kind: "member", name: name || "Former team member", recorded: true };
      }
      return logLabelActor(row.actorLabel, clientName);
    },
  };
}

export async function loadActorDirectory(orgId: string): Promise<ActorDirectory> {
  const rows = await db.select({
    id: crmMembers.id, role: crmMembers.role, displayName: crmMembers.displayName,
    email: crmMembers.email, userDisplayName: users.displayName,
  }).from(crmMembers)
    .leftJoin(users, eq(users.id, crmMembers.userId))
    .where(eq(crmMembers.orgId, orgId));
  return actorDirectoryOf(rows);
}

/** crm_estimate_events.actor ("<member id>" | "client" | "visitor" | "system") as a named actor. */
export function estimateEventActor(
  actor: string | null | undefined, dir: Pick<ActorDirectory, "member">, clientName: string | null,
): CrmActor {
  const a = String(actor ?? "").trim();
  if (a === "client") return clientActor(clientName);
  if (a === "visitor") return systemActor("Unverified visitor");
  if (a === "system") return systemActor("System");
  if (!a) return UNRECORDED_ACTOR;
  return dir.member(a) ?? { kind: "member", name: "Former team member", recorded: true };
}
