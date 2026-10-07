import type { ReactNode } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

/** A quiet number tile: hairline, 12px grey label, 20px/400 number, optional hint. A tile with `href` is a link. */
export function GoogleStat({ label, value, hint, href, tone = "default", testId, className }: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: "default" | "bad";
  testId?: string;
  className?: string;
}) {
  const body = (
    <>
      <p className="g-stat__label">{label}</p>
      <p className={cn("g-stat__value", tone === "bad" && "g-stat__value--bad")}>{value}</p>
      {hint && <p className="g-stat__hint">{hint}</p>}
    </>
  );
  if (href) return <Link href={href} className={cn("g-stat", className)} data-testid={testId}>{body}</Link>;
  return <div className={cn("g-stat", className)} data-testid={testId}>{body}</div>;
}

/** Tiles two across on phones, up to `cols` on desktop. */
export function GoogleStatGrid({ children, cols = 3, className }: { children: ReactNode; cols?: 2 | 3 | 4; className?: string }) {
  const lg = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" }[cols];
  return <div className={cn("grid grid-cols-2 gap-3", lg, className)}>{children}</div>;
}
