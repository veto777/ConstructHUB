import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** The full-width grey "More businesses >" pill under Google's local pack. */
export function GoogleMoreButton({ label = "More businesses", onClick, href, disabled, testId, className }: {
  label?: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  testId?: string;
  className?: string;
}) {
  const body = <><span>{label}</span><ChevronRight aria-hidden="true" /></>;
  const cls = cn("g-pill g-pill--grey", className);
  if (href && !disabled) return <a href={href} className={cls} data-testid={testId}>{body}</a>;
  return <button type="button" className={cls} onClick={onClick} disabled={disabled} data-testid={testId}>{body}</button>;
}
