import type { ComponentType, MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

/**
 * The Call / Directions / Website / Reviews pill of Google's local pack: 1px #dadce0 border, full radius,
 * blue icon + blue 14px/500 label, light-blue hover. `href` renders a link, otherwise a button.
 */
export function GooglePill({ icon: Icon, label, href, onClick, external, variant = "outline", disabled, testId, className, title, type = "button", ariaLabel }: {
  icon?: IconType;
  label: ReactNode;
  href?: string;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  /** Open the link in a new tab (sets rel="noopener noreferrer"). */
  external?: boolean;
  variant?: "outline" | "grey" | "solid" | "danger";
  disabled?: boolean;
  testId?: string;
  className?: string;
  title?: string;
  type?: "button" | "submit";
  ariaLabel?: string;
}) {
  const cls = cn("g-pill", variant === "grey" && "g-pill--grey", variant === "solid" && "g-pill--solid", variant === "danger" && "g-pill--danger", className);
  const body = <>{Icon && <Icon className="shrink-0" aria-hidden="true" />}<span>{label}</span></>;
  if (href && !disabled) {
    return (
      <a href={href} className={cls} onClick={onClick} data-testid={testId} title={title} aria-label={ariaLabel}
        target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>
        {body}
      </a>
    );
  }
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} data-testid={testId} title={title} aria-label={ariaLabel}>
      {body}
    </button>
  );
}
