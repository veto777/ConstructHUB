import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2 } from "lucide-react";
import { ErrorCard } from "@/components/crm-ui";

/**
 * Public lead-capture form — the page contractors embed on their own
 * marketing site (iframe) or link to directly. Token-authorised like
 * /co/:token: no login, no email gate, no CRM chrome (full-bleed).
 *
 * The `website` field is a honeypot: hidden from humans, auto-filled by
 * bots. The server answers bot submissions with the same 201 as real ones,
 * so nothing here treats them differently either.
 */
export default function PublicLeadFormPage() {
  const [, params] = useRoute("/lead-form/:token");
  const token = params?.token;

  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "", address: "", website: "" });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: org, isLoading, error: loadError } = useQuery<{ name: string; logoUrl: string | null }>({
    queryKey: [`/api/public/leads/${token}`], enabled: !!token, retry: false,
  });

  const submit = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/public/leads/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          message: form.message.trim() || undefined,
          address: form.address.trim() || undefined,
          website: form.website,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Something went wrong");
      return r.json();
    },
    onSuccess: () => setSent(true),
    onError: (e: any) => setError(String(e.message ?? e)),
  });

  if (isLoading) {
    return <div className="flex justify-center p-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (loadError || !org) {
    return (
      <div className="min-h-screen bg-muted/40 flex items-start justify-center py-16 px-4">
        <ErrorCard title="This form isn't available" description="The link may have been rotated — ask the company for a fresh one." />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-muted/40 py-6 px-3 sm:py-10 sm:px-4" data-testid="public-lead-form-root">
      <div className="max-w-lg mx-auto">
        <Card className="shadow-md overflow-hidden">
          <div className="border-b p-6 sm:p-8">
            {org.logoUrl && <img src={org.logoUrl} alt={org.name} className="h-12 object-contain mb-2" />}
            <h1 className="text-xl font-semibold tracking-tight">{org.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Tell us about your project and we'll get back to you.
            </p>
          </div>
          <CardContent className="p-6 sm:p-8">
            {sent ? (
              <div className="flex items-start gap-3" data-testid="text-lead-success">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Thanks — we'll be in touch.</div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {org.name} has received your message.
                  </p>
                </div>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  setError(null);
                  submit.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="lead-name">Name *</Label>
                  <Input id="lead-name" required maxLength={200} data-testid="input-lead-name"
                    value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="lead-email">Email</Label>
                    <Input id="lead-email" type="email" data-testid="input-lead-email"
                      value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lead-phone">Phone</Label>
                    <Input id="lead-phone" type="tel" data-testid="input-lead-phone"
                      value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lead-address">Address</Label>
                  <Input id="lead-address" data-testid="input-lead-address"
                    value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lead-message">How can we help?</Label>
                  <Textarea id="lead-message" rows={4} data-testid="textarea-lead-message"
                    value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
                </div>
                {/* Honeypot — off-screen, unreachable by keyboard, ignored by autofill. */}
                <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "-9999px" }}>
                  <label>
                    Website
                    <input type="text" tabIndex={-1} autoComplete="off"
                      value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
                  </label>
                </div>
                {error && <p className="text-sm text-destructive" data-testid="text-lead-error">{error}</p>}
                <Button type="submit" className="w-full" disabled={submit.isPending || !form.name.trim()}
                  data-testid="button-lead-submit">
                  {submit.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Send
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
