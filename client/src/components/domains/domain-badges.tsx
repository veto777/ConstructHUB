/**
 * Expiry, auto-renew and website-health badges for a domain row, plus the needs-attention
 * predicate behind the inventory's "Needs attention" filter. Mirrors the daily monitor's
 * thresholds (server/domains/service.ts monitor): expiry within 60/30/7 days, auto-renew
 * off, HTTPS down, SSL certificate within 30 days. Keep in step with the attention filter
 * in server/domains/routes.ts GET /api/domains.
 */
export type DomainStateLike = {
  expires?: string | null;
  autoRenew?: boolean | null;
} | null;
export type DomainHealthLike = {
  up?: boolean | null;
  sslExpires?: string | null;
  checkedAt?: string | null;
} | null;

export type Badge = { key: string; tone: "bad" | "warn" | "ok" | "muted"; label: string };

const daysUntil = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.ceil((t - Date.now()) / 86400000) : null;
};

const rel = (days: number) =>
  days < 0
    ? `${Math.abs(days)} day${Math.abs(days) !== 1 ? "s" : ""} ago`
    : `in ${days} day${days !== 1 ? "s" : ""}`;

export function domainBadges(
  state: DomainStateLike,
  health: DomainHealthLike,
): Badge[] {
  const badges: Badge[] = [];
  const expires = daysUntil(state?.expires);
  if (expires !== null) {
    if (expires < 0)
      badges.push({ key: "expired", tone: "bad", label: `Expired ${rel(expires)}` });
    else if (expires <= 7)
      badges.push({ key: "expiry", tone: "bad", label: `Expires ${rel(expires)}` });
    else if (expires <= 30)
      badges.push({ key: "expiry", tone: "warn", label: `Expires ${rel(expires)}` });
    else if (expires <= 60)
      badges.push({
        key: "expiry",
        tone: "muted",
        label: `Expires ${new Date(state!.expires!).toLocaleDateString()}`,
      });
  }
  if (state?.autoRenew === false)
    badges.push({ key: "autorenew", tone: "warn", label: "Auto-renew off" });
  if (health) {
    const ssl = daysUntil(health.sslExpires);
    if (health.up === false)
      badges.push({ key: "down", tone: "bad", label: "Website not answering" });
    if (ssl !== null && ssl <= 30)
      badges.push({
        key: "ssl",
        tone: ssl < 0 ? "bad" : "warn",
        label:
          ssl < 0
            ? `SSL certificate expired ${rel(ssl)}`
            : `SSL expires ${rel(ssl)}`,
      });
    if (health.up === true && (ssl === null || ssl > 30))
      badges.push({ key: "healthy", tone: "ok", label: "Website and SSL OK" });
  }
  return badges;
}

/** True when the daily monitor would flag this domain today (the attention filter's predicate). */
export function needsAttention(
  state: DomainStateLike,
  health: DomainHealthLike,
): boolean {
  const expires = daysUntil(state?.expires);
  return (
    (expires !== null && expires <= 60) ||
    state?.autoRenew === false ||
    health?.up === false ||
    (daysUntil(health?.sslExpires) ?? 99) <= 30
  );
}

export const badgeClass = (tone: Badge["tone"]) =>
  tone === "bad"
    ? "g-chip g-chip--sm g-closed"
    : tone === "warn"
      ? "g-chip g-chip--sm text-amber-700 dark:text-amber-400"
      : tone === "ok"
        ? "g-chip g-chip--sm g-open"
        : "g-chip g-chip--sm";
