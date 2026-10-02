import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPhone, type ForwardingCarrier, type VoiceNumber } from "./numbers-shared";

/** The digits a star code wants: "+13605550100" → "3605550100". */
const dialDigits = (e164: string) => e164.replace(/^\+1/, "");

/**
 * "Forward your lines" (numbers+billing lane). The copy is the server's static
 * list (server/voice/numbers.ts FORWARDING_CARRIERS); each step's
 * "<assistant number>" is filled with the chosen number's dial digits, so the
 * owner can read the code straight off the screen.
 */
export function ForwardingInstructions({ numbers, carriers, advice, initialId }: {
  numbers: VoiceNumber[];
  carriers: ForwardingCarrier[];
  advice: string[];
  initialId?: string | null;
}) {
  const usable = numbers.filter((n) => n.status === "active");
  const [id, setId] = useState<string>(initialId && usable.some((n) => n.id === initialId) ? initialId : usable[0]?.id ?? "");
  const [copied, setCopied] = useState(false);
  const current = usable.find((n) => n.id === id) ?? usable[0] ?? null;
  const fill = (text: string) => (current ? text.replaceAll("<assistant number>", dialDigits(current.phoneNumber)) : text);

  const copy = async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(dialDigits(current.phoneNumber));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: the number is on screen anyway */ }
  };

  return (
    <Card data-testid="card-voice-forwarding">
      <CardHeader className="space-y-1">
        <CardTitle className="text-lg">Forward your existing line</CardTitle>
        <CardDescription>
          Keep the number on your trucks, site and ads. Point it at the assistant and every call it can't reach you on goes to the assistant.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!current ? (
          <p className="text-sm text-muted-foreground" data-testid="text-voice-forwarding-none">Buy a number first; the steps here fill in with it.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {usable.length > 1 ? (
              <Select value={current.id} onValueChange={setId}>
                <SelectTrigger className="w-auto min-w-[16rem]" aria-label="Number to forward to" data-testid="select-voice-forwarding-number"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {usable.map((n) => <SelectItem key={n.id} value={n.id}>{formatPhone(n.phoneNumber)}{n.label ? ` — ${n.label}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-sm">Forward to <span className="font-semibold tabular-nums" data-testid="text-voice-forwarding-number">{formatPhone(current.phoneNumber)}</span></span>
            )}
            <Button size="sm" variant="outline" onClick={copy} data-testid="button-voice-forwarding-copy">
              {copied ? <Check className="h-4 w-4 mr-1.5" aria-hidden="true" /> : <Copy className="h-4 w-4 mr-1.5" aria-hidden="true" />}
              {copied ? "Copied" : "Copy digits"}
            </Button>
          </div>
        )}

        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {advice.map((a) => <li key={a}>{a}</li>)}
        </ul>

        <Accordion type="single" collapsible className="w-full" data-testid="accordion-voice-forwarding">
          {carriers.map((c) => (
            <AccordionItem key={c.id} value={c.id} data-testid={`forwarding-carrier-${c.id}`}>
              <AccordionTrigger className="text-sm">{c.name}</AccordionTrigger>
              <AccordionContent className="space-y-2 text-sm">
                <ol className="list-decimal space-y-1 pl-5">
                  {c.steps.map((s) => <li key={s} className="font-normal">{fill(s)}</li>)}
                </ol>
                {c.off && <p className="text-muted-foreground">{fill(c.off)}</p>}
                {c.note && <p className="text-xs text-muted-foreground">{c.note}</p>}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
        <p className="text-xs text-muted-foreground">
          Star codes differ by line type and plan; if a code doesn't confirm, your carrier's app or support line can set forwarding for you.
        </p>
      </CardContent>
    </Card>
  );
}
