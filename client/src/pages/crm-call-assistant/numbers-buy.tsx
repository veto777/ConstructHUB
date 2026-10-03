import { Section } from "@/components/app-ui";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Search, ArrowLeft, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { formatUsd } from "@shared/plan-copy";
import { US_STATES, NUMBERS_KEY, formatPhone, type SearchResponse, type VoiceNumber } from "./numbers-shared";

type Step = "where" | "pick" | "details";

/**
 * Buy-a-number wizard (numbers+billing lane): state (+ optional area code /
 * city) → up to 10 candidates from SignalWire → label / location / the line
 * you'll forward → buy. `onBought` hands the new number to the forwarding
 * instructions. The price shown comes from the server (included vs an extra
 * number), never computed here.
 */
export function BuyNumberWizard({ minDays, mock, onBought, onCancel }: {
  minDays: number;
  mock: boolean;
  onBought: (n: VoiceNumber) => void;
  onCancel?: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("where");
  const [state, setState] = useState("");
  const [areaCode, setAreaCode] = useState("");
  const [city, setCity] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [picked, setPicked] = useState("");
  const [label, setLabel] = useState("");
  const [location, setLocation] = useState("");
  const [forwardingFrom, setForwardingFrom] = useState("");

  const areaCodeOk = areaCode === "" || /^\d{3}$/.test(areaCode);
  const search = useQuery<SearchResponse>({ queryKey: [query ?? ""], enabled: query !== null, retry: false, staleTime: 60_000 });
  const candidates = search.data?.numbers ?? [];
  const chosen = candidates.find((c) => c.phoneNumber === picked) ?? null;

  const runSearch = () => {
    const params = new URLSearchParams({ state, limit: "10" });
    if (areaCode) params.set("areaCode", areaCode);
    if (city.trim()) params.set("city", city.trim());
    setPicked("");
    setQuery(`${NUMBERS_KEY}/search?${params.toString()}`);
    setStep("pick");
  };

  const buy = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", NUMBERS_KEY, {
        phoneNumber: picked, label: label.trim() || undefined, location: location.trim() || undefined,
        state, locality: chosen?.locality ?? undefined, forwardingFrom: forwardingFrom.trim() || undefined,
      });
      return (await res.json()) as { number: VoiceNumber; mock: boolean };
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: [NUMBERS_KEY] });
      void queryClient.invalidateQueries({ queryKey: ["/api/crm/voice/status"] });
      toast({ title: `${formatPhone(data.number.phoneNumber)} is yours`, description: data.mock ? "Mock carrier — no real number was bought." : "Now forward your line to it." });
      onBought(data.number);
    },
    onError: (e) => toast({ title: "Couldn't buy that number", description: apiErrorMessage(e), variant: "destructive" }),
  });

  return (
    <Section flush testId="card-voice-number-buy">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <PhoneCall className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          Get a local number
          {mock && <Badge variant="outline" data-testid="badge-voice-numbers-mock">Mock carrier</Badge>}
        </CardTitle>
        <CardDescription>
          Step {step === "where" ? 1 : step === "pick" ? 2 : 3} of 3 — {step === "where" ? "where your callers are" : step === "pick" ? "pick a number" : "name it and buy"}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === "where" && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (state && areaCodeOk) runSearch(); }}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="voice-number-state">State</Label>
                <Select value={state} onValueChange={setState}>
                  <SelectTrigger id="voice-number-state" data-testid="select-voice-number-state"><SelectValue placeholder="Choose a state" /></SelectTrigger>
                  <SelectContent>
                    {US_STATES.map((s) => <SelectItem key={s.code} value={s.code} data-testid={`option-voice-number-state-${s.code}`}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="voice-number-area">Area code <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input id="voice-number-area" inputMode="numeric" placeholder="360" value={areaCode}
                  onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  aria-invalid={!areaCodeOk} data-testid="input-voice-number-area-code" />
                {!areaCodeOk && <p className="text-xs text-destructive">An area code is three digits.</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="voice-number-city">City <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input id="voice-number-city" placeholder="Bellingham" maxLength={60} value={city} onChange={(e) => setCity(e.target.value)} data-testid="input-voice-number-city" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              A number in your callers' area code looks local on their phone. A city narrows the list; if nothing comes back, try just the state.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="submit" disabled={!state || !areaCodeOk} data-testid="button-voice-number-search">
                <Search className="h-4 w-4 mr-1.5" aria-hidden="true" />Find numbers
              </Button>
              {onCancel && <Button type="button" variant="ghost" onClick={onCancel} data-testid="button-voice-number-cancel">Cancel</Button>}
            </div>
          </form>
        )}

        {step === "pick" && (
          <div className="space-y-4">
            {search.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />Asking the carrier for numbers…</p>
            ) : search.isError ? (
              <p className="text-sm text-destructive" role="alert" data-testid="text-voice-number-search-error">{apiErrorMessage(search.error)}</p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-voice-number-none">
                No numbers available there right now. Try without the city, another area code, or a neighbouring one.
              </p>
            ) : (
              <>
                <p className="text-sm" data-testid="text-voice-number-price">
                  {search.data!.monthlyCents === 0
                    ? "Included in your AI Call Assistant add-on."
                    : `This would be an extra number: ${formatUsd(search.data!.monthlyCents)} a month (the Extra Call Assistant number add-on).`}
                </p>
                <RadioGroup value={picked} onValueChange={setPicked} className="grid gap-2 sm:grid-cols-2" aria-label="Available numbers">
                  {candidates.map((c) => (
                    <Label key={c.phoneNumber} htmlFor={`voice-cand-${c.phoneNumber}`}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 has-[[data-state=checked]]:border-primary"
                      data-testid={`option-voice-number-${c.phoneNumber}`}>
                      <RadioGroupItem id={`voice-cand-${c.phoneNumber}`} value={c.phoneNumber} />
                      <span className="min-w-0">
                        <span className="block font-medium tabular-nums">{formatPhone(c.phoneNumber)}</span>
                        <span className="block text-xs text-muted-foreground">{[c.locality, c.region].filter(Boolean).join(", ") || "Location not listed"}{c.capabilities.sms ? " · can text" : ""}</span>
                      </span>
                    </Label>
                  ))}
                </RadioGroup>
              </>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => setStep("where")} data-testid="button-voice-number-back"><ArrowLeft className="h-4 w-4 mr-1.5" aria-hidden="true" />Change area</Button>
              <Button disabled={!picked} onClick={() => { setLocation((l) => l || [chosen?.locality, state].filter(Boolean).join(", ")); setStep("details"); }} data-testid="button-voice-number-next">Use this number</Button>
            </div>
          </div>
        )}

        {step === "details" && chosen && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!buy.isPending) buy.mutate(); }}>
            <p className="text-sm">
              <span className="font-semibold tabular-nums" data-testid="text-voice-number-chosen">{formatPhone(chosen.phoneNumber)}</span>
              {chosen.locality ? <span className="text-muted-foreground"> · {chosen.locality}, {chosen.region}</span> : null}
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="voice-number-label">Label</Label>
                <Input id="voice-number-label" maxLength={60} placeholder="Main office" value={label} onChange={(e) => setLabel(e.target.value)} data-testid="input-voice-number-label" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="voice-number-location">Location</Label>
                <Input id="voice-number-location" maxLength={120} placeholder="Bellingham, WA" value={location} onChange={(e) => setLocation(e.target.value)} data-testid="input-voice-number-location" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="voice-number-forward">Line you'll forward <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input id="voice-number-forward" inputMode="tel" placeholder="(360) 555-0199" value={forwardingFrom} onChange={(e) => setForwardingFrom(e.target.value)} data-testid="input-voice-number-forwarding-from" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {search.data && search.data.monthlyCents > 0 ? `Billed at ${formatUsd(search.data.monthlyCents)} a month as an extra number. ` : ""}
              The carrier keeps a number for at least {minDays} days, so it can be released {minDays} days after you buy it.
              {mock ? " Mock carrier: nothing is bought and the number won't ring." : ""}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setStep("pick")} disabled={buy.isPending} data-testid="button-voice-number-back-pick"><ArrowLeft className="h-4 w-4 mr-1.5" aria-hidden="true" />Back</Button>
              <Button type="submit" disabled={buy.isPending} data-testid="button-voice-number-buy">
                {buy.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" /> : null}
                Buy {formatPhone(chosen.phoneNumber)}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Section>
  );
}
