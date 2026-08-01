import { CHLogo } from "@/components/ch-logo";

/**
 * The CRM's brand lockup: the ConstructHUB mark plus a CRM badge in the
 * product's secondary accent (purple/blue — `--crm-accent`, set by the
 * `crm-theme` class on <html>; the hsl() fallback keeps the badge sane
 * anywhere else). The CRM reads as its own product while staying visibly
 * part of ConstructHUB. The marketing mark itself (ch-logo.tsx) is untouched.
 */
export function CrmLogo({
  height = 36,
  className = "",
  testid,
}: {
  height?: number;
  className?: string;
  testid?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} data-testid={testid}>
      <CHLogo height={height} />
      <span
        className="inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 font-extrabold uppercase tracking-wider"
        style={{
          fontSize: Math.max(10, Math.round(height * 0.32)),
          lineHeight: 1.25,
          backgroundColor: "hsl(var(--crm-accent, 250 84% 60%))",
          color: "hsl(var(--crm-accent-foreground, 0 0% 100%))",
        }}
      >
        CRM
      </span>
    </span>
  );
}
