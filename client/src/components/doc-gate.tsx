import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Lock, MailCheck } from "lucide-react";
import { PrintLockdown } from "@/components/print-lockdown";

/**
 * The email gate for private documents (Jobber-style). The server answered
 * 401 { requiresVerification: true } to the anonymous document fetch; the
 * visitor proves they own the inbox the document was sent to. The endpoint
 * ALWAYS answers { sent: true } — whether the email matched is never
 * revealed here either. On a match, the emailed magic link flips to a client
 * session and lands back on this same URL, which then just works.
 */
export function DocGateChallenge({ docType, token }: { docType: "estimate" | "invoice"; token: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/public/verify-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType, token, email }),
      });
      if (r.status === 429) {
        setError("Too many attempts. Please try again in a few minutes.");
        return;
      }
      if (!r.ok) {
        setError("Enter a valid email address.");
        return;
      }
      setSent(true);
    } catch {
      setError("Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-muted/40 flex items-start justify-center py-16 px-4">
      <PrintLockdown />
      <Card className="max-w-md w-full shadow-md" data-testid="doc-gate">
        <CardContent className="p-8 space-y-4">
          {sent ? (
            <div className="text-center space-y-3">
              <MailCheck className="h-10 w-10 text-primary mx-auto" />
              <h1 className="text-xl font-semibold">Check your inbox</h1>
              <p className="text-sm text-muted-foreground" data-testid="text-gate-sent">
                If that email matches the one this document was sent to, a secure access link
                is on its way. It expires in 30 minutes, works once, and brings you straight
                back to this document.
              </p>
            </div>
          ) : (
            <>
              <div className="text-center space-y-2">
                <Lock className="h-10 w-10 text-muted-foreground mx-auto" />
                <h1 className="text-xl font-semibold">This document is private</h1>
                <p className="text-sm text-muted-foreground">
                  Enter the email address it was sent to and we'll email you a secure access link.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="gate-email">Email address</Label>
                <Input
                  id="gate-email"
                  type="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && email.trim() && !busy) submit(); }}
                  placeholder="you@example.com"
                  data-testid="input-gate-email"
                />
              </div>
              {error && <p className="text-sm text-destructive" data-testid="text-gate-error">{error}</p>}
              <Button className="w-full" disabled={!email.trim() || busy} onClick={submit} data-testid="button-gate-send">
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Email me a secure link
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
