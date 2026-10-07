import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Scopes Google's design tokens (font, colours, shapes — client/src/styles/google.css) to one subtree.
 * Inside it the app's own theme variables point at the same palette, so existing shadcn controls follow.
 * `page` fills the viewport with the Google surface colour (the app's own page background shows otherwise).
 */
export function GoogleSurface({ children, className, header, page, testId }: {
  children: ReactNode;
  className?: string;
  /** Optional Google-style strip above the content: a 20px/400 title and a 14px secondary line. */
  header?: { title: ReactNode; description?: ReactNode; actions?: ReactNode };
  page?: boolean;
  testId?: string;
}) {
  return (
    <div className={cn("g-surface", page && "min-h-full", className)} data-testid={testId}>
      {header && (
        <div className="g-header flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="g-header__title">{header.title}</h2>
            {header.description && <p className="g-header__sub">{header.description}</p>}
          </div>
          {header.actions && <div className="flex flex-wrap gap-2">{header.actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
