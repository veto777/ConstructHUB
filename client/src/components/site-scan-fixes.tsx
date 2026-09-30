import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      <p>
        Detected platform: {report.platforms?.join(", ")}. Detection uses HTML
        fingerprints; Custom/unknown means no supported fingerprint was found.
        Editor paths are starting points and may vary by version or plan.
      </p>
      <p>
        Done is your work status. A rescan separately verifies fixed, still
        present, new, or not checked. A missing finding is not proof of a fix
        when coverage differs.
      </p>
      {onDone && (
        <div className="flex gap-2">
          <Button
            variant="outline"
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
        <article className="border rounded p-4 space-y-2 min-w-0" key={f.key}>
          <h3 className="font-semibold">
            {f.title ||
              report.findings.find((a: any) => a.id === f.findingId)?.title ||
              f.findingId}
          </h3>
          {f.guidance && (
            <>
              <p>
                <strong>Why it matters for SEO:</strong> {f.guidance.impact} —{" "}
                {f.guidance.reason}
              </p>
              <a
                className="underline"
                href={f.guidance.source}
                target="_blank"
                rel="noreferrer"
              >
                Source
              </a>
              <ol className="list-decimal pl-5">
                {f.guidance.steps.map((s: string, i: number) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </>
          )}
          <p>
            {f.done ? "Done (reported)" : "Not done"} · Rescan:{" "}
            <strong>{f.verification}</strong>
          </p>
          <p className="break-all">
            Page: {f.page}
            {f.target && (
              <>
                <br />
                Target: {f.target}
              </>
            )}
          </p>
          <pre className="text-xs whitespace-pre-wrap break-all">
            {JSON.stringify(f.evidence, null, 2)}
          </pre>
          <p>
            <strong>{f.platform}:</strong> {f.clickPath}
          </p>
          {f.code && (
            <>
              <p>Draft code — review before publishing</p>
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
              <pre className="text-xs whitespace-pre-wrap break-all">
                {f.code}
              </pre>
            </>
          )}
          {onDone && (
            <Button variant="outline" onClick={() => onDone([f.key], !f.done)}>
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
    <div className="space-y-2">
      <label>
        Search findings and fixes
        <Input
          value={filters.q}
          onChange={(e) =>
            setFilters({ ...filters, q: e.target.value, offset: 0 })
          }
        />
      </label>
      <label>
        Category{" "}
        <select
          className="border p-2 bg-background"
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
      </label>
      <label>
        Verification{" "}
        <select
          className="border p-2 bg-background"
          value={filters.verification}
          onChange={(e) =>
            setFilters({ ...filters, verification: e.target.value, offset: 0 })
          }
        >
          {["", "new", "still present", "fixed", "not checked"].map((v) => (
            <option key={v} value={v}>
              {v || "All statuses"}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2 items-center">
        <Button
          variant="outline"
          disabled={!filters.offset}
          onClick={() =>
            setFilters({ ...filters, offset: Math.max(0, filters.offset - 25) })
          }
        >
          Previous findings
        </Button>
        <span>
          {filters.offset + 1}–{Math.min(filters.offset + 25, total)} of {total}
        </span>
        <Button
          variant="outline"
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
