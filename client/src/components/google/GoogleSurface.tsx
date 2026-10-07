import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GoogleSectionHeader } from "./GoogleSectionHeader";

/**
 * Scopes Google's design tokens (font, colours, shapes — client/src/styles/google.css) to one subtree.
 * Inside it the app's own theme variables point at the same palette, so existing shadcn controls follow.
 *
 * The signed-in platform layout (App.tsx) already sits on a `.g-surface` with the brand orange as the accent;
 * this wrapper is for the Google Business pages, which take Google's blue (`accent="google"`, the default here)
 * because they imitate Google on purpose. `accent="brand"` nests a plain surface (orange) where one is needed.
 * `page` fills the viewport with the surface colour.
 */
export function GoogleSurface({ children, className, header, page, testId, accent = "google" }: {
  children: ReactNode;
  className?: string;
  /** Optional Google-style strip above the content: a 20px/400 title and a 14px secondary line. */
  header?: { title: ReactNode; description?: ReactNode; actions?: ReactNode };
  page?: boolean;
  testId?: string;
  accent?: "google" | "brand";
}) {
  return (
    <div className={cn("g-surface", accent === "google" && "g-surface--google", page && "min-h-full", className)} data-testid={testId}>
      {header && <GoogleSectionHeader title={header.title} description={header.description} actions={header.actions} />}
      {children}
    </div>
  );
}
