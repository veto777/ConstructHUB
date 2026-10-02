import { EmptyState } from "@/components/crm-ui";
import { Phone } from "lucide-react";
import type { VoiceStatus } from "./index";

/**
 * Overview tab — status, number(s), minutes used this month, next steps.
 * OWNER: studio-frontend lane (LANES.md). Reads GET /api/crm/voice/status
 * (numbers+billing lane fills numbers/profile/usage).
 */
export function OverviewPanel({ status, loading }: { status: VoiceStatus | null; loading: boolean }) {
  return (
    <div data-testid="panel-call-assistant-overview" className="pt-4">
      <EmptyState
        icon={Phone}
        title={loading ? "Loading…" : "Overview"}
        description={status
          ? `Allowance: ${status.allowance.numbers} number${status.allowance.numbers === 1 ? "" : "s"}, ${status.allowance.minutes.toLocaleString("en-US")} minutes / month. Engine ${status.engine.configured ? "configured" : "not configured"}.`
          : "Status, numbers and minutes used will show here."}
      />
    </div>
  );
}
