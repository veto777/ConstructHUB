import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Inside the iPhone apps a locked tool only says it isn't on the account — no plan name, price, upgrade or link to
 * buy anything (owner, 2026-10-04: the apps sell nothing — App Store 3.1.3(f); docs/app/APP-STORE-PLAN.md).
 */
export function AppLocked({ name, testId, compact = false }: { name: string; testId?: string; compact?: boolean }) {
  if (compact) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground" data-testid={testId}>
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Not on this account.
      </p>
    );
  }
  return (
    <Card data-testid={testId}>
      <CardContent className="flex items-start gap-3 py-6 text-sm">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p><span className="font-medium">{name}</span> isn't on this account.</p>
      </CardContent>
    </Card>
  );
}
