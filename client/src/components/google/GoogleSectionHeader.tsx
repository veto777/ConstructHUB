import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Google's section heading: a 20px/400 title, an optional 14px grey line under it, a hairline below.
 * Used as a page title on the platform pages and as the heading of a list ("Your tools", "Recent").
 */
export function GoogleSectionHeader({ title, titleAfter, description, actions, count, flush, as: Tag = "h2", titleTestId, testId, className }: {
  title: ReactNode;
  /** A small control beside the title, outside the heading itself (the "i" help button). */
  titleAfter?: ReactNode;
  description?: ReactNode;
  /** Pills or small controls on the right; they wrap under the title on phones. */
  actions?: ReactNode;
  /** A small grey count after the title ("Recent 12"). */
  count?: number | string | null;
  /** No space under the hairline (the list starts right away). */
  flush?: boolean;
  as?: "h1" | "h2" | "h3";
  titleTestId?: string;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={cn("g-header flex flex-wrap items-end justify-between gap-3", flush && "g-header--flush", className)} data-testid={testId}>
      <div className="min-w-0">
        <div className={titleAfter ? "flex items-center gap-1.5" : undefined}>
          <Tag className="g-header__title">
            <span data-testid={titleTestId}>{title}</span>
            {count != null && count !== "" && <span className="g-header__count">{typeof count === "number" ? count.toLocaleString() : count}</span>}
          </Tag>
          {titleAfter}
        </div>
        {description && <p className="g-header__sub">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
