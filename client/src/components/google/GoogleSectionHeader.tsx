import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { HelpButton } from "@/components/help-button";
import { useHelpKeyForRoute } from "@/lib/use-help-entry";
import { cn } from "@/lib/utils";

/**
 * Google's section heading: a 20px/400 title, an optional 14px grey line under it, a hairline below.
 * Used as a page title on the platform pages and as the heading of a list ("Your tools", "Recent").
 *
 * As a page title (`as="h1"`) it carries the page's "i" (help registry: what it's for, how to use it, the
 * walkthrough) by itself: the entry whose route matches the page, unless `helpKey` names one or `titleAfter`
 * already brings a control. `helpKey={null}` turns it off.
 */
export function GoogleSectionHeader({ title, titleAfter, description, actions, count, flush, as: Tag = "h2", titleTestId, testId, className, helpKey: helpKeyProp }: {
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
  /** The "i" beside a page title: a help registry key, omitted for the page route's own entry, null for none. */
  helpKey?: string | null;
}) {
  const [location] = useLocation();
  const routeHelpKey = useHelpKeyForRoute(location);
  const helpKey = Tag === "h1" && !titleAfter ? (helpKeyProp === undefined ? routeHelpKey : helpKeyProp ?? undefined) : helpKeyProp ?? undefined;
  const after = titleAfter ?? (helpKey ? <HelpButton k={helpKey} /> : undefined);
  return (
    <div className={cn("g-header flex flex-wrap items-end justify-between gap-3", flush && "g-header--flush", className)} data-testid={testId}>
      <div className="min-w-0">
        <div className={after ? "flex items-center gap-1.5" : undefined}>
          <Tag className="g-header__title">
            <span data-testid={titleTestId}>{title}</span>
            {count != null && count !== "" && <>
              {/* The count reads as its own word ("Issues, 82"), never glued to the title ("Issues82"). */}
              <span className="sr-only">, {typeof count === "number" ? count.toLocaleString() : count}</span>
              <span className="g-header__count" aria-hidden="true">{typeof count === "number" ? count.toLocaleString() : count}</span>
            </>}
          </Tag>
          {after}
        </div>
        {description && <p className="g-header__sub">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
