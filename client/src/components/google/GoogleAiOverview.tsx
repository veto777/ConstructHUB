import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Google's 4-point sparkle. */
export function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2c.6 4.9 4.1 8.4 9 9-4.9.6-8.4 4.1-9 9-.6-4.9-4.1-8.4-9-9 4.9-.6 8.4-4.1 9-9Z" />
    </svg>
  );
}

/** A dotted-underlined entity name inside an AI Overview body. */
export function AiEntity({ children }: { children: ReactNode }) {
  return <span className="g-ai__entity">{children}</span>;
}

/**
 * The "AI Overview" block: sparkle + label, then an 18px/26px body. Used for OUR summaries (review
 * summaries, competitor summaries, AI reply drafts) — it never pretends to be Google's own.
 */
export function GoogleAiOverview({ children, label = "AI Overview", footnote, actions, testId, className }: {
  children: ReactNode;
  label?: ReactNode;
  /** Small grey line under the body: the source, a caveat, a date. */
  footnote?: ReactNode;
  actions?: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <section className={cn("g-ai", className)} data-testid={testId}>
      <h3 className="g-ai__label"><SparkleIcon /> {label}</h3>
      <div className="g-ai__body">{children}</div>
      {footnote && <p className="g-ai__foot">{footnote}</p>}
      {actions && <div className="g-card__actions">{actions}</div>}
    </section>
  );
}
