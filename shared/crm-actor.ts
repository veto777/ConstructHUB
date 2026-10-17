/**
 * Actor attribution — "who did it", by name, on every CRM log line.
 *
 * Owner order (2026-10-17): every activity / timeline / history line names the
 * real person — "Gabe Varnadore added a project photo (in progress) —
 * IMG_3305.jpeg". The org owner reads "Veto Smith (Owner) …" ("Owner" when the
 * owner has no name set). A client reads by the client's name ("Carley Geiss
 * shared a photo"); automatic work by what did it ("HOVER import", "System",
 * "Stripe"). Never "Your team" / "A team member" when the actor is known, and
 * never a raw id.
 *
 * A row from before an action was attributed is NOT guessed: it carries
 * `recorded: false` and reads "… (uploader not recorded)" (server side).
 *
 * Pure — shared by the server (notes-timeline.ts, activity.ts, stats.ts) and
 * the client UI (bold name + Owner badge).
 */

export type CrmActorKind = "member" | "client" | "system";

export interface CrmActor {
  kind: CrmActorKind;
  /** The person's / client's / source's name — never an id. */
  name: string;
  /** Member role ("owner", "office", …) when kind is member. */
  role?: string | null;
  /** The org owner — shown as "Name (Owner)". */
  isOwner?: boolean;
  /** false = historic row: nothing recorded who did it (never guessed). */
  recorded?: boolean;
}

/** The owner's name when none is set anywhere. */
export const OWNER_FALLBACK_NAME = "Owner";

/** Labels the server stores for non-member sources that are NOT a client. */
export const CRM_SYSTEM_ACTOR_LABELS = ["HOVER import", "System", "Stripe", "Auto-attach"] as const;
export type CrmSystemActorLabel = (typeof CRM_SYSTEM_ACTOR_LABELS)[number];

export interface MemberNameSource {
  role?: string | null;
  displayName?: string | null;
  /** The signed-in user's own display name (users.display_name), the second choice. */
  userDisplayName?: string | null;
  email?: string | null;
}

const clean = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * A member's name: display name → the user's own name → email local part.
 * The owner never falls back to an email: no name set reads "Owner".
 */
export function memberDisplayName(m: MemberNameSource): string {
  const dn = clean(m.displayName) || clean(m.userDisplayName);
  if (dn && !dn.includes("@")) return dn;
  if (m.role === "owner") return OWNER_FALLBACK_NAME;
  const fromDn = dn.includes("@") ? dn.split("@")[0] : "";
  const local = fromDn || clean(m.email).split("@")[0];
  return local || "Team member";
}

export function memberActor(m: MemberNameSource): CrmActor {
  const isOwner = m.role === "owner";
  return { kind: "member", name: memberDisplayName(m), role: m.role ?? null, isOwner, recorded: true };
}

export function clientActor(name?: string | null): CrmActor {
  return { kind: "client", name: clean(name) || "Client", recorded: true };
}

export function systemActor(label: string): CrmActor {
  return { kind: "system", name: clean(label) || "System", recorded: true };
}

/** The team did it but nothing recorded which person (historic rows only). */
export const UNRECORDED_TEAM_ACTOR: CrmActor = { kind: "member", name: "Your team", recorded: false };

/** Nothing recorded who did it, and nothing proves it was the team either. */
export const UNRECORDED_ACTOR: CrmActor = { kind: "system", name: "Unknown", recorded: false };

/** "Veto Smith (Owner)", "Gabe Varnadore", "Carley Geiss", "HOVER import". */
export function actorLabel(a: CrmActor): string {
  if (a.kind === "member" && a.isOwner) {
    return a.name === OWNER_FALLBACK_NAME ? OWNER_FALLBACK_NAME : `${a.name} (Owner)`;
  }
  return a.name;
}

/** "<actor> <rest>" — the one way a log line is built from its actor. */
export function actorSentence(a: CrmActor, rest: string): string {
  return `${actorLabel(a)} ${rest}`.replace(/\s{2,}/g, " ").trim();
}

/**
 * crm_attachments.uploaded_by_label (no member): a known system source, else
 * the client's name the portal recorded at upload time.
 */
export function uploadLabelActor(label: string): CrmActor {
  const l = clean(label);
  if ((CRM_SYSTEM_ACTOR_LABELS as readonly string[]).includes(l)) return systemActor(l);
  return clientActor(l);
}

/**
 * crm_activity_log.actor_label on a row with no member: "client" is the
 * client (named from the row's customer when known); anything else is the
 * automatic source that wrote it ("system", "Ava (Call Assistant)",
 * "ConstructHUB billing").
 */
export function logLabelActor(label: string, clientName?: string | null): CrmActor {
  const l = clean(label);
  if (l.toLowerCase() === "client") return clientActor(clientName);
  if (l.toLowerCase() === "system" || !l) return systemActor("System");
  return systemActor(l);
}
