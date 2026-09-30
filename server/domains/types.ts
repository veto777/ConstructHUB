import { z } from "zod";
import { isIP } from "node:net";
export const domainName = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
export const recordType = z.enum(["A", "AAAA", "CNAME", "TXT", "MX", "CAA"]);
export const recordInput = z
  .object({
    id: z
      .string()
      .regex(/^[0-9]+$/)
      .optional(),
    type: recordType,
    name: z
      .string()
      .max(253)
      .regex(/^(?:@|\*|(?:\*\.)?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)$/)
      .transform((s) => s.toLowerCase()),
    content: z
      .string()
      .min(1)
      .max(4096)
      .refine((s) => !/[\r\n\0]/.test(s)),
    ttl: z.number().int().min(60).max(2147483647).default(600),
    priority: z.number().int().min(0).max(65535).default(0),
  })
  .strict()
  .superRefine((r, c) => {
    const invalid =
      (r.type === "A" && isIP(r.content) !== 4) ||
      (r.type === "AAAA" && isIP(r.content) !== 6) ||
      (["MX", "CNAME"].includes(r.type) &&
        !domainName.safeParse(r.content.replace(/\.$/, "")).success) ||
      (r.type === "CAA" &&
        !/^(0|128) (issue|issuewild|iodef) "[^"\r\n]+"$/.test(r.content));
    if (invalid) c.addIssue({ code: "custom", message: "Invalid DNS value" });
  });
export type DnsRecord = z.infer<typeof recordInput>;
export const changeInput = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("nameservers"),
      nameservers: z
        .array(domainName)
        .min(2)
        .max(6)
        .refine((v) => new Set(v).size === v.length),
    })
    .strict(),
  z.object({ kind: z.literal("create"), record: recordInput }).strict(),
  z.object({ kind: z.literal("update"), record: recordInput }).strict(),
  z.object({ kind: z.literal("delete"), record: recordInput }).strict(),
]);
export type Change = z.infer<typeof changeInput>;
export type DomainState = {
  domain: string;
  expires: string | null;
  autoRenew: boolean | null;
  status: string | null;
  nameservers: string[];
  records: DnsRecord[];
};
export interface RegistrarAdapter {
  list(
    cursor?: string,
  ): Promise<{ domains: Omit<DomainState, "records">[]; next: string | null }>;
  read(domain: string): Promise<DomainState>;
  setNameservers(domain: string, nameservers: string[]): Promise<void>;
  createRecord(domain: string, record: DnsRecord): Promise<DnsRecord>;
  updateRecord(domain: string, record: DnsRecord): Promise<void>;
  deleteRecord(domain: string, record: DnsRecord): Promise<void>;
}
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v) =>
    Array.isArray(v)
      ? [...v].sort((a, b) =>
          JSON.stringify(a).localeCompare(JSON.stringify(b)),
        )
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
          )
        : v,
  );
export const emailWarning = (c: Change, before?: DomainState) =>
  c.kind === "nameservers" ||
  ["MX", "TXT", "CNAME"].includes(c.record.type) ||
  !!before?.records.some(
    (r) => r.id === c.record.id && ["MX", "TXT", "CNAME"].includes(r.type),
  );
export function desired(before: DomainState, change: Change): DomainState {
  change = changeInput.parse(change);
  if (change.kind === "nameservers")
    return { ...before, nameservers: change.nameservers };
  if (before.nameservers.some((n) => /(^|\.)cloudflare\.com\.?$/i.test(n)))
    throw new DomainError(
      "DNS is on Cloudflare. Manage records in Cloudflare.",
    );
  const key = (r: DnsRecord) => r.id || `${r.type}:${r.name}`;
  const match = before.records.find((r) => key(r) === key(change.record));
  if (change.kind !== "create" && !match)
    throw new DomainError("Record no longer exists. Refresh the preview.", 409);
  if (
    change.kind === "create" &&
    before.records.some(
      (r) =>
        r.name === change.record.name &&
        r.type === change.record.type &&
        r.content === change.record.content,
    )
  )
    throw new DomainError("Record already exists.", 409);
  return {
    ...before,
    records:
      change.kind === "create"
        ? [...before.records, change.record]
        : change.kind === "delete"
          ? before.records.filter((r) => r !== match)
          : before.records.map((r) => (r === match ? change.record : r)),
  };
}
