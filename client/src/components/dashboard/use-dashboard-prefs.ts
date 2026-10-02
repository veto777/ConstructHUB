/**
 * Writes for the dashboard's per-user preferences (server/dashboard/index.ts):
 * clear / snooze / restore "Needs you today" items and save the layout. Each
 * write updates the cached GET /api/dashboard answer at once (optimistic),
 * then refetches it; a failed write puts the old answer back and says so.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DashboardAttentionItem, DashboardPayload } from "@shared/dashboard";
import {
  attentionSignature, isDefaultDashboardLayout, sortByDashboardLayout,
  type DashboardClearedItem, type DashboardLayout,
} from "@shared/dashboard-prefs";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export const DASHBOARD_QUERY_KEY = ["/api/dashboard"] as const;

type Snapshot = { prev: DashboardPayload | undefined };

function useDashboardWrite<V>(opts: {
  request: (vars: V) => Promise<unknown>;
  optimistic: (data: DashboardPayload, vars: V) => DashboardPayload;
  failTitle: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation<unknown, Error, V, Snapshot>({
    mutationFn: opts.request,
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: DASHBOARD_QUERY_KEY });
      const prev = qc.getQueryData<DashboardPayload>(DASHBOARD_QUERY_KEY);
      if (prev) qc.setQueryData<DashboardPayload>(DASHBOARD_QUERY_KEY, opts.optimistic(prev, vars));
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(DASHBOARD_QUERY_KEY, ctx.prev);
      toast({ title: opts.failTitle, description: apiErrorMessage(err), variant: "destructive" });
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }); },
  });
}

export type DismissVars = { items: DashboardAttentionItem[]; until: Date | null };

/** The CRM org the shown answer is for: CRM items are cleared and restored in it only. */
function useScope() {
  const qc = useQueryClient();
  return () => qc.getQueryData<DashboardPayload>(DASHBOARD_QUERY_KEY)?.scope ?? "";
}

/** Clear ("Done", until: null) or snooze items. */
export function useDismissItems() {
  const scope = useScope();
  return useDashboardWrite<DismissVars>({
    failTitle: "Couldn't clear that",
    request: ({ items, until }) => apiRequest("PUT", "/api/dashboard/dismissals", {
      items: items.map((i) => ({ key: i.key, value: attentionSignature(i), until: until ? until.toISOString() : null })),
      scope: scope(),
    }),
    optimistic: (data, { items, until }) => {
      const keys = new Set(items.map((i) => i.key));
      const moved: DashboardClearedItem[] = items.map((i) => ({ ...i, signature: attentionSignature(i), until: until ? until.toISOString() : null }));
      return {
        ...data,
        attention: data.attention.filter((i) => !keys.has(i.key)),
        cleared: [...data.cleared.filter((i) => !keys.has(i.key)), ...moved],
      };
    },
  });
}

/** Restore cleared items: these, or every one (`items` null). */
export function useRestoreItems() {
  const scope = useScope();
  return useDashboardWrite<{ items: DashboardClearedItem[] | null }>({
    failTitle: "Couldn't restore that",
    request: async ({ items }) => {
      const q = `?scope=${encodeURIComponent(scope())}`;
      if (!items) return apiRequest("DELETE", `/api/dashboard/dismissals${q}`);
      for (const i of items) await apiRequest("DELETE", `/api/dashboard/dismissals/${encodeURIComponent(i.key)}${q}`);
    },
    optimistic: (data, { items }) => {
      const back = items ?? data.cleared;
      const keys = new Set(back.map((i) => i.key));
      const restored: DashboardAttentionItem[] = back.map(({ signature: _s, until: _u, ...item }) => item);
      // "bad" first, then the rest, as the server orders them.
      const attention = [...data.attention.filter((i) => !keys.has(i.key)), ...restored];
      return {
        ...data,
        attention: [...attention.filter((i) => i.tone === "bad"), ...attention.filter((i) => i.tone !== "bad")],
        cleared: data.cleared.filter((i) => !keys.has(i.key)),
      };
    },
  });
}

/**
 * Save the layout (the default is saved as a reset). Tiles reorder and hide at
 * once; newly shown ones load with the refetch. A hidden tile's alerts stay in
 * "Needs you today".
 */
export function useSaveLayout() {
  return useDashboardWrite<DashboardLayout>({
    failTitle: "Couldn't save your dashboard",
    request: (layout) => isDefaultDashboardLayout(layout)
      ? apiRequest("DELETE", "/api/dashboard/layout")
      : apiRequest("PUT", "/api/dashboard/layout", { layout }),
    optimistic: (data, layout) => {
      const hidden = new Set(layout.hidden);
      return {
        ...data,
        layout,
        tiles: sortByDashboardLayout(data.tiles.filter((t) => !hidden.has(t.key)), layout),
      };
    },
  });
}
