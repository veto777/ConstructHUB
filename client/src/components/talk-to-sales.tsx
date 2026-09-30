/**
 * "Talk to a sales rep": everything at or above SALES_THRESHOLD_CENTS (SEO packages,
 * websites, formation + licensing, the Complete Business Build, Agency above
 * self-serve, custom work) is sold through a person, never a price or a
 * checkout. The form goes to the existing /api/seo-inquiry endpoint, which
 * emails the sales inbox; the topic travels as the requested service and the
 * company rides in the message.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { CheckCircle2, Loader2, MessageSquare, Send } from "lucide-react";

type TalkToSalesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What they asked about, e.g. "Monthly SEO packages" (sent as the requested service). */
  topic: string;
  /** Called when the dialog closes after a request was sent. */
  onSent?: () => void;
};

/** Server limits (routes.ts seoInquiryInput): service 100, message 5,000. */
const TOPIC_MAX = 100;
const NEED_MAX = 4500;

export function TalkToSalesDialog({ open, onOpenChange, topic, onSent }: TalkToSalesDialogProps) {
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [need, setNeed] = useState("");
  const ids = useId();

  const send = useMutation({
    mutationFn: async () => {
      const message = [company.trim() && `Company: ${company.trim()}`, need.trim()].filter(Boolean).join("\n\n");
      await apiRequest("POST", "/api/seo-inquiry", {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        services: [topic.slice(0, TOPIC_MAX)],
        message: message || null,
      });
    },
  });

  // Each opening starts a fresh request, prefilled from the signed-in account.
  useEffect(() => {
    if (!open) return;
    send.reset();
    setName((v) => v || user?.displayName || "");
    setEmail((v) => v || user?.email || "");
    setCompany((v) => v || user?.companyName || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canSend = name.trim().length > 0 && email.trim().length > 0 && !send.isPending;

  const setOpen = (next: boolean) => {
    onOpenChange(next);
    if (!next && send.isSuccess) onSent?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" data-testid="dialog-talk-to-sales">
        <DialogHeader>
          <DialogTitle>Talk to a sales rep</DialogTitle>
          <DialogDescription data-testid="text-sales-topic">
            About: <span className="font-medium text-foreground">{topic}</span>. We price this with you, so tell us a little about what you need.
          </DialogDescription>
        </DialogHeader>
        {send.isSuccess ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-green-500/30 bg-green-500/5 p-4" role="status" data-testid="text-sales-success">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
              <p className="text-sm">
                Thanks{name.trim() ? `, ${name.trim().split(" ")[0]}` : ""}. Your request went to our sales team; a rep will reply to <span className="font-medium">{email.trim()}</span>.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)} data-testid="button-sales-done">Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); if (canSend) send.mutate(); }}
            data-testid="form-talk-to-sales"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${ids}-name`}>Name</Label>
                <Input id={`${ids}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="name" required data-testid="input-sales-name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${ids}-email`}>Email</Label>
                <Input id={`${ids}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="email" required data-testid="input-sales-email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${ids}-phone`}>Phone <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input id={`${ids}-phone`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50} autoComplete="tel" data-testid="input-sales-phone" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${ids}-company`}>Company <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input id={`${ids}-company`} value={company} onChange={(e) => setCompany(e.target.value)} maxLength={200} autoComplete="organization" data-testid="input-sales-company" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-need`}>What do you need?</Label>
              <Textarea
                id={`${ids}-need`}
                value={need}
                onChange={(e) => setNeed(e.target.value)}
                maxLength={NEED_MAX}
                rows={4}
                placeholder="Trades, service area, timeline, anything we should know."
                data-testid="input-sales-need"
              />
            </div>
            {send.isError && (
              <p role="alert" className="text-sm text-destructive" data-testid="text-sales-error">{apiErrorMessage(send.error)}</p>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!canSend} data-testid="button-sales-submit">
                {send.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Send to sales
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

type TalkToSalesButtonProps = Omit<ButtonProps, "onClick" | "children" | "asChild"> & {
  topic: string;
  onSent?: () => void;
  children?: ReactNode;
  "data-testid"?: string;
};

/** A "Talk to a sales rep" button that opens the inquiry form for `topic`. */
export function TalkToSalesButton({ topic, onSent, children, ...buttonProps }: TalkToSalesButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" {...buttonProps} onClick={() => setOpen(true)}>
        {children ?? (<><MessageSquare className="h-4 w-4 mr-2 shrink-0" />Talk to a sales rep</>)}
      </Button>
      <TalkToSalesDialog open={open} onOpenChange={setOpen} topic={topic} onSent={onSent} />
    </>
  );
}
