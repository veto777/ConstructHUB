import type { ComponentType, MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

/**
 * The Call / Directions / Website / Reviews pill of Google's local pack: 1px hairline, full radius, an accent
 * icon + accent 14px/500 label, a tinted hover. The accent is the surface's `--g-accent` (brand orange on the
 * platform, Google blue inside a GoogleSurface) — nothing here is hard-coded. `href` renders a link, otherwise
 * a button. `selected` is the filter-chip state (a tinted fill).
 */
export function GooglePill({ icon: Icon, label, href, onClick, external, variant = "outline", size, selected, disabled, testId, className, title, type = "button", ariaLabel, ariaPressed, role }: {
  icon?: IconType;
  label: ReactNode;
  href?: string;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  /** Open the link in a new tab (sets rel="noopener noreferrer"). */
  external?: boolean;
  variant?: "outline" | "grey" | "solid" | "danger" | "quiet";
  /** sm: 32px tall, 13px label — for dense rows. */
  size?: "sm";
  selected?: boolean;
  disabled?: boolean;
  testId?: string;
  className?: string;
  title?: string;
  type?: "button" | "submit";
  ariaLabel?: string;
  ariaPressed?: boolean;
  role?: string;
}) {
  const cls = cn(
    "g-pill",
    variant === "grey" && "g-pill--grey", variant === "solid" && "g-pill--solid", variant === "danger" && "g-pill--danger", variant === "quiet" && "g-pill--quiet",
    size === "sm" && "g-pill--sm", selected && "g-pill--on", className,
  );
  const body = <>{Icon && <Icon className="shrink-0" aria-hidden="true" />}<span>{label}</span></>;
  if (href && !disabled) {
    return (
      <a href={href} className={cls} onClick={onClick} data-testid={testId} title={title} aria-label={ariaLabel} role={role}
        target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>
        {body}
      </a>
    );
  }
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} data-testid={testId} title={title} aria-label={ariaLabel}
      aria-pressed={ariaPressed} role={role} aria-checked={role === "radio" ? ariaPressed : undefined}>
      {body}
    </button>
  );
}
