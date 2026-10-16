/**
 * Server setup detail (env var names, "restart the app", worker switches) is for platform admins only; a customer
 * reads one plain sentence instead (audit wave 2, #8). The server decides who is a platform admin (/api/auth/me).
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export function usePlatformAdmin(): boolean {
  const { data } = useQuery<{ isPlatformAdmin?: boolean } | null>({ queryKey: ["/api/auth/me"] });
  return data?.isPlatformAdmin === true;
}

/** Renders its children only for a platform admin — e.g. the env var a missing feature needs. */
export function AdminSetupNote({ children, testId }: { children: ReactNode; testId?: string }) {
  if (!usePlatformAdmin()) return null;
  return <span className="mt-1 block text-xs g-text-2" data-testid={testId ?? "admin-setup-note"}>Admin: {children}</span>;
}
