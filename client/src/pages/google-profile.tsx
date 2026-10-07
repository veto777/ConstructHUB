import { AppPage, PageHeader } from "@/components/app-ui";
import { GoogleSurface } from "@/components/google";
/**
 * /google-profile — the sidebar's "Google Profile" button (owner, 2026-10-02: "just add button that says
 * Google Profile and it takes you to that page"). One location → its profile page; several → the list to
 * pick from; none yet → straight to importing it from the connected Google account.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export default function GoogleProfilePage() {
  const [, setLocation] = useLocation();
  const { data, error } = useQuery<{ items: { id: number }[]; total: number }>({
    queryKey: ["/api/locations", "paged", "google-profile"],
    queryFn: () => apiRequest("GET", "/api/locations?paged=true&offset=0").then((r) => r.json()),
  });
  useEffect(() => {
    if (error) { setLocation("/locations", { replace: true }); return; }
    if (!data) return;
    if (data.total === 1 && data.items[0]) setLocation(`/locations?location=${data.items[0].id}`, { replace: true });
    else if (data.total === 0) setLocation("/locations?import=gbp", { replace: true });
    else setLocation("/locations", { replace: true });
  }, [data, error, setLocation]);
  return (
    <GoogleSurface page><AppPage className="before:hidden" testId="page-google-profile"><PageHeader title="Google Profile" description="Opening your business profile."/><div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Opening your Google Business Profile…
    </div></AppPage></GoogleSurface>
  );
}
