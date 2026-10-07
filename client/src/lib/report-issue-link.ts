/** "Report an issue" from any footer: the report page, told which page the person was on (`?from=`). */
export function reportIssueHref(base: "/report-issue" | "/crm/report-issue" = "/report-issue"): string {
  if (typeof window === "undefined") return base;
  const path = window.location.pathname;
  return path === base || path === "/" ? base : `${base}?from=${encodeURIComponent(path)}`;
}
