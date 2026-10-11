import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toolbar } from "@/components/app-ui";
import { evidenceSummary } from "@/components/site-scan-helpers";
const selectClass =
  "h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-auto";
/** What the scan saw for one fix: a short readable list, with the raw JSON behind "Technical evidence". */
function EvidenceSummary({ evidence }: { evidence: unknown }) {
  const isEmpty =
    evidence == null ||
    (typeof evidence === "object" && Object.keys(evidence as object).length === 0);
  if (isEmpty) return null;
  const lines = evidenceSummary(evidence);
  return (
    <div className="space-y-1">
      {lines.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          {lines.map((l, i) => (
            <div key={i} className="contents">
              <dt className="text-muted-foreground">{l.label}</dt>
              <dd className="min-w-0 break-words">{l.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">
          Technical evidence
        </summary>
        <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md border p-2 text-xs text-muted-foreground">
          {JSON.stringify(evidence, null, 2)}
        </pre>
      </details>
    </div>
  );
}
export function FixChecklist({
  report,
  onDone,
}: {
  report: any;
  onDone?: (keys: string[], done: boolean) => void;
}) {
  const [copied, setCopied] = useState("");
  const [copyFailed, setCopyFailed] = useState("");
  if (!report?.fixes) return null;
  return (
    <section className="space-y-3" aria-label="Prioritized fix checklist">
      <h2 className="text-xl font-semibold">
        Exactly how to fix — prioritized checklist
      </h2>
      <p className="text-sm text-muted-foreground">
        Detected platform: {report.platforms?.join(", ")}. Detection uses HTML
        fingerprints; Custom/unknown means no supported fingerprint was found.
        Editor paths are starting points and may vary by version or plan.
      </p>
      <p className="text-sm text-muted-foreground">
        Done is your work status. A rescan separately verifies fixed, still
        present, new, or not checked. A missing finding is not proof of a fix
        when coverage differs.
      </p>
      {onDone && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!report.fixes.length}
            onClick={() =>
              onDone(
                report.fixes.map((f: any) => f.key),
                true,
              )
            }
          >
            Mark this page done
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!report.fixes.length}
            onClick={() =>
              onDone(
                report.fixes.map((f: any) => f.key),
                false,
              )
            }
          >
            Mark this page not done
          </Button>
        </div>
      )}
      {report.fixes.map((f: any) => (
        <article className="space-y-2 rounded-xl border p-4 min-w-0" key={f.key}>
          <h3 className="font-semibold">
            {f.title ||
              report.findings.find((a: any) => a.id === f.findingId)?.title ||
              f.findingId}
          </h3>
          {f.guidance && (
            <>
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground">
                  Why it matters for SEO:
                </strong>{" "}
                {f.guidance.impact} — {f.guidance.reason}
              </p>
              <a
                className="text-sm text-primary underline"
                href={f.guidance.source}
                target="_blank"
                rel="noreferrer"
              >
                Source
              </a>
              <ol className="list-decimal pl-5 text-sm text-muted-foreground">
                {f.guidance.steps.map((s: string, i: number) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </>
          )}
          <p className="text-sm">
            {f.done ? "Done (reported)" : "Not done"} · Rescan:{" "}
            <strong>{f.verification}</strong>
          </p>
          <p className="break-all text-sm text-muted-foreground">
            Page: {f.page}
            {f.target && (
              <>
                <br />
                Target: {f.target}
              </>
            )}
          </p>
          <EvidenceSummary evidence={f.evidence} />
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{f.platform}:</strong>{" "}
            {f.clickPath}
          </p>
          {f.code && (
            <>
              <p className="text-sm text-muted-foreground">
                Draft code — review before publishing
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  // A blocked clipboard must not read as copied.
                  try {
                    await navigator.clipboard.writeText(f.code);
                    setCopied(f.key);
                    setCopyFailed("");
                  } catch {
                    setCopied("");
                    setCopyFailed(f.key);
                  }
                }}
              >
                {copied === f.key ? "Code copied" : "Copy code"}
              </Button>
              {copyFailed === f.key && (
                <p role="alert" className="text-sm text-red-600">
                  Could not copy: your browser blocked clipboard access. Select
                  the code below and copy it manually.
                </p>
              )}
              <pre className="whitespace-pre-wrap break-all text-xs">
                {f.code}
              </pre>
            </>
          )}
          {onDone && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDone([f.key], !f.done)}
            >
              {f.done ? "Mark not done" : "Mark done"}
            </Button>
          )}
        </article>
      ))}
    </section>
  );
}
export function ReportFilters({
  filters,
  setFilters,
  total,
}: {
  filters: any;
  setFilters: (v: any) => void;
  total: number;
}) {
  return (
    <div className="space-y-3">
      <Toolbar
        search={{
          value: filters.q,
          onChange: (v) => setFilters({ ...filters, q: v, offset: 0 }),
          placeholder: "Search findings and fixes",
        }}
        activeFilters={(filters.category ? 1 : 0) + (filters.verification ? 1 : 0)}
        filters={
          <>
            <select
              aria-label="Category"
              className={selectClass}
              value={filters.category}
              onChange={(e) =>
                setFilters({ ...filters, category: e.target.value, offset: 0 })
              }
            >
              {[
                "",
                "technical",
                "performance",
                "local",
                "content",
                "ai-readiness",
              ].map((v) => (
                <option key={v} value={v}>
                  {v || "All categories"}
                </option>
              ))}
            </select>
            <select
              aria-label="Verification"
              className={selectClass}
              value={filters.verification}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  verification: e.target.value,
                  offset: 0,
                })
              }
            >
              {["", "new", "still present", "fixed", "not checked"].map(
                (v) => (
                  <option key={v} value={v}>
                    {v || "All statuses"}
                  </option>
                ),
              )}
            </select>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!filters.offset}
          onClick={() =>
            setFilters({ ...filters, offset: Math.max(0, filters.offset - 25) })
          }
        >
          Previous findings
        </Button>
        <span className="text-sm tabular-nums text-muted-foreground">
          {total ? `${filters.offset + 1}–${Math.min(filters.offset + 25, total)} of ${total}` : "0 findings"}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={filters.offset + 25 >= total}
          onClick={() =>
            setFilters({ ...filters, offset: filters.offset + 25 })
          }
        >
          Next findings
        </Button>
      </div>
    </div>
  );
}
export const initialReportFilters = {
  q: "",
  category: "",
  verification: "",
  offset: 0,
};
