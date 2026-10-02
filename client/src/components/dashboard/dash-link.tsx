import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { Link } from "wouter";
import { portalUrl } from "@/lib/site";
import type { DashboardSurface } from "@shared/dashboard";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  surface: DashboardSurface;
  children: ReactNode;
};

/**
 * A dashboard link: an in-app route goes through wouter; a "portal" path is a
 * page on the CRM host, resolved with portalUrl() and opened with a full load.
 */
export const DashLink = forwardRef<HTMLAnchorElement, Props>(function DashLink({ href, surface, children, ...rest }, ref) {
  if (surface === "portal") {
    return <a ref={ref} href={portalUrl(href)} {...rest}>{children}</a>;
  }
  return <Link ref={ref} href={href} {...rest}>{children}</Link>;
});

/** Visible keyboard focus for plain links (Buttons carry their own). */
export const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
