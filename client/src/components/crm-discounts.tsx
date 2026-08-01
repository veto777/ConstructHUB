import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BadgePercent, Loader2, Plus, Trash2 } from "lucide-react";

type Offer = {
  id?: string;
  code: string;
  label: string;
  percentBps: number;
  conditions: string | null;
  enabled: boolean;
};

type Preset = {
  code: string;
  label: string;
  percentBps: number;
  conditions: string;
  defaultEnabled: boolean;
};

const pct = (bps: number) => (bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * Optional discount offers for one estimate — the creator ticks which preset
 * offers (or custom ones) the CLIENT may select on the gated public page.
 * The client's picks only preview the total; the server re-computes on
 * approve. Price-match stays off unless the creator explicitly enables it —
 * matching bids is a bad sales tactic, offered here only deliberately.
 *
 * Self-contained: own dialog, own queries. Mounted per estimate row on the
 * client detail page.
 */
export function EstimateDiscounts({ estimate }: { estimate: any }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [customLabel, setCustomLabel] = useState("");
  const [customPct, setCustomPct] = useState("");
  const [customConditions, setCustomConditions] = useState("");

  const { data, isLoading } = useQuery<{ offers: Offer[]; presets: Preset[] }>({
    queryKey: [`/api/crm/estimates/${estimate.id}/discounts`],
    enabled: open,
  });
  const presets = data?.presets ?? [];

  // Reset the editable list from the server each time the dialog opens.
  useEffect(() => {
    if (open && data) setOffers(data.offers.map((o) => ({ ...o })));
  }, [open, data]);

  const save = useMutation({
    mutationFn: async () =>
      (await apiRequest("PUT", `/api/crm/estimates/${estimate.id}/discounts`, {
        offers: offers.map((o, idx) => ({
          code: o.code, label: o.label, percentBps: o.percentBps,
          conditions: o.conditions || null, enabled: o.enabled, sortOrder: idx,
        })),
      })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/crm/estimates/${estimate.id}/discounts`] });
      setOpen(false);
      toast({ title: "Discount offers saved", description: "They appear on the client's estimate page." });
    },
    onError: (e: any) => toast({ title: "Could not save offers", description: String(e.message ?? e), variant: "destructive" }),
  });

  const presetOffer = (code: string) => offers.find((o) => o.code === code);
  const togglePreset = (p: Preset, on: boolean) => {
    if (on) {
      setOffers((cur) => [...cur, {
        code: p.code, label: p.label, percentBps: p.percentBps,
        conditions: p.conditions, enabled: p.defaultEnabled,
      }]);
    } else {
      setOffers((cur) => cur.filter((o) => o.code !== p.code));
    }
  };
  const setOffer = (code: string, patch: Partial<Offer>) =>
    setOffers((cur) => cur.map((o) => (o.code === code ? { ...o, ...patch } : o)));

  const addCustom = () => {
    const bps = Math.round((parseFloat(customPct) || 0) * 100);
    if (!customLabel.trim() || bps <= 0) return;
    setOffers((cur) => [...cur, {
      code: `custom-${Date.now().toString(36)}`,
      label: customLabel.trim(), percentBps: bps,
      conditions: customConditions.trim() || null, enabled: true,
    }]);
    setCustomLabel(""); setCustomPct(""); setCustomConditions("");
  };

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}
        data-testid={`button-discounts-${estimate.id}`}>
        <BadgePercent className="h-4 w-4 mr-2" /> Discounts
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Optional discounts — {estimate.number}</DialogTitle>
          </DialogHeader>

          {isLoading ? (
            <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Tick the offers this client may choose on their estimate page. Each carries its
                conditions; the total updates live as they tick, and is re-computed on our side
                when they approve.
              </p>

              <div className="space-y-2">
                {presets.map((p) => {
                  const offer = presetOffer(p.code);
                  return (
                    <Card key={p.code} data-testid={`preset-${p.code}`}>
                      <CardContent className="p-3 space-y-2">
                        <label className="flex items-center gap-2 text-sm font-medium">
                          <Checkbox
                            checked={!!offer}
                            onCheckedChange={(c) => togglePreset(p, c === true)}
                            data-testid={`check-preset-${p.code}`}
                          />
                          {p.label} <span className="text-muted-foreground font-normal">−{pct(p.percentBps)}%</span>
                        </label>
                        <p className="text-xs text-muted-foreground pl-6">{p.conditions}</p>
                        {offer && (
                          <div className="pl-6 flex items-center gap-2">
                            <Switch
                              checked={offer.enabled}
                              onCheckedChange={(v) => setOffer(p.code, { enabled: v })}
                              data-testid={`switch-offer-${p.code}`}
                            />
                            <span className="text-xs text-muted-foreground">
                              {offer.enabled ? "Shown to the client" : "Hidden from the client"}
                            </span>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {offers.filter((o) => o.code.startsWith("custom-")).length > 0 && (
                <div className="space-y-2">
                  {offers.filter((o) => o.code.startsWith("custom-")).map((o) => (
                    <div key={o.code} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                      data-testid={`custom-offer-${o.code}`}>
                      <div className="text-sm min-w-0">
                        <span className="font-medium">{o.label}</span>
                        <span className="text-muted-foreground"> −{pct(o.percentBps)}%</span>
                        {o.conditions && <div className="text-xs text-muted-foreground truncate">{o.conditions}</div>}
                      </div>
                      <Button size="sm" variant="ghost"
                        onClick={() => setOffers((cur) => cur.filter((x) => x.code !== o.code))}
                        data-testid={`button-remove-${o.code}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Separator />
              <div className="space-y-2">
                <div className="text-sm font-medium">Custom offer</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Label</Label>
                    <Input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)}
                      placeholder="Repeat client" data-testid="input-custom-discount-label" />
                  </div>
                  <div>
                    <Label className="text-xs">Discount %</Label>
                    <Input type="number" step="0.5" min="0" value={customPct}
                      onChange={(e) => setCustomPct(e.target.value)}
                      data-testid="input-custom-discount-pct" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Conditions (optional)</Label>
                  <Input value={customConditions} onChange={(e) => setCustomConditions(e.target.value)}
                    placeholder="What the client must do to qualify" data-testid="input-custom-discount-conditions" />
                </div>
                <Button size="sm" variant="outline" onClick={addCustom}
                  disabled={!customLabel.trim() || !(parseFloat(customPct) > 0)}
                  data-testid="button-add-custom-discount">
                  <Plus className="h-4 w-4 mr-2" /> Add custom offer
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => save.mutate()} disabled={save.isPending || isLoading}
              data-testid="button-save-discounts">
              {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save offers
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
