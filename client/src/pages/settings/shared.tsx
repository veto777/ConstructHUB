import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";

/** Clipboard writes can be refused (no permission, insecure context, some browsers); report the outcome. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Title row above a section: name, one-line description, the ⓘ tip and optional actions. */
export function SettingsSectionHeader({ title, description, infoKey, actions }: {
  title: string;
  description?: string;
  infoKey?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-border/60" data-testid="settings-section-header">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight flex items-center gap-1" data-testid="text-settings-section-title">
          {title}
          {infoKey && <InfoTip k={infoKey} />}
        </h2>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function LoadingCard({ label = "Loading…" }: { label?: string }) {
  return (
    <Card>
      <CardContent className="py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" /> {label}
      </CardContent>
    </Card>
  );
}

/**
 * Reads a JSON endpoint that may not exist on this server yet. A 404, or the
 * SPA's HTML fallback (a 2xx page for an unknown /api path), resolves to
 * `null` ("unavailable") instead of throwing, so a panel can say so honestly.
 * Any other failure — a 401, a 5xx, the tunnel's HTML error page while the
 * server restarts — is still an error, so an outage never reads as "this
 * feature isn't installed".
 */
export async function fetchOptional<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  const type = res.headers.get("content-type") ?? "";
  if (res.status === 404 || (res.ok && !type.includes("application/json"))) return null;
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
  return (await res.json()) as T;
}

export function useOptionalQuery<T>(url: string, enabled = true) {
  return useQuery<T | null>({ queryKey: [url], queryFn: () => fetchOptional<T>(url), enabled });
}

export const formatDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString() : "—";

export const formatDateTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString() : "—";

export const formatCount = (v: number): string => v.toLocaleString("en-US");
