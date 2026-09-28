import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
export function ReviewReferralSettings() {
  const { data } = useQuery<{ enabled: boolean; offer: string }>({ queryKey: ["/api/review-referral-settings"] });
  const [draft, setDraft] = useState<{ enabled: boolean; offer: string } | null>(null);
  const settings = draft || data || { enabled: false, offer: "" };
  const save = useMutation({ mutationFn: async () => (await apiRequest("PUT", "/api/review-referral-settings", settings)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/review-referral-settings"] }); setDraft(null); } });
  return <Card>
    <CardHeader><CardTitle>Customer referral offer</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Off by default. Your offer is for referred customers only, never for leaving a review or choosing a rating.</p>
      <div className="flex items-center gap-3"><Switch id="referral-enabled" checked={settings.enabled} onCheckedChange={enabled => setDraft({ ...settings, enabled })} /><Label htmlFor="referral-enabled">Show my referral offer</Label></div>
      <Label htmlFor="referral-offer">Offer and terms</Label>
      <Textarea id="referral-offer" maxLength={500} value={settings.offer} onChange={e => setDraft({ ...settings, offer: e.target.value })} placeholder="Describe your referral offer and eligibility terms" />
      <Button disabled={!data || save.isPending || (settings.enabled && !settings.offer.trim())} onClick={() => save.mutate()}>Save referral settings</Button>
      {save.isError && <p role="alert" className="text-sm text-destructive">Could not save referral settings.</p>}
      {save.isSuccess && <p role="status" className="text-sm">Referral settings saved.</p>}
    </CardContent>
  </Card>;
}
