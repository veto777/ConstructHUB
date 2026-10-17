/**
 * Who did it — the bold name every CRM activity / history line leads with.
 * The org owner gets an "Owner" badge; a client a quiet "Client" tag; an
 * automatic source ("HOVER import", "Stripe", "System") reads as itself.
 * An actor nobody recorded (historic rows) renders nothing here — the
 * entry's own sentence already says "(uploader not recorded)".
 */
import type { CrmActor } from "@shared/crm-actor";
import { OWNER_FALLBACK_NAME } from "@shared/crm-actor";

export function ActorName({ actor, className = "" }: { actor: CrmActor | null | undefined; className?: string }) {
  if (!actor || actor.recorded === false) return null;
  const ownerOnly = actor.kind === "member" && actor.isOwner && actor.name === OWNER_FALLBACK_NAME;
  return (
    <span className={`inline-flex items-baseline gap-1 ${className}`} data-testid="actor-name">
      <strong className="font-semibold text-foreground">{actor.name}</strong>
      {actor.kind === "member" && actor.isOwner && !ownerOnly && (
        <span className="rounded border border-primary/30 bg-primary/10 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-primary"
          data-testid="badge-owner">Owner</span>
      )}
      {actor.kind === "client" && (
        <span className="rounded border px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          data-testid="badge-client">Client</span>
      )}
    </span>
  );
}

/** A log line: bold actor + the rest of the sentence; falls back to the plain text. */
export function ActorLine({ actor, actionText, text }: { actor?: CrmActor | null; actionText?: string | null; text: string }) {
  if (!actor || actor.recorded === false || !actionText) return <>{text}</>;
  return <><ActorName actor={actor} /> {actionText}</>;
}
