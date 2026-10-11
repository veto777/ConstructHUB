import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The readable before/after review for a DNS change (the old screen serialized both states as
 * JSON). Records render as a table diff — Added / Changed / Removed rows, with the MX, TXT,
 * CNAME and nameserver implications called out — and the full snapshots stay behind a
 * "Developer" disclosure. Modelled on the ads change-preview dialog.
 */
export type DnsRecordLike = {
  id?: string;
  type: string;
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
};
export type DiffStatus = "added" | "removed" | "changed" | "unchanged";
export type DiffRow = {
  status: DiffStatus;
  before?: DnsRecordLike;
  after?: DnsRecordLike;
};

const contentKey = (r: DnsRecordLike) =>
  `tn:${r.type}:${r.name}:${r.content}`;
const rowKey = (r: DnsRecordLike) => (r.id ? `id:${r.id}` : contentKey(r));
const sameRecord = (a: DnsRecordLike, b: DnsRecordLike) =>
  a.type === b.type &&
  a.name === b.name &&
  a.content === b.content &&
  (a.ttl ?? 600) === (b.ttl ?? 600) &&
  (a.priority ?? 0) === (b.priority ?? 0);

export function diffRecords(
  before: DnsRecordLike[] = [],
  after: DnsRecordLike[] = [],
): DiffRow[] {
  const unmatched = new Map<string, DnsRecordLike[]>();
  for (const r of after) {
    const k = rowKey(r);
    unmatched.set(k, [...(unmatched.get(k) || []), r]);
  }
  const rows: DiffRow[] = [];
  const consumedAfter = new Set<DnsRecordLike>();
  // First pass: match by provider id, then by exact type/name/content.
  for (const b of before) {
    const candidates = unmatched.get(rowKey(b)) || [];
    const m = candidates[0];
    if (m) {
      consumedAfter.add(m);
      unmatched.set(
        rowKey(b),
        candidates.filter((x) => x !== m),
      );
      rows.push({
        status: sameRecord(b, m) ? "unchanged" : "changed",
        before: b,
        after: m,
      });
    } else {
      rows.push({ status: "removed", before: b });
    }
  }
  for (const a of after)
    if (!consumedAfter.has(a)) rows.push({ status: "added", after: a });
  const rank = { changed: 0, added: 1, removed: 2, unchanged: 3 } as const;
  return rows.sort(
    (x, y) =>
      rank[x.status] - rank[y.status] ||
      (x.before ?? x.after)!.type.localeCompare((y.before ?? y.after)!.type) ||
      (x.before ?? x.after)!.name.localeCompare((y.before ?? y.after)!.name),
  );
}

export function diffNameservers(
  before: string[] = [],
  after: string[] = [],
) {
  const norm = (s: string) => s.toLowerCase().replace(/\.$/, "");
  const b = new Set(before.map(norm)),
    a = new Set(after.map(norm));
  return {
    added: after.filter((x) => !b.has(norm(x))),
    removed: before.filter((x) => !a.has(norm(x))),
  };
}

const STATUS_LABEL: Record<DiffStatus, string> = {
  added: "Added",
  changed: "Changed",
  removed: "Removed",
  unchanged: "Unchanged",
};
const STATUS_CLASS: Record<DiffStatus, string> = {
  added: "g-open",
  changed: "text-amber-700 dark:text-amber-400",
  removed: "g-closed",
  unchanged: "g-text-2",
};

const recordValue = (r: DnsRecordLike) =>
  r.type === "MX" && r.priority ? `${r.priority} ${r.content}` : r.content;

/** One sentence per record family that can take the website or email down. */
export function changeImplications(
  rows: DiffRow[],
  ns: { added: string[]; removed: string[] },
): string[] {
  const types = new Set(
    rows
      .filter((r) => r.status !== "unchanged")
      .flatMap((r) => [r.before?.type, r.after?.type]),
  );
  const out: string[] = [];
  if (ns.added.length || ns.removed.length)
    out.push(
      "Nameserver changes reroute the website and email — expect a short interruption while the change propagates.",
    );
  if (types.has("MX"))
    out.push("MX records route email: a wrong value stops mail delivery.");
  if (types.has("TXT"))
    out.push(
      "TXT records often carry email authentication (SPF/DKIM): a wrong value can send mail to spam.",
    );
  if (types.has("CNAME"))
    out.push("A CNAME change can take the host it points at offline.");
  return out;
}

export type JobLike = {
  status: string;
  before_state?: { nameservers?: string[]; records?: DnsRecordLike[] } | null;
  after_state?: { nameservers?: string[]; records?: DnsRecordLike[] } | null;
};

