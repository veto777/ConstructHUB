import type { DnsRecordLike } from "./dns-diff";

/**
 * The DNS record change form and the preview request it sends. A record picked from
 * the registrar keeps its provider id while the replacement values are edited, but the
 * id is only forwarded when it unambiguously belongs to the operation's target:
 * never for creates, and never in bulk mode or for another domain — there it would
 * mis-scope to a same-named record or a colliding provider id.
 */

export type RecordChangeForm = {
  kind: string; // "create" | "update" | "delete"
  type: string;
  name: string;
  content: string;
  ttl: number;
  priority: number;
};

/**
 * The provider record id that may travel with this change, or "" when the identity
 * does not apply: creates make a new record, and a picked record belongs to exactly
 * one domain, so it cannot scope a bulk or foreign-domain change.
 */
export function scopedRecordId(opts: {
  recordId: string;
  recordDomainId: number | null;
  selected: number[];
  kind: string;
}): string {
  if (opts.kind === "create") return "";
  if (!opts.recordId) return "";
  if (opts.recordDomainId === null) return "";
  if (opts.selected.length !== 1 || opts.selected[0] !== opts.recordDomainId)
    return "";
  return opts.recordId;
}

/** Exactly the change payload the preview endpoint receives for a record operation. */
export function buildRecordChange(
  form: RecordChangeForm,
  id: string,
): { kind: string; record: DnsRecordLike } {
  return {
    kind: form.kind,
    record: {
      ...(id ? { id } : {}),
      type: form.type,
      name: form.name,
      content: form.content,
      ttl: form.ttl,
      priority: form.priority,
    },
  };
}
