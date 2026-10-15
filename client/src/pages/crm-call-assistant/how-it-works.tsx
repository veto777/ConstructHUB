import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * "How this works" — three numbered steps in a quiet callout (the SEO Suite's `g-callout`), for the views
 * that are a form or a list with no story of their own (Numbers, Agent studio). Static copy, written from
 * what the code does today; never a promise the server does not keep.
 */
export function HowItWorks({ title = "How this works", steps, className, testId, foot }: {
  title?: string;
  /** At most three: [heading, one sentence]. */
  steps: ReadonlyArray<[string, ReactNode]>;
  className?: string;
  testId?: string;
  /** One small line under the steps (a rule the owner must know). */
  foot?: ReactNode;
}) {
  return (
    <section className={cn("g-callout", className)} aria-labelledby={`${testId ?? "how-it-works"}-title`} data-testid={testId ?? "how-it-works"}>
      <h2 id={`${testId ?? "how-it-works"}-title`} className="g-card__title g-card__title--md">{title}</h2>
      <ol className="mt-3 grid gap-3 sm:grid-cols-3">
        {steps.slice(0, 3).map(([head, body], i) => (
          <li key={i} className="flex gap-3" data-testid={`${testId ?? "how-it-works"}-step-${i + 1}`}>
            <span className="g-chip g-chip--sm shrink-0 tabular-nums" aria-hidden="true">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-[14px] leading-5 g-text">{head}</span>
              <span className="block text-[13px] leading-5 g-text-2">{body}</span>
            </span>
          </li>
        ))}
      </ol>
      {foot && <p className="mt-3 text-[12px] leading-4 g-text-2">{foot}</p>}
    </section>
  );
}