/** Previewed → Applied → Verified, from the job's own status. */
export function JobStatusStepper({ status }: { status: string }) {
  const step =
    status === "previewing"
      ? 0 // building the preview
      : ["ready", "expired"].includes(status)
        ? 1 // previewed, awaiting confirmation
        : ["queued", "applying", "working"].includes(status)
          ? 2
          : ["verifying"].includes(status)
            ? 3
            : 4;
  const failed =
    status === "failed"
      ? 1
      : status === "uncertain"
        ? 2
        : ["verification_failed", "expired"].includes(status)
          ? 3
          : 0;
  const steps = [
    { label: "Previewed", done: step >= 1, failed: failed === 1 },
    {
      label: "Applied",
      done: status === "verified" || step > 3,
      active: step === 2 || step === 3,
      failed: failed === 2,
    },
    {
      label: "Verified",
      done: status === "verified",
      active: status === "verifying",
      failed: failed === 3,
    },
  ];
  const statusText: Record<string, string> = {
    previewing: "Building preview…",
    ready: "Previewed — awaiting your confirmation",
    queued: "Queued to apply…",
    applying: "Applying at the registrar…",
    working: "Applying at the registrar…",
    verifying: "Verifying against public DNS…",
    verified: "Verified — public DNS matches the change",
    verification_failed: "Verification failed — public DNS does not match yet",
    uncertain: "Applied, but the result is uncertain — review before retrying",
    failed: "Failed",
    complete: "Complete",
    expired: "Preview expired — create a new one",
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {steps.map((s, i) => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden="true" className="g-text-2">→</span>}
          <span
            className={cn(
              "inline-flex items-center gap-1",
              s.failed
                ? "g-closed"
                : s.done
                  ? "g-open"
                  : s.active
                    ? "g-accent"
                    : "g-text-2",
            )}
          >
            {s.failed ? (
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
            ) : s.done ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : s.active ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {s.label}
          </span>
        </span>
      ))}
      <span className="g-text-2">· {statusText[status] || status}</span>
    </span>
  );
}

export function DnsStateDiff({ job }: { job: JobLike }) {
  const before = job.before_state,
    after = job.after_state;
  const rows = useMemo(
    () => diffRecords(before?.records, after?.records),
    [before?.records, after?.records],
  );
  const ns = useMemo(
    () => diffNameservers(before?.nameservers, after?.nameservers),
    [before?.nameservers, after?.nameservers],
  );
  const implications = changeImplications(rows, ns);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const changed = rows.filter((r) => r.status !== "unchanged");
  const unchanged = rows.filter((r) => r.status === "unchanged");
  if (!before && !after) return null;
  if (!changed.length && !ns.added.length && !ns.removed.length)
    return <p className="mt-2 text-sm g-text-2">No changes — before and after match.</p>;
  return (
    <div className="mt-3 space-y-3">
      {(ns.added.length > 0 || ns.removed.length > 0) && (
        <div className="text-sm">
          <h4 className="font-medium">Nameservers</h4>
          <ul className="mt-1 space-y-0.5">
            {ns.removed.map((n) => (
              <li key={`r-${n}`} className="g-closed">
                − {n}
              </li>
            ))}
            {ns.added.map((n) => (
              <li key={`a-${n}`} className="g-open">
                + {n}
              </li>
            ))}
          </ul>
        </div>
      )}
      {changed.length > 0 && (
        <div className="overflow-x-auto">
          <table className="g-table min-w-[520px]">
            <thead>
              <tr>
                <th scope="col">Change</th>
                <th scope="col">Type</th>
                <th scope="col">Name</th>
                <th scope="col">TTL</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {changed.map((r, i) => {
                const b = r.before,
                  a = r.after,
                  shown = a ?? b!;
                const ttlChanged = b && a && (b.ttl ?? 600) !== (a.ttl ?? 600);
                return (
                  <tr key={`${rowKey(shown)}-${i}`}>
                    <td data-label="Change">
                      <span className={cn("font-medium", STATUS_CLASS[r.status])}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td data-label="Type">{shown.type}</td>
                    <td data-label="Name" className="break-all">{shown.name}</td>
                    <td data-label="TTL" className="num">
                      {ttlChanged ? (
                        <>
                          <span className="g-text-2 line-through">{b!.ttl ?? 600}</span>{" "}
                          {a!.ttl ?? 600}
                        </>
                      ) : (
                        (shown.ttl ?? 600)
                      )}
                    </td>
                    <td data-label="Value" className="min-w-0 break-all">
                      {b && a && r.status === "changed" ? (
                        <>
                          <span className="g-text-2 line-through">
                            {recordValue(b)}
                          </span>{" "}
                          → {recordValue(a)}
                        </>
                      ) : (
                        recordValue(shown)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {unchanged.length > 0 && (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs g-accent"
          aria-expanded={showUnchanged}
          onClick={() => setShowUnchanged((v) => !v)}
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", showUnchanged && "rotate-180")}
            aria-hidden="true"
          />
          {unchanged.length} unchanged record{unchanged.length !== 1 ? "s" : ""}
        </button>
      )}
      {showUnchanged && unchanged.length > 0 && (
        <div className="overflow-x-auto">
          <table className="g-table min-w-[520px] g-text-2">
            <tbody>
              {unchanged.map((r, i) => {
                const shown = r.after ?? r.before!;
                return (
                  <tr key={`u-${rowKey(shown)}-${i}`}>
                    <td data-label="Type">{shown.type}</td>
                    <td data-label="Name" className="break-all">{shown.name}</td>
                    <td data-label="TTL" className="num">{shown.ttl ?? 600}</td>
                    <td data-label="Value" className="min-w-0 break-all">
                      {recordValue(shown)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {implications.length > 0 && (
        <ul className="space-y-1">
          {implications.map((line) => (
            <li key={line} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
