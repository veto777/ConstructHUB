import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A clearly labelled SAMPLE of what a page shows once it has real data (owner 2026-10-15: "add a placeholder
 * that says demo, and once you add real data the demo is replaced … so the clients know what each feature is").
 *
 * Rules, because this project never fabricates data (CLAUDE.md):
 *  - Shown ONLY while the real dataset is empty; the moment one real record exists the caller renders the real
 *    thing instead. Never mixed with real rows.
 *  - Built from static fixtures in the client. Nothing is stored, nothing is sent to the server, nothing counts.
 *  - Every number, name and address is obviously made up ("Sample Roofing Co.", "123 Example St") and the whole
 *    block is badged "Sample data" at the top and dimmed, with an aria-label saying so.
 *  - Never used for government, permit or compliance records.
 */
export function SamplePreview({ children, what, cta, className, testId }: {
  children: ReactNode;
  /** What the sample stands for, in the client's words: "what you'll see once you add a site". */
  what: string;
  /** The one action that replaces the sample with real data (a button or link), shown in the badge row. */
  cta?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section className={cn("relative rounded-xl border border-dashed border-amber-400/60 bg-amber-50/40 p-3 dark:bg-amber-950/10", className)}
      aria-label={`Sample data: ${what}`} data-testid={testId ?? "sample-preview"} data-sample="true">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[12px] font-medium text-amber-800 dark:text-amber-200" data-testid="sample-preview-badge">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Sample data · {what}
        </p>
        {cta && <div className="flex items-center gap-2">{cta}</div>}
      </div>
      <div className="pointer-events-none select-none opacity-80" aria-hidden="true" inert="">
        {children}
      </div>
    </section>
  );
}
