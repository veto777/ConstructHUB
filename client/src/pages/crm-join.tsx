import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, UserPlus, AlertTriangle } from "lucide-react";

interface Lookup {
  email: string;
  role: string;
  orgName: string | null;
}

/** Landing page for a team invitation link: /crm/join?token=… */
export default function CrmJoinPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    setToken(t);
  }, []);

  const { data, isLoading, error } = useQuery<Lookup>({
    queryKey: ["/api/crm/invitations/lookup", token],
    queryFn: async () => {
      const r = await fetch(`/api/crm/invitations/lookup/${token}`, { credentials: "include" });
      if (!r.ok) throw new Error((await r.text()) || "Invitation not found");
      return r.json();
    },
    enabled: !!token,
    retry: false,
  });

  const accept = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/invitations/accept", { token })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/me"] });
      toast({ title: "Welcome aboard" });
      navigate("/crm/team");
    },
    onError: (e: any) =>
      toast({ title: "Could not accept", description: String(e.message ?? e), variant: "destructive" }),
  });

  if (!token) {
    return (
      <div className="p-10 max-w-lg mx-auto">
        <Card>
          <CardHeader><CardTitle>Missing invitation link</CardTitle></CardHeader>
          <CardContent className="text-muted-foreground">
            This page needs an invitation token. Use the link from your invitation email.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-10 max-w-lg mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> Join the team
          </CardTitle>
          <CardDescription>
            {data?.orgName ? `${data.orgName} invited you to ConstructHub CRM.` : "Checking your invitation…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-invite-error">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{String((error as Error).message)}</span>
            </div>
          )}

          {data && (
            <>
              <div className="text-sm space-y-1">
                <div>
                  Invitation for <span className="font-medium">{data.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  Role: <Badge variant="secondary">{data.role}</Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                You must be signed in as {data.email} to accept. If you don't have an account yet,
                create one with that email address first.
              </p>
              <Button onClick={() => accept.mutate()} disabled={accept.isPending} data-testid="button-accept-invite">
                {accept.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Accept invitation
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
