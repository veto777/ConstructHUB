import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Bell, CheckCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** The social-platform-style bell: unread badge, dropdown feed, tap-through. */
export function CrmNotificationsBell() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const { data } = useQuery<{ unread: number; notifications: Notification[] }>({
    queryKey: ["/api/crm/notifications"],
    refetchInterval: 30_000,
  });
  const unread = data?.unread ?? 0;
  const items = data?.notifications ?? [];

  const readAll = useMutation({
    mutationFn: () => apiRequest("POST", "/api/crm/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/crm/notifications"] }),
  });
  const readOne = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/crm/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/crm/notifications"] }),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative inline-flex items-center justify-center rounded-md h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          data-testid="button-notifications-bell"
          aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 font-semibold text-center"
              data-testid="badge-notifications-unread"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" data-testid="popover-notifications">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => readAll.mutate()}
              data-testid="button-notifications-read-all"
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[380px] overflow-y-auto">
          {items.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground" data-testid="text-notifications-empty">
              Nothing yet — estimate opens, payments, and team activity land here.
            </div>
          )}
          {items.map((n) => (
            <button
              key={n.id}
              className={`w-full text-left px-3 py-2.5 border-b last:border-b-0 hover:bg-accent/60 transition-colors ${n.readAt ? "opacity-70" : ""}`}
              data-testid={`notification-item-${n.id}`}
              onClick={() => {
                if (!n.readAt) readOne.mutate(n.id);
                if (n.link) {
                  setOpen(false);
                  navigate(n.link);
                }
              }}
            >
              <div className="flex items-start gap-2">
                {!n.readAt && <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />}
                <div className={`min-w-0 ${n.readAt ? "pl-4" : ""}`}>
                  <div className="text-sm leading-snug">{n.title}</div>
                  {n.body && <div className="text-xs text-muted-foreground truncate mt-0.5">{n.body}</div>}
                  <div className="text-[11px] text-muted-foreground mt-0.5">{timeAgo(n.createdAt)}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
