import { EmptyState } from "@/components/crm-ui";
import { PhoneIncoming } from "lucide-react";

/**
 * Calls tab — the log (outcome, summary, transcript, recording player, linked
 * client), the spam view (?spam=1) with the ledger and unblock, and open
 * escalations. OWNER: calls+crm lane (LANES.md). API: /api/crm/voice/calls*,
 * /spam*, /escalations* (server/voice/calls.ts).
 */
export function CallsPanel({ canManage }: { canManage: boolean }) {
  return (
    <div data-testid="panel-call-assistant-calls" className="pt-4">
      <EmptyState
        icon={PhoneIncoming}
        title="Calls"
        description={`Every call with its outcome, transcript and recording${canManage ? ", plus the spam ledger" : ""}. Coming from the calls lane.`}
      />
    </div>
  );
}
