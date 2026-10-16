import { Suspense, createElement, lazy, type ComponentType, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { isChunkLoadError } from "@/lib/stale-build";
import { reportClientError } from "@/lib/report-client-errors";

/**
 * A sample component whose fixture module downloads only when an empty state actually renders it.
 *
 * The fixtures (components/traffic-tool/samples.tsx, components/crm-sample-previews.tsx,
 * pages/crm-call-assistant/samples.tsx) are static data plus the pages' own views, and a page with real data never
 * shows them; imported statically they rode in every page's first download (IP Tracker fetched VPN Shield's views
 * through the shared fixture module and the other way round). Use it where the page used to import the component:
 *
 *   const IpSample = lazySample(() => import("@/components/traffic-tool/samples"), "IpSample");
 *
 * The props stay typed as the fixture's. While the chunk loads nothing is drawn (it is a few KB and cached from then
 * on); a chunk that cannot be loaded (a deploy replaced it, offline) draws nothing either, because a sample is only
 * ever decoration — the page itself is unaffected, and an unexplained failure is reported.
 */
type PropsOf<C> = C extends ComponentType<infer P> ? P : never;
export function lazySample<M extends object, K extends keyof M>(load: () => Promise<M>, name: K): ComponentType<PropsOf<M[K]>> {
  const Sample = lazy(() =>
    load()
      .then((m) => ({ default: m[name] as unknown as ComponentType<any> }))
      .catch((err: unknown): { default: ComponentType<any> } => {
        if (!isChunkLoadError(err)) reportClientError(err);
        return { default: () => null };
      }),
  ) as unknown as ComponentType<any>;
  return function LazySample(props: PropsOf<M[K]>) {
    return <Suspense fallback={null}>{createElement(Sample, props)}</Suspense>;
  };
}

/**
 * The one guard every <SamplePreview> call site goes through: true ONLY when the real dataset is known to be
 * empty. Never while the request is loading, never after it failed (an error is not "no data"), never when a
 * filter, search, date range or permission narrows a dataset that may hold rows, and never past the first page.
 *
 *  - `total`    — the real, unfiltered record count. `undefined`/`null` means "not known yet" → no sample.
 *  - `filtered` — any filter/search/range/permission is narrowing what the caller sees.
 *  - `page`     — zero-based page index or row offset; anything but 0 means "past the first page".
 *
 * A range-only empty result ("no visits in the last 7 days" for a site that had visits before) is not empty data:
 * pass the range as `filtered` and say "Nothing in this range" instead (see `NothingInRange`).
 */
export function showSample({ isLoading, isError, total, filtered, page }: {
  isLoading?: boolean;
  isError?: boolean;
  total: number | null | undefined;
  filtered?: boolean;
  page?: number;
}): boolean {
  if (isLoading || isError || filtered) return false;
  if (page) return false;
  return total === 0;
}

/** The honest empty state for a dataset that has records, just none in the chosen range/window. */
export function NothingInRange({ children, className, testId }: { children?: ReactNode; className?: string; testId?: string }) {
  return (
    <p className={cn("rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground", className)} data-testid={testId ?? "nothing-in-range"}>
      {children ?? "Nothing in this range."}
    </p>
  );
}

/**
 * A clearly labelled SAMPLE of what a page shows once it has real data (owner 2026-10-15: "add a placeholder
 * that says demo, and once you add real data the demo is replaced … so the clients know what each feature is").
 *
 * Rules, because this project never fabricates data (CLAUDE.md):
 *  - Shown ONLY while the real dataset is empty; the moment one real record exists the caller renders the real
 *    thing instead. Never mixed with real rows.
 *  - Built from static fixtures in the client. Nothing is stored, nothing is sent to the server, nothing counts.
 *  - Every number, name and address is obviously made up ("Sample Roofing Co.", "123 Example St") and the whole
 *    block is badged "Sample data" at the top and dimmed, with an aria-label saying so. A screen reader hears that
 *    label once (the visual badge repeats it, so it is aria-hidden) and then only the CTA: the sample itself is
 *    `inert` + aria-hidden, so nothing in it is read, tabbed to or clicked.
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
        <p className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[12px] font-medium text-amber-800 dark:text-amber-200" aria-hidden="true" data-testid="sample-preview-badge">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Sample data · {what}
        </p>
        {cta && <div className="flex items-center gap-2">{cta}</div>}
      </div>
      {/* Not interactive: a sample is to look at. (The `inert` attribute is not in React's typings yet.) */}
      <div className="pointer-events-none select-none opacity-80" aria-hidden="true" {...({ inert: "" } as Record<string, string>)}>
        {children}
      </div>
    </section>
  );
}

/* ── Fixture helpers: one made-up business and one clock for every page's sample ─────────────────────────────── */

/**
 * The one made-up business the samples are about. Obviously fictional (reserved `.example` domain, "Sample …"
 * name, "Example St") so it can never be mistaken for a real record. Pages build their fixtures from it.
 */
export const SAMPLE_BUSINESS = {
  name: "Sample Roofing Co.",
  domain: "sample-roofing.example",
  email: "owner@sample-roofing.example",
  address: "123 Example St, Sampletown",
} as const;

/** A fixture timestamp this long before now, as an ISO string: `sampleAgo({ hours: 3 })`, `sampleAgo({ days: 2 })`. */
export function sampleAgo({ minutes = 0, hours = 0, days = 0 }: { minutes?: number; hours?: number; days?: number }): string {
  return new Date(Date.now() - ((days * 24 + hours) * 60 + minutes) * 60_000).toISOString();
}
