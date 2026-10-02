import { EmptyState } from "@/components/crm-ui";
import { Hash } from "lucide-react";

/**
 * Numbers tab — buy-by-state wizard (state → area code / city → pick → label
 * + location), the org's numbers with release dates, and forwarding
 * instructions per carrier / CallRail. OWNER: numbers+billing lane (LANES.md).
 * API: /api/crm/voice/numbers* (server/voice/numbers.ts).
 */
export function NumbersPanel({ canManage }: { canManage: boolean }) {
  return (
    <div data-testid="panel-call-assistant-numbers" className="pt-4">
      <EmptyState
        icon={Hash}
        title="Numbers"
        description={canManage
          ? "Buy a local number by state, label it, and forward your existing line to it. Coming from the numbers lane."
          : "Only members who manage settings can buy or release numbers."}
      />
    </div>
  );
}
