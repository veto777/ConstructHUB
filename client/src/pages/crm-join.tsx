import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, UserPlus, AlertTriangle, HardHat } from "lucide-react";
import { StatusPill, roleTone } from "@/components/crm-ui";

interface Lookup {
  email: string;
  role: string;
  orgName: string | null;
}

function BrandMark() {
  return (
    <div className="flex items-center justify-center gap-2.5 mb-6">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <HardHat className="h-4 w-4" strokeWidth={2} />
      </div>
      <span className="font-semibold text-lg">
        ConstructHub <span className="text-primary font-bold">CRM</span>
      </span>
    </div>
  );
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

  const [phone, setPhone] = useState("");
  const accept = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/invitations/accept", { token, phone })).json(),
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
      <div className="min-h-[80vh] flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <BrandMark />
          <Card className="shadow-md">
            <CardHeader><CardTitle>Missing invitation link</CardTitle></CardHeader>
            <CardContent className="text-muted-foreground">
              This page needs an invitation token. Use the link from your invitation email.
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <BrandMark />
        <Card className="shadow-md">
          <CardHeader className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-2">
              <UserPlus className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <CardTitle>Join the team</CardTitle>
            <CardDescription>
              {data?.orgName ? `${data.orgName} invited you to ConstructHub CRM.` : "Checking your invitation…"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading && (
              <div className="flex justify-center py-2">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive rounded-lg border border-destructive/30 bg-destructive/5 p-3"
                data-testid="text-invite-error">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{String((error as Error).message)}</span>
              </div>
            )}

            {data && (
              <>
                <div className="rounded-lg border bg-muted/30 p-4 text-sm space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Invitation for</span>
                    <span className="font-medium">{data.email}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Role</span>
                    <StatusPill tone={roleTone(data.role)}>{data.role}</StatusPill>
                  </div>
                </div>
                <div>
                  <Label htmlFor="join-phone">Your direct phone number *</Label>
                  <Input id="join-phone" type="tel" placeholder="(555) 123-4567" value={phone}
                    onChange={(e) => setPhone(e.target.value)} data-testid="input-join-phone" />
                  <p className="text-xs text-muted-foreground mt-1">
                    Clients on your jobs see this — they need to know exactly who to reach.
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  You must be signed in as {data.email} to accept. If you don't have an account yet,
                  create one with that email address first.
                </p>
                <Button className="w-full" onClick={() => accept.mutate()}
                  disabled={accept.isPending || phone.replace(/[^\d]/g, "").length < 7}
                  data-testid="button-accept-invite">
                  {accept.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Accept invitation
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
